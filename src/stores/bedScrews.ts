import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import type {
  JsonRpcNotification,
  ObjectSnapshotHandler,
  PrinterObjectSelection,
  PrinterObjectSnapshot,
} from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { isRecord } from '@/utils/records'

const bedScrewsSubscriptionKey = 'alabaster.bedScrews'

const bedScrewsSelection: PrinterObjectSelection = {
  bed_screws: ['is_active', 'state', 'current_screw', 'accepted_screws'],
}

/** Which pass `BED_SCREWS_ADJUST` is on: the coarse round, or the finer second one. */
export type BedScrewPass = 'adjust' | 'fine'

/**
 * Klipper's `bed_screws` helper: the state the machine is in while it stands at
 * one bed screw and waits for someone to say the screw is done.
 *
 * **It is a separate helper from `manual_probe`, and that is the whole reason
 * this store exists.** `BED_SCREWS_ADJUST` looks like a manual probe from the
 * outside — the machine stops, a console line asks for an answer, and nothing
 * moves until it gets one — but Klipper implements it in `bed_screws.py` with
 * its own status object and its own three commands, and registers `ACCEPT`,
 * `ADJUSTED` and `ABORT` for the duration. Watching `manual_probe` therefore
 * never sees it: `is_active` stays false for the entire procedure, so a prompt
 * built on that object leaves the machine parked at a screw with no way out of
 * the interface. That is what this store fixes.
 *
 * The mirror of `stores/manualProbe.ts` in every other respect, deliberately:
 * the same subscription shape, the same dismissal rule, the same reset paths.
 * One difference worth naming — `manual_probe` is one of the objects Klipper
 * loads whether or not the config asks for it, and this one is not. A printer
 * with no `[bed_screws]` section simply never reports the object, which is the
 * same "absent rather than an error" the printer store's optional objects rely
 * on, and it means `isActive` stays false forever rather than the subscription
 * failing.
 *
 * **Nothing here polls, and nothing here infers.** The helper can be started
 * from the console, a macro, the printer's own screen, or a second browser, and
 * watching what Alabaster itself sent would miss every one it did not start.
 */
export const useBedScrewsStore = defineStore('bedScrews', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()

  const isActive = ref(false)
  /** The pass in progress, or null while no helper is running. */
  const pass = ref<BedScrewPass | null>(null)
  /**
   * Which screw of the current pass the machine is standing at, zero-based —
   * Klipper's own index into the list of screws that pass visits. It is an index
   * into a list this object never sends, which is why the prompt reads the
   * screws themselves from `printerConfig.bedScrews`.
   */
  const currentScrew = ref(0)
  /**
   * How many screws of this pass have been accepted. Not simply `currentScrew`
   * plus one: answering `ADJUSTED` sets it back to the start of the round,
   * because a screw turned by a noticeable amount changes the others and
   * Klipper re-verifies all of them. The prompt shows this rather than the index
   * so a round that restarts is visible instead of looking like a stall.
   */
  const acceptedScrews = ref(0)

  /**
   * Whether the user has put the prompt aside while the procedure is still
   * running. The procedure is machine state, not dialog state: dismissing must
   * not accept or abort anything, so this is the one flag that separates "no
   * screws are waiting" from "a screw is waiting and is not on screen right
   * now". Cleared whenever a helper starts, so the next one prompts again.
   */
  const isDismissed = ref(false)

  const disposers: Array<() => void> = []
  let stopAvailabilityWatch: WatchStopHandle | null = null
  let stopPrinterChangeReset: (() => void) | null = null
  let started = false

  /** Whether the prompt should be on screen: a screw is waiting and was not put aside. */
  const isPromptOpen = computed(() => isActive.value && !isDismissed.value)

  function readPass(value: unknown): BedScrewPass | null {
    return value === 'adjust' || value === 'fine' ? value : null
  }

  function readCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null
  }

  function mergeStatus(status: Record<string, unknown>): void {
    const update = status.bed_screws
    if (!isRecord(update)) return
    if ('is_active' in update) {
      const active = update.is_active === true
      // A helper starting is what re-arms the prompt. Doing this on the rising
      // edge only means a status push that merely reports the next screw —
      // which is every ACCEPT — cannot undo a dismissal the user just made.
      if (active && !isActive.value) isDismissed.value = false
      isActive.value = active
    }
    if ('state' in update) pass.value = readPass(update.state)
    if ('current_screw' in update) currentScrew.value = readCount(update.current_screw) ?? 0
    if ('accepted_screws' in update) {
      // Klipper passes through -1 for exactly one instant: `ADJUSTED` sets it
      // there and immediately calls its own ACCEPT, which brings it to 0. A
      // status push caught in between would otherwise render "screw −1".
      acceptedScrews.value = Math.max(0, readCount(update.accepted_screws) ?? 0)
    }
  }

  function handleSnapshot(snapshot: PrinterObjectSnapshot): void {
    mergeStatus(snapshot.status)
  }

  function handleStatusUpdate(notification: JsonRpcNotification): void {
    const status = notification.params[0]
    if (isRecord(status)) mergeStatus(status)
  }

  /**
   * No procedure survives this. Klipper going away ends the helper without ever
   * reporting `is_active: false`, and another printer's bed screws are not this
   * one's — either way a prompt left on screen would offer to accept a screw no
   * machine is standing at.
   */
  function clear(): void {
    isActive.value = false
    pass.value = null
    currentScrew.value = 0
    acceptedScrews.value = 0
    isDismissed.value = false
  }

  function dismiss(): void {
    isDismissed.value = true
  }

  function reopen(): void {
    isDismissed.value = false
  }

  function start(): void {
    if (started) return
    started = true
    stopPrinterChangeReset = moonraker.onPrinterChange(clear)
    disposers.push(
      moonraker.onObjectSnapshot(handleSnapshot as ObjectSnapshotHandler),
      moonraker.onNotification('notify_status_update', handleStatusUpdate),
    )
    stopAvailabilityWatch = watch(
      () => availability.isKlipperReady,
      (isReady) => {
        if (!isReady) {
          clear()
          return
        }
        void moonraker
          .setObjectSubscription(bedScrewsSubscriptionKey, bedScrewsSelection)
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
    void moonraker.removeObjectSubscription(bedScrewsSubscriptionKey)
  }

  return {
    isActive,
    pass,
    currentScrew,
    acceptedScrews,
    isPromptOpen,
    dismiss,
    reopen,
    start,
    stop,
  }
})
