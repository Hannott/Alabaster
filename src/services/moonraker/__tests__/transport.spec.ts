import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  JsonRpcTransport,
  MoonrakerDisconnectedError,
  MoonrakerProtocolError,
  MoonrakerRequestTimeoutError,
  MoonrakerRpcError,
} from '@/services/moonraker'
import {
  createMockSocketFactory,
  flushPromises,
  sentRequest,
} from '@/services/moonraker/__tests__/mockSocket'

describe('JsonRpcTransport', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('correlates a JSON-RPC response with its request', async () => {
    const { factory, sockets } = createMockSocketFactory()
    const transport = new JsonRpcTransport({ socketFactory: factory })
    const connecting = transport.connect('ws://printer.local/websocket')
    const socket = sockets[0]!
    socket.open()
    await connecting

    const response = transport.call<{ klippy_state: string }>('server.info')
    const request = sentRequest(socket, 'server.info')

    expect(JSON.parse(socket.sent[0]!)).toEqual({
      jsonrpc: '2.0',
      method: 'server.info',
      id: 1,
    })

    socket.receive({
      jsonrpc: '2.0',
      id: request.id,
      result: { klippy_state: 'ready' },
    })

    await expect(response).resolves.toEqual({ klippy_state: 'ready' })
  })

  it('returns typed RPC errors to the caller', async () => {
    const { factory, sockets } = createMockSocketFactory()
    const transport = new JsonRpcTransport({ socketFactory: factory })
    const connecting = transport.connect('ws://printer.local/websocket')
    const socket = sockets[0]!
    socket.open()
    await connecting

    const response = transport.call('server.info')
    const request = sentRequest(socket, 'server.info')
    socket.receive({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32602, message: 'Unauthorized', data: { source: 'authorization' } },
    })

    const error = await response.catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(MoonrakerRpcError)
    expect(error).toMatchObject({ code: -32602, message: 'Unauthorized' })
  })

  it('dispatches positional Moonraker notifications by method', async () => {
    const { factory, sockets } = createMockSocketFactory()
    const transport = new JsonRpcTransport({ socketFactory: factory })
    const handler = vi.fn()
    transport.onNotification('notify_status_update', handler)
    const connecting = transport.connect('ws://printer.local/websocket')
    const socket = sockets[0]!
    socket.open()
    await connecting

    socket.receive({
      jsonrpc: '2.0',
      method: 'notify_status_update',
      params: [{ toolhead: { position: [1, 2, 3] } }, 12.5],
    })

    expect(handler).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      method: 'notify_status_update',
      params: [{ toolhead: { position: [1, 2, 3] } }, 12.5],
    })
  })

  it('reports malformed messages without interrupting later valid traffic', async () => {
    const { factory, sockets } = createMockSocketFactory()
    const transport = new JsonRpcTransport({ socketFactory: factory })
    const errors: Error[] = []
    transport.onProtocolError((error) => errors.push(error))
    const connecting = transport.connect('ws://printer.local/websocket')
    const socket = sockets[0]!
    socket.open()
    await connecting

    socket.onmessage?.call(
      socket as unknown as WebSocket,
      new MessageEvent('message', { data: '{invalid' }),
    )
    const response = transport.call<string>('test.echo')
    const request = sentRequest(socket, 'test.echo')
    socket.receive({ jsonrpc: '2.0', id: request.id, result: 'ok' })

    expect(errors[0]).toBeInstanceOf(MoonrakerProtocolError)
    await expect(response).resolves.toBe('ok')
  })

  it('times out requests and removes their correlation entry', async () => {
    vi.useFakeTimers()
    const { factory, sockets } = createMockSocketFactory()
    const transport = new JsonRpcTransport({ socketFactory: factory, requestTimeoutMs: 250 })
    const connecting = transport.connect('ws://printer.local/websocket')
    sockets[0]!.open()
    await connecting

    const response = transport.call('server.info')
    const rejection = expect(response).rejects.toBeInstanceOf(MoonrakerRequestTimeoutError)
    await vi.advanceTimersByTimeAsync(250)

    await rejection
  })

  it('lets a caller lengthen or remove its own deadline', async () => {
    vi.useFakeTimers()
    const { factory, sockets } = createMockSocketFactory()
    const transport = new JsonRpcTransport({ socketFactory: factory, requestTimeoutMs: 250 })
    const connecting = transport.connect('ws://printer.local/websocket')
    const socket = sockets[0]!
    socket.open()
    await connecting

    const lengthened = transport.call('machine.update.refresh', {}, { timeoutMs: 1_000 })
    await vi.advanceTimersByTimeAsync(250)
    socket.receive({
      jsonrpc: '2.0',
      id: sentRequest(socket, 'machine.update.refresh').id,
      result: 'ok',
    })

    // The default deadline has passed, so only the override kept it alive.
    await expect(lengthened).resolves.toBe('ok')

    const unbounded = transport.call('machine.update.upgrade', {}, { timeoutMs: null })
    await vi.advanceTimersByTimeAsync(600_000)
    socket.receive({
      jsonrpc: '2.0',
      id: sentRequest(socket, 'machine.update.upgrade').id,
      result: 'ok',
    })

    await expect(unbounded).resolves.toBe('ok')
  })

  it('still rejects a request without a deadline when the socket closes', async () => {
    const { factory, sockets } = createMockSocketFactory()
    const transport = new JsonRpcTransport({ socketFactory: factory })
    const connecting = transport.connect('ws://printer.local/websocket')
    const socket = sockets[0]!
    socket.open()
    await connecting

    // Opting out of the timer must not make a request unkillable.
    const unbounded = transport.call('machine.update.upgrade', {}, { timeoutMs: null })
    socket.closeFromServer()

    await expect(unbounded).rejects.toBeInstanceOf(MoonrakerDisconnectedError)
  })

  it('rejects every in-flight request when the socket closes', async () => {
    const { factory, sockets } = createMockSocketFactory()
    const transport = new JsonRpcTransport({ socketFactory: factory })
    const connecting = transport.connect('ws://printer.local/websocket')
    const socket = sockets[0]!
    socket.open()
    await connecting

    const first = transport.call('printer.gcode.script', { script: 'G28' })
    const second = transport.call('server.info')
    socket.closeFromServer()
    await flushPromises()

    await expect(first).rejects.toBeInstanceOf(MoonrakerDisconnectedError)
    await expect(second).rejects.toBeInstanceOf(MoonrakerDisconnectedError)
  })
})
