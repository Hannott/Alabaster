import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import type { JsonRpcNotification, ObjectSnapshotHandler } from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useManualProbeStore } from '@/stores/manualProbe'
import { useMoonrakerStore } from '@/stores/moonraker'
import { useToastsStore } from '@/stores/toasts'

function wireStore() {
  const moonraker = useMoonrakerStore()
  let snapshotHandler: ObjectSnapshotHandler | undefined
  let statusHandler: ((notification: JsonRpcNotification) => void) | undefined
  let responseHandler: ((notification: JsonRpcNotification) => void) | undefined
  let printerChangeHandler: (() => void) | undefined
  const setObjectSubscription = vi
    .spyOn(moonraker, 'setObjectSubscription')
    .mockResolvedValue(undefined)
  vi.spyOn(moonraker, 'removeObjectSubscription').mockResolvedValue(undefined)
  vi.spyOn(moonraker, 'onObjectSnapshot').mockImplementation((handler) => {
    snapshotHandler = handler
    return () => undefined
  })
  vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
    if (method === 'notify_status_update') statusHandler = handler
    if (method === 'notify_gcode_response') responseHandler = handler
    return () => undefined
  })
  vi.spyOn(moonraker, 'onPrinterChange').mockImplementation((handler) => {
    printerChangeHandler = handler
    return () => undefined
  })

  const store = useManualProbeStore()
  store.start()
  return {
    store,
    setObjectSubscription,
    snapshot: (status: Record<string, unknown>) => snapshotHandler?.({ eventtime: 1, status }),
    update: (params: readonly unknown[]) =>
      statusHandler?.({ jsonrpc: '2.0', method: 'notify_status_update', params }),
    respond: (line: unknown) =>
      responseHandler?.({ jsonrpc: '2.0', method: 'notify_gcode_response', params: [line] }),
    changePrinter: () => printerChangeHandler?.(),
  }
}

/** Everything `isKlipperReady` is derived from, so the store's watch can fire. */
function setKlipperReady(isReady: boolean): Promise<void> {
  const availability = useAvailabilityStore()
  availability.transportState = isReady ? 'connected' : 'disconnected'
  availability.klipperState = isReady ? 'ready' : 'disconnected'
  availability.subscriptionState = isReady ? 'ready' : 'inactive'
  return nextTick()
}

const activeProbe = {
  manual_probe: {
    is_active: true,
    z_position: 4.997,
    z_position_lower: 4.95,
    z_position_upper: 5.05,
  },
}

describe('manual probe store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('reads the probe state and the bracket either side of it', () => {
    const { store, snapshot } = wireStore()

    snapshot(activeProbe)

    expect(store.isActive).toBe(true)
    expect(store.zPosition).toBe(4.997)
    expect(store.zPositionLower).toBe(4.95)
    expect(store.zPositionUpper).toBe(5.05)
    expect(store.isPromptOpen).toBe(true)
  })

  it('treats an unreported bound as absent rather than as a number', () => {
    const { store, snapshot } = wireStore()

    snapshot({
      manual_probe: {
        is_active: true,
        z_position: 5,
        z_position_lower: null,
        z_position_upper: null,
      },
    })

    expect(store.zPositionLower).toBeNull()
    expect(store.zPositionUpper).toBeNull()
  })

  it('applies a live delta and leaves an omitted field as last reported', () => {
    const { store, snapshot, update } = wireStore()

    snapshot(activeProbe)
    update([{ manual_probe: { z_position: 4.975, z_position_lower: 4.95 } }])

    expect(store.zPosition).toBe(4.975)
    expect(store.zPositionUpper).toBe(5.05)
    expect(store.isActive).toBe(true)
  })

  it('closes the prompt when the probe ends, wherever it was ended from', () => {
    const { store, snapshot, update } = wireStore()

    snapshot(activeProbe)
    update([{ manual_probe: { is_active: false } }])

    expect(store.isActive).toBe(false)
    expect(store.isPromptOpen).toBe(false)
  })

  it('dismissing puts the prompt aside without ending the probe', () => {
    const { store, snapshot, update } = wireStore()

    snapshot(activeProbe)
    store.dismiss()

    expect(store.isPromptOpen).toBe(false)
    expect(store.isActive).toBe(true)

    // Every TESTZ pushes a new position; none of them may undo the dismissal.
    update([{ manual_probe: { is_active: true, z_position: 4.9 } }])
    expect(store.isPromptOpen).toBe(false)

    store.reopen()
    expect(store.isPromptOpen).toBe(true)
  })

  it('re-arms the prompt for the next probe after one was dismissed', () => {
    const { store, snapshot, update } = wireStore()

    snapshot(activeProbe)
    store.dismiss()
    update([{ manual_probe: { is_active: false } }])
    update([{ manual_probe: { is_active: true, z_position: 6 } }])

    expect(store.isPromptOpen).toBe(true)
  })

  it('drops a probe that cannot still be waiting: Klipper gone, or another printer', async () => {
    const { store, snapshot, changePrinter } = wireStore()

    await setKlipperReady(true)
    snapshot(activeProbe)
    expect(store.isActive).toBe(true)

    await setKlipperReady(false)
    expect(store.isActive).toBe(false)
    expect(store.zPosition).toBeNull()

    await setKlipperReady(true)
    snapshot(activeProbe)
    changePrinter()
    expect(store.isActive).toBe(false)
  })

  /*
   * Klipper answers a refused ACCEPT on the console and then ends the probe, so
   * the RPC succeeds and the prompt closes exactly as it does on success. Without
   * this the calibration silently did not happen.
   */
  it('surfaces a refused ACCEPT, which the transport reports as a success', () => {
    const toasts = useToastsStore()
    const { snapshot, respond } = wireStore()

    snapshot(activeProbe)
    respond('!! Manual probe failed! Use TESTZ commands to position the nozzle.')

    expect(toasts.entries).toHaveLength(1)
    expect(toasts.entries[0]?.message).toBe(
      'Klipper refused the probe: Manual probe failed! Use TESTZ commands to position the nozzle.',
    )
  })

  it('ignores console traffic that is not this probe being refused', () => {
    const toasts = useToastsStore()
    const { snapshot, respond, update } = wireStore()

    snapshot(activeProbe)
    respond('Z position: 4.950 --> 4.997 <-- 5.050')
    respond(42)
    expect(toasts.entries).toHaveLength(0)

    // A macro echoing the phrase with no probe running is not a refusal either.
    update([{ manual_probe: { is_active: false } }])
    respond('Manual probe failed!')
    expect(toasts.entries).toHaveLength(0)
  })

  it('subscribes to the four fields it reads once Klipper is ready', async () => {
    const { setObjectSubscription } = wireStore()

    await setKlipperReady(true)

    expect(setObjectSubscription).toHaveBeenCalledWith('alabaster.manualProbe', {
      manual_probe: ['is_active', 'z_position', 'z_position_lower', 'z_position_upper'],
    })
  })
})
