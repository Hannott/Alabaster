import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { i18n } from '@/i18n'
import { useAvailabilityStore } from '@/stores/availability'
import { useConfirmationsStore } from '@/stores/confirmations'
import { useHistoryStore } from '@/stores/history'
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

describe('Print files view', () => {
  it('lists folders and printable files as file-select rows', async () => {
    const view = await mountView()

    const rows = view.findAll('.print-files-row')
    // The parent row is absent at the root: there is nowhere above it to go.
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.text())).toEqual([
      expect.stringContaining('calibration'),
      expect.stringContaining('cube.gcode'),
      expect.stringContaining('benchy.gcode'),
    ])

    // Composed on the documented shared pattern rather than a parallel one.
    for (const row of rows) expect(row.classes()).toContain('file-select')
  })

  it('shows no detail pane until a file is chosen', async () => {
    const view = await mountView()

    expect(view.find('.print-files-detail').exists()).toBe(false)
  })

  it('shows what the slicer said about the chosen file', async () => {
    const view = await mountView()

    await view.findAll('.print-files-row')[1]!.trigger('click')
    await flushPromises()

    const detail = view.find('.print-files-detail')
    expect(detail.exists()).toBe(true)
    expect(detail.text()).toContain('cube.gcode')
    // 5400 s and 4200 mm, in the units a person reads.
    expect(detail.text()).toContain('1h 30m')
    expect(detail.text()).toContain('4.2 m')
    expect(detail.text()).toContain('OrcaSlicer')
  })

  it('marks the chosen row rather than leaving the selection only in the pane', async () => {
    const view = await mountView()

    await view.findAll('.print-files-row')[1]!.trigger('click')
    await flushPromises()

    const selected = view.findAll('.print-files-row--selected')
    expect(selected).toHaveLength(1)
    expect(selected[0]!.text()).toContain('cube.gcode')
    expect(selected[0]!.attributes('aria-current')).toBe('true')
  })

  it('starts the chosen file, passing the path Klipper takes', async () => {
    const printer = usePrinterStore(pinia)
    const startPrint = vi.spyOn(printer, 'startPrint').mockResolvedValue(true)
    const view = await mountView()

    await view.findAll('.print-files-row')[1]!.trigger('click')
    await flushPromises()
    await view.find('.print-files-detail__actions button').trigger('click')

    expect(startPrint).toHaveBeenCalledWith('cube.gcode')
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

    await view.findAll('.print-files-row')[1]!.trigger('click')
    await flushPromises()

    const printButton = view.find('.print-files-detail__actions button')
    expect(printButton.attributes('disabled')).toBeDefined()
    expect(view.find('.print-files-detail').text()).toContain('A print is already running.')
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

      await view.findAll('.print-files-row')[1]!.trigger('click')
      await flushPromises()
      await view.find('.print-files-detail__actions button').trigger('click')

      expect(startPrint).toHaveBeenCalledWith('cube.gcode')
      expect(view.find('dialog[open]').exists()).toBe(false)
    })

    it('asks before starting once the reminder is on and something is overdue', async () => {
      const printer = usePrinterStore(pinia)
      const startPrint = vi.spyOn(printer, 'startPrint').mockResolvedValue(true)
      useConfirmationsStore(pinia).setMaintenanceReminderEnabled(true)
      seedOverdueInterval()
      const view = await mountView()

      await view.findAll('.print-files-row')[1]!.trigger('click')
      await flushPromises()
      await view.find('.print-files-detail__actions button').trigger('click')

      expect(startPrint).not.toHaveBeenCalled()
      expect(view.text()).toContain('Maintenance is overdue')
      expect(view.text()).toContain('Belt tension')
    })

    it('starts the print and quiets the reminder until tomorrow on "Start anyway"', async () => {
      const printer = usePrinterStore(pinia)
      const startPrint = vi.spyOn(printer, 'startPrint').mockResolvedValue(true)
      const confirmations = useConfirmationsStore(pinia)
      confirmations.setMaintenanceReminderEnabled(true)
      seedOverdueInterval()
      const view = await mountView()
      await view.findAll('.print-files-row')[1]!.trigger('click')
      await flushPromises()
      await view.find('.print-files-detail__actions button').trigger('click')

      const startAnyway = view.findAll('button').find((button) => button.text() === 'Start anyway')
      await startAnyway?.trigger('click')

      expect(startPrint).toHaveBeenCalledWith('cube.gcode')
      expect(confirmations.shouldShowMaintenanceReminder()).toBe(false)
    })

    it('declines to print and snoozes for a week on "Not now"', async () => {
      const printer = usePrinterStore(pinia)
      const startPrint = vi.spyOn(printer, 'startPrint').mockResolvedValue(true)
      const confirmations = useConfirmationsStore(pinia)
      confirmations.setMaintenanceReminderEnabled(true)
      seedOverdueInterval()
      const view = await mountView()
      await view.findAll('.print-files-row')[1]!.trigger('click')
      await flushPromises()
      await view.find('.print-files-detail__actions button').trigger('click')

      const notNow = view.findAll('button').find((button) => button.text() === 'Not now')
      await notNow?.trigger('click')

      expect(startPrint).not.toHaveBeenCalled()
      expect(confirmations.shouldShowMaintenanceReminder()).toBe(false)
    })
  })

  it('offers folder navigation into a subfolder and back out of it', async () => {
    const view = await mountView()

    await view.findAll('.print-files-row')[0]!.trigger('click')
    await flushPromises()

    expect(view.text()).toContain('calibration')
    const rows = view.findAll('.print-files-row')
    // Inside a folder the first row goes back up.
    expect(rows[0]!.text()).toContain('Up one level')
  })

  it('says the folder is empty rather than showing an empty table', async () => {
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
