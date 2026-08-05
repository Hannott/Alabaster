import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { flushPromises } from '@/services/moonraker/__tests__/mockSocket'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'

vi.mock('@/services/moonraker', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/moonraker')>()
  return { ...original, probeMoonrakerReachable: vi.fn() }
})

// Imported after the mock so this binding is the mocked one, matching the
// hoisted `vi.mock` above rather than a second, unmocked module instance.
const { probeMoonrakerReachable } = await import('@/services/moonraker')
const probe = probeMoonrakerReachable as ReturnType<typeof vi.fn>

/**
 * A stand-in for the global constructor, not for `MoonrakerClient`'s injectable
 * `socketFactory` — the store builds its client internally with no seam for
 * that, so intercepting `WebSocket` itself is the only way to control the
 * connection from here. `transport.spec.ts` and `client.spec.ts` already cover
 * the handshake mechanics through the real seam; this only needs a socket that
 * can be told to fail.
 *
 * Rejecting the transport's connection promise resumes `client.connect()`'s
 * `await` on a microtask, never synchronously — so every caller of `fail()`
 * still has to flush promises before the store's `lastError` reflects it,
 * exactly as a real failed handshake would.
 */
class FakeWebSocket {
  static readonly CONNECTING = 0
  static instances: FakeWebSocket[] = []
  readyState = FakeWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: { code: number; wasClean: boolean }) => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  send(): void {}

  close(): void {
    this.readyState = 3
  }

  /**
   * `onerror` alone, matching how `mockSocket.ts`'s established fixture does
   * it. A real browser dispatches a failed handshake's `error` and `close`
   * events on separate ticks, so firing both synchronously here — as an
   * earlier version of this fixture did — closes that gap in a way a real
   * WebSocket never would: the client's own `onClose` handler bumps its
   * connection generation before the rejected promise's `catch` block gets a
   * turn to run, so the block's `isCurrentConnection` guard sees a stale
   * generation and returns before classifying the error at all. `onerror`
   * alone is enough — its handler already rejects the pending connection.
   */
  fail(): void {
    this.readyState = 3
    this.onerror?.()
  }
}

let realWebSocket: typeof WebSocket

beforeEach(() => {
  window.localStorage.clear()
  setActivePinia(createPinia())
  probe.mockReset()
  FakeWebSocket.instances = []
  realWebSocket = globalThis.WebSocket
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
})

afterEach(() => {
  globalThis.WebSocket = realWebSocket
  vi.useRealTimers()
})

function latestSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances.at(-1)
  if (!socket) throw new Error('no socket was opened')
  return socket
}

/** Fails the current socket and waits for the store to have reacted to it. */
async function failConnection(): Promise<void> {
  latestSocket().fail()
  await flushPromises()
}

describe('diagnosing a failed connection', () => {
  it('softens "could not be reached" once something answers at that address', async () => {
    let resolveProbe: (reachable: boolean) => void = () => undefined
    probe.mockReturnValue(new Promise((resolve) => (resolveProbe = resolve)))

    const moonraker = useMoonrakerStore()
    moonraker.connect('voron.local:7125')
    await failConnection()

    expect(moonraker.lastError).toBe('connectionFailed')
    expect(probe).toHaveBeenCalledWith('ws://voron.local:7125/websocket')

    resolveProbe(true)
    await flushPromises()

    expect(moonraker.lastError).toBe('originRefused')
  })

  it('leaves the plain "could not be reached" message when nothing answers', async () => {
    probe.mockResolvedValue(false)

    const moonraker = useMoonrakerStore()
    moonraker.connect('voron.local:7125')
    await failConnection()
    await flushPromises()

    expect(moonraker.lastError).toBe('connectionFailed')
  })

  it('never probes a printer that has already been reached from this browser', async () => {
    probe.mockResolvedValue(true)

    const availability = useAvailabilityStore()
    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    availability.printerSnapshotSynchronized()
    expect(availability.hasReachedMoonraker).toBe(true)

    const moonraker = useMoonrakerStore()
    moonraker.connect('voron.local:7125')
    await failConnection()

    // A printer that has worked before cannot newly be rejected by CORS, so a
    // routine reconnect blip must not spend a probe diagnosing it.
    expect(probe).not.toHaveBeenCalled()
    expect(moonraker.lastError).toBe('connectionFailed')
  })

  it('does not stack a second probe onto a failure the first is still diagnosing', async () => {
    // Two independent failed attempts — a settled connection promise is
    // already a no-op on a second `fail()`, so proving the debounce needs the
    // real reconnect ladder to genuinely open and fail a second socket.
    vi.useFakeTimers()
    probe.mockReturnValue(new Promise(() => undefined))

    const moonraker = useMoonrakerStore()
    moonraker.connect('voron.local:7125')
    latestSocket().fail()
    await vi.advanceTimersByTimeAsync(0)

    // The reconnect ladder's own initial delay is 500ms, jittered up to 20%
    // beyond that — advance comfortably past the worst case rather than the
    // nominal figure, or this occasionally fires a tick early.
    await vi.advanceTimersByTimeAsync(700)
    expect(FakeWebSocket.instances).toHaveLength(2)
    latestSocket().fail()
    await vi.advanceTimersByTimeAsync(0)

    expect(probe).toHaveBeenCalledOnce()
  })

  it('ignores a stale answer once the failure it was diagnosing has moved on', async () => {
    let resolveProbe: (reachable: boolean) => void = () => undefined
    probe.mockReturnValue(new Promise((resolve) => (resolveProbe = resolve)))

    const moonraker = useMoonrakerStore()
    moonraker.connect('voron.local:7125')
    await failConnection()
    expect(moonraker.lastError).toBe('connectionFailed')

    // Whatever moved it on — a reconnect that then succeeded, a fresh manual
    // attempt — the probe launched for the failure must not reach past it.
    moonraker.lastError = 'none'

    resolveProbe(true)
    await flushPromises()

    expect(moonraker.lastError).toBe('none')
  })

  it('discards a probe answering for a printer that is no longer the one in front', async () => {
    let resolveProbe: (reachable: boolean) => void = () => undefined
    probe.mockReturnValue(new Promise((resolve) => (resolveProbe = resolve)))

    const moonraker = useMoonrakerStore()
    moonraker.connect('voron.local:7125')
    await failConnection()
    expect(moonraker.lastError).toBe('connectionFailed')

    probe.mockResolvedValueOnce(false)
    moonraker.connect('prusa.local:7125')
    await failConnection()

    resolveProbe(true)
    await flushPromises()

    // The stale answer was for voron; prusa's own state must be what shows.
    expect(moonraker.endpoint).toBe('ws://prusa.local:7125/websocket')
    expect(moonraker.lastError).toBe('connectionFailed')
  })
})
