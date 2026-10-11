import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import type { JsonRpcNotification, ObjectSnapshotHandler } from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { useManualProbeStore } from '@/stores/manualProbe'
import { sharedRunTimings, useSharedRunsStore } from '@/stores/sharedRuns'

const stateObject = 'gcode_macro _ALABASTER_STATE'

function wireStore() {
  const moonraker = useMoonrakerStore()
  let snapshotHandler: ObjectSnapshotHandler | undefined
  let statusHandler: ((notification: JsonRpcNotification) => void) | undefined
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

  const store = useSharedRunsStore()
  store.start()
  return {
    store,
    setObjectSubscription,
    snapshot: (status: Record<string, unknown>) => snapshotHandler?.({ eventtime: 1, status }),
    update: (status: Record<string, unknown>) =>
      statusHandler?.({ jsonrpc: '2.0', method: 'notify_status_update', params: [status, 1] }),
  }
}

function setKlipperReady(isReady: boolean): Promise<void> {
  const availability = useAvailabilityStore()
  availability.transportState = isReady ? 'connected' : 'disconnected'
  availability.klipperState = isReady ? 'ready' : 'disconnected'
  availability.subscriptionState = isReady ? 'ready' : 'inactive'
  return nextTick()
}

describe('shared runs store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setActivePinia(createPinia())
  })

  it('reads the runs every browser reports and tells its own apart from the rest', async () => {
    const { store, setObjectSubscription, snapshot, update } = wireStore()
    await setKlipperReady(true)
    expect(setObjectSubscription).toHaveBeenCalledWith('alabaster.sharedRuns', {
      [stateObject]: ['runs'],
      idle_timeout: ['state'],
    })

    snapshot({ [stateObject]: { runs: {} } })
    expect(store.isSupported).toBe(true)

    const own = store.claim('macro', 'PURGE')
    expect(own).not.toBeNull()
    update({
      [stateObject]: {
        runs: {
          [own!]: { kind: 'macro', name: 'PURGE' },
          other: { kind: 'calibration', name: 'probeAccuracy' },
          broken: { kind: 'unknown', name: 'X' },
        },
      },
    })

    expect(store.runs.map((run) => run.id)).toEqual([own, 'other'])
    expect(store.isForeignMacroRunning('purge')).toBe(false)
    expect(store.foreignCalibration?.name).toBe('probeAccuracy')
  })

  it('brackets nothing on a pack that predates the runs variable', async () => {
    const { store, snapshot } = wireStore()
    await setKlipperReady(true)
    snapshot({ [stateObject]: { pause_at_layer: -1 } })

    expect(store.isSupported).toBe(false)
    expect(store.claim('macro', 'PURGE')).toBeNull()
  })

  it('refuses a name the pack would have to quote', async () => {
    const { store, snapshot } = wireStore()
    await setKlipperReady(true)
    snapshot({ [stateObject]: { runs: {} } })

    expect(store.claim('macro', 'TWO WORDS')).toBeNull()
  })

  describe('a marker left behind', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    function endScripts(rpcCall: ReturnType<typeof vi.fn>): string[] {
      return rpcCall.mock.calls
        .map(([, params]) => (params as { script: string }).script)
        .filter((script) => script.startsWith('_ALABASTER_RUN_END'))
    }

    async function wired() {
      const moonraker = useMoonrakerStore()
      const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
      const wiring = wireStore()
      moonraker.connectionPhase = 'connected'
      await setKlipperReady(true)
      return { ...wiring, rpcCall }
    }

    it('is cleared by any browser once the printer has been quiet a while', async () => {
      const { snapshot, update, rpcCall } = await wired()
      snapshot({
        [stateObject]: { runs: { gone: { kind: 'calibration', name: 'probeAccuracy' } } },
        idle_timeout: { state: 'Printing' },
      })
      await nextTick()
      vi.advanceTimersByTime(sharedRunTimings.staleAfterMs * 2)
      // Still printing: the run may well be going.
      expect(endScripts(rpcCall as never)).toEqual([])

      update({ idle_timeout: { state: 'Ready' } })
      await nextTick()
      vi.advanceTimersByTime(sharedRunTimings.staleAfterMs - 1)
      expect(endScripts(rpcCall as never)).toEqual([])
      vi.advanceTimersByTime(1)
      expect(endScripts(rpcCall as never)).toEqual(['_ALABASTER_RUN_END ID=gone'])

      // Sent once, not on every check.
      vi.advanceTimersByTime(sharedRunTimings.staleAfterMs * 2)
      expect(endScripts(rpcCall as never)).toHaveLength(1)
    })

    it('is left alone while a paper test holds the machine with Klipper idle', async () => {
      const { snapshot, rpcCall } = await wired()
      useManualProbeStore().isActive = true
      snapshot({
        [stateObject]: { runs: { waiting: { kind: 'calibration', name: 'probeZOffset' } } },
        idle_timeout: { state: 'Ready' },
      })
      await nextTick()
      vi.advanceTimersByTime(sharedRunTimings.staleAfterMs * 2)

      expect(endScripts(rpcCall as never)).toEqual([])
    })

    it("is never this browser's own run while it is still going", async () => {
      const { store, snapshot, update, rpcCall } = await wired()
      snapshot({ [stateObject]: { runs: {} }, idle_timeout: { state: 'Ready' } })
      const id = store.claim('calibration', 'probeZOffset')!
      update({ [stateObject]: { runs: { [id]: { kind: 'calibration', name: 'probeZOffset' } } } })
      await nextTick()
      vi.advanceTimersByTime(sharedRunTimings.staleAfterMs * 2)
      expect(endScripts(rpcCall as never)).toEqual([])

      // Its end marker failed to send: once released, it is cleared like any other.
      store.release(id)
      vi.advanceTimersByTime(sharedRunTimings.staleAfterMs)
      expect(endScripts(rpcCall as never)).toEqual([`_ALABASTER_RUN_END ID=${id}`])
    })
  })

  it('forgets every run when Klipper leaves, which empties the variable', async () => {
    const { store, snapshot } = wireStore()
    await setKlipperReady(true)
    snapshot({ [stateObject]: { runs: { a: { kind: 'macro', name: 'PURGE' } } } })

    await setKlipperReady(false)

    expect(store.runs).toEqual([])
    expect(store.isSupported).toBe(false)
  })
})
