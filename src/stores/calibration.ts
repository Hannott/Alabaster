import { defineStore } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'

import {
  procedureById,
  type CalibrationProcedure,
  type ProcedureAction,
  type ProcedureContext,
  type ProcedureId,
  type ProcedureOutcome,
  type ProcedureResult,
  type ProcedureResultRow,
  type ProcedureSnapshot,
  type ProcedureValues,
} from '@/features/calibration/procedures'
import type { LevelingMethod } from '@/stores/printerConfig'
import { useAvailabilityStore } from '@/stores/availability'
import { useConsoleStore } from '@/stores/console'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import { useQuickConfigStore } from '@/stores/quickConfig'

/** One run a procedure started, as the log keeps it. */
export interface CalibrationLogEntry {
  /** When the run started, epoch milliseconds; also the entry's identity. */
  at: number
  values: Record<string, string>
  rows: ProcedureResultRow[]
  outcome: ProcedureOutcome | 'failed'
}

export type CalibrationLog = Partial<Record<ProcedureId, CalibrationLogEntry[]>>

interface StoredLog {
  version: 1
  procedures: CalibrationLog
}

export interface CalibrationRun {
  procedureId: ProcedureId
  script: string
  values: Record<string, string>
  before: ProcedureSnapshot
  /** The last console entry before the run was sent; its output is everything after. */
  startEntryId: number
  startedAt: number
  running: boolean
  succeeded: boolean | null
}

export type PersistActionOutcome = 'saved' | 'buffered' | 'unchanged' | 'refused'

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

const levelingProcedures: Partial<Record<ProcedureId, LevelingMethod>> = {
  quadGantryLevel: 'quadGantryLevel',
  zTilt: 'zTilt',
  screwsTilt: 'screwsTiltAdjust',
  bedScrews: 'bedScrews',
  deltaCalibrate: 'deltaCalibrate',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readStoredLog(value: unknown): CalibrationLog {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.procedures)) return {}
  const log: CalibrationLog = {}
  for (const [id, entries] of Object.entries(value.procedures)) {
    if (procedureById(id) === undefined || !Array.isArray(entries)) continue
    log[id as ProcedureId] = entries.filter(
      (entry): entry is CalibrationLogEntry =>
        isRecord(entry) && typeof entry.at === 'number' && Array.isArray(entry.rows),
    )
  }
  return log
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

  const runs = reactive(new Map<ProcedureId, CalibrationRun>())
  const log = ref<CalibrationLog>({})
  const logLoaded = ref(false)
  const logFailed = ref(false)
  let loadGeneration = 0
  let started = false
  let stopConnectionWatch: (() => void) | null = null
  let stopPrinterChange: (() => void) | null = null

  const activeRun = computed(() => [...runs.values()].find((run) => run.running) ?? null)

  function lastEntryId(): number {
    const entries = gcodeConsole.consoleEntries
    return entries.length > 0 ? entries[entries.length - 1]!.id : 0
  }

  function outputFor(run: CalibrationRun): string[] {
    return gcodeConsole.consoleEntries
      .filter((entry) => entry.id > run.startEntryId && entry.kind !== 'command')
      .map((entry) => entry.raw)
  }

  function runFor(id: ProcedureId): CalibrationRun | null {
    return runs.get(id) ?? null
  }

  function linesFor(id: ProcedureId): string[] {
    const run = runs.get(id)
    return run ? outputFor(run) : []
  }

  function resultFor(id: ProcedureId): ProcedureResult | null {
    const run = runs.get(id)
    const procedure = procedureById(id)
    if (!run || !procedure?.parse) return null
    return procedure.parse(outputFor(run), run.before, run.values)
  }

  function historyFor(id: ProcedureId): readonly CalibrationLogEntry[] {
    return log.value[id] ?? []
  }

  function lastRunAt(id: ProcedureId): number | null {
    const entries = log.value[id]
    if (!entries || entries.length === 0) return null
    return Math.max(...entries.map((entry) => entry.at))
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
      log.value = readStoredLog(response.value)
      logFailed.value = false
    } catch {
      // Moonraker answers an error for a key never written: no runs logged yet.
      if (generation !== loadGeneration) return
      log.value = {}
    } finally {
      if (generation === loadGeneration) logLoaded.value = true
    }
  }

  /*
   * Read, merge, write: another browser may have logged a run since this one
   * last read, and writing the local copy over it would lose that run. A
   * failed write is not retried — the next run's write carries this one too,
   * because it merges the local log in.
   */
  async function writeLog(): Promise<void> {
    if (!availability.isMoonrakerConnected) return
    let remote: CalibrationLog
    try {
      const response = await moonraker.rpcCall('server.database.get_item', {
        namespace: logNamespace,
        key: logKey,
      })
      remote = readStoredLog(response.value)
    } catch {
      remote = {}
    }
    const merged: CalibrationLog = { ...remote }
    for (const [id, entries] of Object.entries(log.value) as Array<
      [ProcedureId, CalibrationLogEntry[]]
    >) {
      const byAt = new Map((merged[id] ?? []).map((entry) => [entry.at, entry]))
      for (const entry of entries) byAt.set(entry.at, entry)
      merged[id] = [...byAt.values()]
        .sort((left, right) => left.at - right.at)
        .slice(-entriesPerProcedure)
    }
    log.value = merged
    try {
      const value: StoredLog = { version: 1, procedures: merged }
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

  /** Records, or updates, the log entry for a run from what it has printed so far. */
  function recordRun(run: CalibrationRun): void {
    const result = resultFor(run.procedureId)
    const entry: CalibrationLogEntry = {
      at: run.startedAt,
      values: run.values,
      rows: [...(result?.rows ?? [])],
      outcome: run.succeeded === false ? 'failed' : (result?.outcome ?? 'done'),
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
    if (leveling !== undefined) return printer.runLeveling(leveling)
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
    const record: CalibrationRun = {
      procedureId: procedure.id,
      script,
      values: { ...values },
      before: procedure.snapshot?.(values, context) ?? {},
      startEntryId: lastEntryId(),
      startedAt: Date.now(),
      running: true,
      succeeded: null,
    }
    runs.set(procedure.id, record)
    const succeeded = await dispatch(procedure, script, values)
    const current = runs.get(procedure.id)
    if (current && current.startedAt === record.startedAt) {
      current.running = false
      current.succeeded = succeeded
      recordRun(current)
    }
    return succeeded
  }

  /*
   * An interactive run — a paper test, a screw-by-screw adjustment — answers
   * with its result after the command itself has returned, when the reader
   * accepts. So a finished run's log entry is refreshed as more of its result
   * arrives, for as long as it is the latest run of its procedure.
   */
  watch(
    () => gcodeConsole.consoleEntries.length,
    () => {
      for (const current of runs.values()) {
        if (current.running || current.succeeded !== true) continue
        const logged = log.value[current.procedureId]?.find(
          (entry) => entry.at === current.startedAt,
        )
        const rows = resultFor(current.procedureId)?.rows.length ?? 0
        if (logged && rows > logged.rows.length) recordRun(current)
      }
    },
  )

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

  async function runAction(action: ProcedureAction): Promise<PersistActionOutcome | boolean> {
    if (action.kind === 'gcode') return printer.sendGcode(action.command, 'calibration')
    const result = await quickConfig.persistOption(action.section, action.option, action.value)
    return result.status
  }

  function printerChanged(): void {
    loadGeneration += 1
    runs.clear()
    log.value = {}
    logLoaded.value = false
    logFailed.value = false
  }

  function start(): void {
    if (started) return
    started = true
    stopPrinterChange = moonraker.onPrinterChange(printerChanged)
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
    stopPrinterChange?.()
    stopPrinterChange = null
  }

  return {
    runs,
    activeRun,
    log,
    logLoaded,
    logFailed,
    runFor,
    linesFor,
    resultFor,
    historyFor,
    lastRunAt,
    run,
    runAction,
    recordManual,
    loadLog,
    start,
    stop,
  }
})
