import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import type { ScrewsTiltStatus, ScrewTurn } from '@/features/calibration/screws'
import type {
  JsonRpcNotification,
  ObjectSnapshotHandler,
  PrinterObjectSelection,
  PrinterObjectSnapshot,
} from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { isRecord } from '@/utils/records'

const screwsTiltSubscriptionKey = 'alabaster.screwsTilt'

const screwsTiltSelection: PrinterObjectSelection = {
  screws_tilt_adjust: ['error', 'max_deviation', 'results'],
}

function readResults(value: unknown): ScrewsTiltStatus['results'] {
  if (!isRecord(value)) return {}
  const results: Record<string, { z: number; sign: ScrewTurn; adjust: string; isBase: boolean }> =
    {}
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry) || typeof entry.z !== 'number' || !Number.isFinite(entry.z)) continue
    const sign = entry.sign === 'CCW' ? 'CCW' : 'CW'
    results[key] = {
      z: entry.z,
      sign,
      adjust: typeof entry.adjust === 'string' ? entry.adjust : '00:00',
      isBase: entry.is_base === true,
    }
  }
  return results
}

/**
 * What `SCREWS_TILT_CALCULATE` found, from Klipper's own status object rather
 * than the console lines it also prints. The object carries every screw's
 * height, direction and turn, plus whether the run exceeded `MAX_DEVIATION`
 * — which the lines do not say in any shape a parser could trust, and which
 * is the difference between a bed to adjust and a run to repeat. Present
 * only where `[screws_tilt_adjust]` is configured; the subscription is
 * unconditional, as `firmware_retraction`'s is, because an absent object is
 * absent rather than an error.
 *
 * The results persist on the printer between runs, so a reader of them has
 * to know which run they belong to: the calibration store snapshots them
 * when a run starts and reads them only once they have changed.
 */
export const useScrewsTiltStore = defineStore('screwsTilt', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()

  const error = ref(false)
  const maxDeviation = ref<number | null>(null)
  const results = ref<ScrewsTiltStatus['results']>({})

  const disposers: Array<() => void> = []
  let stopAvailabilityWatch: WatchStopHandle | null = null
  let stopPrinterChangeReset: (() => void) | null = null
  let started = false

  const hasResults = computed(() => Object.keys(results.value).length > 0)

  const status = computed<ScrewsTiltStatus>(() => ({
    error: error.value,
    maxDeviation: maxDeviation.value,
    results: results.value,
  }))

  function mergeStatus(update: Record<string, unknown>): void {
    const object = update.screws_tilt_adjust
    if (!isRecord(object)) return
    if ('error' in object) error.value = object.error === true
    if ('max_deviation' in object) {
      maxDeviation.value =
        typeof object.max_deviation === 'number' && Number.isFinite(object.max_deviation)
          ? object.max_deviation
          : null
    }
    if ('results' in object) results.value = readResults(object.results)
  }

  function handleSnapshot(snapshot: PrinterObjectSnapshot): void {
    mergeStatus(snapshot.status)
  }

  function handleStatusUpdate(notification: JsonRpcNotification): void {
    const update = notification.params[0]
    if (isRecord(update)) mergeStatus(update)
  }

  function printerChanged(): void {
    error.value = false
    maxDeviation.value = null
    results.value = {}
  }

  function start(): void {
    if (started) return
    started = true
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    disposers.push(
      moonraker.onObjectSnapshot(handleSnapshot as ObjectSnapshotHandler),
      moonraker.onNotification('notify_status_update', handleStatusUpdate),
    )
    stopAvailabilityWatch = watch(
      () => availability.isKlipperReady,
      (isReady) => {
        if (!isReady) return
        void moonraker
          .setObjectSubscription(screwsTiltSubscriptionKey, screwsTiltSelection)
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
  }

  return { error, maxDeviation, results, hasResults, status, start, stop }
})
