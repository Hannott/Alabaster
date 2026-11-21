import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import type {
  JsonRpcNotification,
  ObjectSnapshotHandler,
  PrinterObjectSnapshot,
} from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import { isRecord } from '@/utils/records'

/**
 * Endstop states, from `printer.query_endstops.status`.
 *
 * There is no notification for these: Klipper answers the query by asking the
 * MCUs at that moment, so the only way to keep them current is to ask again.
 * The store therefore polls — the explicit polling the hard rule in `AGENTS.md`
 * calls for where no notification exists — but only while the printer is idle.
 * A query during a print competes with the motion queue for the same MCU, and a
 * reading nobody is watching is not worth that. While a print runs, the last
 * reading stays on screen and is marked stale.
 *
 * "Idle" is Klipper's own word, not merely "no print": the query takes the
 * G-code mutex and processes the toolhead's lookahead queue
 * (`query_endstops.py`), so a poll during a macro, a heat soak or a run of jog
 * moves waits behind it and splits the moves it lands between. Polling is
 * therefore held while `idle_timeout` reports `Printing`, which Klipper reports
 * whenever G-code is executing, print or not. `query_endstops.last_query` is
 * subscribed alongside it, so a read anyone else asks for — `QUERY_ENDSTOPS`
 * in the console, another browser — shows here without a request of ours.
 */

export type EndstopState = 'triggered' | 'open' | 'unknown'

export interface EndstopReading {
  /** The endstop's name as Klipper reports it: `x`, `y`, `z`, `z1`, and so on. */
  name: string
  state: EndstopState
}

/** How often an idle printer is asked again. */
export const endstopPollIntervalMs = 2000

const subscriptionKey = 'alabaster.calibration.endstops'

/** `last_query`'s values are the MCU's raw answer, a boolean or 0/1, not the RPC's words. */
function readQueriedState(value: unknown): EndstopState {
  if (typeof value === 'boolean') return value ? 'triggered' : 'open'
  if (value === 0 || value === 1) return value === 1 ? 'triggered' : 'open'
  return 'unknown'
}

function sortedReadings(entries: Array<[string, EndstopState]>): EndstopReading[] {
  return entries
    .map(([name, state]) => ({ name, state }))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
}

function readState(value: unknown): EndstopState {
  if (typeof value !== 'string') return 'unknown'
  const normalized = value.trim().toLowerCase()
  if (normalized === 'triggered') return 'triggered'
  if (normalized === 'open') return 'open'
  return 'unknown'
}

export const useEndstopsStore = defineStore('endstops', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()
  const printer = usePrinterStore()

  const readings = ref<EndstopReading[]>([])
  const isLoading = ref(false)
  const failed = ref(false)
  /** When the shown readings were taken, so the view can say how old they are. */
  const readAt = ref<number | null>(null)

  let generation = 0
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let started = false
  let stopWatch: WatchStopHandle | null = null
  let stopPrinterChangeReset: (() => void) | null = null
  let stopSubscriptionWatch: WatchStopHandle | null = null
  const disposers: Array<() => void> = []
  /** `idle_timeout.state`: `Idle`, `Ready`, or `Printing` while any G-code runs. */
  const idleState = ref<string | null>(null)

  const hasReadings = computed(() => readings.value.length > 0)
  /** Whether Klipper is executing G-code outside a print, which holds polling. */
  const isBusy = computed(() => idleState.value === 'Printing' && !printer.hasActivePrint)
  /**
   * Whether the shown readings are known to be current. Polling stops while a
   * print runs, so what is on screen then describes the machine as it was before
   * the print started.
   */
  const isStale = computed(() => hasReadings.value && (printer.hasActivePrint || isBusy.value))
  const isPolling = computed(() => pollTimer !== null)

  /**
   * A poll tick must never pile onto a request that has not answered yet. A
   * printer fault can make `query_endstops.status` hang for a long time — the
   * MCU is unresponsive, so Klipper cannot flush the toolhead move the query
   * waits on — and without this guard the two-second interval kept firing
   * regardless, queuing one more request every tick for as long as the fault
   * lasted. The backlog then drained in a burst the moment the connection
   * freed up, which is what a MCU shutdown turned into a flood of near-
   * simultaneous failures instead of one clear one.
   */
  async function refresh(): Promise<boolean> {
    if (isLoading.value) return false
    if (!availability.isKlipperReady) return false
    const current = ++generation
    isLoading.value = true

    try {
      const result = await moonraker.rpcCall('printer.query_endstops.status')
      if (current !== generation) return false
      readings.value = sortedReadings(
        Object.entries(result ?? {}).map(([name, value]) => [name, readState(value)]),
      )
      readAt.value = Date.now()
      failed.value = false
      return true
    } catch {
      // Keep the last reading rather than blanking the panel: a refused query
      // says nothing about where the endstops actually are.
      if (current === generation) failed.value = true
      return false
    } finally {
      if (current === generation) isLoading.value = false
    }
  }

  function startPolling(): void {
    if (pollTimer !== null) return
    pollTimer = setInterval(() => void refresh(), endstopPollIntervalMs)
  }

  function stopPolling(): void {
    if (pollTimer === null) return
    clearInterval(pollTimer)
    pollTimer = null
  }

  /**
   * A reading names another machine's switches; shown here it reports pins
   * the new printer may not even have. The next poll tick repopulates once
   * the new printer is ready.
   */
  function mergeStatus(status: unknown): void {
    if (!isRecord(status)) return
    const idle = status.idle_timeout
    if (isRecord(idle) && typeof idle.state === 'string') idleState.value = idle.state
    const query = status.query_endstops
    if (!isRecord(query) || !isRecord(query.last_query)) return
    const entries = Object.entries(query.last_query)
    if (entries.length === 0) return
    // A read of our own that is still answering is about to say the same, and newer.
    if (isLoading.value) return
    readings.value = sortedReadings(entries.map(([name, value]) => [name, readQueriedState(value)]))
    readAt.value = Date.now()
    failed.value = false
  }

  function handleSnapshot(snapshot: PrinterObjectSnapshot): void {
    mergeStatus(snapshot.status)
  }

  function handleStatusUpdate(notification: JsonRpcNotification): void {
    mergeStatus(notification.params[0])
  }

  function printerChanged(): void {
    generation += 1
    idleState.value = null
    readings.value = []
    readAt.value = null
    isLoading.value = false
    failed.value = false
  }

  function start(): void {
    if (started) return
    started = true
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    try {
      disposers.push(
        moonraker.onObjectSnapshot(handleSnapshot as ObjectSnapshotHandler),
        moonraker.onNotification('notify_status_update', handleStatusUpdate),
      )
    } catch {
      // Without a client nothing reports a status; polling alone keeps the readings.
    }
    stopSubscriptionWatch = watch(
      () => availability.isKlipperReady,
      (ready) => {
        if (!ready) return
        void moonraker
          .setObjectSubscription(subscriptionKey, {
            idle_timeout: ['state'],
            query_endstops: ['last_query'],
          })
          .catch(() => undefined)
      },
      { immediate: true },
    )
    stopWatch = watch(
      () => availability.isKlipperReady && !printer.hasActivePrint && !isBusy.value,
      (shouldPoll) => {
        if (shouldPoll) {
          void refresh()
          startPolling()
        } else {
          stopPolling()
        }
      },
      { immediate: true },
    )
  }

  function stop(): void {
    if (!started) return
    started = false
    generation += 1
    isLoading.value = false
    stopPolling()
    stopWatch?.()
    stopWatch = null
    stopSubscriptionWatch?.()
    stopSubscriptionWatch = null
    while (disposers.length > 0) disposers.pop()?.()
    void moonraker.removeObjectSubscription(subscriptionKey).catch(() => undefined)
    idleState.value = null
    stopPrinterChangeReset?.()
    stopPrinterChangeReset = null
  }

  return {
    readings,
    hasReadings,
    isLoading,
    isStale,
    isBusy,
    isPolling,
    failed,
    readAt,
    refresh,
    start,
    stop,
  }
})
