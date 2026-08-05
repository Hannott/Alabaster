import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { JsonRpcNotification } from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useDevicePowerStore } from '@/stores/devicePower'
import { useMoonrakerStore } from '@/stores/moonraker'
import { useServerCapabilitiesStore } from '@/stores/serverCapabilities'

function wireStore() {
  const moonraker = useMoonrakerStore()
  const availability = useAvailabilityStore()
  const serverCapabilities = useServerCapabilitiesStore()
  let notifyHandler: ((notification: JsonRpcNotification) => void) | undefined
  const rpcCall = vi.spyOn(moonraker, 'rpcCall')
  vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
    if (method === 'notify_power_changed') notifyHandler = handler
    return () => undefined
  })
  vi.spyOn(moonraker, 'onPrinterChange').mockImplementation(() => () => undefined)
  availability.moonrakerConnected({ klippy_connected: false, klippy_state: 'disconnected' })

  const store = useDevicePowerStore()
  return {
    store,
    serverCapabilities,
    rpcCall,
    notify: (payload: unknown) =>
      notifyHandler?.({ jsonrpc: '2.0', method: 'notify_power_changed', params: [payload] }),
  }
}

describe('device power store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('fetches devices once Moonraker is connected and the component is present', async () => {
    const { store, rpcCall } = wireStore()
    rpcCall.mockResolvedValue({
      devices: [{ device: 'psu', status: 'off', locked_while_printing: true, type: 'gpio' }],
    })

    store.start()
    await Promise.resolve()
    await Promise.resolve()

    expect(rpcCall).toHaveBeenCalledWith('machine.device_power.devices')
    expect(store.devices).toEqual([
      { device: 'psu', status: 'off', locked_while_printing: true, type: 'gpio' },
    ])
    expect(store.hasDevices).toBe(true)
  })

  it('never calls the RPC when the component is absent', () => {
    const { store, serverCapabilities, rpcCall } = wireStore()
    serverCapabilities.components = ['some_other_component']

    store.start()

    expect(rpcCall).not.toHaveBeenCalled()
    expect(store.hasDevices).toBe(false)
  })

  it('applies a live notify_power_changed as an upsert, not a replace', async () => {
    const { store, rpcCall, notify } = wireStore()
    rpcCall.mockResolvedValue({
      devices: [
        { device: 'psu', status: 'off', locked_while_printing: false, type: 'gpio' },
        { device: 'light', status: 'off', locked_while_printing: false, type: 'gpio' },
      ],
    })
    store.start()
    await Promise.resolve()
    await Promise.resolve()

    notify({ device: 'light', status: 'on', locked_while_printing: false, type: 'gpio' })

    expect(store.devices).toHaveLength(2)
    expect(store.devices.find((device) => device.device === 'light')?.status).toBe('on')
    expect(store.devices.find((device) => device.device === 'psu')?.status).toBe('off')
  })

  it('sends an explicit action and applies the result, never leaving a device stuck pending', async () => {
    const { store, rpcCall } = wireStore()
    rpcCall.mockResolvedValueOnce({ devices: [] })
    store.start()
    await Promise.resolve()
    await Promise.resolve()

    rpcCall.mockResolvedValueOnce({ psu: 'on' })
    const succeeded = await store.setDevice('psu', 'on')

    expect(succeeded).toBe(true)
    expect(rpcCall).toHaveBeenCalledWith('machine.device_power.post_device', {
      device: 'psu',
      action: 'on',
    })
    expect(store.pendingDevices.has('psu')).toBe(false)
    expect(store.devices.find((device) => device.device === 'psu')?.status).toBe('on')
  })

  it('reports failure rather than throwing when the command is refused', async () => {
    const { store, rpcCall } = wireStore()
    rpcCall.mockResolvedValueOnce({ devices: [] })
    store.start()
    await Promise.resolve()
    await Promise.resolve()

    rpcCall.mockRejectedValueOnce(new Error('locked while printing'))
    const succeeded = await store.setDevice('psu', 'off')

    expect(succeeded).toBe(false)
    expect(store.pendingDevices.has('psu')).toBe(false)
  })
})
