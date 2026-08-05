import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  MockWebSocket,
  flushPromises,
  sentRequest,
} from '@/services/moonraker/__tests__/mockSocket'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'

/**
 * The store builds its client internally with no seam for a socket factory, so
 * the global constructor is the seam — the same approach `moonraker.spec.ts`
 * takes, over the established mock socket rather than a second fixture, because
 * this needs a connection that completes rather than one that fails.
 */
class TrackedSocket extends MockWebSocket {
  /*
   * The mock reads `WebSocket.CONNECTING`/`OPEN` off the global constructor,
   * which for the duration of this file is this class — so the ready-state
   * constants have to come with it. Without them every comparison is
   * `undefined === undefined` and the transport treats an open socket as one
   * that never opened.
   */
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: TrackedSocket[] = []

  constructor(url: string) {
    super(url)
    TrackedSocket.instances.push(this)
  }
}

let realWebSocket: typeof WebSocket

beforeEach(() => {
  window.localStorage.clear()
  setActivePinia(createPinia())
  TrackedSocket.instances = []
  realWebSocket = globalThis.WebSocket
  globalThis.WebSocket = TrackedSocket as unknown as typeof WebSocket
})

afterEach(() => {
  globalThis.WebSocket = realWebSocket
})

/**
 * More turns than the shared `flushPromises`, which is two: the store's client
 * refreshes its identity before it identifies, and each awaited step costs its
 * own microtask before the next frame reaches the socket.
 */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await flushPromises()
}

/** Connects and answers the handshake, leaving Klipper ready and subscribed. */
async function connect(): Promise<TrackedSocket> {
  useMoonrakerStore().connect('voron.local:7125')
  const socket = TrackedSocket.instances.at(-1)
  if (!socket) throw new Error('no socket was opened')

  socket.open()
  await settle()
  const identify = sentRequest(socket, 'server.connection.identify')
  socket.receive({ jsonrpc: '2.0', id: identify.id, result: { connection_id: 1 } })
  await settle()
  const info = sentRequest(socket, 'server.info')
  socket.receive({
    jsonrpc: '2.0',
    id: info.id,
    result: { klippy_connected: true, klippy_state: 'ready' },
  })
  await settle()

  return socket
}

describe('what Klipper says about itself', () => {
  it('keeps the reason for a shutdown current from the subscription that reports it', async () => {
    const socket = await connect()
    const availability = useAvailabilityStore()

    socket.receive({
      jsonrpc: '2.0',
      method: 'notify_status_update',
      params: [
        {
          webhooks: {
            state: 'shutdown',
            state_message: "MCU 'mcu' shutdown: Timer too close",
          },
        },
        12,
      ],
    })
    await settle()

    expect(availability.klipperMessage).toBe("MCU 'mcu' shutdown: Timer too close")
  })

  it('ignores a status update that says nothing about Klipper itself', async () => {
    const socket = await connect()
    const availability = useAvailabilityStore()
    availability.reportKlipperMessage('Printer is ready')

    socket.receive({
      jsonrpc: '2.0',
      method: 'notify_status_update',
      params: [{ extruder: { temperature: 210.4 } }, 13],
    })
    await settle()

    expect(availability.klipperMessage).toBe('Printer is ready')
  })
})
