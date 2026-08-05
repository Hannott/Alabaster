import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import type { JsonRpcNotification, NotificationHandler } from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import { useServerCapabilitiesStore } from '@/stores/serverCapabilities'
import { resolveSpoolmanUrl, spoolPollIntervalMs, useSpoolStore } from '@/stores/spool'

function makeMoonrakerConnected() {
  const availability = useAvailabilityStore()
  availability.moonrakerConnected({ klippy_connected: false, klippy_state: 'disconnected' })
}

/** A proxy result shaped the way `use_v2_response: true` always answers. */
function proxied<T>(response: T): { response: T; error: null } {
  return { response, error: null }
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

describe('spool store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useFakeTimers()
    setActivePinia(createPinia())
    makeMoonrakerConnected()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads status and the active spool once Moonraker connects', async () => {
    spyNotifications()
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'server.spoolman.status') {
        return Promise.resolve({
          spoolman_connected: true,
          pending_reports: [],
          spool_id: 7,
        }) as never
      }
      if (method === 'server.spoolman.proxy') {
        return Promise.resolve(
          proxied({ id: 7, remaining_weight: 742, filament: { name: 'PLA' } }),
        ) as never
      }
      if (method === 'server.config') {
        return Promise.resolve({
          config: { spoolman: { server: 'http://192.168.1.50:7912' } },
        }) as never
      }
      throw new Error(`unexpected method ${String(method)}`)
    })

    const spool = useSpoolStore()
    spool.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(spool.spoolmanConnected).toBe(true)
    expect(spool.activeSpoolId).toBe(7)
    expect(spool.activeSpool?.remaining_weight).toBe(742)
    expect(spool.spoolmanUrl).toBe('http://192.168.1.50:7912/')
    expect(rpcCall).toHaveBeenCalledWith('server.spoolman.proxy', {
      request_method: 'GET',
      path: '/v1/spool/7',
      use_v2_response: true,
    })

    spool.stop()
  })

  it('leaves the Spoolman URL unset when the configured server cannot be parsed', async () => {
    spyNotifications()
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'server.spoolman.status') {
        return Promise.resolve({
          spoolman_connected: false,
          pending_reports: [],
          spool_id: null,
        }) as never
      }
      if (method === 'server.config') {
        return Promise.resolve({ config: {} }) as never
      }
      return Promise.resolve(proxied(null)) as never
    })

    const spool = useSpoolStore()
    spool.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(spool.spoolmanUrl).toBeNull()

    spool.stop()
  })

  it('never asks Moonraker anything on a printer without the spoolman component', async () => {
    spyNotifications()
    const capabilities = useServerCapabilitiesStore()
    capabilities.applyServerInfo({ components: ['history'] })
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall')

    const spool = useSpoolStore()
    spool.start()
    await vi.advanceTimersByTimeAsync(spoolPollIntervalMs * 2)

    expect(rpcCall).not.toHaveBeenCalled()
    spool.stop()
  })

  it('polls the active spool for its remaining weight, since nothing notifies that', async () => {
    spyNotifications()
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'server.spoolman.status') {
        return Promise.resolve({
          spoolman_connected: true,
          pending_reports: [],
          spool_id: 3,
        }) as never
      }
      return Promise.resolve(proxied({ id: 3, remaining_weight: 500 })) as never
    })

    const spool = useSpoolStore()
    spool.start()
    await vi.advanceTimersByTimeAsync(0)
    const callsAfterFirstRead = rpcCall.mock.calls.length

    await vi.advanceTimersByTimeAsync(spoolPollIntervalMs * 2)
    expect(rpcCall.mock.calls.length).toBeGreaterThan(callsAfterFirstRead)

    spool.stop()
  })

  it('updates the active spool as soon as the notification says it changed', async () => {
    const handlers = spyNotifications()
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method, params) => {
      if (method === 'server.spoolman.status') {
        return Promise.resolve({
          spoolman_connected: true,
          pending_reports: [],
          spool_id: null,
        }) as never
      }
      const id = (params as { path: string }).path.split('/').pop()
      return Promise.resolve(
        proxied({ id: Number(id), remaining_weight: 100 * Number(id) }),
      ) as never
    })

    const spool = useSpoolStore()
    spool.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(spool.activeSpool).toBeNull()

    fire(handlers, 'notify_active_spool_set', { spool_id: 9 })
    await vi.advanceTimersByTimeAsync(0)

    expect(spool.activeSpoolId).toBe(9)
    expect(spool.activeSpool?.remaining_weight).toBe(900)

    spool.stop()
  })

  it('stops polling once Spoolman itself disconnects, and resumes once it is back', async () => {
    const handlers = spyNotifications()
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'server.spoolman.status') {
        return Promise.resolve({
          spoolman_connected: true,
          pending_reports: [],
          spool_id: 1,
        }) as never
      }
      return Promise.resolve(proxied({ id: 1, remaining_weight: 500 })) as never
    })

    const spool = useSpoolStore()
    spool.start()
    await vi.advanceTimersByTimeAsync(0)

    fire(handlers, 'notify_spoolman_status_changed', { spoolman_connected: false })
    const callsAtDisconnect = rpcCall.mock.calls.length
    await vi.advanceTimersByTimeAsync(spoolPollIntervalMs * 3)
    expect(rpcCall.mock.calls.length).toBe(callsAtDisconnect)

    fire(handlers, 'notify_spoolman_status_changed', { spoolman_connected: true })
    await vi.advanceTimersByTimeAsync(spoolPollIntervalMs)
    expect(rpcCall.mock.calls.length).toBeGreaterThan(callsAtDisconnect)

    spool.stop()
  })

  /*
   * Polling stops the instant Spoolman is known down, so nothing would
   * otherwise refresh the spool away from its last-known-good reading — every
   * fit/temperature check downstream would keep judging a print against
   * numbers that are no longer trustworthy, which is exactly the "still shown
   * when unavailable" failure every Spoolman-dependent surface must avoid.
   */
  it('drops the active spool the instant Spoolman disconnects, via the notification', async () => {
    const handlers = spyNotifications()
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'server.spoolman.status') {
        return Promise.resolve({
          spoolman_connected: true,
          pending_reports: [],
          spool_id: 1,
        }) as never
      }
      return Promise.resolve(proxied({ id: 1, remaining_weight: 500 })) as never
    })

    const spool = useSpoolStore()
    spool.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(spool.activeSpool?.remaining_weight).toBe(500)

    fire(handlers, 'notify_spoolman_status_changed', { spoolman_connected: false })

    expect(spool.activeSpool).toBeNull()
    expect(spool.hasActiveSpool).toBe(false)

    spool.stop()
  })

  it('drops a stale active spool when the first status read itself reports Spoolman disconnected', async () => {
    spyNotifications()
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'server.spoolman.status') {
        return Promise.resolve({
          spoolman_connected: false,
          pending_reports: [],
          spool_id: null,
        }) as never
      }
      return Promise.resolve(proxied({ id: 1, remaining_weight: 500 })) as never
    })

    const spool = useSpoolStore()
    // A reading that survived from before this connection — the case
    // `refreshStatus`'s own branch guards, distinct from the notification path
    // the test above covers.
    spool.activeSpool = {
      id: 1,
      registered: '2026-01-01T00:00:00Z',
      used_weight: 0,
      used_length: 0,
      remaining_weight: 500,
      archived: false,
      filament: { id: 1, material: 'PLA' },
    }

    spool.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(spool.activeSpool).toBeNull()

    spool.stop()
  })

  it('clears everything printer-specific when the connection is retargeted', async () => {
    const realWebSocket = globalThis.WebSocket
    globalThis.WebSocket = class {
      static readonly CONNECTING = 0
      readyState = 0
      close(): void {}
      send(): void {}
    } as unknown as typeof WebSocket
    spyNotifications()
    const moonraker = useMoonrakerStore()
    // A client has to exist for the retarget below to count as a printer
    // change — `connect` is the path the registered resets actually run on.
    moonraker.connect('printer-a.local:7125')
    makeMoonrakerConnected()
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'server.spoolman.status') {
        return Promise.resolve({
          spoolman_connected: true,
          pending_reports: [],
          spool_id: 1,
        }) as never
      }
      if (method === 'server.config') {
        return Promise.resolve({
          config: { spoolman: { server: 'http://printer-a.local:7912' } },
        }) as never
      }
      return Promise.resolve(proxied({ id: 1, remaining_weight: 500 })) as never
    })

    const spool = useSpoolStore()
    spool.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(spool.activeSpool).not.toBeNull()
    expect(spool.spoolmanUrl).not.toBeNull()

    moonraker.connect('a-different-printer.local')
    await vi.advanceTimersByTimeAsync(0)
    globalThis.WebSocket = realWebSocket

    expect(spool.spoolmanConnected).toBeNull()
    expect(spool.spoolmanUrl).toBeNull()
    expect(spool.activeSpoolId).toBeNull()
    expect(spool.activeSpool).toBeNull()

    spool.stop()
  })

  it('sets the active spool and surfaces a refused command for an explicit retry', async () => {
    spyNotifications()
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'server.spoolman.post_spool_id') {
        return Promise.resolve({ spool_id: 4 }) as never
      }
      return Promise.resolve(proxied({ id: 4, remaining_weight: 250 })) as never
    })

    const spool = useSpoolStore()
    expect(await spool.setActiveSpool(4)).toBe(true)
    expect(spool.activeSpoolId).toBe(4)
    expect(spool.activeSpool?.remaining_weight).toBe(250)

    rpcCall.mockRejectedValueOnce(new Error('moonraker refused'))
    expect(await spool.setActiveSpool(null)).toBe(false)
    expect(spool.lastCommandError).toBe('setActiveSpool')

    spool.clearCommandError()
    expect(spool.lastCommandError).toBeNull()
  })

  it('omits spool_id entirely when clearing the active spool', async () => {
    spyNotifications()
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'server.spoolman.post_spool_id') {
        return Promise.resolve({ spool_id: null }) as never
      }
      return Promise.resolve(proxied(null)) as never
    })

    const spool = useSpoolStore()
    // Moonraker's `get_int("spool_id", None)` only falls back to `None` when
    // the key is absent; a present `null` still reaches `int(None)` and
    // Moonraker refuses the call, so clearing must omit the key entirely
    // rather than send it as `null`.
    expect(await spool.setActiveSpool(null)).toBe(true)
    expect(rpcCall).toHaveBeenCalledWith('server.spoolman.post_spool_id', {})

    spool.stop()
  })

  it('never starts a second switch while one is still pending', async () => {
    spyNotifications()
    const moonraker = useMoonrakerStore()
    let resolvePost: ((value: { spool_id: number | null }) => void) | undefined
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'server.spoolman.post_spool_id') {
        return new Promise((resolve) => (resolvePost = resolve)) as never
      }
      return Promise.resolve(proxied({ id: 5, remaining_weight: 500 })) as never
    })

    const spool = useSpoolStore()
    const firstCall = spool.setActiveSpool(5)
    // The guard trips before the mutation's own follow-up read of the spool it
    // just set, so a second switch mid-flight adds no `post_spool_id` call —
    // only the first switch's own two calls (the mutation, then its refresh).
    expect(await spool.setActiveSpool(6)).toBe(false)
    expect(rpcCall).toHaveBeenCalledTimes(1)

    resolvePost?.({ spool_id: 5 })
    await firstCall
    expect(rpcCall).toHaveBeenCalledWith('server.spoolman.post_spool_id', { spool_id: 5 })
    expect(
      rpcCall.mock.calls.filter(([method]) => method === 'server.spoolman.post_spool_id'),
    ).toHaveLength(1)
  })
})

describe('auto-pause on empty spool', () => {
  beforeEach(() => {
    // dashboardLayout persists to real localStorage, which jsdom does not
    // reset between tests on its own — without this, one test's
    // `autoPauseOnEmpty: true` survives into the next.
    window.localStorage.clear()
    setActivePinia(createPinia())
    // Isolates these tests from `refreshStatus`'s own network call — the
    // watcher under test reacts to `activeSpool` directly and does not need
    // the capability-gated polling machinery running at all.
    useServerCapabilitiesStore().applyServerInfo({ components: [] })
  })

  function seedActiveSpool(spool: ReturnType<typeof useSpoolStore>, remainingWeight: number): void {
    spool.activeSpoolId = 1
    spool.activeSpool = {
      id: 1,
      registered: '2026-01-01T00:00:00Z',
      used_weight: 0,
      used_length: 0,
      remaining_weight: remainingWeight,
      archived: false,
      filament: { id: 1, material: 'PLA' },
    }
  }

  it('pauses the print once the spool reports empty, when the setting is on', async () => {
    spyNotifications()
    const spool = useSpoolStore()
    const printer = usePrinterStore()
    const pausePrint = vi.spyOn(printer, 'pausePrint').mockResolvedValue(true)
    useDashboardLayoutStore().updateConfig('spool', { autoPauseOnEmpty: true })
    printer.printStats.state = 'printing'
    seedActiveSpool(spool, 5)

    spool.start()
    spool.activeSpool = { ...spool.activeSpool!, remaining_weight: 0 }
    await nextTick()

    expect(pausePrint).toHaveBeenCalledOnce()
    spool.stop()
  })

  it('does nothing while the setting is off', async () => {
    spyNotifications()
    const spool = useSpoolStore()
    const printer = usePrinterStore()
    const pausePrint = vi.spyOn(printer, 'pausePrint').mockResolvedValue(true)
    printer.printStats.state = 'printing'
    seedActiveSpool(spool, 5)

    spool.start()
    spool.activeSpool = { ...spool.activeSpool!, remaining_weight: -2 }
    await nextTick()

    expect(pausePrint).not.toHaveBeenCalled()
    spool.stop()
  })

  it('does nothing while nothing is actually printing', async () => {
    spyNotifications()
    const spool = useSpoolStore()
    const printer = usePrinterStore()
    const pausePrint = vi.spyOn(printer, 'pausePrint').mockResolvedValue(true)
    useDashboardLayoutStore().updateConfig('spool', { autoPauseOnEmpty: true })
    printer.printStats.state = 'complete'
    seedActiveSpool(spool, 5)

    spool.start()
    spool.activeSpool = { ...spool.activeSpool!, remaining_weight: 0 }
    await nextTick()

    expect(pausePrint).not.toHaveBeenCalled()
    spool.stop()
  })

  it('does nothing while the spool still has filament left', async () => {
    spyNotifications()
    const spool = useSpoolStore()
    const printer = usePrinterStore()
    const pausePrint = vi.spyOn(printer, 'pausePrint').mockResolvedValue(true)
    useDashboardLayoutStore().updateConfig('spool', { autoPauseOnEmpty: true })
    printer.printStats.state = 'printing'
    seedActiveSpool(spool, 5)

    spool.start()
    spool.activeSpool = { ...spool.activeSpool!, remaining_weight: 4 }
    await nextTick()

    expect(pausePrint).not.toHaveBeenCalled()
    spool.stop()
  })
})

describe('searchExternalFilaments', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('proxies a search to the external filament catalogue', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi
      .spyOn(moonraker, 'rpcCall')
      .mockResolvedValue(
        proxied([
          { id: 'prusament_pla_1000_175', manufacturer: 'Prusament', name: 'PLA', material: 'PLA' },
        ]) as never,
      )

    const spool = useSpoolStore()
    const { filaments, failed } = await spool.searchExternalFilaments('prusament pla')

    expect(rpcCall).toHaveBeenCalledWith('server.spoolman.proxy', {
      request_method: 'GET',
      path: '/v1/external/filament/search',
      query: 'query=prusament%20pla&limit=20',
      use_v2_response: true,
    })
    expect(failed).toBe(false)
    expect(filaments).toEqual([
      { id: 'prusament_pla_1000_175', manufacturer: 'Prusament', name: 'PLA', material: 'PLA' },
    ])
  })

  it('reports failure separately from an empty match list', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({
      response: null,
      error: { status_code: 502, message: 'unreachable' },
    } as never)

    const spool = useSpoolStore()
    const { filaments, failed } = await spool.searchExternalFilaments('nonsense')

    expect(filaments).toEqual([])
    expect(failed).toBe(true)
  })

  it('reports failure when the RPC call itself is refused', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockRejectedValue(new Error('no spoolman'))

    const spool = useSpoolStore()
    const { filaments, failed } = await spool.searchExternalFilaments('pla')

    expect(filaments).toEqual([])
    expect(failed).toBe(true)
  })
})

describe('resolveSpoolmanUrl', () => {
  it('substitutes a loopback host with the endpoint actually used to reach Moonraker', () => {
    expect(resolveSpoolmanUrl('http://127.0.0.1:7912', 'ws://printer.local:7125/websocket')).toBe(
      'http://printer.local:7912/',
    )
    expect(resolveSpoolmanUrl('localhost:7912', 'ws://printer.local:7125/websocket')).toBe(
      'http://printer.local:7912/',
    )
  })

  it('leaves a non-loopback host as configured', () => {
    expect(
      resolveSpoolmanUrl('http://192.168.1.50:7912', 'ws://printer.local:7125/websocket'),
    ).toBe('http://192.168.1.50:7912/')
  })

  it('returns null for a value that is not a usable URL', () => {
    expect(resolveSpoolmanUrl('::not a url::', 'ws://printer.local:7125/websocket')).toBeNull()
  })
})
