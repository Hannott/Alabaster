import { describe, expect, it, vi } from 'vitest'

import type { NavigationDestinationName } from '@/navigation/destinations'
import { createPagePrefetch } from '@/router/prefetch'

/** Runs each scheduled turn as soon as it is queued, so a test needs no timers. */
function immediateSchedule(task: () => void): () => void {
  task()
  return () => {}
}

function loaders(names: readonly NavigationDestinationName[], fail: Set<string> = new Set()) {
  const calls: string[] = []
  const table: Partial<Record<NavigationDestinationName, { load: () => Promise<unknown> }>> = {}

  for (const name of names) {
    table[name] = {
      load: () => {
        calls.push(name)
        return fail.has(name) ? Promise.reject(new Error('offline')) : Promise.resolve({})
      },
    }
  }

  return { table, calls }
}

const order: NavigationDestinationName[] = ['overview', 'printFiles', 'history']

describe('page prefetch', () => {
  it('warms every page once, in the order given', async () => {
    const { table, calls } = loaders(order)
    createPagePrefetch(table, immediateSchedule).warmAll(order)
    await vi.waitFor(() => expect(calls).toEqual(['overview', 'printFiles', 'history']))
  })

  /**
   * Sequential, not parallel: these requests share the link with the WebSocket
   * carrying the printer's status, and a warm-up the reader can feel has defeated
   * itself. Each page starts only once the one before it has arrived.
   */
  it('waits for each page before starting the next', async () => {
    const started: string[] = []
    const resolvers: Array<() => void> = []
    const table = {
      overview: {
        load: () => {
          started.push('overview')
          return new Promise<void>((resolve) => resolvers.push(resolve))
        },
      },
      printFiles: {
        load: () => {
          started.push('printFiles')
          return Promise.resolve()
        },
      },
    }

    createPagePrefetch(table, immediateSchedule).warmAll(['overview', 'printFiles'])
    expect(started).toEqual(['overview'])

    resolvers[0]?.()
    await vi.waitFor(() => expect(started).toEqual(['overview', 'printFiles']))
  })

  it('requests a page once however often intent is expressed', () => {
    const { table, calls } = loaders(order)
    const prefetch = createPagePrefetch(table, immediateSchedule)

    prefetch.prefetch('history')
    prefetch.prefetch('history')
    prefetch.prefetch('history')

    expect(calls).toEqual(['history'])
  })

  it('skips a page intent already warmed', async () => {
    const { table, calls } = loaders(order)
    const prefetch = createPagePrefetch(table, immediateSchedule)

    prefetch.prefetch('printFiles')
    prefetch.warmAll(order)

    await vi.waitFor(() => expect(calls).toEqual(['printFiles', 'overview', 'history']))
  })

  /**
   * A warm-up that failed was nobody's request, so it is forgotten rather than
   * reported — and forgetting it is what lets the next attempt happen. Caching the
   * failure would mean one dropped request on a reconnecting printer left that
   * page cold for the rest of the session, which is exactly the dead click this
   * whole mechanism exists to remove.
   */
  it('lets a page that failed to warm be requested again', async () => {
    const { table, calls } = loaders(order, new Set(['history']))
    const prefetch = createPagePrefetch(table, immediateSchedule)

    prefetch.prefetch('history')
    await vi.waitFor(() => expect(calls).toEqual(['history']))

    prefetch.prefetch('history')
    await vi.waitFor(() => expect(calls).toEqual(['history', 'history']))
  })

  it('keeps warming the rest of the list after one page fails', async () => {
    const { table, calls } = loaders(order, new Set(['overview']))
    createPagePrefetch(table, immediateSchedule).warmAll(order)
    await vi.waitFor(() => expect(calls).toEqual(['overview', 'printFiles', 'history']))
  })

  it('stops warming when cancelled', async () => {
    const scheduled: Array<() => void> = []
    const { table, calls } = loaders(order)
    const prefetch = createPagePrefetch(table, (task) => {
      scheduled.push(task)
      return () => {
        scheduled.splice(scheduled.indexOf(task), 1)
      }
    })

    prefetch.warmAll(order)
    expect(scheduled).toHaveLength(1)

    prefetch.cancel()
    expect(scheduled).toHaveLength(0)
    expect(calls).toEqual([])
  })
})
