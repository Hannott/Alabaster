import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'

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
 */

export type EndstopState = 'triggered' | 'open' | 'unknown'

export interface EndstopReading {
  /** The endstop's name as Klipper reports it: `x`, `y`, `z`, `z1`, and so on. */
  name: string
  state: EndstopState
}

/** How often an idle printer is asked again. */
export const endstopPollIntervalMs = 2000

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

  const hasReadings = computed(() => readings.value.length > 0)
  /**
   * Whether the shown readings are known to be current. Polling stops while a
   * print runs, so what is on screen then describes the machine as it was before
   * the print started.
   */
  const isStale = computed(() => hasReadings.value && printer.hasActivePrint)
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
      readings.value = Object.entries(result ?? {})
        .map(([name, value]) => ({ name, state: readState(value) }))
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
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
  function printerChanged(): void {
    generation += 1
    readings.value = []
    readAt.value = null
    isLoading.value = false
    failed.value = false
  }

  function start(): void {
    if (started) return
    started = true
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    stopWatch = watch(
      () => availability.isKlipperReady && !printer.hasActivePrint,
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
    stopPrinterChangeReset?.()
    stopPrinterChangeReset = null
  }

  return {
    readings,
    hasReadings,
    isLoading,
    isStale,
    isPolling,
    failed,
    readAt,
    refresh,
    start,
    stop,
  }
})
