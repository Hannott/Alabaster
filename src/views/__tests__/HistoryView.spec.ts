import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

  it('shows occupied time on the lifetime card, and no longer a success rate there', () => {
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

    const totalsCard = wrapper.get('.history-totals')
    expect(totalsCard.text()).toContain('Time occupied')
    expect(totalsCard.text()).not.toContain('Success rate')
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

  it('shows which spool printed a job in the detail pane, once its row is opened', async () => {
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

    expect(wrapper.find('.history-job-detail').exists()).toBe(false)
    await wrapper.get('.history-job').trigger('click')

    expect(wrapper.get('.history-job-detail__auxiliary').text()).toContain('Spool 3')
  })

  it('opens the detail pane for the clicked job and closes it from its own button', async () => {
    const history = useHistoryStore()
    history.jobs = [
      job({ id: '1', filename: 'first.gcode' }),
      job({ id: '2', filename: 'second.gcode' }),
    ]
    const wrapper = mountView()

    const rows = wrapper.findAll('.history-job')
    await rows[1]!.trigger('click')

    expect(wrapper.get('.history-job-detail').text()).toContain('second.gcode')

    await wrapper.get('[aria-label="Close job details"]').trigger('click')
    expect(wrapper.find('.history-job-detail').exists()).toBe(false)
  })

  it('queues the selected job for printing again from the detail pane', async () => {
    useAvailabilityStore().moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const history = useHistoryStore()
    history.jobs = [job({ filename: 'prints/cube.gcode' })]
    const jobQueue = useJobQueueStore()
    const addJob = vi.spyOn(jobQueue, 'addJob').mockResolvedValue(true)
    const wrapper = mountView()

    await wrapper.get('.history-job').trigger('click')
    const queueButton = wrapper.findAll('button').find((button) => button.text() === 'Add to queue')
    expect(queueButton).toBeDefined()
    await queueButton?.trigger('click')

    expect(addJob).toHaveBeenCalledWith('prints/cube.gcode')
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

    const totalsCard = wrapper.get('.history-totals')
    expect(totalsCard.text()).toContain('Energy used')
    expect(totalsCard.text()).toContain('12,400 Wh')
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

  it('loads more jobs and can scroll back to the top of the page', async () => {
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

    const scrollToTopButton = wrapper.get('[aria-label="Back to top"]')
    const scrollTo = vi.fn()
    // jsdom does not implement scrollTo; the page root is a plain element.
    Object.defineProperty(wrapper.get('.standard-page').element, 'scrollTo', { value: scrollTo })
    await scrollToTopButton.trigger('click')
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }))
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

    expect(wrapper.get('.history-totals').text()).toContain('mystery_reading')
  })
})
