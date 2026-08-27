import { afterEach, describe, expect, it, vi } from 'vitest'

import { MoonrakerClient, MoonrakerDisconnectedError } from '@/services/moonraker'
import type { MoonrakerIdentityRefresher } from '@/services/moonraker/client'
import {
  createMockSocketFactory,
  flushPromises,
  sentRequest,
  type MockWebSocket,
} from '@/services/moonraker/__tests__/mockSocket'

function createClient(
  factory: (url: string) => ReturnType<MockWebSocket['asWebSocketLike']>,
  refreshIdentity?: MoonrakerIdentityRefresher,
) {
  return new MoonrakerClient({
    endpoint: 'ws://printer.local/websocket',
    identity: {
      clientName: 'Alabaster',
      version: '0.1.0',
      type: 'web',
      url: 'https://example.test/alabaster',
    },
    ...(refreshIdentity ? { refreshIdentity } : {}),
    socketFactory: factory,
    random: () => 0.5,
    initialReconnectDelayMs: 500,
    lifecyclePollMs: 2_000,
  })
}

async function completeHandshake(
  socket: MockWebSocket,
  klippyState: 'disconnected' | 'startup' | 'ready' | 'error' | 'shutdown' = 'ready',
): Promise<void> {
  socket.open()
  await flushPromises()

  const identify = sentRequest(socket, 'server.connection.identify')
  socket.receive({ jsonrpc: '2.0', id: identify.id, result: { connection_id: 42 } })
  await flushPromises()

  const serverInfo = sentRequest(socket, 'server.info')
  socket.receive({
    jsonrpc: '2.0',
    id: serverInfo.id,
    result: {
      klippy_connected: klippyState !== 'disconnected',
      klippy_state: klippyState,
    },
  })
  await flushPromises()
}

describe('MoonrakerClient', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('identifies the browser before reporting server availability', async () => {
    const { factory, sockets } = createMockSocketFactory()
    const client = createClient(factory)
    const states: string[] = []
    const serverInfo = vi.fn()
    client.onConnectionStatus((status) => states.push(status.phase))
    client.onServerInfo(serverInfo)

    client.start()
    const socket = sockets[0]!
    await completeHandshake(socket)

    expect(sentRequest(socket, 'server.connection.identify').params).toEqual({
      client_name: 'Alabaster',
      version: '0.1.0',
      type: 'web',
      url: 'https://example.test/alabaster',
    })
    expect(states).toEqual(['idle', 'connecting', 'identifying', 'connected'])
    expect(serverInfo).toHaveBeenCalledWith({ klippy_connected: true, klippy_state: 'ready' })
  })

  it('treats a different endpoint as a first connection, not a reconnect', async () => {
    const { factory, sockets } = createMockSocketFactory()
    const client = createClient(factory)
    const states: string[] = []

    client.start()
    await completeHandshake(sockets[0]!)
    client.onConnectionStatus((status) => states.push(status.phase))

    client.setEndpoint('ws://other-printer.local/websocket')

    // `stopped` for the printer we left, then `connecting` — not `reconnecting`,
    // which would present a machine that has never answered as one that dropped.
    expect(states).toEqual(['connected', 'stopped', 'connecting'])
    expect(sockets[1]?.url).toBe('ws://other-printer.local/websocket')
  })

  it("merges independent object subscriptions into Moonraker's single selection", async () => {
    const { factory, sockets } = createMockSocketFactory()
    const client = createClient(factory)
    await client.setObjectSubscription('motion', { toolhead: ['position', 'status'] })
    await client.setObjectSubscription('overview', {
      toolhead: ['homed_axes'],
      extruder: null,
    })

    client.start()
    const socket = sockets[0]!
    await completeHandshake(socket)

    expect(sentRequest(socket, 'printer.objects.subscribe').params).toEqual({
      objects: {
        toolhead: ['position', 'status', 'homed_axes'],
        extruder: null,
      },
    })
  })

  it('resubscribes after reconnect but never replays an interrupted command', async () => {
    vi.useFakeTimers()
    const { factory, sockets } = createMockSocketFactory()
    const client = createClient(factory)
    await client.setObjectSubscription('overview', { webhooks: ['state'] })
    client.start()

    const firstSocket = sockets[0]!
    await completeHandshake(firstSocket)
    const firstSubscription = sentRequest(firstSocket, 'printer.objects.subscribe')
    firstSocket.receive({
      jsonrpc: '2.0',
      id: firstSubscription.id,
      result: { eventtime: 1, status: { webhooks: { state: 'ready' } } },
    })
    await flushPromises()

    const command = client.callRaw('printer.gcode.script', { script: 'G28' })
    firstSocket.closeFromServer()
    const rejection = expect(command).rejects.toBeInstanceOf(MoonrakerDisconnectedError)
    await flushPromises()
    await rejection

    await vi.advanceTimersByTimeAsync(500)
    const secondSocket = sockets[1]!
    await completeHandshake(secondSocket)

    expect(sentRequest(secondSocket, 'printer.objects.subscribe').params).toEqual({
      objects: { webhooks: ['state'] },
    })
    expect(
      secondSocket.sent.some(
        (message) => (JSON.parse(message) as { method: string }).method === 'printer.gcode.script',
      ),
    ).toBe(false)
  })

  it('polls server.info while Klipper is unavailable and resubscribes when it becomes ready', async () => {
    vi.useFakeTimers()
    const { factory, sockets } = createMockSocketFactory()
    const client = createClient(factory)
    const snapshot = vi.fn()
    client.onObjectSnapshot(snapshot)
    await client.setObjectSubscription('overview', { webhooks: ['state'] })
    client.start()

    const socket = sockets[0]!
    await completeHandshake(socket, 'startup')
    expect(
      socket.sent.filter((message) => JSON.parse(message).method === 'server.info'),
    ).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(2_000)
    const poll = sentRequest(socket, 'server.info')
    socket.receive({
      jsonrpc: '2.0',
      id: poll.id,
      result: { klippy_connected: true, klippy_state: 'ready' },
    })
    await flushPromises()

    const subscription = sentRequest(socket, 'printer.objects.subscribe')
    socket.receive({
      jsonrpc: '2.0',
      id: subscription.id,
      result: { eventtime: 3, status: { webhooks: { state: 'ready' } } },
    })
    await flushPromises()

    expect(snapshot).toHaveBeenCalledWith({
      eventtime: 3,
      status: { webhooks: { state: 'ready' } },
    })
  })

  it('asks Klipper why it is not ready and reports the reason', async () => {
    const { factory, sockets } = createMockSocketFactory()
    const client = createClient(factory)
    const message = vi.fn()
    client.onKlipperMessage(message)
    client.start()

    const socket = sockets[0]!
    await completeHandshake(socket, 'error')

    const info = sentRequest(socket, 'printer.info')
    socket.receive({
      jsonrpc: '2.0',
      id: info.id,
      result: {
        state: 'error',
        state_message: "Option 'rotation_distance' in section 'stepper_x' must be specified",
      },
    })
    await flushPromises()

    expect(message).toHaveBeenCalledWith(
      "Option 'rotation_distance' in section 'stepper_x' must be specified",
    )
  })

  it('does not ask a host that is gone, and asks again as soon as it shuts down', async () => {
    const { factory, sockets } = createMockSocketFactory()
    const client = createClient(factory)
    client.start()

    const socket = sockets[0]!
    await completeHandshake(socket, 'disconnected')
    expect(socket.sent.some((message) => JSON.parse(message).method === 'printer.info')).toBe(false)

    socket.receive({ jsonrpc: '2.0', method: 'notify_klippy_shutdown' })
    await flushPromises()

    expect(sentRequest(socket, 'printer.info').method).toBe('printer.info')
  })

  it('drops a reason that arrives after Klipper became ready', async () => {
    vi.useFakeTimers()
    const { factory, sockets } = createMockSocketFactory()
    const client = createClient(factory)
    const message = vi.fn()
    client.onKlipperMessage(message)
    client.start()

    const socket = sockets[0]!
    await completeHandshake(socket, 'startup')
    const info = sentRequest(socket, 'printer.info')

    socket.receive({ jsonrpc: '2.0', method: 'notify_klippy_ready' })
    await flushPromises()
    socket.receive({
      jsonrpc: '2.0',
      id: info.id,
      result: { state: 'startup', state_message: 'Printer is not ready' },
    })
    await flushPromises()

    expect(message).not.toHaveBeenCalled()
  })

  it('re-polls and resubscribes after a klippy_started notification restarts the connection', async () => {
    vi.useFakeTimers()
    const { factory, sockets } = createMockSocketFactory()
    const client = createClient(factory)
    const snapshot = vi.fn()
    client.onObjectSnapshot(snapshot)
    await client.setObjectSubscription('overview', { webhooks: ['state'] })
    client.start()

    const socket = sockets[0]!
    await completeHandshake(socket)
    const firstSubscription = sentRequest(socket, 'printer.objects.subscribe')
    socket.receive({
      jsonrpc: '2.0',
      id: firstSubscription.id,
      result: { eventtime: 1, status: { webhooks: { state: 'ready' } } },
    })
    await flushPromises()

    socket.receive({ jsonrpc: '2.0', method: 'notify_klippy_started' })
    await vi.advanceTimersByTimeAsync(2_000)

    const poll = sentRequest(socket, 'server.info')
    socket.receive({
      jsonrpc: '2.0',
      id: poll.id,
      result: { klippy_connected: true, klippy_state: 'ready' },
    })
    await flushPromises()

    const resubscription = sentRequest(socket, 'printer.objects.subscribe')
    expect(resubscription.id).not.toBe(firstSubscription.id)
    socket.receive({
      jsonrpc: '2.0',
      id: resubscription.id,
      result: { eventtime: 4, status: { webhooks: { state: 'ready' } } },
    })
    await flushPromises()

    expect(snapshot).toHaveBeenLastCalledWith({
      eventtime: 4,
      status: { webhooks: { state: 'ready' } },
    })
  })

  it('discards an obsolete snapshot and sends the newest subscription after a lifecycle race', async () => {
    const { factory, sockets } = createMockSocketFactory()
    const client = createClient(factory)
    const snapshot = vi.fn()
    client.onObjectSnapshot(snapshot)
    await client.setObjectSubscription('overview', { webhooks: ['state'] })
    client.start()

    const socket = sockets[0]!
    await completeHandshake(socket)
    const firstSubscription = sentRequest(socket, 'printer.objects.subscribe')

    socket.receive({ jsonrpc: '2.0', method: 'notify_klippy_shutdown' })
    const latestSubscription = client.setObjectSubscription('temperatures', {
      extruder: ['temperature'],
    })
    socket.receive({ jsonrpc: '2.0', method: 'notify_klippy_ready' })
    socket.receive({
      jsonrpc: '2.0',
      id: firstSubscription.id,
      result: { eventtime: 4, status: { webhooks: { state: 'ready' } } },
    })
    await flushPromises()

    expect(snapshot).not.toHaveBeenCalled()
    const requests = socket.sent
      .map((message) => JSON.parse(message) as { id: number; method: string; params?: unknown })
      .filter((request) => request.method === 'printer.objects.subscribe')
    expect(requests).toHaveLength(2)
    expect(requests[1]?.params).toEqual({
      objects: { webhooks: ['state'], extruder: ['temperature'] },
    })

    socket.receive({
      jsonrpc: '2.0',
      id: requests[1]!.id,
      result: {
        eventtime: 5,
        status: { webhooks: { state: 'ready' }, extruder: { temperature: 210 } },
      },
    })
    await latestSubscription

    expect(snapshot).toHaveBeenCalledOnce()
    expect(snapshot).toHaveBeenCalledWith({
      eventtime: 5,
      status: { webhooks: { state: 'ready' }, extruder: { temperature: 210 } },
    })
  })

  describe('resumeNow', () => {
    /*
     * The backoff timer that was ticking when a tab froze goes on ticking
     * after the reader comes back, so a page in front of somebody can spend
     * the full ten-second delay waiting on a retry scheduled for nobody.
     *
     * `reconnecting` rather than `connecting` is the part that matters
     * visually: it is what keeps every module in the dimmed `recovering`
     * treatment with its last-known data mounted. A resume routed through
     * `stop()`/`start()` would clear `hasConnected` and drop them to
     * `unavailable` instead — deepening exactly the state this shortens.
     */
    it('brings a waiting reconnect forward without restarting the connection', async () => {
      vi.useFakeTimers()
      const { factory, sockets } = createMockSocketFactory()
      const client = createClient(factory)
      client.start()
      await completeHandshake(sockets[0]!)

      const states: string[] = []
      client.onConnectionStatus((status) => states.push(status.phase))
      sockets[0]!.closeFromServer()
      await flushPromises()
      expect(sockets).toHaveLength(1)

      client.resumeNow()
      await flushPromises()

      // The retry happened on the resume, not at the end of its timer.
      expect(sockets).toHaveLength(2)
      expect(states).toEqual(['connected', 'reconnecting', 'reconnecting'])

      // And the delay that was pending is gone rather than still armed, so it
      // cannot open a second socket behind the one now being established.
      await vi.advanceTimersByTimeAsync(10_000)
      expect(sockets).toHaveLength(2)
    })

    it('leaves an open connection alone', async () => {
      const { factory, sockets } = createMockSocketFactory()
      const client = createClient(factory)
      client.start()
      await completeHandshake(sockets[0]!)

      client.resumeNow({ abandonAttempt: true })
      await flushPromises()

      expect(sockets).toHaveLength(1)
    })

    /*
     * A tab merely becoming visible says nothing about an attempt in
     * progress, and a reader flipping between tabs would otherwise restart a
     * slow first handshake on every flip. A back/forward-cache restore is the
     * one case where the browser itself killed the handshake, so the attempt
     * that still looks live is dead and may be abandoned.
     */
    it('finishes an attempt in progress unless the page was restored', async () => {
      const { factory, sockets } = createMockSocketFactory()
      const client = createClient(factory)
      client.start()
      expect(sockets).toHaveLength(1)

      client.resumeNow()
      await flushPromises()
      expect(sockets).toHaveLength(1)

      client.resumeNow({ abandonAttempt: true })
      await flushPromises()
      expect(sockets).toHaveLength(2)

      // The abandoned socket must not be able to report anything afterwards.
      sockets[0]!.closeFromServer()
      await flushPromises()
      expect(sockets).toHaveLength(2)
    })

    it('does nothing for a client that was deliberately stopped', async () => {
      const { factory, sockets } = createMockSocketFactory()
      const client = createClient(factory)
      client.start()
      await completeHandshake(sockets[0]!)
      client.stop()

      client.resumeNow({ abandonAttempt: true })
      await flushPromises()

      expect(sockets).toHaveLength(1)
    })
  })

  describe('refreshIdentity', () => {
    it('awaits the hook and carries its access token into identify', async () => {
      const refreshIdentity = vi.fn(async (call: Parameters<MoonrakerIdentityRefresher>[0]) => {
        const result = await call<{ token: string }>('access.refresh_jwt', {
          refresh_token: 'stored-refresh-token',
        })
        return { accessToken: result.token }
      })
      const { factory, sockets } = createMockSocketFactory()
      const client = createClient(factory, refreshIdentity)

      client.start()
      const socket = sockets[0]!
      socket.open()
      await flushPromises()

      const refresh = sentRequest(socket, 'access.refresh_jwt')
      expect(refresh.params).toEqual({ refresh_token: 'stored-refresh-token' })
      // Identify must not be sent yet — the hook is still in flight.
      expect(socket.sent.some((message) => JSON.parse(message).method === 'identify')).toBe(false)

      socket.receive({ jsonrpc: '2.0', id: refresh.id, result: { token: 'fresh-access-token' } })
      await flushPromises()

      expect(sentRequest(socket, 'server.connection.identify').params).toMatchObject({
        access_token: 'fresh-access-token',
      })
    })

    it('identifies without a token when the hook resolves nothing', async () => {
      const refreshIdentity = vi.fn(async () => ({}))
      const { factory, sockets } = createMockSocketFactory()
      const client = createClient(factory, refreshIdentity)

      client.start()
      const socket = sockets[0]!
      socket.open()
      // One extra tick versus a hook-less connect: awaiting the (trivially
      // resolving) hook itself costs a microtask turn before identify is sent.
      await flushPromises()
      await flushPromises()

      expect(sentRequest(socket, 'server.connection.identify').params).not.toHaveProperty(
        'access_token',
      )
    })

    it('treats a rejecting hook like any other identify failure and reconnects', async () => {
      vi.useFakeTimers()
      const refreshIdentity = vi.fn(async () => {
        throw new Error('refresh exploded')
      })
      const { factory, sockets } = createMockSocketFactory()
      const client = createClient(factory, refreshIdentity)
      const states: string[] = []
      client.onConnectionStatus((status) => states.push(status.phase))

      client.start()
      const socket = sockets[0]!
      socket.open()
      await flushPromises()
      await flushPromises()

      expect(states).toContain('reconnecting')
      expect(sockets).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(500)
      expect(sockets).toHaveLength(2)

      sockets[1]!.open()
      await flushPromises()
      await flushPromises()
      expect(refreshIdentity).toHaveBeenCalledTimes(2)
    })
  })
})
