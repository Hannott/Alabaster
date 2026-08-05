import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { resolveWebcamUrl, useWebcamsStore } from '@/stores/webcams'

describe('webcam URL resolution', () => {
  it('resolves relative camera streams against the Moonraker host', () => {
    expect(resolveWebcamUrl('/webcam/?action=stream', 'ws://printer.local:7125/websocket')).toBe(
      'http://printer.local:7125/webcam/?action=stream',
    )
    expect(resolveWebcamUrl('/camera', 'wss://printer.example/websocket')).toBe(
      'https://printer.example/camera',
    )
  })

  it('preserves absolute stream URLs', () => {
    expect(resolveWebcamUrl('http://camera.local/stream', 'ws://printer.local/websocket')).toBe(
      'http://camera.local/stream',
    )
  })
})

describe('webcams store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setActivePinia(createPinia())
    useAvailabilityStore().moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
  })

  it('reloads when Moonraker says the webcam list changed', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({ webcams: [] } as never)
    const handlers: Array<() => void> = []
    vi.spyOn(moonraker, 'onNotification').mockImplementation(((
      name: string,
      handler: () => void,
    ) => {
      if (name === 'notify_webcams_changed') handlers.push(handler)
      return () => undefined
    }) as never)
    const webcams = useWebcamsStore()

    webcams.start()
    const callsAfterStart = rpcCall.mock.calls.length
    expect(handlers).toHaveLength(1)

    handlers[0]!()
    await Promise.resolve()

    expect(rpcCall.mock.calls.length).toBeGreaterThan(callsAfterStart)
    webcams.stop()
  })
})
