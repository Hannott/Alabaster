import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { JsonRpcNotification, NotificationHandler } from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { useSensorsStore } from '@/stores/sensors'
import { useServerCapabilitiesStore } from '@/stores/serverCapabilities'

function makeMoonrakerConnected() {
  const availability = useAvailabilityStore()
  availability.moonrakerConnected({ klippy_connected: false, klippy_state: 'disconnected' })
}

function spyNotifications() {
  const moonraker = useMoonrakerStore()
  const handlers = new Map<string, NotificationHandler>()
  vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
    handlers.set(method, handler)
    return () => handlers.delete(method)
  })
  return handlers
}

function fire(handlers: Map<string, NotificationHandler>, method: string, payload: unknown): void {
  const notification: JsonRpcNotification = { jsonrpc: '2.0', method, params: [payload] }
  handlers.get(method)?.(notification)
}

describe('sensors store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useFakeTimers()
    setActivePinia(createPinia())
    makeMoonrakerConnected()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('discovers every configured sensor once Moonraker connects', async () => {
    spyNotifications()
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'server.sensors.list') {
        return Promise.resolve({
          sensors: {
            chamber: {
              id: 'chamber',
              friendly_name: 'Chamber',
              type: 'mqtt',
              values: { value1: 22.5 },
            },
          },
        }) as never
      }
      throw new Error(`unexpected method ${String(method)}`)
    })

    const sensors = useSensorsStore()
    sensors.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(sensors.sensors).toEqual([
      { id: 'chamber', friendlyName: 'Chamber', values: { value1: 22.5 } },
    ])
    expect(rpcCall).toHaveBeenCalledWith('server.sensors.list', {})

    sensors.stop()
  })

  it('never asks Moonraker anything on a printer without the sensor component', async () => {
    spyNotifications()
    const capabilities = useServerCapabilitiesStore()
    capabilities.applyServerInfo({ components: ['history'] })
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall')

    const sensors = useSensorsStore()
    sensors.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(rpcCall).not.toHaveBeenCalled()
    expect(sensors.sensors).toEqual([])

    sensors.stop()
  })

  it('replaces a sensor reading wholesale from notify_sensor_update', async () => {
    const handlers = spyNotifications()
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'server.sensors.list') {
        return Promise.resolve({
          sensors: {
            chamber: {
              id: 'chamber',
              friendly_name: 'Chamber',
              type: 'mqtt',
              values: { value1: 22.5, value2: 40 },
            },
          },
        }) as never
      }
      throw new Error(`unexpected method ${String(method)}`)
    })

    const sensors = useSensorsStore()
    sensors.start()
    await vi.advanceTimersByTimeAsync(0)

    // Moonraker republishes every value the changed sensor currently reports,
    // not only the one that moved — a stale key must not survive the merge.
    fire(handlers, 'notify_sensor_update', { chamber: { value1: 23.1 } })

    expect(sensors.sensors).toEqual([
      { id: 'chamber', friendlyName: 'Chamber', values: { value1: 23.1 } },
    ])

    sensors.stop()
  })

  it('clears every sensor when the connection is retargeted', async () => {
    const realWebSocket = globalThis.WebSocket
    globalThis.WebSocket = class {
      static readonly CONNECTING = 0
      readyState = 0
      close(): void {}
      send(): void {}
    } as unknown as typeof WebSocket
    spyNotifications()
    const moonraker = useMoonrakerStore()
    moonraker.connect('printer-a.local:7125')
    makeMoonrakerConnected()
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'server.sensors.list') {
        return Promise.resolve({
          sensors: {
            chamber: {
              id: 'chamber',
              friendly_name: 'Chamber',
              type: 'mqtt',
              values: { value1: 1 },
            },
          },
        }) as never
      }
      throw new Error(`unexpected method ${String(method)}`)
    })

    const sensors = useSensorsStore()
    sensors.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(sensors.sensors).toHaveLength(1)

    moonraker.connect('a-different-printer.local')
    await vi.advanceTimersByTimeAsync(0)
    globalThis.WebSocket = realWebSocket

    expect(sensors.sensors).toEqual([])

    sensors.stop()
  })
})
