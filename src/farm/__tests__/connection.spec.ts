import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FarmConnection } from '@/farm/connection'
import type { FarmPrinterSnapshot } from '@/farm/types'
import {
  createMockSocketFactory,
  type MockWebSocket,
} from '@/services/moonraker/__tests__/mockSocket'

/**
 * A farm connection against a mock socket. Everything here is a behaviour the
 * rail depends on and that no other spec covers: it is the only client in the
 * product that is not the one the application drives.
 */

interface Harness {
  connection: FarmConnection
  sockets: MockWebSocket[]
  snapshots: FarmPrinterSnapshot[]
  names: string[]
  latest: () => FarmPrinterSnapshot
  socket: () => MockWebSocket
  reply: (method: string, result: unknown) => void
}

function requestsFor(
  socket: MockWebSocket,
  method: string,
): Array<{ id: number; params?: Record<string, unknown> }> {
  return socket.sent
    .map(
      (message) =>
        JSON.parse(message) as { id: number; method: string; params?: Record<string, unknown> },
    )
    .filter((request) => request.method === method)
    .map((request) => ({ id: request.id, ...(request.params ? { params: request.params } : {}) }))
}

function createHarness(options: { probeReachable?: () => Promise<boolean> } = {}): Harness {
  const { sockets, factory } = createMockSocketFactory()
  const snapshots: FarmPrinterSnapshot[] = []
  const names: string[] = []

  const connection = new FarmConnection({
    id: 'printer-2',
    endpoint: 'ws://voron.local:7125/websocket',
    version: '0.0.0-test',
    origin: 'http://alabaster.local',
    onChange: (snapshot) => snapshots.push(snapshot),
    onName: (name) => names.push(name),
    socketFactory: factory,
    now: () => 1_700_000_000_000,
    ...(options.probeReachable ? { probeReachable: options.probeReachable } : {}),
  })

  const socket = () => {
    const current = sockets[sockets.length - 1]
    if (!current) throw new Error('no socket was opened')
    return current
  }

  return {
    connection,
    sockets,
    snapshots,
    names,
    latest: () => snapshots[snapshots.length - 1] ?? connection.currentSnapshot,
    socket,
    reply: (method, result) => {
      const request = requestsFor(socket(), method).at(-1)
      if (!request) throw new Error(`no ${method} request was sent`)
      socket().receive({ jsonrpc: '2.0', id: request.id, result })
    },
  }
}

/** Opens the socket and answers identify + the lifecycle poll, as a real printer would. */
async function connect(harness: Harness): Promise<void> {
  harness.connection.start()
  harness.socket().open()
  await vi.waitFor(() =>
    expect(requestsFor(harness.socket(), 'server.connection.identify')).not.toHaveLength(0),
  )
  harness.reply('server.connection.identify', { connection_id: 1 })
  await vi.waitFor(() => expect(requestsFor(harness.socket(), 'server.info')).not.toHaveLength(0))
  harness.reply('server.info', {
    klippy_connected: true,
    klippy_state: 'ready',
    components: ['job_queue', 'webcam'],
  })
}

describe('a farm connection', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /*
   * A column the user has not named shows what the printer calls itself rather
   * than its address, so the name has to be asked for. `printer.info` rather
   * than `machine.system_info`: Moonraker answers it from its own host
   * information, so a printer whose Klipper is down — the column most in need
   * of being told apart from its neighbours — still has a name.
   */
  it('asks the printer what it calls itself', async () => {
    const harness = createHarness()
    await connect(harness)

    await vi.waitFor(() =>
      expect(requestsFor(harness.socket(), 'printer.info')).not.toHaveLength(0),
    )
    harness.reply('printer.info', { state: 'ready', state_message: '', hostname: 'voron24' })

    await vi.waitFor(() => expect(harness.names).toEqual(['voron24']))
  })

  it('reports no name at all rather than an empty one', async () => {
    const harness = createHarness()
    await connect(harness)

    await vi.waitFor(() =>
      expect(requestsFor(harness.socket(), 'printer.info')).not.toHaveLength(0),
    )
    harness.reply('printer.info', { state: 'ready', state_message: '', hostname: '' })

    await vi.waitFor(() => expect(harness.snapshots.length).toBeGreaterThan(0))
    expect(harness.names).toEqual([])
  })

  it('subscribes to the field-scoped selection and nothing else', async () => {
    const harness = createHarness()
    await connect(harness)

    await vi.waitFor(() =>
      expect(requestsFor(harness.socket(), 'printer.objects.subscribe')).not.toHaveLength(0),
    )
    const [request] = requestsFor(harness.socket(), 'printer.objects.subscribe')
    const objects = request?.params?.objects as Record<string, unknown>
    expect(Object.keys(objects).sort()).toEqual([
      'display_status',
      'extruder',
      'heater_bed',
      'print_stats',
      'toolhead',
      'virtual_sdcard',
      'webhooks',
    ])
    // The measured reason: whole objects cost four times the deltas.
    for (const fields of Object.values(objects)) expect(Array.isArray(fields)).toBe(true)
    harness.connection.dispose()
  })

  it('asks a connected printer for its cameras and its queue exactly once', async () => {
    const harness = createHarness()
    await connect(harness)

    await vi.waitFor(() => {
      expect(requestsFor(harness.socket(), 'server.webcams.list')).toHaveLength(1)
      expect(requestsFor(harness.socket(), 'server.job_queue.status')).toHaveLength(1)
    })
    harness.connection.dispose()
  })

  /*
   * The trap this covers: `webcams.ts` resolves stream URLs against whichever
   * printer is *connected to the application*. A farm column reusing that would
   * show one machine's camera under every other machine's name, with nothing
   * looking broken.
   */
  it('resolves a relative stream path against its own printer, not the active one', async () => {
    const harness = createHarness()
    await connect(harness)
    await vi.waitFor(() =>
      expect(requestsFor(harness.socket(), 'server.webcams.list')).toHaveLength(1),
    )

    harness.reply('server.webcams.list', {
      webcams: [
        {
          name: 'Chamber',
          uid: 'cam-1',
          enabled: true,
          service: 'mjpegstreamer',
          stream_url: '/webcam/?action=stream',
          snapshot_url: '/webcam/?action=snapshot',
        },
      ],
    })

    await vi.waitFor(() => expect(harness.latest().cameras).toHaveLength(1))
    expect(harness.latest().cameras[0]?.streamUrl).toBe(
      'http://voron.local:7125/webcam/?action=stream',
    )
    harness.connection.dispose()
  })

  /*
   * A camera switched off in Moonraker still belongs in the snapshot: the
   * column decides what to render, and it gets the same list from this
   * connection as from the live webcams store — which keeps disabled cameras so
   * the settings editor can list them. Filtering in one producer and not the
   * other rendered a disabled camera as a dead black tile on one column and as
   * "no camera" on the next.
   */
  it('reports a disabled camera rather than dropping it', async () => {
    const harness = createHarness()
    await connect(harness)
    await vi.waitFor(() =>
      expect(requestsFor(harness.socket(), 'server.webcams.list')).toHaveLength(1),
    )

    harness.reply('server.webcams.list', {
      webcams: [
        {
          name: 'Switched off',
          uid: 'cam-2',
          enabled: false,
          service: 'mjpegstreamer',
          stream_url: '/webcam/?action=stream',
        },
      ],
    })

    await vi.waitFor(() => expect(harness.latest().cameras).toHaveLength(1))
    expect(harness.latest().cameras[0]?.enabled).toBe(false)
    harness.connection.dispose()
  })

  it('does not ask a printer without the power component for its devices', async () => {
    const harness = createHarness()
    await connect(harness)
    await vi.waitFor(() =>
      expect(requestsFor(harness.socket(), 'server.webcams.list')).toHaveLength(1),
    )

    // Measured: a printer without `[power]` answers `Method not found` rather
    // than an empty list, so asking costs a round trip to learn nothing.
    expect(requestsFor(harness.socket(), 'machine.device_power.devices')).toHaveLength(0)
    expect(harness.latest().power).toBeNull()
    harness.connection.dispose()
  })

  it('keeps its last snapshot when stopped so a column that returns is not blank', async () => {
    const harness = createHarness()
    await connect(harness)
    harness.socket().receive({
      jsonrpc: '2.0',
      method: 'notify_status_update',
      params: [{ print_stats: { state: 'printing', filename: 'bracket.gcode' } }],
    })

    await vi.waitFor(() => expect(harness.latest().state).toBe('printing'))
    harness.connection.stop()

    expect(harness.latest().state).toBe('printing')
    expect(harness.latest().job?.filename).toBe('bracket.gcode')
    // Stale rather than empty: the column dims what it knew instead of losing it.
    expect(harness.latest().connection).toBe('offline')
    expect(harness.latest().hasConnected).toBe(true)
    harness.connection.dispose()
  })

  /*
   * A refused origin and a printer that is switched off fail the handshake
   * identically, and on a farm the first is the most common setup mistake —
   * without the probe the column reads "offline" for a machine that is running.
   */
  it('reports a reachable printer that refuses this origin as refused', async () => {
    const harness = createHarness({ probeReachable: () => Promise.resolve(true) })
    harness.connection.start()
    harness.socket().fail()

    await vi.waitFor(() => expect(harness.latest().connection).toBe('originRefused'))
    harness.connection.dispose()
  })

  it('leaves an unreachable printer reported as offline', async () => {
    const harness = createHarness({ probeReachable: () => Promise.resolve(false) })
    harness.connection.start()
    harness.socket().fail()

    await vi.waitFor(() => expect(harness.snapshots.length).toBeGreaterThan(0))
    expect(harness.latest().connection).not.toBe('originRefused')
    harness.connection.dispose()
  })
})
