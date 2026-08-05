import { describe, expect, it, vi } from 'vitest'

import { probeMoonrakerReachable } from '@/services/moonraker'

describe('probeMoonrakerReachable', () => {
  it('reads reachability from whether the request resolves, never from the response', async () => {
    // no-cors is opaque by construction: status and body are both unreadable.
    // A stand-in that throws if either is touched proves nothing here reads
    // them — `then` has to pass through undefined, or `await`ing this value
    // would trip the same trap for a reason that has nothing to do with the
    // function under test.
    const opaque = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then' || typeof prop === 'symbol') return undefined
          throw new Error(`must not read Response.${String(prop)} in no-cors mode`)
        },
      },
    ) as Response
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(opaque)

    await expect(
      probeMoonrakerReachable('ws://voron.local:7125/websocket', { fetchImpl }),
    ).resolves.toBe(true)
  })

  it('requests no-cors against the server.info path, never the websocket', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null))

    await probeMoonrakerReachable('ws://voron.local:7125/websocket', { fetchImpl })

    const [url, init] = fetchImpl.mock.calls[0]!
    expect(String(url)).toBe('http://voron.local:7125/server/info')
    expect(init).toMatchObject({ mode: 'no-cors', cache: 'no-store' })
  })

  it('is unreachable on a genuine network failure, the same as fetch reports it', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(
      probeMoonrakerReachable('ws://voron.local:7125/websocket', { fetchImpl }),
    ).resolves.toBe(false)
  })

  it('gives up rather than hang on a host that never answers', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = (init as { signal?: AbortSignal } | undefined)?.signal
          signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError')))
        }),
    )

    await expect(
      probeMoonrakerReachable('ws://voron.local:7125/websocket', { fetchImpl, timeoutMs: 5 }),
    ).resolves.toBe(false)
  })

  it('answers false rather than throwing for an endpoint it cannot parse', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(probeMoonrakerReachable('not a url at all', { fetchImpl })).resolves.toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('probes over wss as https, matching how file downloads already do it', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null))

    await probeMoonrakerReachable('wss://voron.local/websocket', { fetchImpl })

    expect(String(fetchImpl.mock.calls[0]![0])).toBe('https://voron.local/server/info')
  })
})
