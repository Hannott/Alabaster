import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import type {
  JsonRpcNotification,
  ObjectSnapshotHandler,
  PrinterObjectSelection,
  PrinterObjectSnapshot,
} from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useBedScrewsStore } from '@/stores/bedScrews'
import { useManualProbeStore } from '@/stores/manualProbe'
import { useMoonrakerStore } from '@/stores/moonraker'
import { isRecord } from '@/utils/records'

const sharedRunsSubscriptionKey = 'alabaster.sharedRuns'
const stateObject = 'gcode_macro _ALABASTER_STATE'
const sharedRunsSelection: PrinterObjectSelection = {
  [stateObject]: ['runs'],
  idle_timeout: ['state'],
}

/**
 * How long the printer has to have been quiet before a marker nobody here is
 * running counts as left behind. Long enough to cover the moment between a
 * run's start marker and its first move, when Klipper is not yet `Printing`.
 */
export const sharedRunTimings = { staleAfterMs: 5_000 }

export type SharedRunKind = 'macro' | 'calibration'

export interface SharedRun {
  id: string
  kind: SharedRunKind
  /** The macro's upper-case name, or the calibration procedure's id. */
  name: string
}

/** Characters every `ID`, `KIND`, and `NAME` sent to the pack is made of, so none needs quoting. */
const plainParameter = /^[A-Za-z0-9_]+$/

function readRuns(value: unknown): SharedRun[] {
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([id, entry]) => {
    if (!isRecord(entry)) return []
    const { kind, name } = entry
    if ((kind !== 'macro' && kind !== 'calibration') || typeof name !== 'string') return []
    return [{ id, kind, name }]
  })
}

/**
 * The macros and calibrations Alabaster has running on this printer, from any
 * browser. Klipper reports which script is executing to nobody, and Moonraker
 * sends a script's text only to the client that sent it, so a run is visible
 * elsewhere only if it says so itself: the macro pack's `_ALABASTER_RUN_BEGIN`
 * and `_ALABASTER_RUN_END` keep a `runs` variable on `_ALABASTER_STATE`, and its
 * status reaches every client like any other Klipper object.
 *
 * A printer whose pack predates `runs` reports no such field, and every run
 * there stays visible only in the browser that started it, exactly as before.
 *
 * **A marker is not trusted to be cleared by the browser that set it.** That
 * browser can be reloaded, closed, or offline when its run ends, and a marker
 * nobody clears holds every other browser's Run buttons until Klipper
 * restarts. So any browser clears a marker it is not itself running once the
 * printer has been quiet for `staleAfterMs`: Klipper's `idle_timeout` is not
 * `Printing` — it leaves `Printing` only once the toolhead has stopped and no
 * script holds the G-code lock — and no paper test or bed-screw round is
 * waiting, since those hold the machine with the lock free. Clearing early
 * costs nothing either: `_ALABASTER_RUN_END` is a script, so it waits for the
 * G-code lock and cannot run in the middle of the command it is about.
 */
export const useSharedRunsStore = defineStore('sharedRuns', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()

  const runs = ref<SharedRun[]>([])
  /** Whether the pack reports `runs` at all; nothing is bracketed until it does. */
  const isSupported = ref(false)
  /** The ids this browser began, so its own runs are never mistaken for another browser's. */
  const ownIds = ref<ReadonlySet<string>>(new Set())
  /** The subset still running here; any other marker is one this browser may clear. */
  const activeOwnIds = ref<ReadonlySet<string>>(new Set())
  const isKlipperPrinting = ref(false)
  const manualProbe = useManualProbeStore()
  const bedScrews = useBedScrewsStore()
  /** Ids whose end marker this browser has already sent, so it is sent once. */
  const clearingIds = new Set<string>()
  let staleTimer: ReturnType<typeof setTimeout> | null = null

  const disposers: Array<() => void> = []
  let stopAvailabilityWatch: WatchStopHandle | null = null
  let stopPrinterChangeReset: (() => void) | null = null
  let started = false

  const foreignRuns = computed(() => runs.value.filter((run) => !ownIds.value.has(run.id)))

  function isForeignMacroRunning(name: string): boolean {
    const macro = name.trim().toUpperCase()
    return foreignRuns.value.some((run) => run.kind === 'macro' && run.name === macro)
  }

  /** The procedure another browser is running, if one is. */
  const foreignCalibration = computed(
    () => foreignRuns.value.find((run) => run.kind === 'calibration') ?? null,
  )

  function mergeStatus(status: Record<string, unknown>): void {
    const idle = status.idle_timeout
    if (isRecord(idle) && typeof idle.state === 'string') {
      isKlipperPrinting.value = idle.state === 'Printing'
    }
    const state = status[stateObject]
    if (!isRecord(state) || !('runs' in state)) return
    isSupported.value = true
    runs.value = readRuns(state.runs)
    for (const id of clearingIds) {
      if (!runs.value.some((run) => run.id === id)) clearingIds.delete(id)
    }
  }

  const isPrinterQuiet = computed(
    () => !isKlipperPrinting.value && !manualProbe.isActive && !bedScrews.isActive,
  )
  const unattendedRuns = computed(() => runs.value.filter((run) => !activeOwnIds.value.has(run.id)))

  function clearStale(): void {
    staleTimer = null
    if (!isPrinterQuiet.value) return
    for (const run of unattendedRuns.value) {
      if (clearingIds.has(run.id)) continue
      clearingIds.add(run.id)
      end(run.id)
    }
  }

  function scheduleStaleCheck(): void {
    if (staleTimer !== null) clearTimeout(staleTimer)
    staleTimer = null
    if (!isPrinterQuiet.value || unattendedRuns.value.length === 0) return
    staleTimer = setTimeout(clearStale, sharedRunTimings.staleAfterMs)
  }

  function handleSnapshot(snapshot: PrinterObjectSnapshot): void {
    mergeStatus(snapshot.status)
  }

  function handleStatusUpdate(notification: JsonRpcNotification): void {
    const status = notification.params[0]
    if (isRecord(status)) mergeStatus(status)
  }

  function newId(): string {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  }

  /**
   * Reserves an id for a run this browser is about to start, or `null` where
   * the pack cannot carry it — the caller then sends its script unbracketed.
   */
  function claim(kind: SharedRunKind, name: string): string | null {
    if (!isSupported.value || !plainParameter.test(name)) return null
    const id = newId()
    ownIds.value = new Set(ownIds.value).add(id)
    activeOwnIds.value = new Set(activeOwnIds.value).add(id)
    return id
  }

  /**
   * The run is over here, however it ended. A marker still standing after
   * this — its end marker failed to send — is cleared like anyone else's.
   */
  function release(id: string): void {
    const next = new Set(activeOwnIds.value)
    next.delete(id)
    activeOwnIds.value = next
    scheduleStaleCheck()
  }

  function beginLine(id: string, kind: SharedRunKind, name: string): string {
    return `_ALABASTER_RUN_BEGIN ID=${id} KIND=${kind} NAME=${name}`
  }

  function endLine(id: string): string {
    return `_ALABASTER_RUN_END ID=${id}`
  }

  /*
   * Bookkeeping, not a command: sent straight to Moonraker rather than through
   * the printer store, so it is neither echoed into the console nor listed
   * among the queued commands. A failure is ignored — the marker it would have
   * set or cleared is the only thing lost, and Klipper restarting clears it.
   */
  function send(script: string): void {
    if (!moonraker.isConnected) return
    moonraker
      .rpcCall('printer.gcode.script', { script }, { timeoutMs: null })
      .catch(() => undefined)
  }

  function begin(id: string, kind: SharedRunKind, name: string): void {
    send(beginLine(id, kind, name))
  }

  function end(id: string): void {
    send(endLine(id))
  }

  /** Klipper leaving takes the variable with it; the next snapshot reports it afresh. */
  function clear(): void {
    runs.value = []
    isSupported.value = false
    isKlipperPrinting.value = false
    clearingIds.clear()
    if (staleTimer !== null) clearTimeout(staleTimer)
    staleTimer = null
  }

  function printerChanged(): void {
    clear()
    ownIds.value = new Set()
    activeOwnIds.value = new Set()
  }

  function start(): void {
    if (started) return
    started = true
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    disposers.push(
      moonraker.onObjectSnapshot(handleSnapshot as ObjectSnapshotHandler),
      moonraker.onNotification('notify_status_update', handleStatusUpdate),
      watch(
        () => [isPrinterQuiet.value, unattendedRuns.value.map((run) => run.id).join(',')],
        scheduleStaleCheck,
      ),
    )
    stopAvailabilityWatch = watch(
      () => availability.isKlipperReady,
      (isReady) => {
        if (!isReady) {
          clear()
          return
        }
        void moonraker
          .setObjectSubscription(sharedRunsSubscriptionKey, sharedRunsSelection)
          .catch(() => undefined)
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
    while (disposers.length > 0) disposers.pop()?.()
    void moonraker.removeObjectSubscription(sharedRunsSubscriptionKey)
  }

  return {
    runs,
    isSupported,
    foreignRuns,
    foreignCalibration,
    isForeignMacroRunning,
    claim,
    release,
    beginLine,
    endLine,
    begin,
    end,
    start,
    stop,
  }
})
