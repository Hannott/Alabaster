import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'
import { useAvailabilityStore } from '@/stores/availability'
import { useHistoryStore, type HistoryJob } from '@/stores/history'
import { useJobQueueStore } from '@/stores/jobQueue'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { usePrinterStore } from '@/stores/printer'
import HistoryView from '@/views/HistoryView.vue'

function job(overrides: Partial<HistoryJob> = {}): HistoryJob {
  return {
    id: '1',
    filename: 'cube.gcode',
    outcome: 'completed',
    startedAt: 1_700_000_000,
    endedAt: 1_700_003_600,
    printDuration: 3600,
    totalDuration: 4000,
    filamentUsed: 5000,
    fileExists: true,
    auxiliaryData: [],
    details: {
      estimatedTime: null,
      filamentType: null,
      filamentName: null,
      filamentWeight: null,
      layerHeight: null,
      objectHeight: null,
      slicer: null,
      thumbnailSmall: null,
      thumbnailLarge: null,
    },
    ...overrides,
  }
}

function mountView() {
  const printer = usePrinterStore()
  vi.spyOn(printer, 'refreshFiles').mockResolvedValue(true)
  return mount(HistoryView, {
    global: { plugins: [i18n] },
  })
}

describe('HistoryView', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('shows occupied time and the heat-up it implies on the lifetime strip, and no success rate there', () => {
    const history = useHistoryStore()
    history.totals = {
      jobs: 10,
      totalTime: 40000,
      printTime: 36000,
      filamentUsed: 120000,
      longestJob: 8000,
      longestPrint: 7200,
      auxiliaryTotals: [],
    }
    const wrapper = mountView()

    const strip = wrapper.get('.history-lifetime')
    expect(strip.text()).toContain('Occupied')
    // 40,000 s occupied against 36,000 s printing: 1h 7m of heat-up and pauses, 10%.
    const overhead = strip
      .findAll('.machine-stat')
      .find((cell) => cell.text().includes('Heat-up and pauses'))
    expect(overhead?.get('.machine-stat__value').text().replace(/\s+/g, '')).toBe('1h7m')
    expect(overhead?.text()).toContain('10% of occupied time')
    expect(strip.text()).not.toContain('Success rate')
  })

  it('states the typical print and the estimate gap over the completed jobs they were measured on', () => {
    const history = useHistoryStore()
    history.windowJobs = [
      job({ id: '1', printDuration: 1100, details: { ...job().details, estimatedTime: 1000 } }),
      job({ id: '2', printDuration: 1300, details: { ...job().details, estimatedTime: 1000 } }),
      job({ id: '3', printDuration: 2400 }),
      job({ id: '4', outcome: 'cancelled', printDuration: 50 }),
    ]
    const wrapper = mountView()

    const cells = wrapper.findAll('.history-stats-panel .machine-stat')
    const typical = cells.find((cell) => cell.text().includes('Typical print'))
    expect(typical?.text()).toContain('Median of 3 completed')
    const estimate = cells.find((cell) => cell.text().includes('Against estimate'))
    expect(estimate?.get('.machine-stat__value').text().replace(/\s+/g, '')).toBe('+20%')
    expect(estimate?.text()).toContain('median of 2')
  })

  it('groups jobs under the day they ended, so a row only needs its time', () => {
    const history = useHistoryStore()
    const now = Math.floor(Date.now() / 1000)
    history.jobs = [
      job({ id: '1', filename: 'today.gcode', startedAt: now - 600, endedAt: now }),
      job({ id: '2', filename: 'old.gcode', startedAt: 1_700_000_000, endedAt: 1_700_003_600 }),
    ]
    const wrapper = mountView()

    const labels = wrapper.findAll('.history-jobs-panel .machine-list__label').map((l) => l.text())
    expect(labels[0]).toBe('Today')
    expect(labels).toHaveLength(2)
  })

  it('renders one outcome row per outcome present, with jobs, share, filament and time', () => {
    const history = useHistoryStore()
    history.windowJobs = [
      job({ id: '1', outcome: 'completed', filamentUsed: 1000, printDuration: 100 }),
      job({ id: '2', outcome: 'completed', filamentUsed: 1000, printDuration: 100 }),
      job({ id: '3', outcome: 'cancelled', filamentUsed: 500, printDuration: 50 }),
    ]
    const wrapper = mountView()

    const rows = wrapper.findAll('.history-outcome-table .module-table__row')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.text()).toContain('Completed')
    expect(rows[0]?.text()).toContain('67%')
    expect(rows[1]?.text()).toContain('Cancelled')
    expect(rows[1]?.text()).toContain('33%')
  })

  it('recomputes share when the measure toggle changes, without refetching', async () => {
    const history = useHistoryStore()
    history.windowJobs = [
      job({ id: '1', outcome: 'completed', filamentUsed: 9000, printDuration: 100 }),
      job({ id: '2', outcome: 'cancelled', filamentUsed: 1000, printDuration: 100 }),
    ]
    const wrapper = mountView()

    const completedRowBefore = wrapper.findAll('.history-outcome-table .module-table__row')[0]
    expect(completedRowBefore?.text()).toContain('50%')

    const filamentButton = wrapper
      .findAll('button')
      .find(
        (button) => button.text() === 'Filament' && button.attributes('aria-pressed') !== undefined,
      )
    expect(filamentButton).toBeDefined()
    await filamentButton?.trigger('click')

    const completedRowAfter = wrapper.findAll('.history-outcome-table .module-table__row')[0]
    expect(completedRowAfter?.text()).toContain('90%')
  })

  it('asks the store for a new period when a period button is pressed', async () => {
    const history = useHistoryStore()
    const setPeriod = vi.spyOn(history, 'setPeriod')
    const wrapper = mountView()

    const thirtyDayButton = wrapper.findAll('button').find((button) => button.text() === '30 days')
    expect(thirtyDayButton).toBeDefined()
    await thirtyDayButton?.trigger('click')

    expect(setPeriod).toHaveBeenCalledWith('30d')
  })

  it('shows an empty message rather than a table with nothing in it', () => {
    const history = useHistoryStore()
    history.windowJobs = []
    const wrapper = mountView()

    expect(wrapper.find('.history-outcome-table').exists()).toBe(false)
    expect(wrapper.text()).toContain('No jobs in this period.')
  })

  it('reports a failed statistics fetch independently of the job list', () => {
    const history = useHistoryStore()
    history.windowFailed = true
    const wrapper = mountView()

    expect(wrapper.text()).toContain('The statistics window could not be read')
  })

  it('renders the trend chart once the window has jobs', () => {
    const history = useHistoryStore()
    history.windowJobs = [job()]
    const wrapper = mountView()

    expect(wrapper.find('.history-trend').exists()).toBe(true)
  })

  it('lists the completed-job length distribution, excluding cancelled jobs', () => {
    const history = useHistoryStore()
    history.windowJobs = [
      job({ id: '1', outcome: 'completed', printDuration: 3600 }),
      job({ id: '2', outcome: 'cancelled', printDuration: 999_999 }),
    ]
    const wrapper = mountView()

    const rows = wrapper.findAll('.history-distribution__row')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.text()).toContain('1 jobs')
  })

  it('shows which spool printed a job in its details, once its row is opened', async () => {
    const history = useHistoryStore()
    history.jobs = [
      job({
        auxiliaryData: [
          {
            provider: 'spoolman',
            field: 'spool_ids',
            description: 'Spool IDs used',
            units: null,
            value: [3],
          },
        ],
      }),
    ]
    const wrapper = mountView()

    expect(wrapper.find('.machine-row-expansion').exists()).toBe(false)
    await wrapper.get('.machine-row__toggle').trigger('click')

    expect(wrapper.get('.machine-row-facts').text()).toContain('Spool 3')
  })

  it('opens the clicked job beneath its own row, and closes it when chosen again', async () => {
    const history = useHistoryStore()
    history.jobs = [
      job({ id: '1', filename: 'first.gcode' }),
      job({ id: '2', filename: 'second.gcode' }),
    ]
    const wrapper = mountView()

    const toggles = wrapper.findAll('.machine-row__toggle')
    await toggles[1]!.trigger('click')

    const expansion = wrapper.get('.machine-row-expansion')
    expect(expansion.attributes('id')).toBe('history-job-2')
    expect(toggles[1]!.attributes('aria-expanded')).toBe('true')

    await toggles[1]!.trigger('click')
    expect(wrapper.find('.machine-row-expansion').exists()).toBe(false)
  })

  it('queues the opened job for printing again from its details', async () => {
    useAvailabilityStore().moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const history = useHistoryStore()
    history.jobs = [job({ filename: 'prints/cube.gcode' })]
    const jobQueue = useJobQueueStore()
    const addJob = vi.spyOn(jobQueue, 'addJob').mockResolvedValue(true)
    const wrapper = mountView()

    await wrapper.get('.machine-row__toggle').trigger('click')
    const queueButton = wrapper.findAll('button').find((button) => button.text() === 'Add to queue')
    expect(queueButton).toBeDefined()
    await queueButton?.trigger('click')

    expect(addJob).toHaveBeenCalledWith('prints/cube.gcode')
  })

  it('confirms the enqueue on the button, and drops it when another job is picked', async () => {
    // The queue is a card on another page and this pane does not move, so a
    // successful post looks exactly like a refused one from here.
    useAvailabilityStore().moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const history = useHistoryStore()
    history.jobs = [job({ filename: 'prints/cube.gcode' }), job({ filename: 'prints/cone.gcode' })]
    const jobQueue = useJobQueueStore()
    vi.spyOn(jobQueue, 'addJob').mockResolvedValue(true)
    const wrapper = mountView()

    await wrapper.findAll('.machine-row__toggle')[0]!.trigger('click')
    const queueButton = wrapper.findAll('button').find((button) => button.text() === 'Add to queue')
    await queueButton?.trigger('click')
    await flushPromises()
    expect(queueButton?.text()).toBe('Added to queue')
    expect(queueButton?.attributes('data-cooldown')).toBe('true')

    // A confirmation names the job that was on screen when it was earned.
    await wrapper.findAll('.machine-row__toggle')[1]!.trigger('click')
    const reopened = wrapper.findAll('button').find((button) => button.text() === 'Add to queue')
    expect(reopened?.attributes('data-cooldown')).toBeUndefined()
  })

  it('reads an aggregate auxiliary field back through its sensor declaration', () => {
    const history = useHistoryStore()
    history.totals = {
      jobs: 1,
      totalTime: 0,
      printTime: 0,
      filamentUsed: 0,
      longestJob: 0,
      longestPrint: 0,
      auxiliaryTotals: [
        { provider: 'sensor power_meter', field: 'energy_wh', maximum: 500, total: 12400 },
      ],
    }
    const printerConfig = usePrinterConfigStore()
    printerConfig.settings = {
      'sensor power_meter': { history_field_energy_wh: { desc: 'Energy used', units: 'Wh' } },
    }
    const wrapper = mountView()

    const strip = wrapper.get('.history-lifetime')
    expect(strip.text()).toContain('Energy used')
    expect(strip.text()).toContain('12,400 Wh')
  })

  it('gives each outcome its own icon shape, not a shared save/warning split', () => {
    const history = useHistoryStore()
    history.windowJobs = [
      job({ id: '1', outcome: 'completed' }),
      job({ id: '2', outcome: 'cancelled' }),
      job({ id: '3', outcome: 'unknown' }),
      job({ id: '4', outcome: 'error' }),
    ]
    const wrapper = mountView()

    const rows = wrapper.findAll('.history-outcome-table .module-table__row')
    expect(rows).toHaveLength(4)
    // A check for completed, an x for cancelled, a question mark for
    // unknown — only the genuinely problem outcomes keep the warning
    // triangle, per the icon-name-to-outcome mapping `outcomeIcon` encodes.
    // Fixed order is completed, cancelled, interrupted, error, unknown —
    // interrupted has no jobs here and is dropped, so error sorts before
    // unknown.
    expect(rows[0]?.get('svg').html()).toContain('M5 13l4 4L19 7')
    expect(rows[1]?.get('svg').html()).toContain('M6 6l12 12M18 6 6 18')
    expect(rows[2]?.get('svg').html()).toContain('M12 3.5 2.5 20h19Z')
    expect(rows[3]?.get('svg').html()).toContain('cx="12" cy="12" r="9"')
  })

  it('loads more jobs from the end of the list', async () => {
    const history = useHistoryStore()
    history.jobs = [job()]
    history.hasMore = true
    const loadMore = vi.spyOn(history, 'loadMore').mockResolvedValue(true)
    const wrapper = mountView()

    const loadMoreButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Load older jobs')
    expect(loadMoreButton).toBeDefined()
    await loadMoreButton?.trigger('click')
    expect(loadMore).toHaveBeenCalled()
  })

  describe('paging as the end of the list comes into view', () => {
    class FakeObserver {
      static latest: FakeObserver | null = null
      observed: Element[] = []
      observeCalls = 0
      constructor(private readonly callback: IntersectionObserverCallback) {
        FakeObserver.latest = this
      }
      observe(element: Element): void {
        this.observed.push(element)
        this.observeCalls += 1
      }
      unobserve(element: Element): void {
        this.observed = this.observed.filter((entry) => entry !== element)
      }
      disconnect(): void {
        this.observed = []
      }
      report(isIntersecting: boolean): void {
        const entries = this.observed.map((target) => ({ isIntersecting, target }))
        this.callback(
          entries as unknown as IntersectionObserverEntry[],
          this as unknown as IntersectionObserver,
        )
      }
    }

    beforeEach(() => {
      vi.stubGlobal('IntersectionObserver', FakeObserver)
      useAvailabilityStore().moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('asks for one page per sighting, and looks again only after it has landed', async () => {
      const history = useHistoryStore()
      history.jobs = [job()]
      history.hasMore = true
      let finish: (loaded: boolean) => void = () => {}
      const loadMore = vi.spyOn(history, 'loadMore').mockImplementation(() => {
        history.isLoading = true
        return new Promise((resolve) => {
          finish = (loaded) => {
            history.isLoading = false
            resolve(loaded)
          }
        })
      })
      mountView()
      await flushPromises()
      const observer = FakeObserver.latest!
      expect(observer.observed).toHaveLength(1)
      expect(observer.observeCalls).toBe(1)

      observer.report(true)
      await flushPromises()
      expect(loadMore).toHaveBeenCalledTimes(1)

      // The page lands while the observer has said nothing new — a hidden tab,
      // or the frame before the new rows are measured. That must not page again.
      finish(true)
      await flushPromises()
      expect(loadMore).toHaveBeenCalledTimes(1)
      expect(observer.observeCalls).toBe(2)

      observer.report(true)
      await flushPromises()
      expect(loadMore).toHaveBeenCalledTimes(2)
    })

    it('stops paging after a failed read and leaves the retry to the button', async () => {
      const history = useHistoryStore()
      history.jobs = [job()]
      history.hasMore = true
      history.failed = true
      const loadMore = vi.spyOn(history, 'loadMore').mockResolvedValue(false)
      const wrapper = mountView()

      await flushPromises()
      expect(FakeObserver.latest!.observed).toHaveLength(1)
      FakeObserver.latest!.report(true)
      await flushPromises()
      expect(loadMore).not.toHaveBeenCalled()
      expect(wrapper.findAll('button').some((b) => b.text() === 'Load older jobs')).toBe(true)
    })
  })

  it('falls back to the field name when its declaration is gone', () => {
    const history = useHistoryStore()
    history.totals = {
      jobs: 1,
      totalTime: 0,
      printTime: 0,
      filamentUsed: 0,
      longestJob: 0,
      longestPrint: 0,
      auxiliaryTotals: [
        { provider: 'sensor removed', field: 'mystery_reading', maximum: 0, total: 4 },
      ],
    }
    const wrapper = mountView()

    expect(wrapper.get('.history-lifetime').text()).toContain('mystery_reading')
  })
})
