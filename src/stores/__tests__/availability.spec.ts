import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useAvailabilityStore } from '@/stores/availability'

describe('availability store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('keeps Moonraker-only capabilities available while Klipper restarts', () => {
    const store = useAvailabilityStore()
    store.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    store.printerSnapshotSynchronized()

    store.handleKlipperNotification('notify_klippy_disconnected')

    expect(store.availabilityFor('moonraker')).toEqual({
      phase: 'available',
      reason: 'none',
      isAvailable: true,
      isStale: false,
    })
    expect(store.availabilityFor('klipper')).toEqual({
      phase: 'recovering',
      reason: 'klipperDisconnected',
      isAvailable: false,
      isStale: true,
    })
  })

  it('marks existing data stale during a Moonraker reconnect without resetting the app', () => {
    const store = useAvailabilityStore()
    store.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    store.printerSnapshotSynchronized()

    store.moonrakerConnectionLost()

    expect(store.transportState).toBe('reconnecting')
    expect(store.availabilityFor('klipper')).toMatchObject({
      phase: 'recovering',
      reason: 'moonrakerReconnecting',
      isStale: true,
    })
    expect(store.availabilityFor('local').isAvailable).toBe(true)
  })

  it('moves from startup to ready in response to the Klipper lifecycle', () => {
    const store = useAvailabilityStore()
    store.moonrakerConnected({ klippy_connected: true, klippy_state: 'startup' })

    expect(store.availabilityFor('klipper')).toMatchObject({
      phase: 'recovering',
      reason: 'klipperStarting',
    })

    store.handleKlipperNotification('notify_klippy_ready')

    expect(store.availabilityFor('klipper')).toMatchObject({
      phase: 'recovering',
      reason: 'printerSynchronizing',
    })

    store.printerSnapshotSynchronized()

    expect(store.availabilityFor('klipper').isAvailable).toBe(true)
  })

  it('drops back to startup when Klipper restarts out from under a ready connection', () => {
    const store = useAvailabilityStore()
    store.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    store.printerSnapshotSynchronized()

    store.handleKlipperNotification('notify_klippy_started')

    expect(store.availabilityFor('klipper')).toMatchObject({
      phase: 'recovering',
      reason: 'klipperStarting',
      isAvailable: false,
      isStale: true,
    })
  })

  it('distinguishes terminal Klipper failures from automatic recovery', () => {
    const store = useAvailabilityStore()
    store.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    store.printerSnapshotSynchronized()

    store.handleKlipperNotification('notify_klippy_shutdown')

    expect(store.availabilityFor('klipper')).toMatchObject({
      phase: 'error',
      reason: 'klipperShutdown',
      isAvailable: false,
      isStale: true,
    })
  })

  it('keeps a fault message reported before the state that explains it', () => {
    const store = useAvailabilityStore()
    store.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    store.printerSnapshotSynchronized()

    // The order Klipper actually produces on a shutdown: the webhooks push
    // carries the reason, and Moonraker's own notification follows it.
    store.reportKlipperMessage("MCU 'mcu' shutdown: ADC out of range")
    store.handleKlipperNotification('notify_klippy_shutdown')

    expect(store.klipperMessage).toBe("MCU 'mcu' shutdown: ADC out of range")
  })

  it('forgets a fault message once the printer is running or gone', () => {
    const store = useAvailabilityStore()
    store.moonrakerConnected({ klippy_connected: true, klippy_state: 'error' })
    store.reportKlipperMessage('Option not valid in section')

    store.handleKlipperNotification('notify_klippy_ready')
    expect(store.klipperMessage).toBe('')

    store.reportKlipperMessage('Lost communication with MCU')
    store.printerChanged()
    expect(store.klipperMessage).toBe('')
  })

  it('does not invalidate synchronized data for a duplicate ready notification', () => {
    const store = useAvailabilityStore()
    store.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    store.printerSnapshotSynchronized()

    store.handleKlipperNotification('notify_klippy_ready')

    expect(store.subscriptionState).toBe('ready')
    expect(store.availabilityFor('klipper').isAvailable).toBe(true)
  })

  it('distinguishes an intentional disconnect from background recovery', () => {
    const store = useAvailabilityStore()
    store.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    store.printerSnapshotSynchronized()

    store.moonrakerDisconnected()

    expect(store.availabilityFor('moonraker')).toEqual({
      phase: 'unavailable',
      reason: 'moonrakerDisconnected',
      isAvailable: false,
      isStale: true,
    })
  })
})
