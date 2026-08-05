import type { NavigationDestinationName } from '@/navigation/destinations'
import { pages } from '@/router/pages'

/**
 * Warming page modules before they are asked for.
 *
 * Alabaster's pages are split into their own modules so the first paint costs
 * one page rather than ten. The price is that the first visit to each of them
 * waits for a request, and on a printer's own Wi-Fi that wait is long enough to
 * read as an unresponsive interface. Fetching them while nothing is happening
 * removes the wait without giving up the split: by the time a destination is
 * clicked its module is already in the browser's module registry, so the click
 * resolves inside a frame and no placeholder is ever earned.
 *
 * Deliberately not gated on `saveData` or connection type. Every page together
 * is a fraction of one G-code thumbnail, and the machine this runs against is on
 * the same network as the printer it controls; a data-saver branch would trade a
 * measurable improvement for a case that does not arise here.
 */

type Schedule = (task: () => void) => () => void

/**
 * Idle time, not a timer.
 *
 * A `setTimeout` competes with the page the reader is actually looking at —
 * with its first subscriptions arriving, its own module still evaluating, and on
 * a Pi that is exactly the moment there is nothing to spare. `requestIdleCallback`
 * waits for the browser to be doing nothing, and its timeout is the floor that
 * keeps a permanently busy page from never warming anything at all.
 */
const idleSchedule: Schedule = (task) => {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(() => task(), { timeout: 3_000 })
    return () => cancelIdleCallback(handle)
  }

  const handle = setTimeout(task, 300)
  return () => clearTimeout(handle)
}

export interface PagePrefetch {
  /**
   * Warms one page now. Called on pointer or keyboard intent, where the reader
   * has already told us which destination they are heading for.
   */
  prefetch: (name: NavigationDestinationName) => void
  /**
   * Warms every page in the order given, one at a time. Sequential on purpose:
   * ten parallel requests share the same link as the WebSocket carrying the
   * printer's status, and the point of this is to be invisible.
   */
  warmAll: (order: readonly NavigationDestinationName[]) => void
  /** Abandons whatever has not been warmed yet. */
  cancel: () => void
}

export function createPagePrefetch(
  loaders: Partial<Record<NavigationDestinationName, { load: () => Promise<unknown> }>>,
  schedule: Schedule = idleSchedule,
): PagePrefetch {
  const requested = new Set<NavigationDestinationName>()
  let cancelScheduled: (() => void) | null = null

  function load(name: NavigationDestinationName): Promise<unknown> {
    const entry = loaders[name]
    if (!entry) return Promise.resolve()
    // A failed warm-up is forgotten rather than reported: nothing asked for this
    // page yet, and dropping it from the set lets the next attempt — an idle turn
    // or the reader hovering the link — try again instead of caching the failure.
    return entry.load().catch(() => requested.delete(name))
  }

  function prefetch(name: NavigationDestinationName): void {
    if (requested.has(name)) return
    requested.add(name)
    void load(name)
  }

  function warmAll(order: readonly NavigationDestinationName[]): void {
    const queue = order.filter((name) => !requested.has(name))
    if (queue.length === 0) return

    const next = (index: number): void => {
      if (index >= queue.length) {
        cancelScheduled = null
        return
      }

      cancelScheduled = schedule(() => {
        const name = queue[index]
        if (name === undefined) {
          cancelScheduled = null
          return
        }
        if (requested.has(name)) {
          next(index + 1)
          return
        }
        requested.add(name)
        void load(name).then(() => next(index + 1))
      })
    }

    next(0)
  }

  function cancel(): void {
    cancelScheduled?.()
    cancelScheduled = null
  }

  return { prefetch, warmAll, cancel }
}

export const pagePrefetch = createPagePrefetch(pages)
