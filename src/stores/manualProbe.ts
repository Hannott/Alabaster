import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import type {
  JsonRpcNotification,
  ObjectSnapshotHandler,
  PrinterObjectSelection,
  PrinterObjectSnapshot,
} from '@/services/moonraker'
import { i18n } from '@/i18n'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { useToastsStore } from '@/stores/toasts'
import { isRecord } from '@/utils/records'

const manualProbeSubscriptionKey = 'alabaster.manualProbe'

const manualProbeSelection: PrinterObjectSelection = {
  manual_probe: ['is_active', 'z_position', 'z_position_lower', 'z_position_upper'],
}

/**
 * Klipper's `manual_probe` helper: the state a paper test is in while the
 * machine waits for someone to say where the bed is.
 *
 * It gets its own store rather than a slot in `printer.ts`'s already-large
 * selection for the same reason `excludeObject.ts` does — a different
 * population, read by one surface — and it is subscribed unconditionally
 * because `manual_probe` is one of the objects Klipper loads whether or not
 * the config names it. A machine that never runs a manual probe simply reports
 * `is_active: false` forever.
 *
 * **Nothing here polls, and nothing here infers.** The helper can be started by
 * anything — `MANUAL_PROBE`, `Z_ENDSTOP_CALIBRATE`, `PROBE_CALIBRATE`,
 * `DELTA_CALIBRATE` on a probe-less delta, or a user macro such as
 * `CALIBRATE_NOZZLE_Z` — from the console, a macro button, a printer's own
 * screen, or a second browser. Watching the object is the only way a prompt can
 * appear for all of those; watching what Alabaster itself sent would miss every
 * one it did not start.
 *
 * **`BED_SCREWS_ADJUST` is not one of them**, though it reads like one: Klipper
 * implements it in `bed_screws.py` as a separate helper with its own status
 * object and its own `ACCEPT`/`ADJUSTED`/`ABORT`, so `manual_probe.is_active`
 * stays false for that whole procedure. It has its own store and prompt — see
 * `stores/bedScrews.ts`. This comment claimed otherwise for a while, and the
 * cost of the mistake was a machine parked at a bed screw with no prompt.
 */
export const useManualProbeStore = defineStore('manualProbe', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()
  const toasts = useToastsStore()

  const isActive = ref(false)
  /** Where the nozzle is now, in the kinematic frame the helper reports. */
  const zPosition = ref<number | null>(null)
  /**
   * The nearest heights already visited below and above the current one — the
   * bracket a bisection is closing in on. Both are null until the probe has
   * been somewhere else in that direction, which is what Klipper's own console
   * report writes as `??????`; a prompt has to be able to say "not yet" rather
   * than draw a bound that does not exist.
   */
  const zPositionLower = ref<number | null>(null)
  const zPositionUpper = ref<number | null>(null)

  /**
   * Whether the user has put the prompt aside while the probe is still running.
   * The probe is machine state, not dialog state: dismissing the prompt must
   * not accept or abort anything, so this is the one flag that separates "no
   * probe is running" from "a probe is running and is not on screen right now".
   * Cleared whenever a probe starts, so the next one prompts again.
   */
  const isDismissed = ref(false)

  const disposers: Array<() => void> = []
  let stopAvailabilityWatch: WatchStopHandle | null = null
  let stopPrinterChangeReset: (() => void) | null = null
  let started = false

  /** Whether the prompt should be on screen: a probe is waiting and was not put aside. */
  const isPromptOpen = computed(() => isActive.value && !isDismissed.value)

  function readPosition(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }

  function mergeStatus(status: Record<string, unknown>): void {
    const update = status.manual_probe
    if (!isRecord(update)) return
    if ('is_active' in update) {
      const active = update.is_active === true
      // A probe starting is what re-arms the prompt. Doing this on the rising
      // edge only means a status push that merely reports a new Z — which is
      // every TESTZ — cannot undo a dismissal the user just made.
      if (active && !isActive.value) isDismissed.value = false
      isActive.value = active
    }
    if ('z_position' in update) zPosition.value = readPosition(update.z_position)
    if ('z_position_lower' in update) zPositionLower.value = readPosition(update.z_position_lower)
    if ('z_position_upper' in update) zPositionUpper.value = readPosition(update.z_position_upper)
  }

  function handleSnapshot(snapshot: PrinterObjectSnapshot): void {
    mergeStatus(snapshot.status)
  }

  function handleStatusUpdate(notification: JsonRpcNotification): void {
    const status = notification.params[0]
    if (isRecord(status)) mergeStatus(status)
  }

  /**
   * Klipper can refuse an `ACCEPT`, and the refusal is not an error the RPC ever
   * reports: `cmd_ACCEPT` checks that the nozzle actually moved down from where
   * the probe started and that X and Y did not move, and if either fails it
   * prints "Manual probe failed!" and ends the probe **without recording
   * anything**. The transport call succeeded, `is_active` goes false, and the
   * prompt closes exactly as it does on success — so without this the one
   * outcome the whole dialog exists to produce can silently not happen.
   *
   * Alabaster makes this likelier than a prompt that cannot be put aside does,
   * which is why it is handled rather than documented: dismissing the prompt to
   * go and jog the toolhead or run another macro is a path this design invites,
   * and moving X or Y is one of the two things that invalidates the probe.
   *
   * Matched on Klipper's own English text, the way `features/bedMesh/probeRun.ts`
   * already reads the transcript — Klipper does not localise its console, and
   * "Manual probe failed" is the stable part of a sentence whose tail explains
   * what to do instead. That tail is what the toast carries, so the advice comes
   * from the firmware that refused rather than from a copy of it here that could
   * go stale.
   */
  function handleGcodeResponse(notification: JsonRpcNotification): void {
    if (!isActive.value) return
    const response = notification.params[0]
    if (typeof response !== 'string') return
    if (!/manual probe failed/i.test(response)) return
    toasts.push(
      i18n.global.t('manualProbe.refused', { reason: response.replace(/^!!\s*/, '').trim() }),
    )
  }

  /**
   * No probe survives this. Klipper going away ends the helper without ever
   * reporting `is_active: false`, and another printer's probe is not this
   * one's — either way a prompt left on screen would offer to accept a
   * position no machine is holding.
   */
  function clear(): void {
    isActive.value = false
    zPosition.value = null
    zPositionLower.value = null
    zPositionUpper.value = null
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
      moonraker.onNotification('notify_gcode_response', handleGcodeResponse),
    )
    stopAvailabilityWatch = watch(
      () => availability.isKlipperReady,
      (isReady) => {
        if (!isReady) {
          clear()
          return
        }
        void moonraker
          .setObjectSubscription(manualProbeSubscriptionKey, manualProbeSelection)
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
    void moonraker.removeObjectSubscription(manualProbeSubscriptionKey)
  }

  return {
    isActive,
    zPosition,
    zPositionLower,
    zPositionUpper,
    isPromptOpen,
    dismiss,
    reopen,
    start,
    stop,
  }
})
