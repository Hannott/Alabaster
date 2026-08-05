import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import type { JsonRpcNotification, ObjectSnapshotHandler } from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { useRunoutSensorsStore } from '@/stores/runoutSensors'

function wireStore(objects: readonly string[]) {
  const moonraker = useMoonrakerStore()
  let snapshotHandler: ObjectSnapshotHandler | undefined
  let statusHandler: ((notification: JsonRpcNotification) => void) | undefined
  let printerChangeHandler: (() => void) | undefined
  const setObjectSubscription = vi
    .spyOn(moonraker, 'setObjectSubscription')
    .mockResolvedValue(undefined)
  vi.spyOn(moonraker, 'removeObjectSubscription').mockResolvedValue(undefined)
  vi.spyOn(moonraker, 'rpcCall').mockImplementation(((method: string) => {
    if (method === 'printer.objects.list') return Promise.resolve({ objects })
    return Promise.resolve(undefined)
  }) as never)
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

  const store = useRunoutSensorsStore()
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

describe('runout sensors store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('reports no sensors on a printer with none configured', async () => {
    const { store } = wireStore(['toolhead', 'heater_bed'])

    await setKlipperReady(true)
    await Promise.resolve()

    expect(store.hasSensors).toBe(false)
  })

  it('discovers configured switch and motion sensors from the live object list', async () => {
    const { store, setObjectSubscription } = wireStore([
      'toolhead',
      'filament_switch_sensor runout',
      'filament_motion_sensor jam',
    ])

    await setKlipperReady(true)
    await Promise.resolve()

    expect(setObjectSubscription).toHaveBeenCalledWith('alabaster.runoutSensors', {
      'filament_switch_sensor runout': ['enabled', 'filament_detected'],
      'filament_motion_sensor jam': ['enabled', 'filament_detected'],
    })
    expect(store.readings).toEqual([
      {
        objectName: 'filament_motion_sensor jam',
        name: 'jam',
        kind: 'motion',
        enabled: false,
        filamentDetected: false,
      },
      {
        objectName: 'filament_switch_sensor runout',
        name: 'runout',
        kind: 'switch',
        enabled: false,
        filamentDetected: false,
      },
    ])
  })

  it('reads armed state and filament presence from status pushes', async () => {
    const { store, snapshot, update } = wireStore(['filament_switch_sensor runout'])

    await setKlipperReady(true)
    await Promise.resolve()

    snapshot({ 'filament_switch_sensor runout': { enabled: true, filament_detected: true } })
    expect(store.readings[0]).toMatchObject({ enabled: true, filamentDetected: true })

    update([{ 'filament_switch_sensor runout': { filament_detected: false } }])
    // An omitted field keeps its last reported value: Moonraker sends deltas.
    expect(store.readings[0]).toMatchObject({ enabled: true, filamentDetected: false })
  })

  it('drops sensors on printer change and rediscovers for the next one', async () => {
    const { store, changePrinter } = wireStore(['filament_switch_sensor runout'])

    await setKlipperReady(true)
    await Promise.resolve()
    expect(store.hasSensors).toBe(true)

    changePrinter()
    expect(store.hasSensors).toBe(false)
  })
})
