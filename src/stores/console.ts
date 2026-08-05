import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import type { JsonRpcNotification } from '@/services/moonraker'
import {
  consoleEntryFromCommand,
  consoleEntryFromResponse,
  type ConsoleEntry,
} from '@/services/console/transcript'
import { i18n } from '@/i18n'
import { useAvailabilityStore } from '@/stores/availability'
import { useBedMeshStore } from '@/stores/bedMesh'
import { useMoonrakerStore } from '@/stores/moonraker'
import { readScoped, writeScoped } from '@/stores/printerScope'
import { usePrinterStore } from '@/stores/printer'
import { usePrintersStore } from '@/stores/printers'
import { isRecord } from '@/utils/records'

/**
 * The G-code console: the transcript, the typed-command history, the machine's
 * command list, and the prompt's dispatch path. Split out of the printer store
 * because it is its own domain — everything here is about the conversation with
 * the machine, not the machine's state — and the one coupling that remains runs
 * the other way: the printer store echoes every script it sends into this
 * transcript, through `echoCommand`.
 */

/**
 * Deep enough that scrolling back through a print's chatter reaches something
 * useful, and bounded so a multi-day print cannot grow the tab's memory without
 * limit. Moonraker retains its own history beyond this, which is what
 * `server.gcode_store` backfills on connect.
 */
const maximumConsoleEntries = 1_000
/** What Moonraker is asked for on connect. Its own retention caps this lower. */
const backfilledConsoleEntries = 100
const maximumCommandHistory = 50
/** The word that starts the voyage. See `features/bedMesh/voyage.ts`. */
const voyageWord = 'yarrr'
const commandHistoryStorageKey = 'alabaster.console.history'
const consoleClearedAtStorageKey = 'alabaster.console.clearedAt'

function parsedStorage(key: string): unknown {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

/**
 * Both console keys are scoped per printer. The macros a user types are that
 * machine's vocabulary, and a Clear belongs to the transcript it emptied —
 * carried across, one printer's cutoff silently trims another's backfill, so
 * messages the user never cleared simply never appear.
 *
 * A value in the pre-scoping shape — a bare array here, a bare number for the
 * cutoff — is read as the current printer's, since it is the only one that could
 * have written it, and the next write absorbs it.
 */
function savedCommandHistory(scopeKeys: readonly string[]): string[] {
  const stored = parsedStorage(commandHistoryStorageKey)
  const scoped = Array.isArray(stored)
    ? stored
    : isRecord(stored)
      ? readScoped(stored, scopeKeys)
      : null
  if (!Array.isArray(scoped)) return []
  return scoped.filter((entry): entry is string => typeof entry === 'string')
}

function persistCommandHistory(scopeKeys: readonly string[], history: readonly string[]): void {
  const stored = parsedStorage(commandHistoryStorageKey)
  const table = isRecord(stored) ? stored : {}
  window.localStorage.setItem(
    commandHistoryStorageKey,
    JSON.stringify(writeScoped(table, scopeKeys, history)),
  )
}

/** A hand-edited or corrupt value degrades to no cutoff rather than to a crash. */
function savedConsoleClearedAt(scopeKeys: readonly string[]): number | null {
  const stored = parsedStorage(consoleClearedAtStorageKey)
  const scoped = isRecord(stored) ? readScoped(stored, scopeKeys) : stored
  return typeof scoped === 'number' && Number.isFinite(scoped) ? scoped : null
}

function persistConsoleClearedAt(scopeKeys: readonly string[], clearedAt: number): void {
  const stored = parsedStorage(consoleClearedAtStorageKey)
  const table = isRecord(stored) ? stored : {}
  window.localStorage.setItem(
    consoleClearedAtStorageKey,
    JSON.stringify(writeScoped(table, scopeKeys, clearedAt)),
  )
}

export interface GcodeHelpEntry {
  command: string
  help: string
}

export const useConsoleStore = defineStore('console', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()
  const printers = usePrintersStore()

  const consoleEntries = ref<ConsoleEntry[]>([])
  /**
   * Epoch milliseconds of the last time Clear was pressed, persisted so a
   * cleared console stays cleared across a reload. `server.gcode_store` is
   * Moonraker's own retained history and has no delete endpoint — Clear can
   * only ever empty Alabaster's copy, so without this cutoff the backfill
   * would put everything the user just cleared right back on the next load.
   */
  const consoleClearedAt = ref<number | null>(savedConsoleClearedAt(printers.activeScopeKeys))
  /**
   * The commands this browser has sent, newest last, for the input's history
   * walk. Persisted because a reload that loses what you just typed is the
   * moment a console feels disposable, and it is the user's own text rather than
   * printer state, so nothing on the host can restore it.
   */
  const commandHistory = ref<string[]>(savedCommandHistory(printers.activeScopeKeys))
  /**
   * Every G-code command this machine knows, from `gcode.commands`, which is what
   * Tab completion and the command browser resolve against. Empty until Klipper
   * is ready, so both degrade to doing nothing rather than to guessing.
   */
  const gcodeHelp = ref<GcodeHelpEntry[]>([])
  /**
   * Raw messages, which is the shape the leveling and calibration transcripts
   * consume: both capture an index and slice forward from it to read one
   * command's output. They want Klipper's own text, prefixes intact, because
   * they parse it rather than display it.
   */
  const consoleLines = computed(() => consoleEntries.value.map((entry) => entry.raw))
  const disposers: Array<() => void> = []
  let stopAvailabilityWatch: WatchStopHandle | null = null
  let stopPrinterChangeReset: (() => void) | null = null
  let stopScopeWatch: WatchStopHandle | null = null
  let started = false
  let consoleEntryId = 0

  function appendConsoleEntry(entry: ConsoleEntry): void {
    consoleEntries.value = [...consoleEntries.value, entry].slice(-maximumConsoleEntries)
  }

  /**
   * Records what the user sent. Separate from dispatching it, and always called
   * first: Klipper's answers arrive while the request is still in flight, so
   * echoing after the await would print a command below its own output. A
   * command that Klipper refuses is still echoed, because a console that shows
   * nothing for a rejected line looks like it dropped the keystroke.
   *
   * The printer store calls this for every script it dispatches — `sendGcode`
   * is the single exit point every card command leaves through — so the echo
   * covers card buttons and macros, not only the console prompt.
   */
  function echoCommand(command: string): void {
    appendConsoleEntry(consoleEntryFromCommand(command, ++consoleEntryId, Date.now()))
  }

  function handleGcodeResponse(notification: JsonRpcNotification): void {
    const response = notification.params[0]
    if (typeof response !== 'string' || response.trim() === '') return
    appendConsoleEntry(consoleEntryFromResponse(response, ++consoleEntryId, Date.now()))
  }

  /**
   * Moonraker keeps its own console history, so the transcript can start where the
   * printer actually is rather than empty. Without this a reload looks like the
   * printer has said nothing since boot, and the reason a job failed scrolls out
   * of reach the moment the tab is refreshed.
   *
   * Only ever run against an empty transcript: `notify_gcode_response` may already
   * have delivered live lines by the time this resolves, and prepending history
   * under them would be right while replacing them would lose them.
   *
   * Entries at or before `consoleClearedAt` are dropped, since Moonraker's store
   * has no delete endpoint — Clear can only tell this backfill to keep hiding
   * what it already hid.
   */
  async function backfillConsole(): Promise<void> {
    if (consoleEntries.value.length > 0) return
    try {
      const stored = await moonraker.rpcCall('server.gcode_store', {
        count: backfilledConsoleEntries,
      })
      const cutoff = consoleClearedAt.value
      const restored = stored.gcode_store
        .filter((event) => cutoff === null || Math.round(event.time * 1000) > cutoff)
        .map((event, index) => {
          // Moonraker reports epoch seconds; the index keeps a stable order for
          // entries that share a second.
          const at = Math.round(event.time * 1000) + index
          return event.type === 'command'
            ? consoleEntryFromCommand(event.message, ++consoleEntryId, at)
            : consoleEntryFromResponse(event.message, ++consoleEntryId, at)
        })
      // Live lines win: anything that arrived while this was in flight belongs
      // after the history, not instead of it.
      consoleEntries.value = [...restored, ...consoleEntries.value].slice(-maximumConsoleEntries)
    } catch {
      // A Moonraker without the endpoint, or a failed read, simply starts empty.
    }
  }

  /**
   * `gcode.commands` is a one-time read rather than a subscription because the
   * command list changes only when the configuration does, and a Klipper restart
   * re-runs this through the availability watcher.
   */
  async function refreshGcodeHelp(): Promise<void> {
    try {
      const snapshot = await moonraker.rpcCall('printer.objects.query', {
        objects: { gcode: ['commands'] },
      })
      const gcode = snapshot.status.gcode
      const commands = isRecord(gcode) ? gcode.commands : null
      if (!isRecord(commands)) return
      gcodeHelp.value = Object.entries(commands)
        .map(([command, details]) => ({
          command,
          help: isRecord(details) && typeof details.help === 'string' ? details.help : '',
        }))
        .sort((left, right) => left.command.localeCompare(right.command))
    } catch {
      // Completion and the command browser both degrade to offering nothing.
    }
  }

  function clearConsole(): void {
    consoleEntries.value = []
    const clearedAt = Date.now()
    consoleClearedAt.value = clearedAt
    try {
      persistConsoleClearedAt(printers.activeScopeKeys, clearedAt)
    } catch {
      // A full or unavailable store costs the reload-survives-clear behaviour,
      // not the clear itself: the transcript is still empty right now.
    }
  }

  function rememberCommand(command: string): void {
    // Re-sending the same command must not pad the history with copies of it,
    // and the newest use is the one the history walk should reach first.
    const withoutRepeat = commandHistory.value.filter((entry) => entry !== command)
    commandHistory.value = [...withoutRepeat, command].slice(-maximumCommandHistory)
    try {
      persistCommandHistory(printers.activeScopeKeys, commandHistory.value)
    } catch {
      // A full or unavailable store costs the history, not the command.
    }
  }

  function clearCommandHistory(): void {
    commandHistory.value = []
    try {
      // Emptied for this printer only; another printer's history is untouched.
      persistCommandHistory(printers.activeScopeKeys, [])
    } catch {
      // Nothing to recover from: the in-memory history is already gone.
    }
  }

  /**
   * The history entry lands before dispatch, alongside `sendGcode`'s own echo,
   * so what you typed appears on the bottom row the instant you send it rather
   * than after Klipper answers.
   *
   * Two things about dispatching from here differ from every card control, and
   * both come from the same fact: a typed line's duration and effect are not
   * knowable to the interface.
   *
   * **The transport's local deadline is waived.** Klipper answers
   * `printer.gcode.script` only once the script has finished, and the console is
   * where `M190 S60`, `BED_MESH_CALIBRATE`, `PROBE_ACCURACY`,
   * `SCREWS_TILT_CALCULATE` and any hand-written heat-soak macro get typed —
   * every one of which outlives the sixty-second default and would report a
   * failure for a printer that is working perfectly. `sendGcode` already waives
   * it for `G28` on exactly this reasoning, and `sendMacro` waives it for every
   * macro because a macro is arbitrary user G-code; a line typed at the prompt is
   * arbitrary user G-code with no name on it, so it takes the same exemption
   * rather than a guess at which commands are slow.
   *
   * **A second command while one is in flight is refused before it is echoed.**
   * `runCommand`'s one-pending-per-key gate refuses the dispatch either way, but
   * `sendGcode` echoes first, so going through it anyway wrote a command into the
   * transcript and the history that never reached the machine. A transcript that
   * shows a command nobody ran is worse than one that shows a refusal — it is the
   * inverse of the rule that a *refused* command still echoes, and with the
   * deadline waived above the window it lies over is no longer bounded by a
   * minute. The prompt keeps the draft and says it is busy instead; see
   * `ConsoleCommandInput.vue`'s pending treatment.
   */
  async function sendConsoleCommand(command: string): Promise<boolean> {
    const trimmedCommand = command.trim()
    if (!trimmedCommand) return false

    // Intercepted before anything is sent, not after. Klipper has no such
    // command and would answer with an error, and the console is the one place
    // in the application where whatever is typed goes straight to the machine —
    // so a word that is meant for the interface has to be taken out of the
    // stream here, where the stream begins.
    if (trimmedCommand.toLowerCase() === voyageWord) {
      echoCommand(trimmedCommand)
      rememberCommand(trimmedCommand)
      appendConsoleEntry(
        consoleEntryFromResponse(
          `// ${i18n.global.t('dashboard.bedMesh.voyage')}`,
          ++consoleEntryId,
          Date.now(),
        ),
      )
      useBedMeshStore().requestVoyage()
      return true
    }

    // Resolved per call rather than in setup: the printer store's own setup
    // resolves this store for its echo sites, so resolving it back here at
    // setup time would recurse before either store finished constructing.
    const printer = usePrinterStore()
    // Before the echo, not after it — see this function's own doc comment.
    if (printer.pendingCommands.console) return false
    rememberCommand(trimmedCommand)
    const succeeded = await printer.sendGcode(trimmedCommand, 'console', { timeoutMs: null })
    // The activity feed is the printer store's; a sent command is one of its
    // entries, so the console reports it there rather than keeping a second feed.
    if (succeeded) printer.addActivity('command', 'dashboard.activity.commandSent', trimmedCommand)
    return succeeded
  }

  /**
   * The transcript and the command list describe one machine, so neither may
   * outlive the switch to another: a transcript full of another printer's
   * chatter reads as this printer's, and a command list from another firmware
   * completes to macros this machine does not have.
   *
   * The typed-command history and the Clear cutoff are not here. They belong to
   * the printer's identity rather than to this connection, so they are swapped
   * by `scopeChanged` — not discarded, which would throw away a preference
   * instead of stale data.
   */
  function printerChanged(): void {
    consoleEntries.value = []
    gcodeHelp.value = []
  }

  /**
   * What this printer, as opposed to this connection, has accumulated: the
   * commands typed at it and the point its transcript was last cleared.
   */
  function scopeChanged(): void {
    commandHistory.value = savedCommandHistory(printers.activeScopeKeys)
    consoleClearedAt.value = savedConsoleClearedAt(printers.activeScopeKeys)
  }

  function start(): void {
    if (started) return
    started = true
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    stopScopeWatch = watch(() => printers.activeScopeKeys.join(','), scopeChanged)
    disposers.push(moonraker.onNotification('notify_gcode_response', handleGcodeResponse))
    stopAvailabilityWatch = watch(
      () => availability.isKlipperReady,
      (isReady) => {
        if (!isReady) return
        // The command list is re-read on every readiness, since a restart is
        // exactly when the configuration — and so the macro set — may have
        // changed. The backfill is offered the same chance but takes it only on
        // an empty transcript, which after a restart it no longer is: the lines
        // already on screen are this printer's, a restart does not clear them,
        // and Moonraker's retained copy of them would only duplicate what is
        // there. It is a connect-time catch-up, and the printer switch that
        // empties the transcript is what genuinely re-arms it.
        void backfillConsole()
        void refreshGcodeHelp()
      },
      { immediate: true },
    )
  }

  function stop(): void {
    if (!started) return
    started = false
    stopAvailabilityWatch?.()
    stopAvailabilityWatch = null
    stopPrinterChangeReset?.()
    stopPrinterChangeReset = null
    stopScopeWatch?.()
    stopScopeWatch = null
    while (disposers.length > 0) disposers.pop()?.()
  }

  return {
    consoleEntries,
    consoleLines,
    commandHistory,
    gcodeHelp,
    echoCommand,
    sendConsoleCommand,
    clearConsole,
    clearCommandHistory,
    start,
    stop,
  }
})
