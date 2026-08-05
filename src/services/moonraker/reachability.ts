import { moonrakerHttpBaseUrl } from '@/services/moonraker/url'

export interface ReachabilityOptions {
  /** How long to wait before treating the address as unreachable. */
  timeoutMs?: number
  /** Substituted in tests; production always uses the global `fetch`. */
  fetchImpl?: typeof fetch
}

const defaultTimeoutMs = 3_000

/**
 * Whether *something* answers HTTP at a Moonraker endpoint's host, using the
 * one request mode that succeeds regardless of CORS configuration.
 *
 * A rejected-origin printer and an offline one are indistinguishable through
 * the WebSocket connection itself: browsers deliberately hide a failed
 * handshake's HTTP status from JavaScript — the same restriction that keeps a
 * cross-origin `fetch` from being usable as a port scanner — so both cases
 * surface as the identical `MoonrakerConnectionError`. `mode: 'no-cors'` is
 * the narrow exception. It never exposes a status code or body, but it also
 * never rejects *because* of a missing `Access-Control-Allow-Origin` header:
 * the promise resolves the instant any HTTP response arrives — a 401, a 403,
 * whatever Moonraker's own authorization sends back — and rejects only on a
 * genuine network-level failure: DNS, a refused connection, a timeout.
 * Resolution therefore means "a server is there," not "a server that will
 * talk to us," which is exactly the distinction a CORS-refused printer and an
 * offline one otherwise share.
 *
 * This is a hint, not a diagnosis: something else could be listening on that
 * port, or the WebSocket path specifically could be blocked by a proxy that
 * lets plain HTTP through. It only ever softens "could not be reached" into
 * "reachable, but refused" — never the reverse — for exactly that reason.
 */
export async function probeMoonrakerReachable(
  websocketEndpoint: string,
  options: ReachabilityOptions = {},
): Promise<boolean> {
  const { timeoutMs = defaultTimeoutMs, fetchImpl = fetch } = options

  let probeUrl: URL
  try {
    probeUrl = moonrakerHttpBaseUrl(websocketEndpoint)
    probeUrl.pathname = '/server/info'
  } catch {
    return false
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    await fetchImpl(probeUrl, { mode: 'no-cors', cache: 'no-store', signal: controller.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
