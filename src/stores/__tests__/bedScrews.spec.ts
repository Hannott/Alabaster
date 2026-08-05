import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import type { JsonRpcNotification, ObjectSnapshotHandler } from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useBedScrewsStore } from '@/stores/bedScrews'
import { useMoonrakerStore } from '@/stores/moonraker'

function wireStore() {
  const moonraker = useMoonrakerStore()
  let snapshotHandler: ObjectSnapshotHandler | undefined
  let statusHandler: ((notification: JsonRpcNotification) => void) | undefined
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
    return () => undefined
  })
  vi.spyOn(moonraker, 'onPrinterChange').mockImplementation((handler) => {
    printerChangeHandler = handler
    return () => undefined
  })

  const store = useBedScrewsStore()
  store.start()
  return {
    store,
    setObjectSubscription,
    snapshot: (status: Record<string, unknown>) => snapshotHandler?.({ eventtime: 1, status }),
    update: (params: readonly unknown[]) =>
      statusHandler?.({ jsonrpc: '2.0', method: 'notify_status_update', params }),
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

const waitingAtFirstScrew = {
  bed_screws: { is_active: true, state: 'adjust', current_screw: 0, accepted_screws: 0 },
}

describe('bed screws store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  /**
   * The object this reads is not `manual_probe`. `BED_SCREWS_ADJUST` looks like a
   * manual probe from the outside but Klipper implements it as its own helper, so
   * the probe object stays inactive for the whole procedure — which is why the
   * prompt built on that one never appeared and the machine sat at a screw with
   * no way out of the interface.
   */
  it('subscribes to the bed_screws object, not the manual probe', () => {
    const { setObjectSubscription } = wireStore()

    expect(setObjectSubscription).not.toHaveBeenCalled()
    return setKlipperReady(true).then(() => {
      expect(setObjectSubscription).toHaveBeenCalledWith('alabaster.bedScrews', {
        bed_screws: ['is_active', 'state', 'current_screw', 'accepted_screws'],
      })
    })
  })

  it('reads which pass, which screw and how many are accepted', () => {
    const { store, snapshot } = wireStore()

    snapshot(waitingAtFirstScrew)

    expect(store.isActive).toBe(true)
    expect(store.pass).toBe('adjust')
    expect(store.currentScrew).toBe(0)
    expect(store.acceptedScrews).toBe(0)
    expect(store.isPromptOpen).toBe(true)
  })

  it('follows the helper onto the next screw and into the fine pass', () => {
    const { store, snapshot, update } = wireStore()

    snapshot(waitingAtFirstScrew)
    update([{ bed_screws: { current_screw: 1, accepted_screws: 1 } }])
    expect(store.currentScrew).toBe(1)
    expect(store.acceptedScrews).toBe(1)
    // An omitted field keeps its last reported value: Moonraker sends deltas.
    expect(store.pass).toBe('adjust')

    update([{ bed_screws: { state: 'fine', current_screw: 0, accepted_screws: 0 } }])
    expect(store.pass).toBe('fine')
  })

  /**
   * `ADJUSTED` sets the counter to -1 and immediately runs its own ACCEPT, which
   * brings it back to 0. A status push caught between the two would otherwise
   * render "screw −1 accepted".
   */
  it('never reports a negative accepted count', () => {
    const { store, snapshot, update } = wireStore()

    snapshot(waitingAtFirstScrew)
    update([{ bed_screws: { accepted_screws: -1 } }])

    expect(store.acceptedScrews).toBe(0)
  })

  it('closes the prompt when the round ends, wherever it was ended from', () => {
    const { store, snapshot, update } = wireStore()

    snapshot(waitingAtFirstScrew)
    update([{ bed_screws: { is_active: false, state: null } }])

    expect(store.isActive).toBe(false)
    expect(store.pass).toBeNull()
    expect(store.isPromptOpen).toBe(false)
  })

  it('dismissing puts the prompt aside without answering the machine', () => {
    const { store, snapshot, update } = wireStore()

    snapshot(waitingAtFirstScrew)
    store.dismiss()

    expect(store.isPromptOpen).toBe(false)
    expect(store.isActive).toBe(true)

    // Every ACCEPT pushes the next screw; none of them may undo the dismissal.
    update([{ bed_screws: { is_active: true, current_screw: 1, accepted_screws: 1 } }])
    expect(store.isPromptOpen).toBe(false)

    store.reopen()
    expect(store.isPromptOpen).toBe(true)
  })

  it('re-arms the prompt for the next round after one was dismissed', () => {
    const { store, snapshot, update } = wireStore()

    snapshot(waitingAtFirstScrew)
    store.dismiss()
    update([{ bed_screws: { is_active: false } }])
    update([{ bed_screws: { is_active: true, state: 'adjust', current_screw: 0 } }])

    expect(store.isPromptOpen).toBe(true)
  })

  it('drops a round that cannot still be waiting: Klipper gone, or another printer', async () => {
    const { store, snapshot, changePrinter } = wireStore()

    await setKlipperReady(true)
    snapshot(waitingAtFirstScrew)
    expect(store.isActive).toBe(true)

    // Klipper going away ends the helper without ever reporting is_active false.
    await setKlipperReady(false)
    expect(store.isActive).toBe(false)
    expect(store.pass).toBeNull()

    await setKlipperReady(true)
    snapshot(waitingAtFirstScrew)
    changePrinter()
    expect(store.isActive).toBe(false)
  })

  /**
   * `bed_screws` is not one of the objects Klipper loads unasked, unlike
   * `manual_probe`. A printer with no `[bed_screws]` section simply never reports
   * it, and the store has to read that as "nothing waiting" rather than waiting
   * for a field that will not arrive.
   */
  it('stays inactive on a printer that never reports the object', async () => {
    const { store, snapshot } = wireStore()

    await setKlipperReady(true)
    snapshot({ toolhead: { homed_axes: 'xyz' } })

    expect(store.isActive).toBe(false)
    expect(store.isPromptOpen).toBe(false)
  })
})
