import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { i18n } from '@/i18n'
import { useAvailabilityStore } from '@/stores/availability'
import { useConfirmationsStore } from '@/stores/confirmations'
import { useHistoryStore } from '@/stores/history'
import { useJobQueueStore } from '@/stores/jobQueue'
import { useMaintenanceStore } from '@/stores/maintenance'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import PrintFilesView from '@/views/PrintFilesView.vue'

enableAutoUnmount(afterEach)

beforeAll(() => {
  // jsdom ships <dialog> without its modal methods, so the shared dialog's
  // open/close watcher has nothing to call — see SettingsView.spec.ts, the
  // first place this was worked around.
  const dialogPrototype = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>
  if (typeof dialogPrototype.showModal !== 'function') {
    dialogPrototype.showModal = function showModal(this: HTMLDialogElement): void {
      this.open = true
    }
    dialogPrototype.close = function close(this: HTMLDialogElement): void {
      this.open = false
    }
  }
})

function testRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'overview', component: { template: '<div />' } },
      { path: '/print-files', name: 'printFiles', component: { template: '<div />' } },
    ],
  })
}

const directory = {
  dirs: [{ dirname: 'calibration', modified: 5, size: 0, permissions: 'rw' }],
  files: [
    { filename: 'cube.gcode', modified: 20, size: 2048, permissions: 'rw' },
    { filename: 'benchy.gcode', modified: 10, size: 4096, permissions: 'rw' },
  ],
  disk_usage: { total: 1000, used: 400, free: 600 },
  root_info: { name: 'gcodes', permissions: 'rw' },
}

let pinia: Pinia

async function mountView() {
  const router = testRouter()
  await router.push('/print-files')
  const view = mount(PrintFilesView, { global: { plugins: [i18n, pinia, router] } })
  await flushPromises()
  return view
}

beforeEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  pinia = createPinia()
  setActivePinia(pinia)
  const moonraker = useMoonrakerStore(pinia)
  moonraker.connectionPhase = 'connected'
  useAvailabilityStore(pinia).moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
  vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(directory as never)
  const printer = usePrinterStore(pinia)
  vi.spyOn(printer, 'refreshFiles').mockResolvedValue(true)
  vi.spyOn(printer, 'loadMetadata').mockResolvedValue({
    filename: 'cube.gcode',
    estimated_time: 5400,
    filament_total: 4200,
    layer_height: 0.2,
    object_height: 30,
    slicer: 'OrcaSlicer',
  })
})

function fileToggles(view: Awaited<ReturnType<typeof mountView>>) {
  return view.findAll('.print-file .machine-row__toggle')
}

async function openCube(view: Awaited<ReturnType<typeof mountView>>): Promise<void> {
  await fileToggles(view)[0]!.trigger('click')
  await flushPromises()
}

describe('Print files view', () => {
  it('lists folders, then files newest first, as file-select rows', async () => {
    const view = await mountView()

    const folders = view.findAll('.print-folder')
    expect(folders).toHaveLength(1)
    expect(folders[0]!.text()).toContain('calibration')

    // Newest first by default, named without the `.gcode` every row would repeat.
    const names = view.findAll('.print-file .machine-row__name').map((name) => name.text())
    expect(names).toEqual(['cube', 'benchy'])

    // Composed on the documented shared pattern rather than a parallel one.
    for (const toggle of view.findAll('.machine-row__toggle')) {
      expect(toggle.classes()).toContain('file-select')
    }
  })

  it('opens nothing until a file is chosen', async () => {
    const view = await mountView()

    expect(view.find('.machine-row-expansion').exists()).toBe(false)
  })

  it('shows what the slicer said about the chosen file beneath its own row', async () => {
    const view = await mountView()

    await openCube(view)

    const expansion = view.get('.machine-row-expansion')
    // 5400 s and 4200 mm, in the units a person reads.
    expect(expansion.text()).toContain('1h 30m')
    expect(expansion.text()).toContain('4.2 m')
    expect(expansion.text()).toContain('OrcaSlicer')
    expect(expansion.attributes('id')).toBe('print-file-details')
  })

  it('marks the open row as one item with its details, not as a selection held elsewhere', async () => {
    const view = await mountView()

    await openCube(view)

    const open = view.findAll('.machine-row--open')
    expect(open).toHaveLength(1)
    expect(open[0]!.text()).toContain('cube')
    expect(open[0]!.classes()).not.toContain('selection-row')
    expect(fileToggles(view)[0]!.attributes('aria-expanded')).toBe('true')

    // Chosen again, it closes.
    await fileToggles(view)[0]!.trigger('click')
    await flushPromises()
    expect(view.find('.machine-row-expansion').exists()).toBe(false)
  })

  it('starts the chosen file, passing the path Klipper takes', async () => {
    const printer = usePrinterStore(pinia)
    const startPrint = vi.spyOn(printer, 'startPrint').mockResolvedValue(true)
    const view = await mountView()

    await openCube(view)
    await view.get('.print-file__start').trigger('click')

    expect(startPrint).toHaveBeenCalledWith('cube.gcode')
  })

  it("offers print and queue from a row's menu without opening it", async () => {
    const printer = usePrinterStore(pinia)
    const startPrint = vi.spyOn(printer, 'startPrint').mockResolvedValue(true)
    const jobQueue = useJobQueueStore(pinia)
    const addJob = vi.spyOn(jobQueue, 'addJob').mockResolvedValue(true)
    const view = await mountView()

    const row = view.findAll('.print-file')[1]!
    await row.get('.machine-row__menu > .button').trigger('click')
    await row.get('.print-file__queue').trigger('click')
    await flushPromises()
    expect(addJob).toHaveBeenCalledWith('benchy.gcode')

    await row.get('.machine-row__menu > .button').trigger('click')
    await row.get('.print-file__print').trigger('click')
    expect(startPrint).toHaveBeenCalledWith('benchy.gcode')
  })

  /**
   * On a phone the queue card sits above the list and out of view, so the
   * control confirms on itself for a second afterwards.
   */
  it('confirms an enqueue on the button that did it, then gives the button back', async () => {
    vi.useFakeTimers()
    try {
      const jobQueue = useJobQueueStore(pinia)
      vi.spyOn(jobQueue, 'addJob').mockResolvedValue(true)
      const view = await mountView()

      await openCube(view)
      const queueButton = view.get('.print-file__enqueue')
      await queueButton.trigger('click')
      await flushPromises()

      expect(queueButton.text()).toContain('Added to queue')
      expect(queueButton.attributes('data-cooldown')).toBe('true')
      expect(queueButton.find('.button__cooldown').attributes('style')).toContain('1000ms')

      vi.advanceTimersByTime(1000)
      await flushPromises()
      expect(queueButton.text()).toContain('Add to queue')
      expect(queueButton.attributes('data-cooldown')).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('says nothing when the queue refused the file', async () => {
    // `addJob` reports a refusal by returning false rather than throwing, so a
    // control that confirms on having called it confirms a command that failed.
    const jobQueue = useJobQueueStore(pinia)
    vi.spyOn(jobQueue, 'addJob').mockResolvedValue(false)
    const view = await mountView()

    await openCube(view)
    const queueButton = view.get('.print-file__enqueue')
    await queueButton.trigger('click')
    await flushPromises()

    expect(queueButton.text()).toContain('Add to queue')
    expect(queueButton.attributes('data-cooldown')).toBeUndefined()
  })

  /**
   * Klipper refuses a second print, so the button says so before the user finds
   * out from a failed command. Browsing and uploading stay available: reading the
   * list during a print is ordinary.
   */
  it('refuses to start a second print while one is running, and says why', async () => {
    const printer = usePrinterStore(pinia)
    vi.spyOn(printer, 'hasActivePrint', 'get').mockReturnValue(true)
    const startPrint = vi.spyOn(printer, 'startPrint').mockResolvedValue(true)
    const view = await mountView()

    await openCube(view)

    expect(view.get('.print-file__start').attributes('disabled')).toBeDefined()
    expect(view.get('.machine-row-expansion').text()).toContain('A print is already running.')
    expect(startPrint).not.toHaveBeenCalled()
  })

  describe('the pre-print maintenance reminder', () => {
    function seedOverdueInterval(): void {
      const history = useHistoryStore(pinia)
      const maintenance = useMaintenanceStore(pinia)
      maintenance.addInterval('Belt tension', 'printtime', 10)
      history.totals = { ...history.totals, printTime: 11 * 3600 }
    }

    it('starts printing immediately while the reminder is off, which is the default', async () => {
      const printer = usePrinterStore(pinia)
      const startPrint = vi.spyOn(printer, 'startPrint').mockResolvedValue(true)
      seedOverdueInterval()
      const view = await mountView()

      await openCube(view)
      await view.get('.print-file__start').trigger('click')

      expect(startPrint).toHaveBeenCalledWith('cube.gcode')
      expect(view.find('dialog[open]').exists()).toBe(false)
    })

    it('asks before starting once the reminder is on and something is overdue', async () => {
      const printer = usePrinterStore(pinia)
      const startPrint = vi.spyOn(printer, 'startPrint').mockResolvedValue(true)
      useConfirmationsStore(pinia).setMaintenanceReminderEnabled(true)
      seedOverdueInterval()
      const view = await mountView()

      await openCube(view)
      await view.get('.print-file__start').trigger('click')

      expect(startPrint).not.toHaveBeenCalled()
      expect(view.text()).toContain('Maintenance is overdue')
      expect(view.text()).toContain('Belt tension')
    })

    it('starts the file it was asked about on "Start anyway", and quiets the reminder until tomorrow', async () => {
      const printer = usePrinterStore(pinia)
      const startPrint = vi.spyOn(printer, 'startPrint').mockResolvedValue(true)
      const confirmations = useConfirmationsStore(pinia)
      confirmations.setMaintenanceReminderEnabled(true)
      seedOverdueInterval()
      const view = await mountView()

      // Asked from a row's menu, with no row open: the reminder still knows which file.
      const row = view.findAll('.print-file')[1]!
      await row.get('.machine-row__menu > .button').trigger('click')
      await row.get('.print-file__print').trigger('click')

      const startAnyway = view.findAll('button').find((button) => button.text() === 'Start anyway')
      await startAnyway?.trigger('click')

      expect(startPrint).toHaveBeenCalledWith('benchy.gcode')
      expect(confirmations.shouldShowMaintenanceReminder()).toBe(false)
    })

    it('declines to print and snoozes for a week on "Not now"', async () => {
      const printer = usePrinterStore(pinia)
      const startPrint = vi.spyOn(printer, 'startPrint').mockResolvedValue(true)
      const confirmations = useConfirmationsStore(pinia)
      confirmations.setMaintenanceReminderEnabled(true)
      seedOverdueInterval()
      const view = await mountView()
      await openCube(view)
      await view.get('.print-file__start').trigger('click')

      const notNow = view.findAll('button').find((button) => button.text() === 'Not now')
      await notNow?.trigger('click')

      expect(startPrint).not.toHaveBeenCalled()
      expect(confirmations.shouldShowMaintenanceReminder()).toBe(false)
    })
  })

  it('navigates into a folder and back out through the trail in the card title', async () => {
    const view = await mountView()

    await view.get('.print-folder .machine-row__toggle').trigger('click')
    await flushPromises()

    const trail = view.get('.print-files-trail')
    expect(trail.get('[aria-current="location"]').text()).toBe('calibration')
    const root = trail.findAll('button').find((button) => button.text() === 'All files')
    await root!.trigger('click')
    await flushPromises()

    expect(view.get('.print-files-trail').text()).toBe('All files')
  })

  it('narrows the list as the reader types, and says when nothing matches', async () => {
    const view = await mountView()

    await view.get('.print-files-summary input[type="search"]').setValue('bench')
    expect(view.findAll('.print-file .machine-row__name').map((name) => name.text())).toEqual([
      'benchy',
    ])

    await view.get('.print-files-summary input[type="search"]').setValue('nothing-like-it')
    expect(view.text()).toContain('No files match the search.')
  })

  it('shows the queue beside the files, with a way to remove each job', async () => {
    const jobQueue = useJobQueueStore(pinia)
    jobQueue.jobs = [{ filename: 'benchy.gcode', job_id: 'j1', time_added: 1, time_in_queue: 1 }]
    jobQueue.queueState = 'paused'
    const removeJob = vi.spyOn(jobQueue, 'removeJob').mockResolvedValue(true)
    const view = await mountView()

    const panel = view.get('.print-queue-panel')
    expect(panel.get('.machine-panel-summary').text()).toContain('Paused')
    expect(panel.get('.machine-row__name').text()).toBe('benchy')

    await panel.get('[aria-label="Remove benchy from the queue"]').trigger('click')
    expect(removeJob).toHaveBeenCalledWith('j1')
  })

  it('says the folder is empty rather than showing an empty list', async () => {
    const moonraker = useMoonrakerStore(pinia)
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({
      ...directory,
      dirs: [],
      files: [],
    } as never)
    const view = await mountView()

    expect(view.text()).toContain('No print files in this folder.')
  })
})
