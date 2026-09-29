import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import type { JsonRpcNotification, ObjectSnapshotHandler } from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { useScrewsTiltStore } from '@/stores/screwsTilt'

function wireStore() {
  const moonraker = useMoonrakerStore()
  let snapshotHandler: ObjectSnapshotHandler | undefined
  let statusHandler: ((notification: JsonRpcNotification) => void) | undefined
  let printerChangeHandler: (() => void) | undefined
  const setObjectSubscription = vi
    .spyOn(moonraker, 'setObjectSubscription')
    .mockResolvedValue(undefined)
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

  const store = useScrewsTiltStore()
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

function setKlipperReady(isReady: boolean): Promise<void> {
  const availability = useAvailabilityStore()
  availability.transportState = isReady ? 'connected' : 'disconnected'
  availability.klipperState = isReady ? 'ready' : 'disconnected'
  availability.subscriptionState = isReady ? 'ready' : 'inactive'
  return nextTick()
}

const finished = {
  screws_tilt_adjust: {
    error: false,
    max_deviation: 0.05,
    results: {
      screw1: { z: 2.329, sign: 'CW', adjust: '00:00', is_base: true },
      screw2: { z: 2.391, sign: 'CCW', adjust: '00:15', is_base: false },
    },
  },
}

describe('screws tilt store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('subscribes to the object once Klipper is ready', async () => {
    const { setObjectSubscription } = wireStore()
    expect(setObjectSubscription).not.toHaveBeenCalled()
    await setKlipperReady(true)
    expect(setObjectSubscription).toHaveBeenCalledWith('alabaster.screwsTilt', {
      screws_tilt_adjust: ['error', 'max_deviation', 'results'],
    })
  })

  it('reads a finished run from a snapshot and from a status update', () => {
    const { store, snapshot, update } = wireStore()
    snapshot(finished)
    expect(store.hasResults).toBe(true)
    expect(store.maxDeviation).toBe(0.05)
    expect(store.results.screw2).toEqual({ z: 2.391, sign: 'CCW', adjust: '00:15', isBase: false })
    expect(store.results.screw1?.isBase).toBe(true)

    update([{ screws_tilt_adjust: { error: true, results: {} } }])
    expect(store.error).toBe(true)
    expect(store.hasResults).toBe(false)
    // A field the update leaves out keeps its value.
    expect(store.maxDeviation).toBe(0.05)
  })

  it('drops a screw whose height is not a number, and reads an unknown sign as CW', () => {
    const { store, snapshot } = wireStore()
    snapshot({
      screws_tilt_adjust: {
        results: { screw1: { z: 'nan', sign: 'CW' }, screw2: { z: 1, sign: 'sideways' } },
      },
    })
    expect(Object.keys(store.results)).toEqual(['screw2'])
    expect(store.results.screw2).toMatchObject({ sign: 'CW', adjust: '00:00', isBase: false })
  })

  it('forgets another printer’s screws', () => {
    const { store, snapshot, changePrinter } = wireStore()
    snapshot(finished)
    changePrinter()
    expect(store.hasResults).toBe(false)
    expect(store.maxDeviation).toBeNull()
    expect(store.error).toBe(false)
  })
})
