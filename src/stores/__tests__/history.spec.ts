import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAvailabilityStore } from '@/stores/availability'
import { historyPageSize, useHistoryStore, windowPageSize } from '@/stores/history'
import { useMoonrakerStore } from '@/stores/moonraker'

function job(overrides: Record<string, unknown> = {}) {
  return {
    job_id: '000001',
    filename: 'prints/cube.gcode',
    status: 'completed',
    start_time: 1000,
    end_time: 4600,
    print_duration: 3000,
    total_duration: 3600,
    filament_used: 4200,
    exists: true,
    ...overrides,
  }
}

const totals = {
  job_totals: {
    total_jobs: 12,
    total_time: 360000,
    total_print_time: 300000,
    total_filament_used: 120000,
    longest_job: 40000,
    longest_print: 36000,
  },
}

function mockRpc(jobs: unknown[], count = jobs.length) {
  const moonraker = useMoonrakerStore()
  return vi.spyOn(moonraker, 'rpcCall').mockImplementation((async (method: string) => {
    if (method === 'server.history.totals') return totals
    if (method === 'server.history.list') return { count, jobs }
    return {}
  }) as never)
}

describe('history store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setActivePinia(createPinia())
    useAvailabilityStore().moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
  })

  it('reads jobs and lifetime totals together', async () => {
    mockRpc([job()])
    const history = useHistoryStore()

    await history.refresh()

    expect(history.jobs).toHaveLength(1)
    expect(history.jobs[0]).toMatchObject({
      id: '000001',
      filename: 'prints/cube.gcode',
      outcome: 'completed',
      printDuration: 3000,
      filamentUsed: 4200,
      fileExists: true,
    })
    expect(history.totals.jobs).toBe(12)
    expect(history.totals.printTime).toBe(300000)
  })

  /**
   * Verified against a real printer's history: a job Moonraker reports as
   * `klippy_disconnect` had a `filament_used` of `-10`. Left alone, a negative
   * magnitude subtracts from an aggregate meant to only ever grow, and turns a
   * share percentage into `-0%` — clamped here rather than trusted, since the
   * sign is not data, it is corruption.
   */
  it('clamps a negative filament or duration to zero, rather than trusting it', async () => {
    mockRpc([job({ filament_used: -10, print_duration: -5, total_duration: -1 })])
    const history = useHistoryStore()

    await history.refresh()

    expect(history.jobs[0]).toMatchObject({ filamentUsed: 0, printDuration: 0, totalDuration: 0 })
  })

  it('maps every outcome Moonraker reports, and calls the rest unknown', async () => {
    mockRpc([
      job({ job_id: '1', status: 'completed' }),
      job({ job_id: '2', status: 'cancelled' }),
      job({ job_id: '3', status: 'klippy_shutdown' }),
      job({ job_id: '4', status: 'server_exit' }),
      job({ job_id: '5', status: 'something new' }),
    ])
    const history = useHistoryStore()

    await history.refresh()

    expect(history.jobs.map((entry) => entry.outcome)).toEqual([
      'completed',
      'cancelled',
      'interrupted',
      'error',
      'unknown',
    ])
  })

  /**
   * Moonraker's `count` is the length of `jobs` in that response, never a
   * total — a request for 5 jobs answers `count: 5` whether the printer has
   * 5 jobs or 5,000. `hasMore` is therefore read off the page's own length,
   * never off `count`.
   */
  it('appends the next page rather than reloading the top of the list', async () => {
    const fullPage = Array.from({ length: historyPageSize }, (_unused, index) =>
      job({ job_id: String(index) }),
    )
    const rpcCall = mockRpc(fullPage)
    const history = useHistoryStore()
    await history.refresh()
    expect(history.hasMore).toBe(true)

    rpcCall.mockImplementation((async (method: string) => {
      if (method === 'server.history.totals') return totals
      return { count: 1, jobs: [job({ job_id: 'last' })] }
    }) as never)
    await history.loadMore()

    expect(history.jobs).toHaveLength(historyPageSize + 1)
    expect(history.jobs[history.jobs.length - 1]).toMatchObject({ id: 'last' })
    expect(history.hasMore).toBe(false)
    expect(rpcCall).toHaveBeenCalledWith('server.history.list', {
      limit: historyPageSize,
      start: historyPageSize,
      order: 'desc',
    })
  })

  it('never treats a short first page as having more', async () => {
    mockRpc([job({ job_id: '1' })])
    const history = useHistoryStore()

    await history.refresh()

    expect(history.hasMore).toBe(false)
  })

  it('stops paging once a full page is followed by an empty one', async () => {
    const fullPage = Array.from({ length: historyPageSize }, (_unused, index) =>
      job({ job_id: String(index) }),
    )
    const rpcCall = mockRpc(fullPage)
    const history = useHistoryStore()
    await history.refresh()
    expect(history.hasMore).toBe(true)

    rpcCall.mockImplementation((async (method: string) => {
      if (method === 'server.history.totals') return totals
      return { count: 0, jobs: [] }
    }) as never)
    await history.loadMore()

    expect(history.jobs).toHaveLength(historyPageSize)
    expect(history.hasMore).toBe(false)
  })

  it('keeps the last successful read when a refresh fails', async () => {
    const rpcCall = mockRpc([job()])
    const history = useHistoryStore()
    await history.refresh()

    rpcCall.mockRejectedValue(new Error('history disabled'))
    await expect(history.refresh()).resolves.toBe(false)

    expect(history.failed).toBe(true)
    expect(history.jobs).toHaveLength(1)
    expect(history.totals.jobs).toBe(12)
  })

  it('drops one job from the list when it is removed', async () => {
    const rpcCall = mockRpc([job({ job_id: '1' }), job({ job_id: '2' })])
    const history = useHistoryStore()
    await history.refresh()

    await history.deleteJob('1')

    expect(rpcCall).toHaveBeenCalledWith('server.history.delete_job', { uid: '1' })
    expect(history.jobs.map((entry) => entry.id)).toEqual(['2'])
  })

  /**
   * `notify_history_changed` never fires for a deletion, so the statistics
   * window and lifetime totals would otherwise sit stale until the next
   * period change or reconnect — the trend chart, outcome table and success
   * rate all read from `windowJobs`, not `jobs`.
   */
  it('drops the deleted job from the statistics window and re-fetches totals', async () => {
    const moonraker = useMoonrakerStore()
    let totalsCalls = 0
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation((async (
      method: string,
      params?: Record<string, unknown>,
    ) => {
      if (method === 'server.history.totals') {
        totalsCalls += 1
        return totalsCalls === 1 ? totals : { job_totals: { ...totals.job_totals, total_jobs: 11 } }
      }
      if (method === 'server.history.delete_job') return {}
      if (method === 'server.history.list') {
        if (params?.since !== undefined) {
          return { count: 2, jobs: [job({ job_id: '1' }), job({ job_id: '2' })] }
        }
        return { count: 2, jobs: [job({ job_id: '1' }), job({ job_id: '2' })] }
      }
      return {}
    }) as never)
    const history = useHistoryStore()
    await history.refresh()
    await history.refreshWindow()
    expect(history.windowJobs).toHaveLength(2)

    await history.deleteJob('1')

    expect(rpcCall).toHaveBeenCalledWith('server.history.delete_job', { uid: '1' })
    expect(history.windowJobs.map((entry) => entry.id)).toEqual(['2'])
    expect(history.totals.jobs).toBe(11)
  })

  it('marks a job whose file is gone, so a reprint is not offered for it', async () => {
    mockRpc([job({ exists: false })])
    const history = useHistoryStore()

    await history.refresh()

    expect(history.jobs[0]!.fileExists).toBe(false)
  })

  describe('the statistics window', () => {
    it('starts empty, with no success rate claimed for it', () => {
      const history = useHistoryStore()

      expect(history.windowJobs).toEqual([])
      expect(history.windowSuccessRate).toBeNull()
    })

    /**
     * Moonraker's totals count jobs but not their outcomes, so a rate claimed
     * for all time would be a sample presented as a fact — it is computed over
     * the window's own population, and the population is what the period
     * selector makes explicit.
     */
    it('reports the success rate over the statistics window', async () => {
      const moonraker = useMoonrakerStore()
      vi.spyOn(moonraker, 'rpcCall').mockImplementation((async (method: string) => {
        if (method === 'server.history.totals') return totals
        if (method === 'server.history.list') {
          return {
            count: 4,
            jobs: [
              job({ job_id: '1', status: 'completed' }),
              job({ job_id: '2', status: 'completed' }),
              job({ job_id: '3', status: 'cancelled' }),
              job({ job_id: '4', status: 'error' }),
            ],
          }
        }
        return {}
      }) as never)
      const history = useHistoryStore()

      await history.refreshWindow()

      expect(history.windowSuccessRate).toBe(0.5)
    })

    it('fetches a since-bounded window separate from the paginated job list', async () => {
      const moonraker = useMoonrakerStore()
      const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation((async (
        method: string,
        params?: Record<string, unknown>,
      ) => {
        if (method === 'server.history.totals') return totals
        if (method === 'server.history.list') {
          if (params?.since !== undefined) {
            return { count: 1, jobs: [job({ job_id: 'window' })] }
          }
          return { count: 1, jobs: [job({ job_id: 'list' })] }
        }
        return {}
      }) as never)
      const history = useHistoryStore()

      await history.refreshWindow()

      expect(history.windowJobs.map((entry) => entry.id)).toEqual(['window'])
      expect(history.jobs).toEqual([])
      expect(rpcCall).toHaveBeenCalledWith(
        'server.history.list',
        expect.objectContaining({ since: expect.any(Number) }),
      )
    })

    it('re-fetches with a new boundary when the period changes', async () => {
      const moonraker = useMoonrakerStore()
      const sinceValues: Array<number | undefined> = []
      vi.spyOn(moonraker, 'rpcCall').mockImplementation((async (
        method: string,
        params?: Record<string, unknown>,
      ) => {
        if (method === 'server.history.totals') return totals
        if (method === 'server.history.list') {
          sinceValues.push(params?.since as number | undefined)
          return { count: 0, jobs: [] }
        }
        return {}
      }) as never)
      const history = useHistoryStore()

      await history.refreshWindow()
      history.setPeriod('30d')
      await Promise.resolve()
      await Promise.resolve()

      expect(sinceValues).toHaveLength(2)
      expect(sinceValues[1]).toBeGreaterThan(sinceValues[0] as number)
    })

    it('has no since boundary at all for all time', async () => {
      const moonraker = useMoonrakerStore()
      const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation((async (method: string) => {
        if (method === 'server.history.totals') return totals
        if (method === 'server.history.list') return { count: 0, jobs: [] }
        return {}
      }) as never)
      const history = useHistoryStore()

      history.setPeriod('all')
      await Promise.resolve()

      expect(rpcCall).toHaveBeenCalledWith(
        'server.history.list',
        expect.not.objectContaining({ since: expect.anything() }),
      )
    })

    it('pages the window rather than truncating it when a period holds more than one page', async () => {
      const moonraker = useMoonrakerStore()
      const firstPage = Array.from({ length: windowPageSize }, (_unused, index) =>
        job({ job_id: `page1-${index}` }),
      )
      let call = 0
      vi.spyOn(moonraker, 'rpcCall').mockImplementation((async (method: string) => {
        if (method === 'server.history.totals') return totals
        if (method === 'server.history.list') {
          call += 1
          if (call === 1) return { count: firstPage.length, jobs: firstPage }
          return { count: 1, jobs: [job({ job_id: 'page2-0' })] }
        }
        return {}
      }) as never)
      const history = useHistoryStore()

      await history.refreshWindow()

      expect(history.windowJobs).toHaveLength(windowPageSize + 1)
      expect(history.windowJobs[history.windowJobs.length - 1]).toMatchObject({ id: 'page2-0' })
    })
  })

  describe('auxiliary data', () => {
    it('reads a per-job auxiliary value that is an id list', async () => {
      mockRpc([
        job({
          auxiliary_data: [
            {
              description: 'Spool IDs used',
              name: 'spool_ids',
              provider: 'spoolman',
              units: null,
              value: [3],
            },
          ],
        }),
      ])
      const history = useHistoryStore()

      await history.refresh()

      expect(history.jobs[0]!.auxiliaryData).toEqual([
        {
          provider: 'spoolman',
          field: 'spool_ids',
          description: 'Spool IDs used',
          units: null,
          value: [3],
        },
      ])
    })

    it('reads lifetime auxiliary totals alongside the job totals', async () => {
      const moonraker = useMoonrakerStore()
      vi.spyOn(moonraker, 'rpcCall').mockImplementation((async (method: string) => {
        if (method === 'server.history.totals') {
          return {
            ...totals,
            auxiliary_totals: [
              { field: 'energy_wh', provider: 'sensor power', maximum: 500, total: 12400 },
            ],
          }
        }
        if (method === 'server.history.list') return { count: 1, jobs: [job()] }
        return {}
      }) as never)
      const history = useHistoryStore()

      await history.refresh()

      expect(history.totals.auxiliaryTotals).toEqual([
        { provider: 'sensor power', field: 'energy_wh', maximum: 500, total: 12400 },
      ])
    })

    it('drops a malformed auxiliary entry rather than throwing', async () => {
      mockRpc([job({ auxiliary_data: [null, 'not an object', { name: 'ok', value: 4 }] })])
      const history = useHistoryStore()

      await history.refresh()

      expect(history.jobs[0]!.auxiliaryData).toHaveLength(1)
      expect(history.jobs[0]!.auxiliaryData[0]).toMatchObject({ field: 'ok', value: 4 })
    })
  })

  /**
   * The window refetch this used to trigger is the expensive read on the whole
   * surface — 263 KB and 125 ms against a real printer's 90-day period — and
   * the notification carries the job that changed, so none of these assertions
   * are about a nicety. `jobs` keeping its extra pages is the same fact from
   * the user's side: pressing "Load more" four times and then starting a print
   * must not put the list back to page one.
   */
  describe('applying a history-changed notification', () => {
    function startWithNotifications() {
      const moonraker = useMoonrakerStore()
      const handlers: Array<(notification: unknown) => void> = []
      vi.spyOn(moonraker, 'onNotification').mockImplementation(((
        name: string,
        handler: (notification: unknown) => void,
      ) => {
        if (name === 'notify_history_changed') handlers.push(handler)
        return () => undefined
      }) as never)
      return { handlers }
    }

    function changed(action: string, payloadJob: unknown) {
      return {
        jsonrpc: '2.0',
        method: 'notify_history_changed',
        params: [{ action, job: payloadJob }],
      }
    }

    it('adds the job it was sent without re-reading the list or the window', async () => {
      const rpcCall = mockRpc([job()])
      const { handlers } = startWithNotifications()
      const history = useHistoryStore()

      history.start()
      await Promise.resolve()
      await Promise.resolve()
      rpcCall.mockClear()

      handlers[0]!(changed('added', job({ job_id: '000002', filename: 'prints/next.gcode' })))
      await Promise.resolve()

      const methods = rpcCall.mock.calls.map((call) => call[0])
      expect(methods).not.toContain('server.history.list')
      expect(methods).toContain('server.history.totals')
      expect(history.jobs.map((entry) => entry.id)).toEqual(['000002', '000001'])
      expect(history.windowJobs.map((entry) => entry.id)).toEqual(['000002', '000001'])
      history.stop()
    })

    it('replaces the record in place when the same job finishes', async () => {
      mockRpc([job()])
      const { handlers } = startWithNotifications()
      const history = useHistoryStore()

      history.start()
      await Promise.resolve()
      await Promise.resolve()

      handlers[0]!(
        changed('added', job({ job_id: '000002', status: 'in_progress', end_time: null })),
      )
      await Promise.resolve()
      expect(history.jobs[0]).toMatchObject({ id: '000002', outcome: 'unknown' })

      handlers[0]!(changed('finished', job({ job_id: '000002', status: 'completed' })))
      await Promise.resolve()

      expect(history.jobs).toHaveLength(2)
      expect(history.jobs[0]).toMatchObject({ id: '000002', outcome: 'completed' })
      history.stop()
    })

    /**
     * The list offset `loadMore` passes is `jobs.length`, so an inserted job
     * has to leave that equal to the number of records the server holds ahead
     * of the next page — otherwise the next page arrives one job short or one
     * job duplicated.
     */
    it('keeps loadMore asking for the right offset after an insertion', async () => {
      const firstPage = Array.from({ length: historyPageSize }, (_unused, index) =>
        job({ job_id: `page1-${index}` }),
      )
      const rpcCall = mockRpc(firstPage, historyPageSize)
      const { handlers } = startWithNotifications()
      const history = useHistoryStore()

      history.start()
      await Promise.resolve()
      await Promise.resolve()
      expect(history.hasMore).toBe(true)

      handlers[0]!(changed('added', job({ job_id: 'fresh' })))
      await Promise.resolve()
      rpcCall.mockClear()

      await history.loadMore()

      const listCall = rpcCall.mock.calls.find((call) => call[0] === 'server.history.list')
      expect(listCall?.[1]).toMatchObject({ start: historyPageSize + 1 })
      history.stop()
    })

    it('falls back to re-reading both when the payload is not a job change', async () => {
      const rpcCall = mockRpc([job()])
      const { handlers } = startWithNotifications()
      const history = useHistoryStore()

      history.start()
      await Promise.resolve()
      await Promise.resolve()
      rpcCall.mockClear()

      handlers[0]!(changed('rearranged', null))
      await Promise.resolve()

      expect(rpcCall.mock.calls.map((call) => call[0])).toContain('server.history.list')
      history.stop()
    })
  })
})
