import { defineStore } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'

import {
  procedureById,
  procedureSubject,
  rowsFromPendingItems,
  type CalibrationProcedure,
  type PendingItems,
  type ProcedureAction,
  type ProcedureContext,
  type ProcedureId,
  type ProcedureOutcome,
  type ProcedureResult,
  type ProcedureResultRow,
  type ProcedureSnapshot,
  type ProcedureValues,
  type ShaperCandidate,
  procedureHelper,
} from '@/features/calibration/procedures'
import type { LevelingMethod } from '@/stores/printerConfig'
import { useAvailabilityStore } from '@/stores/availability'
import { useBedScrewsStore } from '@/stores/bedScrews'
import { useManualProbeStore } from '@/stores/manualProbe'
import { useConsoleStore } from '@/stores/console'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import { useQuickConfigStore } from '@/stores/quickConfig'
import { useShakeTuneStore } from '@/stores/shakeTune'

/**
 * How a logged run ended. `running` is the provisional entry written when a
 * run starts, so a run the page loses — a reload, a dropped connection — is
 * still on record; read back without a live run behind it, it is shown as
 * `interrupted`. `interrupted` is also written outright for a run Klipper
 * left in the middle of.
 */
export type LogOutcome = ProcedureOutcome | 'failed' | 'running' | 'interrupted' | 'aborted'

/** One run a procedure started, as the log keeps it. */
export interface CalibrationLogEntry {
  /** When the run started, epoch milliseconds; also the entry's identity. */
  at: number
  values: Record<string, string>
  rows: ProcedureResultRow[]
  outcome: LogOutcome
  /** What the result offered, so an earlier run can still be applied or saved. */
  actions?: ProcedureAction[]
  /** The shapers the run offered per axis, so an earlier run opened later still has the choice. */
  candidates?: ShaperCandidate[]
}

export type CalibrationLog = Partial<Record<ProcedureId, CalibrationLogEntry[]>>

/**
 * Runs forgotten one at a time, by when they started. Kept beside the log
 * because the log is merged, never replaced: without the tombstone, the next
 * browser to write — or this one, from its own copy — would merge the
 * forgotten run straight back.
 */
export type ForgottenRuns = Partial<Record<ProcedureId, number[]>>

interface StoredLog {
  version: 1
  procedures: CalibrationLog
  forgotten?: ForgottenRuns
}

interface LogState {
  procedures: CalibrationLog
  forgotten: ForgottenRuns
}

/** Enough to outlive the twenty entries a procedure keeps, so a forgotten run stays forgotten. */
const tombstonesPerProcedure = 40

/**
 * How long the store waits on the printer at each point a run can only be
 * judged by time. One object, so a test that drives a helper can shorten them
 * rather than wait on the real ones.
 */
export const calibrationTimings = {
  /** How long a helper may take to open after its command returned, before it is taken as never opening. */
  helperOpenMs: 3000,
  /**
   * How long a helper that opens once per point may stay closed between two
   * points: the toolhead lifts, travels and probes in between. Past it, a
   * sequence that never printed its last line — a probe error mid-way — ends.
   */
  helperReopenMs: 120_000,
  /** How long a closed paper test may take to stage or print its value before it is read as aborted. */
  lateResultMs: 20_000,
}

export interface CalibrationRun {
  procedureId: ProcedureId
  /** What the run was about, for a procedure that keeps results per thing; otherwise ''. */
  subject: string
  script: string
  values: Record<string, string>
  before: ProcedureSnapshot
  /** The last console entry before the run was sent; its output is everything after. */
  startEntryId: number
  /**
   * The last console entry that is still the run's own, once another run has
   * started. Until then a finished run's output ends at the first command
   * sent after it finished — see `outputFor`.
   */
  endEntryId: number | null
  /** The last console entry when the run finished; null while it runs. */
  finishedEntryId: number | null
  startedAt: number
  /** `availability.klipperSession` when the run started: a restart since makes what it learned old news. */
  session: number
  running: boolean
  succeeded: boolean | null
  /** Klipper left ready while it ran, so nothing it would have printed was read. */
  interrupted: boolean
  /** Its helper closed with nothing found or staged: the paper test was aborted, or its ACCEPT refused. */
  aborted: boolean
  /** What the run reads the printer through; its closures read live state. */
  context: ProcedureContext
  /** What was staged for SAVE_CONFIG when the run started, so only its own staging counts. */
  pendingBefore: PendingItems
  /**
   * What the run staged, kept once seen: SAVE_CONFIG empties the pending
   * list, and a result that vanished the moment it was saved would be the
   * wrong way round.
   */
  stagedRows: ProcedureResultRow[]
  /** The reader's answers to a procedure's questions, once given. */
  answers: ProcedureResultRow[]
}

export type PersistActionOutcome =
  | 'saved'
  | 'buffered'
  | 'unchanged'
  | 'refused'
  | 'restarting'
  /** Klipper staged another value for the option; SAVE_CONFIG would write that one, so nothing was. */
  | 'stagedDiffers'

/*
 * The log is a record of the machine, not a preference of whoever is looking at
 * it: every user of this printer sees the same "last ran", so it lives in its
 * own namespace rather than under ADR 0008's per-user settings key — a
 * username can be any string, and sharing one namespace would let a user named
 * like the log's key overwrite it.
 */
const logNamespace = 'alabaster_calibration'
const logKey = 'log'
/** Enough history to see a drift over a season, small enough to stay one read. */
const entriesPerProcedure = 20

/** One run is remembered per procedure, and per subject where a procedure has one. */
function runKey(id: ProcedureId, subject: string): string {
  return subject === '' ? id : `${id}:${subject}`
}

const levelingProcedures: Partial<Record<ProcedureId, LevelingMethod>> = {
  quadGantryLevel: 'quadGantryLevel',
  zTilt: 'zTilt',
  screwsTilt: 'screwsTiltAdjust',
  bedScrews: 'bedScrews',
  deltaCalibrate: 'deltaCalibrate',
}

/**
 * Two copies of the log as one: every run either has, oldest first, capped per
 * procedure, less every run either side forgot. A procedure named in
 * `cleared` is taken out of the remote copy first, since merging would bring
 * its deleted entries straight back.
 */
function mergeLogs(
  remote: LogState,
  local: LogState,
  cleared: readonly ProcedureId[] = [],
): LogState {
  const forgotten: ForgottenRuns = {}
  const ids = new Set<ProcedureId>([
    ...(Object.keys(remote.forgotten) as ProcedureId[]),
    ...(Object.keys(local.forgotten) as ProcedureId[]),
  ])
  for (const id of ids) {
    if (cleared.includes(id)) continue
    const ats = new Set([...(remote.forgotten[id] ?? []), ...(local.forgotten[id] ?? [])])
    forgotten[id] = [...ats].sort((left, right) => left - right).slice(-tombstonesPerProcedure)
  }
  const merged: CalibrationLog = { ...remote.procedures }
  for (const id of cleared) delete merged[id]
  for (const [id, entries] of Object.entries(local.procedures) as Array<
    [ProcedureId, CalibrationLogEntry[]]
  >) {
    const byAt = new Map((merged[id] ?? []).map((entry) => [entry.at, entry]))
    for (const entry of entries) {
      // A provisional entry never replaces the final one another browser wrote.
      const existing = byAt.get(entry.at)
      if (existing && entry.outcome === 'running' && existing.outcome !== 'running') continue
      byAt.set(entry.at, entry)
    }
    merged[id] = [...byAt.values()]
      .sort((left, right) => left.at - right.at)
      .slice(-entriesPerProcedure)
  }
  for (const [id, ats] of Object.entries(forgotten) as Array<[ProcedureId, number[]]>) {
    const entries = merged[id]
    if (!entries) continue
    merged[id] = entries.filter((entry) => !ats.includes(entry.at))
  }
  return { procedures: merged, forgotten }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A command a stored action may send: one line of bare words and `KEY=value` pairs. */
const storedCommandPattern = /^[A-Z0-9_]+(?: [A-Z0-9_]+=[A-Za-z0-9_.,+-]+)*$/
const storedValuePattern = /^[A-Za-z0-9_.,+-]+$/

function isText(value: unknown): value is string {
  return typeof value === 'string'
}

/*
 * The log is shared, so any client can write it, and an action read back from
 * it runs on the printer. Only the two shapes a parser produces survive, with
 * a command or value that could only ever be one line of G-code or one option
 * value; anything else is dropped rather than offered as a button.
 */
function readStoredAction(value: unknown): ProcedureAction | null {
  if (!isRecord(value) || !isText(value.id) || !isRecord(value.label)) return null
  const label = value.label
  const text = isText(label.literal)
    ? { literal: label.literal }
    : isText(label.key)
      ? isRecord(label.params) && Object.values(label.params).every(isText)
        ? { key: label.key, params: label.params as Record<string, string> }
        : { key: label.key }
      : null
  if (text === null) return null
  if (value.kind === 'gcode') {
    if (!isText(value.command) || !storedCommandPattern.test(value.command)) return null
    return { kind: 'gcode', id: value.id, label: text, command: value.command }
  }
  if (value.kind !== 'persist' || !isText(value.section) || !Array.isArray(value.changes)) {
    return null
  }
  const changes = value.changes.filter(
    (change): change is { option: string; value: string } =>
      isRecord(change) &&
      isText(change.option) &&
      storedValuePattern.test(change.option) &&
      isText(change.value) &&
      storedValuePattern.test(change.value),
  )
  if (changes.length === 0 || changes.length !== value.changes.length) return null
  const action: ProcedureAction = {
    kind: 'persist',
    id: value.id,
    label: text,
    section: value.section,
    changes,
  }
  return value.restart === true ? { ...action, restart: true } : action
}

/** A shaper candidate as the log keeps it: an axis, a type Klipper would accept, a frequency. */
function readStoredCandidate(value: unknown): ShaperCandidate | null {
  if (!isRecord(value)) return null
  const { axis, shaperType, frequency, kind, recommended, vibrations, maxAccel } = value
  if (axis !== 'x' && axis !== 'y') return null
  if (!isText(shaperType) || !/^[a-z0-9_]+$/.test(shaperType)) return null
  if (typeof frequency !== 'number' || !Number.isFinite(frequency)) return null
  if (kind !== null && kind !== 'performance' && kind !== 'lowVibrations' && kind !== 'best') {
    return null
  }
  const candidate: ShaperCandidate = {
    axis,
    shaperType,
    frequency,
    kind,
    recommended: recommended === true,
  }
  if (typeof vibrations === 'number' && Number.isFinite(vibrations))
    candidate.vibrations = vibrations
  if (typeof maxAccel === 'number' && Number.isFinite(maxAccel)) candidate.maxAccel = maxAccel
  return candidate
}

function readStoredEntry(entry: unknown): CalibrationLogEntry | null {
  if (!isRecord(entry) || typeof entry.at !== 'number' || !Array.isArray(entry.rows)) return null
  const {
    actions: storedActions,
    candidates: storedCandidates,
    ...rest
  } = entry as unknown as CalibrationLogEntry & { actions?: unknown; candidates?: unknown }
  const actions = Array.isArray(storedActions)
    ? storedActions
        .map(readStoredAction)
        .filter((action): action is ProcedureAction => action !== null)
    : []
  const candidates = Array.isArray(storedCandidates)
    ? storedCandidates
        .map(readStoredCandidate)
        .filter((candidate): candidate is ShaperCandidate => candidate !== null)
    : []
  const read: CalibrationLogEntry = { ...rest }
  if (actions.length > 0) read.actions = actions
  if (candidates.length > 0) read.candidates = candidates
  return read
}

function readStoredLog(value: unknown): LogState {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.procedures)) {
    return { procedures: {}, forgotten: {} }
  }
  const log: CalibrationLog = {}
  for (const [id, entries] of Object.entries(value.procedures)) {
    if (procedureById(id) === undefined || !Array.isArray(entries)) continue
    log[id as ProcedureId] = entries
      .map(readStoredEntry)
      .filter((entry): entry is CalibrationLogEntry => entry !== null)
  }
  const forgotten: ForgottenRuns = {}
  if (isRecord(value.forgotten)) {
    for (const [id, ats] of Object.entries(value.forgotten)) {
      if (procedureById(id) === undefined || !Array.isArray(ats)) continue
      forgotten[id as ProcedureId] = ats.filter(
        (at): at is number => typeof at === 'number' && Number.isFinite(at),
      )
    }
  }
  return { procedures: log, forgotten }
}

/**
 * Calibration's procedures: running one, reading what it printed, and the log
 * of every run on this printer.
 *
 * A run's output is the console transcript after the entry that was last when
 * it started, not a bookmark into `consoleLines` — the transcript trims its
 * oldest entries, and an index would slide onto the wrong line, where an entry
 * id never moves. The echoed command itself is not output and is skipped.
 */
export const useCalibrationStore = defineStore('calibration', () => {
  const availability = useAvailabilityStore()
  const gcodeConsole = useConsoleStore()
  const moonraker = useMoonrakerStore()
  const printer = usePrinterStore()
  const quickConfig = useQuickConfigStore()
  const shakeTune = useShakeTuneStore()
  const manualProbe = useManualProbeStore()
  const bedScrews = useBedScrewsStore()

  const runs = reactive(new Map<string, CalibrationRun>())
  const log = ref<CalibrationLog>({})
  const forgotten = ref<ForgottenRuns>({})
  const logLoaded = ref(false)
  const logFailed = ref(false)
  let loadGeneration = 0
  let started = false
  let stopConnectionWatch: (() => void) | null = null

  const activeRun = computed(() => [...runs.values()].find((run) => run.running) ?? null)

  /**
   * A guided panel's helper that Klipper has open — the load cell's
   * `LOAD_CELL_CALIBRATE` — which is not a run here but holds the machine the
   * same way: a Run started under it would answer that helper's commands.
   */
  const openHelper = ref<string | null>(null)
  /** Whether the machine is spoken for, by a run or by an open helper. */
  const busy = computed(() => activeRun.value !== null || openHelper.value !== null)

  function setHelperOpen(id: string, open: boolean): void {
    if (open) openHelper.value = id
    else if (openHelper.value === id) openHelper.value = null
  }

  /*
   * Registered for the store's whole life, not between `start()` and `stop()`:
   * a printer switched while another route was open, and a dashboard shortcut
   * that runs a procedure without the page ever mounting, both reach this
   * store without `start()`. Carried across such a switch, the old printer's
   * log merged into the new printer's database on the next write.
   */
  moonraker.onPrinterChange(printerChanged)

  function lastEntryId(): number {
    const entries = gcodeConsole.consoleEntries
    return entries.length > 0 ? entries[entries.length - 1]!.id : 0
  }

  /**
   * What the run printed: every line after it was sent, up to where it ended.
   * A run's output used to have no end, so a finished probe accuracy test kept
   * collecting the probe lines of the mesh or the levelling run after it — its
   * samples, its result and its log entry drifted with them. It ends at the
   * next run started here, or at the first command sent after it finished,
   * whichever comes first; lines printed before that command are its own
   * trailing output.
   */
  function outputFor(run: CalibrationRun): string[] {
    const lines: string[] = []
    for (const entry of gcodeConsole.consoleEntries) {
      if (entry.id <= run.startEntryId) continue
      if (run.endEntryId !== null && entry.id > run.endEntryId) break
      if (entry.kind === 'command') {
        if (endsRun(run, entry)) break
        continue
      }
      lines.push(entry.raw)
    }
    return lines
  }

  /**
   * Whether a command sent after the run finished ends what it may still
   * claim. A procedure's own follow-ups — the next sample of a drift
   * calibration, the paper test it opens — continue the run instead.
   */
  function endsRun(run: CalibrationRun, entry: { id: number; raw: string }): boolean {
    if (run.finishedEntryId === null || entry.id <= run.finishedEntryId) return false
    const followUps = procedureById(run.procedureId)?.followUps ?? []
    const command = entry.raw.trim().toUpperCase()
    return !followUps.some((followUp) => command === followUp || command.startsWith(`${followUp} `))
  }

  function runFor(id: ProcedureId, subject = ''): CalibrationRun | null {
    return runs.get(runKey(id, subject)) ?? null
  }

  function linesFor(id: ProcedureId, subject = ''): string[] {
    const run = runs.get(runKey(id, subject))
    return run ? outputFor(run) : []
  }

  /**
   * What a run found: its parser's rows, or what it staged where the parser
   * found nothing, plus whatever the reader answered. A parser that returned
   * no rows while the run staged something is the case the pending-items
   * fallback exists for; a parser that found rows already said more than the
   * staged list would, and keeps them.
   */
  function resultFor(id: ProcedureId, subject = ''): ProcedureResult | null {
    const run = runs.get(runKey(id, subject))
    return run ? resultOfRun(run) : null
  }

  function resultOfRun(run: CalibrationRun): ProcedureResult | null {
    const procedure = procedureById(run.procedureId)
    if (!procedure?.parse) return null
    const parsed = procedure.parse(outputFor(run), run.before, run.values, run.context)
    const staged = run.stagedRows
    let result = parsed
    if (staged.length > 0 && (parsed === null || parsed.rows.length === 0)) {
      result = { ...(parsed ?? {}), rows: staged, outcome: 'staged' }
    }
    if (run.answers.length === 0) return result
    return {
      ...(result ?? {}),
      rows: [...(result?.rows ?? []), ...run.answers],
      outcome: result?.outcome === 'done' || result === null ? 'measured' : result.outcome,
    }
  }

  /** Whatever the run has staged since it started, beyond what it had already recorded. */
  function stagedRowsFor(run: CalibrationRun): ProcedureResultRow[] {
    const rows = rowsFromPendingItems(
      run.pendingBefore,
      run.context.pendingItems(),
      run.context.settings,
    )
    return rows.length > run.stagedRows.length ? rows : run.stagedRows
  }

  /**
   * Whether what is staged now can still be the run's own. The same bound as
   * its output: until another run starts here, or a command is sent after it
   * finished. A finished run used to keep reading the pending list for as
   * long as the page was open, so a stepper check logged the probe offset a
   * paper test staged three hours later as its own result.
   */
  function acceptsStaging(run: CalibrationRun): boolean {
    if (run.running) return true
    if (run.endEntryId !== null) return false
    if (run.finishedEntryId === null) return true
    return !gcodeConsole.consoleEntries.some(
      (entry) => entry.kind === 'command' && endsRun(run, entry),
    )
  }

  /** The runs of a procedure, or of one subject of it, oldest first. */
  function historyFor(id: ProcedureId, subject = ''): readonly CalibrationLogEntry[] {
    const entries = log.value[id] ?? []
    if (subject === '') return entries
    const procedure = procedureById(id)
    return entries.filter((entry) => procedureSubject(procedure, entry.values) === subject)
  }

  /**
   * How an entry reads now: a provisional `running` entry with no live run
   * behind it is a run this page never saw finish — a reload or a dropped
   * connection ended it, or another browser is running it this moment, which
   * that browser's final entry will say.
   */
  function outcomeOf(entry: CalibrationLogEntry): LogOutcome {
    if (entry.outcome !== 'running') return entry.outcome
    const live = [...runs.values()].some((run) => run.running && run.startedAt === entry.at)
    return live ? 'running' : 'interrupted'
  }

  /** A run that found what it set out to find — not one that failed, or was never seen to finish. */
  function isCompleted(entry: CalibrationLogEntry): boolean {
    const outcome = outcomeOf(entry)
    return (
      outcome !== 'failed' &&
      outcome !== 'running' &&
      outcome !== 'interrupted' &&
      outcome !== 'aborted'
    )
  }

  /** The newest entry of a procedure, however it ended; null where none is logged. */
  function latestEntry(id: ProcedureId): CalibrationLogEntry | null {
    const entries = log.value[id] ?? []
    return entries.reduce<CalibrationLogEntry | null>(
      (newest, entry) => (newest === null || entry.at > newest.at ? entry : newest),
      null,
    )
  }

  /**
   * When the procedure last completed. A failed run, or one the page lost,
   * does not count: it left the printer as it was, and a procedure whose
   * only run failed is still due.
   */
  function lastRunAt(id: ProcedureId): number | null {
    const completed = (log.value[id] ?? []).filter(isCompleted)
    if (completed.length === 0) return null
    return Math.max(...completed.map((entry) => entry.at))
  }

  async function loadLog(): Promise<void> {
    if (!availability.isMoonrakerConnected) return
    const generation = ++loadGeneration
    try {
      const response = await moonraker.rpcCall('server.database.get_item', {
        namespace: logNamespace,
        key: logKey,
      })
      if (generation !== loadGeneration) return
      /*
       * Merged, not replaced: a run can finish while this read is in flight
       * (a reconnect reloads the log mid-sitting), and the printer's copy may
       * not have that run yet. Replacing would send its row back to "never run".
       */
      const merged = mergeLogs(readStoredLog(response.value), {
        procedures: log.value,
        forgotten: forgotten.value,
      })
      log.value = merged.procedures
      forgotten.value = merged.forgotten
      logFailed.value = false
    } catch {
      // Moonraker answers an error for a key never written: nothing remote to add.
      if (generation !== loadGeneration) return
    } finally {
      if (generation === loadGeneration) logLoaded.value = true
    }
  }

  /*
   * Read, merge, write: another browser may have logged a run since this one
   * last read, and writing the local copy over it would lose that run. A
   * failed write is not retried — the next run's write carries this one too,
   * because it merges the local log in. A procedure named in `cleared` is
   * the one exception: merging would bring its deleted entries straight back
   * from the printer's copy, so it is taken out of both.
   */
  async function writeLog(cleared: readonly ProcedureId[] = []): Promise<void> {
    if (!availability.isMoonrakerConnected) return
    let remote: LogState
    try {
      const response = await moonraker.rpcCall('server.database.get_item', {
        namespace: logNamespace,
        key: logKey,
      })
      remote = readStoredLog(response.value)
    } catch {
      remote = { procedures: {}, forgotten: {} }
    }
    const merged = mergeLogs(remote, { procedures: log.value, forgotten: forgotten.value }, cleared)
    log.value = merged.procedures
    forgotten.value = merged.forgotten
    try {
      const value: StoredLog = {
        version: 1,
        procedures: merged.procedures,
        forgotten: merged.forgotten,
      }
      await moonraker.rpcCall('server.database.post_item', {
        namespace: logNamespace,
        key: logKey,
        value: value as unknown as Record<string, unknown>,
      })
      logFailed.value = false
    } catch {
      logFailed.value = true
    }
  }

  function outcomeOfRun(run: CalibrationRun, result: ProcedureResult | null): LogOutcome {
    if (run.running) return 'running'
    if (run.interrupted) return 'interrupted'
    if (run.aborted) return 'aborted'
    if (run.succeeded === false) return 'failed'
    return result?.outcome ?? 'done'
  }

  /**
   * Records, or updates, the log entry for a run from what it has printed so
   * far. Called once when the run starts, so the printer has a record of it
   * before the command returns — a page reloaded mid-run used to leave no
   * trace, and its Run button came back while the printer was still at work.
   */
  function recordRun(run: CalibrationRun): void {
    const result = resultOfRun(run)
    const entry: CalibrationLogEntry = {
      at: run.startedAt,
      values: run.values,
      rows: [...(result?.rows ?? [])],
      outcome: outcomeOfRun(run, result),
    }
    // A step of the run itself is not something a later reader can take with its result.
    const kept = (result?.actions ?? []).filter((action) => action.transient !== true)
    if (run.succeeded === true && kept.length > 0) entry.actions = kept
    if (run.succeeded === true && result?.shaperCandidates?.length) {
      entry.candidates = [...result.shaperCandidates]
    }
    const entries = (log.value[run.procedureId] ?? []).filter(
      (existing) => existing.at !== run.startedAt,
    )
    log.value = {
      ...log.value,
      [run.procedureId]: [...entries, entry].slice(-entriesPerProcedure),
    }
    void writeLog()
  }

  function dispatch(
    procedure: CalibrationProcedure,
    script: string,
    values: ProcedureValues,
  ): Promise<boolean> {
    /*
     * The procedures that already had a control of their own run through it,
     * so the Movement and Temperatures cards see the same pending state and the
     * same side effects — a mesh records the bed temperature it was taken at.
     */
    if (procedure.id === 'bedMesh') {
      return printer.calibrateBedMesh(values.PROFILE, values.PROBE_COUNT)
    }
    const leveling = levelingProcedures[procedure.id]
    // The card's own path sends the bare command; one with words (a screw DIRECTION) is sent as built.
    if (leveling !== undefined && script === procedure.command) return printer.runLeveling(leveling)
    if (procedure.id === 'heaterModel') {
      const kind = script.startsWith('MPC_CALIBRATE') ? 'mpc' : 'pid'
      return printer.calibrateHeater(kind, values.HEATER ?? '', Number(values.TARGET))
    }
    return printer.sendGcode(script, 'calibration', { timeoutMs: null })
  }

  /**
   * Starts a procedure. Refuses while another is running: the machine does one
   * physical thing at a time, and a run queued behind another would start from
   * a state the reader never saw.
   */
  async function run(
    procedure: CalibrationProcedure,
    values: ProcedureValues,
    context: ProcedureContext,
  ): Promise<boolean> {
    if (activeRun.value !== null || !procedure.build) return false
    const script = procedure.build(values, context)
    if (script === null) return false
    const subject = procedureSubject(procedure, values)
    const startEntryId = lastEntryId()
    for (const earlier of runs.values()) {
      if (earlier.endEntryId === null) earlier.endEntryId = startEntryId
    }
    const record: CalibrationRun = {
      procedureId: procedure.id,
      subject,
      script,
      values: { ...values },
      before: procedure.snapshot?.(values, context) ?? {},
      startEntryId,
      endEntryId: null,
      finishedEntryId: null,
      startedAt: Date.now(),
      session: availability.klipperSession,
      running: true,
      succeeded: null,
      interrupted: false,
      aborted: false,
      context,
      pendingBefore: context.pendingItems(),
      stagedRows: [],
      answers: [],
    }
    const key = runKey(procedure.id, subject)
    runs.set(key, record)
    recordRun(record)
    const watchesGraphs = shakeTuneProcedures.has(procedure.id)
    if (watchesGraphs) shakeTune.start()
    const leaving = untilKlipperLeaves()
    const helper = procedureHelper(procedure, context)
    let succeeded: boolean
    let aborted = false
    try {
      succeeded = await Promise.race([dispatch(procedure, script, values), leaving.promise])
      if (succeeded && helper !== null) {
        const helperDone = procedure.helperDone
        const ending = await helperFinished(
          helper,
          helperDone ? () => helperDone(outputFor(record)) : null,
        )
        succeeded = ending !== 'lost'
        /*
         * A paper test's helper closes before what it stages lands: the probe
         * modules move and scan for seconds after ACCEPT, an eddy probe's
         * calibration longest of all. Closed with nothing yet, the run waits
         * a while for a value or a staging before it is read as aborted — the
         * ABORT itself prints nothing to tell the two apart. A helper that
         * never opened was refused outright, and has nothing to wait for.
         */
        if (succeeded && helper === 'manualProbe') {
          const found =
            ending === 'closed'
              ? await Promise.race([lateResult(record), leaving.promise])
              : hasResult(record)
          if (found === false) {
            if (leaving.left) succeeded = false
            else aborted = true
          }
        }
      }
    } finally {
      leaving.stop()
      if (watchesGraphs) setTimeout(() => shakeTune.stop(), graphLandingMs)
    }
    const current = runs.get(key)
    if (current && current.startedAt === record.startedAt && current.running) {
      current.stagedRows = stagedRowsFor(current)
      current.running = false
      current.aborted = aborted
      current.succeeded = succeeded && !aborted
      current.interrupted = leaving.left
      current.finishedEntryId = lastEntryId()
      recordRun(current)
    }
    return current?.succeeded ?? false
  }

  /** Whether the run has a value or a staging to show. */
  function hasResult(run: CalibrationRun): boolean {
    run.stagedRows = stagedRowsFor(run)
    const result = resultOfRun(run)
    return (result?.rows.length ?? 0) > 0 || result?.outcome === 'staged'
  }

  /** Resolves true as soon as the run has a value or a staging, false once it has waited long enough. */
  function lateResult(run: CalibrationRun): Promise<boolean> {
    if (hasResult(run)) return Promise.resolve(true)
    return new Promise((resolve) => {
      let stop: (() => void) | null = null
      const timer = setTimeout(() => finish(false), calibrationTimings.lateResultMs)
      function finish(value: boolean): void {
        clearTimeout(timer)
        stop?.()
        resolve(value)
      }
      stop = watch(
        () => [gcodeConsole.consoleEntries, printer.saveConfigPendingItems] as const,
        () => {
          if (hasResult(run)) finish(true)
        },
        { deep: true },
      )
    })
  }

  /**
   * Resolves false the moment Klipper leaves ready, for a run to race its
   * command against. Moonraker answers a command that was in flight when
   * Klipper went down, but a Klipper that stops without dropping its
   * connection may never answer — and a run that never ends keeps every Run
   * button on the bench and the dashboard disabled until the page is reloaded.
   */
  function untilKlipperLeaves(): { promise: Promise<false>; stop: () => void; left: boolean } {
    let stop: (() => void) | null = null
    const state = {
      left: false,
      stop: () => {
        stop?.()
        stop = null
      },
      promise: new Promise<false>((resolve) => {
        stop = watch(
          () => availability.isKlipperReady,
          (ready) => {
            if (ready) return
            state.left = true
            resolve(false)
          },
        )
      }),
    }
    return state
  }

  /** The runs whose graph lands in Shake&Tune's results folder after their last line. */
  const shakeTuneProcedures = new Set<ProcedureId>([
    'axesMap',
    'shakeTuneBelts',
    'shakeTuneShaper',
    'shakeTuneVibrations',
  ])
  /** How long the results listing is kept current after such a run, for its graph to be written. */
  const graphLandingMs = 10 * 60 * 1000

  /**
   * Resolves once the interactive helper a run opened has closed — the paper
   * test's ACCEPT or ABORT, the last screw accepted. The command returns as
   * soon as the helper opens, so a run that ended on the command's return
   * said "Finished" while the prompt was still waiting, re-enabled Run, and
   * let a second procedure start in the middle of the first. False when the
   * connection went while it waited.
   */
  function helperFinished(
    helper: 'manualProbe' | 'bedScrews',
    done: (() => boolean) | null,
  ): Promise<'closed' | 'neverOpened' | 'lost'> {
    const isActive = () => (helper === 'manualProbe' ? manualProbe.isActive : bedScrews.isActive)
    return new Promise((resolve) => {
      let opened = isActive()
      let stop: (() => void) | null = null
      let reopenTimer: ReturnType<typeof setTimeout> | null = null
      const timer = setTimeout(() => {
        if (!opened) finish('neverOpened')
      }, calibrationTimings.helperOpenMs)
      function finish(value: 'closed' | 'neverOpened' | 'lost'): void {
        clearTimeout(timer)
        if (reopenTimer !== null) clearTimeout(reopenTimer)
        stop?.()
        resolve(value)
      }
      stop = watch(
        () => [isActive(), availability.isKlipperReady, done?.() ?? true] as const,
        ([active, available, finished]) => {
          if (!available) return finish('lost')
          if (active) {
            opened = true
            if (reopenTimer !== null) clearTimeout(reopenTimer)
            reopenTimer = null
          } else if (opened) {
            if (finished) return finish('closed')
            reopenTimer ??= setTimeout(() => finish('closed'), calibrationTimings.helperReopenMs)
          }
        },
      )
    })
  }

  /*
   * A run's staging can land after its command returned — an interactive
   * one stages on ACCEPT, and a status update can trail the acknowledgement
   * — so every finished run keeps reading what is pending, and grows its own
   * rows from it. It never shrinks them: see `stagedRows`.
   */
  watch(
    () => printer.saveConfigPendingItems,
    () => {
      for (const current of runs.values()) {
        if (current.running || !acceptsStaging(current)) continue
        current.stagedRows = stagedRowsFor(current)
      }
    },
    { deep: true },
  )

  /*
   * An interactive run — a paper test, a screw-by-screw adjustment — answers
   * with its result after the command itself has returned, when the reader
   * accepts, and a Shake&Tune run's graph lands after its last line. So a
   * finished run's log entry is refreshed as its result arrives. Watching the
   * results themselves, rather than the transcript, is what lets a result
   * that grew from a status update or a directory listing be logged too — and
   * it is refreshed when the result *changes*, not only when it grows: a mesh
   * whose parser had nothing until the mesh loaded was logged as the staged
   * list, and a longer list of noise beat four rows of the result for good.
   */
  function loggedShape(result: ProcedureResult | null): string {
    return JSON.stringify([result?.outcome ?? null, result?.rows ?? []])
  }

  watch(
    () =>
      [...runs.values()].map((current) =>
        current.running || current.succeeded !== true ? '' : loggedShape(resultOfRun(current)),
      ),
    () => {
      for (const current of runs.values()) {
        if (current.running || current.succeeded !== true) continue
        const logged = log.value[current.procedureId]?.find(
          (entry) => entry.at === current.startedAt,
        )
        if (!logged) continue
        const shape = loggedShape({
          outcome: logged.outcome as ProcedureOutcome,
          rows: logged.rows,
        })
        if (shape !== loggedShape(resultOfRun(current))) recordRun(current)
      }
    },
  )

  /**
   * Logs what only the reader could see — that the stepper moved, and the
   * right way — as the run's result, one row per question. Answered once per
   * run: a second set of answers replaces the first rather than adding to it.
   */
  function answer(id: ProcedureId, rows: ProcedureResultRow[], subject = ''): void {
    const current = runs.get(runKey(id, subject))
    if (!current || current.running || current.succeeded !== true) return
    current.answers = [...rows]
    recordRun(current)
  }

  /**
   * Logs a procedure that runs as its own guided panel rather than as one
   * command — rotation distance is a measurement the reader takes by hand.
   */
  function recordManual(
    id: ProcedureId,
    values: Record<string, string>,
    rows: ProcedureResultRow[],
    outcome: ProcedureOutcome,
  ): void {
    const entry: CalibrationLogEntry = { at: Date.now(), values, rows, outcome }
    log.value = {
      ...log.value,
      [id]: [...(log.value[id] ?? []), entry].slice(-entriesPerProcedure),
    }
    void writeLog()
  }

  /**
   * Forgets every logged run of one procedure, on every browser: the log is
   * the printer's, so this is the only copy.
   */
  function clearLog(id: ProcedureId): void {
    for (const [key, current] of runs) if (current.procedureId === id) runs.delete(key)
    const rest = { ...log.value }
    delete rest[id]
    log.value = rest
    const restForgotten = { ...forgotten.value }
    delete restForgotten[id]
    forgotten.value = restForgotten
    void writeLog([id])
  }

  /**
   * Forgets one logged run, on every browser. The run's own record in this
   * page goes with it, so the workspace does not keep showing a result the
   * log no longer has.
   */
  function forgetEntry(id: ProcedureId, at: number): void {
    for (const [key, current] of runs) {
      if (current.procedureId === id && current.startedAt === at && !current.running) {
        runs.delete(key)
      }
    }
    const entries = (log.value[id] ?? []).filter((entry) => entry.at !== at)
    log.value = { ...log.value, [id]: entries }
    forgotten.value = {
      ...forgotten.value,
      [id]: [...(forgotten.value[id] ?? []), at].slice(-tombstonesPerProcedure),
    }
    void writeLog()
  }

  /** What Klipper has staged for this option, if anything. */
  function stagedValue(section: string, option: string): string | undefined {
    return printer.saveConfigPendingItems[section.toLowerCase()]?.[option.toLowerCase()]
  }

  async function runAction(action: ProcedureAction): Promise<PersistActionOutcome | boolean> {
    if (action.kind === 'gcode') return printer.sendGcode(action.command, 'calibration')
    const restart = action.restart === true && !printer.hasActivePrint
    const statuses: PersistActionOutcome[] = []
    let wroteAutosave = false
    for (const change of action.changes) {
      /*
       * A staged option is SAVE_CONFIG's to write, and it writes what Klipper
       * staged. Where that is the value asked for, the file is left alone and
       * the save below does the writing; where it is not — a shaper the
       * reader chose over the recommendation Klipper staged — nothing here can
       * make SAVE_CONFIG write the chosen one, and saving would silently keep
       * Klipper's. The file writer's own refusal does not compare values, so it
       * is not asked.
       */
      const staged = stagedValue(action.section, change.option)
      if (staged !== undefined) {
        if (staged.trim().toLowerCase() === change.value.trim().toLowerCase()) {
          statuses.push('unchanged')
          continue
        }
        return 'stagedDiffers'
      }
      const result = await quickConfig.persistOption(action.section, change.option, change.value, {
        intoAutosave: restart,
      })
      statuses.push(result.status)
      if ('autosave' in result && result.autosave) wroteAutosave = true
      // Stopping at the first refusal leaves no half-written pair behind it.
      if (result.status === 'refused') return 'refused'
    }
    for (const option of action.removes ?? []) {
      const result = await quickConfig.unpersistOption(action.section, option)
      statuses.push(result.status)
      if (result.status === 'refused') return 'refused'
    }
    if (statuses.includes('buffered')) return 'buffered'
    const outcome = statuses.every((status) => status === 'unchanged') ? 'unchanged' : 'saved'
    if (!restart) return outcome
    /*
     * SAVE_CONFIG, which writes whatever is staged and restarts, unless a
     * value was just edited inside the `#*#` block: SAVE_CONFIG writes that
     * block back from what Klipper loaded and would put the old value over
     * it, so a firmware restart reads the edited file instead. persistOption
     * only edits the block while nothing is staged, so that restart loses
     * nothing.
     */
    const restarted = wroteAutosave ? await printer.firmwareRestart() : await printer.saveConfig()
    return restarted ? 'restarting' : outcome
  }

  function printerChanged(): void {
    loadGeneration += 1
    runs.clear()
    log.value = {}
    forgotten.value = {}
    openHelper.value = null
    logLoaded.value = false
    logFailed.value = false
  }

  function start(): void {
    if (started) return
    started = true
    stopConnectionWatch = watch(
      () => availability.isMoonrakerConnected,
      (connected) => {
        if (connected) void loadLog()
      },
      { immediate: true },
    )
  }

  function stop(): void {
    if (!started) return
    started = false
    stopConnectionWatch?.()
    stopConnectionWatch = null
  }

  return {
    runs,
    activeRun,
    busy,
    setHelperOpen,
    log,
    logLoaded,
    logFailed,
    runFor,
    linesFor,
    resultFor,
    historyFor,
    latestEntry,
    outcomeOf,
    lastRunAt,
    run,
    runAction,
    answer,
    recordManual,
    clearLog,
    forgetEntry,
    loadLog,
    start,
    stop,
  }
})
