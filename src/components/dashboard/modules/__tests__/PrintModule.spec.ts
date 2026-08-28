import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, nextTick, ref } from 'vue'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import AppIcon from '@/components/AppIcon.vue'
import ExcludeObjectDialog from '@/components/ExcludeObjectDialog.vue'
import PrintModule from '@/components/dashboard/modules/PrintModule.vue'
import {
  dashboardModuleContextKey,
  dashboardModuleHeaderActionKey,
  type DashboardModuleHeaderAction,
} from '@/dashboard/context'
import { i18n } from '@/i18n'
import { useConfirmationsStore } from '@/stores/confirmations'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'
import { useExcludeObjectStore } from '@/stores/excludeObject'
import { useHistoryStore } from '@/stores/history'
import { useJobQueueStore } from '@/stores/jobQueue'
import { useMacrosStore } from '@/stores/macros'
import { useMaintenanceStore } from '@/stores/maintenance'
import { usePrinterStore } from '@/stores/printer'
import { useSpoolStore } from '@/stores/spool'

/**
 * Mounts the module with a stand-in for the card's context, so a test can set the
 * per-card configuration and open the settings layer — neither of which the
 * module can reach on its own, since the card header owns both.
 */
function mountModule(options: { config?: Record<string, unknown>; settingsOpen?: boolean } = {}) {
  const pinia = createPinia()
  const printer = usePrinterStore(pinia)
  const config = ref<Record<string, unknown>>(options.config ?? {})
  const settingsOpen = ref(options.settingsOpen ?? false)
  const headerAction = ref<DashboardModuleHeaderAction | null>(null)

  // The idle card links to File Explorer, and this module is the only one that
  // routes, so the link is stubbed rather than installing a router per test.
  const wrapper = mount(PrintModule, {
    global: {
      plugins: [pinia, i18n],
      stubs: { RouterLink: true },
      provide: {
        [dashboardModuleContextKey as symbol]: {
          instanceId: 'print',
          moduleId: 'print',
          config: computed(() => config.value),
          updateConfig: (patch: Record<string, unknown>) => {
            config.value = { ...config.value, ...patch }
          },
          isSettingsOpen: computed(() => settingsOpen.value),
          openSettings: () => (settingsOpen.value = true),
          closeSettings: () => (settingsOpen.value = false),
        },
        [dashboardModuleHeaderActionKey as symbol]: {
          setHeaderAction: (action: DashboardModuleHeaderAction | null) => {
            headerAction.value = action
          },
        },
      },
    },
  })
  return { printer, wrapper, config, pinia, headerAction }
}

/** Puts the store into a running print with a slicer estimate of one hour. */
function startPrinting(printer: ReturnType<typeof usePrinterStore>) {
  printer.printStats.state = 'printing'
  printer.printStats.filename = 'parts/cube.gcode'
  printer.printStats.printDuration = 1800
  printer.virtualSdcard.progress = 0.5
  printer.currentMetadata = { filename: 'parts/cube.gcode', estimated_time: 3600 }
}

describe('PrintModule', () => {
  beforeAll(() => {
    // jsdom 30 ships <dialog> without its modal methods, so the shared dialog's
    // open/close watcher has nothing to call.
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

  beforeEach(() => {
    window.localStorage.clear()
    vi.useRealTimers()
  })

  it('shows the slicer layer counter, and height only when there is no counter', async () => {
    const { printer, wrapper } = mountModule()
    startPrinting(printer)
    printer.currentMetadata = { filename: 'parts/cube.gcode', object_height: 20 }
    printer.motion.position = [0, 0, 10]
    await flushPromises()

    // Scoped to the stat grid itself, not the whole card: the pause-at-layer
    // prompt's own "Layer" field label is always in the DOM (a closed native
    // <dialog> is still part of the tree jsdom hands back from `.text()`),
    // and it would otherwise collide with this exact assertion.
    const stats = () => wrapper.get('.print-stats')

    // No layer counter reported, so the exact height stands in for it.
    expect(stats().text()).toContain('Height')
    expect(stats().text()).toContain('10.0 / 20.0 mm')
    expect(stats().text()).not.toContain('Layer')

    printer.printStats.currentLayer = 40
    printer.printStats.totalLayer = 80
    await flushPromises()

    // Once the slicer speaks, its own count replaces the height entirely.
    expect(stats().text()).toContain('Layer')
    expect(stats().text()).toContain('40 of 80')
    expect(stats().text()).not.toContain('10.0 / 20.0 mm')
  })

  it('reports the finish as a wall-clock time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-05T12:00:00Z'))
    const { printer, wrapper } = mountModule()
    startPrinting(printer)
    await flushPromises()

    // 3600s estimated, 1800s elapsed: half an hour of printing left.
    expect(wrapper.text()).toContain('Finishes at')
    const expected = new Intl.DateTimeFormat('en', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date('2026-08-05T12:30:00Z'))
    expect(wrapper.text()).toContain(expected)
  })

  it('stays quiet about drift until the print passes the threshold', async () => {
    const { printer, wrapper } = mountModule()
    startPrinting(printer)
    await flushPromises()

    // Half done in half the estimate: exactly on plan, so nothing is said.
    expect(printer.estimateDrift).toBeCloseTo(0)
    expect(wrapper.text()).not.toContain('behind the slicer estimate')
    expect(wrapper.text()).not.toContain('ahead of the slicer estimate')

    // A fifth of the way after half the estimated time is 150% over.
    printer.virtualSdcard.progress = 0.2
    await flushPromises()
    expect(wrapper.text()).toContain('behind the slicer estimate')
  })

  it('moves progress %, the bar and drift together when the filament estimate is selected', async () => {
    const { printer, wrapper } = mountModule({ config: { estimateSource: 'filament' } })
    startPrinting(printer)
    printer.currentMetadata = {
      filename: 'parts/cube.gcode',
      estimated_time: 3600,
      filament_total: 1000,
    }
    printer.printStats.filamentUsed = 200
    await flushPromises()

    // Filament is 20% consumed, so the percentage and bar follow that instead
    // of the 50% file position `startPrinting` set up.
    expect(wrapper.text()).toContain('20%')
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('20')

    // 1800s elapsed at a 20%-implied pace against a 3600s slicer estimate is
    // badly behind, where the file-position basis (50%) read exactly on plan.
    expect(wrapper.text()).toContain('behind the slicer estimate')
  })

  it("reads the slicer's own M73 progress when its estimate is selected, without needing the separate M73 toggle", async () => {
    const { printer, wrapper } = mountModule({ config: { estimateSource: 'slicer' } })
    startPrinting(printer)
    printer.currentMetadata = {
      filename: 'parts/cube.gcode',
      estimated_time: 3600,
      gcode_start_byte: 0,
      gcode_end_byte: 1000,
    }
    printer.virtualSdcard.filePosition = 250
    printer.displayProgress = 0.6
    await flushPromises()

    // File position says 25%; the slicer's own M73 report says 60%. Picking
    // "The slicer estimate" follows the slicer's number on its own.
    expect(wrapper.text()).toContain('60%')
    expect(wrapper.text()).not.toContain('25%')
  })

  /**
   * The speed factor left this card for Movement, whose moves it scales — the
   * same reason the extrusion factor had already left for Extruder. Both halves
   * of one idea sat on cards that did not own either, and this asserts neither
   * comes back: no slider, no reset, and no leftover `M220` error banner, since
   * a card that reports a command it cannot send is reporting someone else's
   * failure.
   */
  it('offers neither speed nor flow, which belong to the cards whose commands they scale', async () => {
    const { printer, wrapper } = mountModule()
    startPrinting(printer)
    printer.motion.speedFactor = 1.5
    printer.motion.extrusionFactor = 1.2
    await flushPromises()

    expect(wrapper.findAll('.app-slider')).toHaveLength(0)
    expect(wrapper.findAll('input[type="range"]')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('Speed')
    expect(wrapper.text()).not.toContain('Flow')
    expect(wrapper.find('[aria-label="Reset Speed factor to its configured value"]').exists()).toBe(
      false,
    )

    printer.lastCommandError = 'speed'
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('keeps the settings panel inset from the card edge, not flush against it', async () => {
    const { wrapper } = mountModule({ settingsOpen: true })
    await flushPromises()

    // On the panel rather than on a wrapper around it: a wrapper's padding sits
    // outside the reveal, so it would hold a gap open while the panel is shut.
    //
    // The shared class rather than the utilities it replaced, so this asserts the
    // intent — Print and Console inset identically — instead of one spelling of
    // it. `interactionConsistency.spec.ts` fails a hand-written inset anywhere.
    const panel = wrapper.get('.module-settings')
    expect(panel.classes()).toContain('module-settings--inset')
  })

  it('uploads a chosen file straight into the start-print confirmation', async () => {
    const { printer, wrapper } = mountModule()
    await flushPromises()

    const uploadPrintFile = vi.spyOn(printer, 'uploadPrintFile').mockResolvedValue('vase.gcode')
    const fileInput = wrapper.get('input[type="file"]')
    const file = new File(['G1 X10'], 'vase.gcode')
    Object.defineProperty(fileInput.element, 'files', { value: [file] })
    await fileInput.trigger('change')
    await flushPromises()

    expect(uploadPrintFile).toHaveBeenCalledWith(file)
    // The same confirmation a recent file would open, not a second dialog for
    // the same decision — uploading is not the risky step, starting is.
    expect(wrapper.text()).toContain('Start printing vase.gcode?')
  })

  it('leaves the file list untouched when an upload fails', async () => {
    const { printer, wrapper } = mountModule()
    vi.spyOn(printer, 'uploadPrintFile').mockResolvedValue(null)
    await flushPromises()

    const fileInput = wrapper.get('input[type="file"]')
    Object.defineProperty(fileInput.element, 'files', { value: [new File(['x'], 'bad.gcode')] })
    await fileInput.trigger('change')
    await flushPromises()

    // The dialog markup is always present; a failed upload must not be the
    // thing that opens it.
    expect(wrapper.get('dialog').element.open).toBe(false)
  })

  it('offers the last printed file for reprinting when idle', async () => {
    const { printer, wrapper } = mountModule()
    // Klipper keeps the filename after the print ends.
    printer.printStats.state = 'complete'
    printer.printStats.filename = 'parts/cube.gcode'
    await flushPromises()

    expect(wrapper.text()).toContain('cube.gcode')
    expect(wrapper.text()).toContain('Print again')
    // And the other files stay reachable beside it: hiding this the moment the
    // printer had printed anything left the one-click path to a *different*
    // recent file available only on a host that had just booted.
    expect(wrapper.text()).toContain('Recent files')

    // The store only starts a listed path, and the list loads lazily, so a
    // reprint has to fetch it before starting.
    const refreshFiles = vi.spyOn(printer, 'refreshFiles').mockResolvedValue(true)
    const startPrint = vi.spyOn(printer, 'startPrint').mockResolvedValue(true)
    await wrapper.get('button.button--primary').trigger('click')
    const confirm = wrapper
      .findAll('.confirm-dialog__actions button')
      .find((button) => button.text() === 'Start print')
    await confirm?.trigger('click')
    await flushPromises()

    expect(refreshFiles).toHaveBeenCalled()
    expect(startPrint).toHaveBeenCalledWith('parts/cube.gcode')
  })

  it('starts immediately, in the danger variant, once its confirmation is turned off', async () => {
    const { printer, wrapper } = mountModule({ config: { skipStartWarning: true } })
    printer.printStats.state = 'complete'
    printer.printStats.filename = 'parts/cube.gcode'
    await flushPromises()

    vi.spyOn(printer, 'refreshFiles').mockResolvedValue(true)
    const startPrint = vi.spyOn(printer, 'startPrint').mockResolvedValue(true)
    const button = wrapper.get('button.button--danger')
    await button.trigger('click')
    await flushPromises()

    expect(startPrint).toHaveBeenCalledWith('parts/cube.gcode')
    expect(wrapper.get('dialog').element.open).toBe(false)
  })

  it('falls back to browsing when the printer has never printed', async () => {
    const { wrapper } = mountModule()
    await flushPromises()

    expect(wrapper.text()).toContain('Start your next print')
    expect(wrapper.text()).toContain('Recent files')
    expect(wrapper.text()).not.toContain('Print again')
    // The explanatory paragraph is gone: an appliance card spends its space on
    // data and actions, not on telling a Klipper owner what a G-code file is.
    expect(wrapper.text()).not.toContain('already stored on the printer')
  })

  it('shows what a finished job cost and clears it back to ready', async () => {
    const { printer, wrapper } = mountModule()
    printer.printStats.state = 'complete'
    printer.printStats.filename = 'parts/cube.gcode'
    printer.printStats.totalDuration = 6300
    printer.printStats.printDuration = 5880
    printer.printStats.filamentUsed = 4235
    await flushPromises()

    expect(wrapper.text()).toContain('Total time')
    expect(wrapper.text()).toContain('1h 45m')
    expect(wrapper.text()).toContain('Printing time')
    expect(wrapper.text()).toContain('1h 38m')
    expect(wrapper.text()).toContain('4.2 m')

    // Clearing unloads the job, which is what returns print_stats to standby.
    const clearPrintStats = vi.spyOn(printer, 'clearPrintStats').mockResolvedValue(true)
    const clear = wrapper.findAll('button').find((button) => button.text() === 'Clear')
    await clear?.trigger('click')
    expect(clearPrintStats).toHaveBeenCalled()
  })

  it('uses the G-code position by default and the slicer figure only when asked', async () => {
    const byteProgress = {
      filename: 'parts/cube.gcode',
      gcode_start_byte: 0,
      gcode_end_byte: 1000,
    }

    const off = mountModule()
    startPrinting(off.printer)
    off.printer.currentMetadata = byteProgress
    off.printer.virtualSdcard.filePosition = 250
    off.printer.displayProgress = 0.6
    await flushPromises()
    expect(off.wrapper.text()).toContain('25%')

    const on = mountModule({ config: { useSlicerProgress: true } })
    startPrinting(on.printer)
    on.printer.currentMetadata = byteProgress
    on.printer.virtualSdcard.filePosition = 250
    on.printer.displayProgress = 0.6
    await flushPromises()
    expect(on.wrapper.text()).toContain('60%')
  })

  it('falls back rather than showing zero when the printer reports no M73', async () => {
    const { printer, wrapper } = mountModule({ config: { useSlicerProgress: true } })
    startPrinting(printer)
    printer.currentMetadata = {
      filename: 'parts/cube.gcode',
      gcode_start_byte: 0,
      gcode_end_byte: 1000,
    }
    printer.virtualSdcard.filePosition = 250
    await flushPromises()

    // Why it fell back is explained in the settings pane, which has its own spec.
    expect(wrapper.text()).toContain('25%')

    printer.displayProgress = 0.6
    await flushPromises()
    expect(wrapper.text()).toContain('60%')
  })

  it('renders the slicer thumbnail only while printing', async () => {
    const { printer, wrapper } = mountModule()
    printer.currentMetadata = {
      filename: 'parts/cube.gcode',
      thumbnails: [{ width: 300, height: 300, size: 900, relative_path: '.thumbs/cube.png' }],
    }
    await flushPromises()
    expect(wrapper.find('.print-thumbnail').exists()).toBe(false)

    startPrinting(printer)
    printer.currentMetadata = {
      filename: 'parts/cube.gcode',
      thumbnails: [{ width: 300, height: 300, size: 900, relative_path: '.thumbs/cube.png' }],
    }
    await flushPromises()

    const thumbnail = wrapper.find('.print-thumbnail')
    expect(thumbnail.exists()).toBe(true)
    expect(thumbnail.attributes('src')).toContain('/server/files/gcodes/parts/.thumbs/cube.png')
  })

  it('expands the thumbnail on click, and collapses it again for the next file', async () => {
    const { printer, wrapper } = mountModule()
    startPrinting(printer)
    printer.currentMetadata = {
      filename: 'parts/cube.gcode',
      thumbnails: [{ width: 300, height: 300, size: 900, relative_path: '.thumbs/cube.png' }],
    }
    await flushPromises()

    const toggle = wrapper.get('[aria-label="Expand the slicer preview"]')
    expect(wrapper.find('.print-thumbnail-toggle--expanded').exists()).toBe(false)

    await toggle.trigger('click')
    expect(wrapper.find('.print-thumbnail-toggle--expanded').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Collapse the slicer preview"]').exists()).toBe(true)

    printer.printStats.filename = 'parts/other.gcode'
    await flushPromises()
    expect(wrapper.find('.print-thumbnail-toggle--expanded').exists()).toBe(false)
  })

  it('offers pause-at-layer and pause-next-layer only once the printer confirms the macro, not merely once it might', async () => {
    const { printer, wrapper, pinia } = mountModule()
    startPrinting(printer)
    await flushPromises()
    expect(wrapper.find('[aria-label="Pause at a layer…"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Pause when this layer finishes"]').exists()).toBe(false)

    const macros = useMacrosStore(pinia)
    macros.allMacroNames = new Set(['SOME_OTHER_MACRO'])
    macros.hasDiscovered = true
    await flushPromises()
    expect(wrapper.find('[aria-label="Pause at a layer…"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Pause when this layer finishes"]').exists()).toBe(false)

    macros.allMacroNames = new Set([
      'SOME_OTHER_MACRO',
      'SET_PAUSE_AT_LAYER',
      'SET_PAUSE_NEXT_LAYER',
    ])
    await flushPromises()
    expect(wrapper.find('[aria-label="Pause at a layer…"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Pause when this layer finishes"]').exists()).toBe(true)
    const iconNames = wrapper.findAllComponents(AppIcon).map((icon) => icon.props('name'))
    expect(iconNames).toContain('layers')
    expect(iconNames).toContain('layerNext')
  })

  it('seeds the pause-at-layer prompt one layer ahead, rejects a layer already passed, and arms on confirm', async () => {
    const { printer, wrapper, pinia } = mountModule()
    startPrinting(printer)
    printer.printStats.currentLayer = 40
    const macros = useMacrosStore(pinia)
    macros.allMacroNames = new Set(['SET_PAUSE_AT_LAYER'])
    macros.hasDiscovered = true
    const run = vi.spyOn(macros, 'run').mockResolvedValue(true)
    await flushPromises()

    await wrapper.get('[aria-label="Pause at a layer…"]').trigger('click')
    await flushPromises()

    const input = wrapper.get('input.prompt-dialog__input')
    expect((input.element as HTMLInputElement).value).toBe('41')

    await input.setValue('40')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()

    await input.setValue('41')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('form').trigger('submit')

    expect(run).toHaveBeenCalledWith('SET_PAUSE_AT_LAYER', {
      ENABLE: '1',
      LAYER: '41',
      MACRO: 'PAUSE',
    })
  })

  it('arms a pause at the next layer boundary with one click, no dialog', async () => {
    const { printer, wrapper, pinia } = mountModule()
    startPrinting(printer)
    const macros = useMacrosStore(pinia)
    macros.allMacroNames = new Set(['SET_PAUSE_NEXT_LAYER'])
    macros.hasDiscovered = true
    const run = vi.spyOn(macros, 'run').mockResolvedValue(true)
    await flushPromises()

    await wrapper.get('[aria-label="Pause when this layer finishes"]').trigger('click')
    expect(run).toHaveBeenCalledWith('SET_PAUSE_NEXT_LAYER', { ENABLE: '1', MACRO: 'PAUSE' })
  })

  it('reaches Exclude object as an icon button, not a labelled row, once the plate defines one', async () => {
    const { printer, wrapper, pinia } = mountModule()
    startPrinting(printer)
    const excludeObject = useExcludeObjectStore(pinia)
    excludeObject.objects = [{ name: 'part_1', center: [10, 10] }]
    await flushPromises()

    const button = wrapper.get('[aria-label="Exclude object"]')
    expect(button.text()).toBe('')
    expect(button.attributes('title')).toBe('Exclude object')
    expect(wrapper.findComponent(ExcludeObjectDialog).props('open')).toBe(false)

    await button.trigger('click')
    expect(wrapper.findComponent(ExcludeObjectDialog).props('open')).toBe(true)
  })

  it('offers no Exclude object control when the plate defines none', async () => {
    const { printer, wrapper } = mountModule()
    startPrinting(printer)
    await flushPromises()

    expect(wrapper.find('[aria-label="Exclude object"]').exists()).toBe(false)
  })

  it('groups job controls separately from optional print tools in the footer', async () => {
    const { printer, wrapper, pinia } = mountModule()
    startPrinting(printer)
    const excludeObject = useExcludeObjectStore(pinia)
    excludeObject.objects = [{ name: 'part_1', center: [10, 10] }]
    await flushPromises()

    const actions = wrapper.get('.print-actions')
    expect(actions.get('.print-actions__primary').text()).toContain('Pause')
    expect(actions.get('.print-actions__primary').text()).toContain('Cancel')

    const secondary = actions.get('.print-actions__secondary')
    expect(secondary.get('[aria-label="Exclude object"]').classes()).toContain('button--quiet')
    expect(
      wrapper.findAllComponents(AppIcon).some((icon) => icon.props('name') === 'excludeObject'),
    ).toBe(true)
  })

  it('names both actions in the cancel confirmation, since one bare "Cancel" would answer for both', async () => {
    const { printer, wrapper } = mountModule()
    startPrinting(printer)
    await flushPromises()

    const cancel = wrapper
      .findAll('.print-actions__primary button')
      .find((button) => button.text() === 'Cancel')
    await cancel?.trigger('click')

    const labels = wrapper.findAll('.confirm-dialog__actions button').map((button) => button.text())
    expect(labels).toContain('Cancel print')
    expect(labels).toContain('Keep printing')
  })

  it('asks before pausing, since nothing brings a paused print back on its own', async () => {
    const { printer, wrapper } = mountModule()
    startPrinting(printer)
    const pausePrint = vi.spyOn(printer, 'pausePrint').mockResolvedValue(true)
    await flushPromises()

    const pause = wrapper
      .findAll('.print-actions__primary button')
      .find((button) => button.text().includes('Pause'))
    await pause?.trigger('click')

    expect(pausePrint).not.toHaveBeenCalled()
    const confirm = wrapper
      .findAll('.confirm-dialog__actions button')
      .find((button) => button.text() === 'Pause')
    await confirm?.trigger('click')

    expect(pausePrint).toHaveBeenCalledOnce()
  })

  it('pauses immediately once its own confirmation is switched off', async () => {
    const { printer, wrapper } = mountModule({ config: { skipPauseWarning: true } })
    startPrinting(printer)
    const pausePrint = vi.spyOn(printer, 'pausePrint').mockResolvedValue(true)
    await flushPromises()

    const pause = wrapper
      .findAll('.print-actions__primary button')
      .find((button) => button.text().includes('Pause'))
    await pause?.trigger('click')

    expect(pausePrint).toHaveBeenCalledOnce()
    expect(wrapper.find('.confirm-dialog[open]').exists()).toBe(false)
  })

  it("quotes Klipper's own reason when a print fails, and never after one that did not", async () => {
    const { printer, wrapper } = mountModule()
    printer.printStats.state = 'error'
    printer.printStats.filename = 'parts/cube.gcode'
    printer.printStats.message = 'Extruder heater not heating at expected rate'
    await flushPromises()

    expect(wrapper.text()).toContain('Extruder heater not heating at expected rate')

    // Klipper keeps the message after the next job succeeds; repeating it under
    // "Print complete" would report a failure that did not happen.
    printer.printStats.state = 'complete'
    await flushPromises()

    expect(wrapper.text()).not.toContain('Extruder heater not heating at expected rate')
  })

  it('shows the file name while printing, not the path it lives under', async () => {
    const { printer, wrapper } = mountModule()
    startPrinting(printer)
    await flushPromises()

    const heading = wrapper.get('p.text-xl')
    expect(heading.text()).toBe('cube.gcode')
    expect(heading.attributes('title')).toBe('parts/cube.gcode')
  })

  it('formats filament figures through the locale rather than by hand', async () => {
    const { printer, wrapper } = mountModule()
    startPrinting(printer)
    printer.printStats.filamentUsed = 1234567
    printer.currentMetadata = { filename: 'parts/cube.gcode', filament_total: 2345678 }
    await flushPromises()

    // The grouping separator is the tell: `toFixed` cannot produce one, and it
    // is what writes an English decimal point into every other language.
    expect(wrapper.text()).toContain('1,234.6 of 2,345.7 m')
  })

  describe('overdue maintenance', () => {
    /**
     * An overdue interval, a Maintenance card for the reminder to point at, and
     * the reminder itself switched on — it is opt-in, off until the user asks
     * for it under Settings → Maintenance.
     */
    function makeOverdue(pinia: ReturnType<typeof createPinia>) {
      const dashboardLayout = useDashboardLayoutStore(pinia)
      dashboardLayout.setVisible('desktop', 'maintenance', true)
      const maintenance = useMaintenanceStore(pinia)
      maintenance.addInterval('Belt tension', 'printtime', 10)
      const history = useHistoryStore(pinia)
      history.totals = { ...history.totals, printTime: 11 * 3600 }
      const confirmations = useConfirmationsStore(pinia)
      confirmations.setMaintenanceReminderEnabled(true)
      return { dashboardLayout, maintenance, confirmations }
    }

    /** The dialog's markup is always in the DOM, so only `open` reports it. */
    function reminderIsOpen(wrapper: ReturnType<typeof mountModule>['wrapper']): boolean {
      const dialog = wrapper.find<HTMLDialogElement>(
        'dialog[aria-labelledby="maintenance-reminder-title"]',
      )
      return dialog.exists() && dialog.element.open
    }

    function clickReminder(
      wrapper: ReturnType<typeof mountModule>['wrapper'],
      label: string,
    ): Promise<void> | undefined {
      return wrapper
        .findAll('.maintenance-reminder-dialog__actions button')
        .find((button) => button.text() === label)
        ?.trigger('click')
    }

    it('asks before reprinting into an overdue interval, the same as Print files does', async () => {
      const { printer, wrapper, pinia } = mountModule()
      makeOverdue(pinia)
      printer.printStats.state = 'complete'
      printer.printStats.filename = 'parts/cube.gcode'
      const startPrint = vi.spyOn(printer, 'startPrint').mockResolvedValue(true)
      await flushPromises()

      await wrapper.get('button.button--primary').trigger('click')
      await flushPromises()

      expect(reminderIsOpen(wrapper)).toBe(true)
      expect(wrapper.text()).toContain('Belt tension')
      expect(startPrint).not.toHaveBeenCalled()
    })

    it('leaves the card alone until the reminder is switched on', async () => {
      const { printer, wrapper, pinia } = mountModule()
      const dashboardLayout = useDashboardLayoutStore(pinia)
      dashboardLayout.setVisible('desktop', 'maintenance', true)
      const maintenance = useMaintenanceStore(pinia)
      maintenance.addInterval('Belt tension', 'printtime', 10)
      const history = useHistoryStore(pinia)
      history.totals = { ...history.totals, printTime: 11 * 3600 }
      printer.printStats.state = 'complete'
      printer.printStats.filename = 'parts/cube.gcode'
      await flushPromises()

      await wrapper.get('button.button--primary').trigger('click')
      await flushPromises()

      expect(reminderIsOpen(wrapper)).toBe(false)
    })

    it('starts on "Start anyway" without asking the ordinary start question a second time', async () => {
      const { printer, wrapper, pinia } = mountModule()
      makeOverdue(pinia)
      printer.printStats.state = 'complete'
      printer.printStats.filename = 'parts/cube.gcode'
      vi.spyOn(printer, 'refreshFiles').mockResolvedValue(true)
      const startPrint = vi.spyOn(printer, 'startPrint').mockResolvedValue(true)
      await flushPromises()

      await wrapper.get('button.button--primary').trigger('click')
      await flushPromises()
      await clickReminder(wrapper, 'Start anyway')
      await flushPromises()

      expect(startPrint).toHaveBeenCalledWith('parts/cube.gcode')
      expect(reminderIsOpen(wrapper)).toBe(false)
    })

    it('starts nothing on "Not now"', async () => {
      const { printer, wrapper, pinia } = mountModule()
      makeOverdue(pinia)
      printer.printStats.state = 'complete'
      printer.printStats.filename = 'parts/cube.gcode'
      const startPrint = vi.spyOn(printer, 'startPrint').mockResolvedValue(true)
      await flushPromises()

      await wrapper.get('button.button--primary').trigger('click')
      await flushPromises()
      await clickReminder(wrapper, 'Not now')
      await flushPromises()

      expect(startPrint).not.toHaveBeenCalled()
      expect(reminderIsOpen(wrapper)).toBe(false)
    })

    it('reveals the Maintenance card instead of starting, and does not answer the question', async () => {
      const { printer, wrapper, pinia } = mountModule()
      const { dashboardLayout } = makeOverdue(pinia)
      dashboardLayout.setCollapsed('desktop', 'maintenance', true)
      printer.printStats.state = 'complete'
      printer.printStats.filename = 'parts/cube.gcode'
      const startPrint = vi.spyOn(printer, 'startPrint').mockResolvedValue(true)
      await flushPromises()

      await wrapper.get('button.button--primary').trigger('click')
      await flushPromises()
      await clickReminder(wrapper, 'Open Maintenance')
      await flushPromises()

      expect(startPrint).not.toHaveBeenCalled()
      const placement = dashboardLayout
        .itemsFor('desktop')
        .find((item) => item.instance.instanceId === 'maintenance')
      expect(placement?.placement.collapsed).toBe(false)
    })
  })

  describe('recent files', () => {
    it('stays reachable after a print, and reports a refused listing as a refusal', async () => {
      const { printer, wrapper } = mountModule()
      printer.printStats.state = 'complete'
      printer.printStats.filename = 'parts/cube.gcode'
      vi.spyOn(printer, 'refreshFiles').mockResolvedValue(false)
      await flushPromises()

      const recent = wrapper
        .findAll('.print-actions__idle button')
        .find((button) => button.text() === 'Recent files')
      await recent?.trigger('click')
      await flushPromises()

      expect(wrapper.text()).toContain('The file list could not be read.')
      expect(wrapper.text()).not.toContain('No G-code files were returned')
    })

    it('reports an empty listing as empty', async () => {
      const { printer, wrapper } = mountModule()
      vi.spyOn(printer, 'refreshFiles').mockResolvedValue(true)
      await flushPromises()

      const recent = wrapper
        .findAll('.print-actions__idle button')
        .find((button) => button.text() === 'Recent files')
      await recent?.trigger('click')
      await flushPromises()

      expect(wrapper.text()).toContain('No G-code files were returned')
    })

    it('expands a row on click to load and show its own estimated time, filament and thumbnail', async () => {
      const { printer, wrapper } = mountModule()
      printer.files = [{ path: 'vase.gcode', modified: 0, size: 0 }]
      vi.spyOn(printer, 'refreshFiles').mockResolvedValue(true)
      const loadMetadata = vi.spyOn(printer, 'loadMetadata').mockResolvedValue({
        filename: 'vase.gcode',
        estimated_time: 3600,
        filament_weight_total: 42,
        thumbnails: [{ width: 300, height: 300, size: 900, relative_path: '.thumbs/vase.png' }],
      })

      const recent = wrapper
        .findAll('.print-actions__idle button')
        .find((button) => button.text() === 'Recent files')
      await recent?.trigger('click')
      await flushPromises()

      const fileRow = wrapper.find('.file-select')
      expect(fileRow.attributes('aria-expanded')).toBe('false')
      expect(loadMetadata).not.toHaveBeenCalled()

      await fileRow.trigger('click')
      await flushPromises()

      expect(loadMetadata).toHaveBeenCalledWith('vase.gcode')
      expect(fileRow.attributes('aria-expanded')).toBe('true')
      expect(wrapper.text()).toContain('1h 0m')
      const thumbnail = wrapper.find('.file-preview-thumbnail')
      expect(thumbnail.exists()).toBe(true)
      expect(thumbnail.attributes('src')).toContain('/server/files/gcodes/.thumbs/vase.png')

      await fileRow.trigger('click')
      await flushPromises()
      expect(fileRow.attributes('aria-expanded')).toBe('false')
    })
  })

  describe('up next', () => {
    it('says the queue is paused, since a paused queue starts nothing on its own', async () => {
      const { printer, wrapper, pinia } = mountModule()
      vi.spyOn(printer, 'loadMetadata').mockResolvedValue({ filename: 'vase.gcode' })
      const jobQueue = useJobQueueStore(pinia)
      jobQueue.jobs = [{ filename: 'vase.gcode', job_id: '1', time_added: 0, time_in_queue: 0 }]
      jobQueue.queueState = 'ready'
      await flushPromises()
      expect(wrapper.text()).not.toContain('Queue paused')

      jobQueue.queueState = 'paused'
      await flushPromises()

      expect(wrapper.text()).toContain('Queue paused')
    })

    it('previews the queue’s front job while idle, using the queue as the preload mechanism', async () => {
      const { printer, wrapper, pinia } = mountModule()
      vi.spyOn(printer, 'loadMetadata').mockResolvedValue({
        filename: 'vase.gcode',
        estimated_time: 3600,
      })
      const jobQueue = useJobQueueStore(pinia)
      jobQueue.jobs = [{ filename: 'vase.gcode', job_id: '1', time_added: 0, time_in_queue: 0 }]
      await flushPromises()

      expect(wrapper.text()).toContain('Up next')
      expect(wrapper.text()).toContain('vase.gcode')
    })

    it('shows the queued file’s thumbnail beside its stats, sized independently of them', async () => {
      const { printer, wrapper, pinia } = mountModule()
      vi.spyOn(printer, 'loadMetadata').mockResolvedValue({
        filename: 'vase.gcode',
        estimated_time: 3600,
        thumbnails: [{ width: 300, height: 300, size: 900, relative_path: '.thumbs/vase.png' }],
      })
      const jobQueue = useJobQueueStore(pinia)
      jobQueue.jobs = [{ filename: 'vase.gcode', job_id: '1', time_added: 0, time_in_queue: 0 }]
      await flushPromises()

      const thumbnail = wrapper.find('.file-preview-thumbnail')
      expect(thumbnail.exists()).toBe(true)
      expect(thumbnail.attributes('src')).toContain('/server/files/gcodes/.thumbs/vase.png')
    })

    it('says nothing while a print is active, since the queue is not next then', async () => {
      const { printer, wrapper, pinia } = mountModule()
      startPrinting(printer)
      const jobQueue = useJobQueueStore(pinia)
      jobQueue.jobs = [{ filename: 'vase.gcode', job_id: '1', time_added: 0, time_in_queue: 0 }]
      await flushPromises()

      expect(wrapper.text()).not.toContain('Up next')
    })

    it('warns when the loaded spool cannot finish the queued job', async () => {
      const { printer, wrapper, pinia } = mountModule()
      vi.spyOn(printer, 'loadMetadata').mockResolvedValue({
        filename: 'vase.gcode',
        filament_weight_total: 220,
      })
      const jobQueue = useJobQueueStore(pinia)
      jobQueue.jobs = [{ filename: 'vase.gcode', job_id: '1', time_added: 0, time_in_queue: 0 }]
      const spool = useSpoolStore(pinia)
      spool.activeSpoolId = 7
      spool.activeSpool = {
        id: 7,
        registered: '2026-01-01T00:00:00Z',
        used_weight: 900,
        used_length: 300000,
        remaining_weight: 100,
        remaining_length: 33000,
        archived: false,
        filament: { id: 1, material: 'PLA' },
      }
      await flushPromises()

      expect(wrapper.text()).toContain('Not enough filament left')
    })

    it('warns when the loaded filament disagrees with the queued job’s first-layer temperature', async () => {
      const { wrapper, pinia } = mountModule()
      vi.spyOn(usePrinterStore(pinia), 'loadMetadata').mockResolvedValue({
        filename: 'vase.gcode',
        first_layer_extr_temp: 250,
      })
      const jobQueue = useJobQueueStore(pinia)
      jobQueue.jobs = [{ filename: 'vase.gcode', job_id: '1', time_added: 0, time_in_queue: 0 }]
      const spool = useSpoolStore(pinia)
      spool.activeSpoolId = 7
      spool.activeSpool = {
        id: 7,
        registered: '2026-01-01T00:00:00Z',
        used_weight: 0,
        used_length: 0,
        archived: false,
        filament: { id: 1, material: 'PLA', settings_extruder_temp: 210 },
      }
      await flushPromises()

      expect(wrapper.text()).toContain('Loaded filament is set for 210°C')
    })

    it('starts the queue, not this specific file, so the queue order is respected', async () => {
      const { printer, wrapper, pinia } = mountModule()
      vi.spyOn(printer, 'loadMetadata').mockResolvedValue({ filename: 'vase.gcode' })
      const jobQueue = useJobQueueStore(pinia)
      jobQueue.jobs = [{ filename: 'vase.gcode', job_id: '1', time_added: 0, time_in_queue: 0 }]
      const startQueue = vi.spyOn(jobQueue, 'startQueue').mockResolvedValue(true)
      await flushPromises()

      const startButton = wrapper
        .findAll('button')
        .find((candidate) => candidate.text().includes('Start now'))
      await startButton?.trigger('click')

      expect(startQueue).toHaveBeenCalled()
    })

    it('removes the front job without touching the rest of the queue', async () => {
      const { printer, wrapper, pinia } = mountModule()
      vi.spyOn(printer, 'loadMetadata').mockResolvedValue({ filename: 'vase.gcode' })
      const jobQueue = useJobQueueStore(pinia)
      jobQueue.jobs = [
        { filename: 'vase.gcode', job_id: '1', time_added: 0, time_in_queue: 0 },
        { filename: 'bracket.gcode', job_id: '2', time_added: 1, time_in_queue: 0 },
      ]
      const removeJob = vi.spyOn(jobQueue, 'removeJob').mockResolvedValue(true)
      await flushPromises()

      expect(wrapper.text()).toContain('+1 more queued')
      const removeButton = wrapper
        .findAll('button')
        .find((candidate) => candidate.text().includes('Remove from queue'))
      await removeButton?.trigger('click')

      expect(removeJob).toHaveBeenCalledWith('1')
    })
  })

  describe('active print filament warning', () => {
    it('warns when the spool cannot finish the print that is already running', async () => {
      const { printer, wrapper, pinia } = mountModule()
      startPrinting(printer)
      printer.currentMetadata = {
        filename: 'parts/cube.gcode',
        filament_weight_total: 220,
      }
      const spool = useSpoolStore(pinia)
      spool.activeSpoolId = 7
      spool.activeSpool = {
        id: 7,
        registered: '2026-01-01T00:00:00Z',
        used_weight: 900,
        used_length: 300000,
        remaining_weight: 100,
        remaining_length: 33000,
        archived: false,
        filament: { id: 1, material: 'PLA' },
      }
      await flushPromises()

      expect(wrapper.text()).toContain('Not enough filament left')
    })

    it('warns when the loaded filament disagrees with the running print’s first-layer temperature', async () => {
      const { printer, wrapper, pinia } = mountModule()
      startPrinting(printer)
      printer.currentMetadata = {
        filename: 'parts/cube.gcode',
        first_layer_extr_temp: 250,
      }
      const spool = useSpoolStore(pinia)
      spool.activeSpoolId = 7
      spool.activeSpool = {
        id: 7,
        registered: '2026-01-01T00:00:00Z',
        used_weight: 0,
        used_length: 0,
        archived: false,
        filament: { id: 1, material: 'PLA', settings_extruder_temp: 210 },
      }
      await flushPromises()

      expect(wrapper.text()).toContain('Loaded filament is set for 210°C')
    })

    it('stays quiet once the print has already extruded enough of its own total to fit what remains', async () => {
      const { printer, wrapper, pinia } = mountModule()
      startPrinting(printer)
      printer.printStats.filamentUsed = 800
      printer.currentMetadata = {
        filename: 'parts/cube.gcode',
        filament_weight_total: 148,
        filament_total: 2000,
      }
      const spool = useSpoolStore(pinia)
      spool.activeSpoolId = 7
      spool.activeSpool = {
        id: 7,
        registered: '2026-01-01T00:00:00Z',
        used_weight: 0,
        used_length: 0,
        remaining_weight: 137,
        archived: false,
        filament: { id: 1, material: 'PLA' },
      }
      await flushPromises()

      expect(wrapper.text()).not.toContain('Not enough filament left')
    })

    it('never shows the positive reassurance for the print already underway', async () => {
      const { printer, wrapper, pinia } = mountModule()
      startPrinting(printer)
      printer.currentMetadata = { filename: 'parts/cube.gcode', filament_weight_total: 50 }
      const spool = useSpoolStore(pinia)
      spool.activeSpoolId = 7
      spool.activeSpool = {
        id: 7,
        registered: '2026-01-01T00:00:00Z',
        used_weight: 0,
        used_length: 0,
        remaining_weight: 500,
        archived: false,
        filament: { id: 1, material: 'PLA' },
      }
      await flushPromises()

      expect(wrapper.text()).not.toContain('Enough filament')
    })
  })

  describe('the maintenance header action', () => {
    it('offers no header action when nothing is overdue', () => {
      const { headerAction } = mountModule()

      expect(headerAction.value).toBeNull()
    })

    it('offers no header action when something is overdue but no Maintenance card is on the dashboard', async () => {
      const { pinia, headerAction } = mountModule()
      const maintenance = useMaintenanceStore(pinia)
      maintenance.addInterval('Belt tension', 'printtime', 10)
      const history = useHistoryStore(pinia)
      history.totals = { ...history.totals, printTime: 11 * 3600 }
      await nextTick()

      expect(headerAction.value).toBeNull()
    })

    it('warns once something is overdue and the Maintenance card is visible', async () => {
      const { pinia, headerAction } = mountModule()
      const dashboardLayout = useDashboardLayoutStore(pinia)
      dashboardLayout.setVisible('desktop', 'maintenance', true)
      const maintenance = useMaintenanceStore(pinia)
      maintenance.addInterval('Belt tension', 'printtime', 10)
      const history = useHistoryStore(pinia)
      history.totals = { ...history.totals, printTime: 11 * 3600 }
      await nextTick()

      expect(headerAction.value).toMatchObject({ icon: 'warning' })
    })

    it('expands the collapsed Maintenance card when the action is clicked', async () => {
      const { pinia, headerAction } = mountModule()
      const dashboardLayout = useDashboardLayoutStore(pinia)
      dashboardLayout.setVisible('desktop', 'maintenance', true)
      dashboardLayout.setCollapsed('desktop', 'maintenance', true)
      const maintenance = useMaintenanceStore(pinia)
      maintenance.addInterval('Belt tension', 'printtime', 10)
      const history = useHistoryStore(pinia)
      history.totals = { ...history.totals, printTime: 11 * 3600 }
      await nextTick()

      headerAction.value?.onClick()

      const placement = dashboardLayout
        .itemsFor('desktop')
        .find((item) => item.instance.instanceId === 'maintenance')
      expect(placement?.placement.collapsed).toBe(false)
    })

    it('withdraws the action once the interval is marked performed', async () => {
      const { pinia, headerAction } = mountModule()
      const dashboardLayout = useDashboardLayoutStore(pinia)
      dashboardLayout.setVisible('desktop', 'maintenance', true)
      const maintenance = useMaintenanceStore(pinia)
      maintenance.addInterval('Belt tension', 'printtime', 10)
      const history = useHistoryStore(pinia)
      history.totals = { ...history.totals, printTime: 11 * 3600 }
      await nextTick()
      expect(headerAction.value).not.toBeNull()

      maintenance.markPerformed(maintenance.intervals[0]!.id)
      await nextTick()

      expect(headerAction.value).toBeNull()
    })
  })
})
