import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MacrosModule from '@/components/dashboard/modules/MacrosModule.vue'
import { dashboardModuleContextKey } from '@/dashboard/context'
import { i18n } from '@/i18n'
import { useMacrosStore } from '@/stores/macros'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { useToastsStore } from '@/stores/toasts'

function mountModule(initialConfig: Record<string, unknown> = {}, surfaceOpen = false) {
  const pinia = createPinia()
  const macros = useMacrosStore(pinia)
  const printer = usePrinterStore(pinia)
  const printerConfig = usePrinterConfigStore(pinia)
  const config = ref<Record<string, unknown>>(initialConfig)
  const openSurface = vi.fn()
  const wrapper = mount(MacrosModule, {
    global: {
      plugins: [pinia, i18n],
      provide: {
        [dashboardModuleContextKey as symbol]: {
          instanceId: 'macros',
          moduleId: 'macros',
          config: computed(() => config.value),
          updateConfig: (patch: Record<string, unknown>) => {
            config.value = { ...config.value, ...patch }
          },
          isSettingsOpen: computed(() => false),
          openSettings: () => undefined,
          closeSettings: () => undefined,
          isSurfaceOpen: computed(() => surfaceOpen),
          openSurface,
          closeSurface: () => undefined,
        },
      },
    },
  })
  return { macros, printer, printerConfig, wrapper, config, openSurface, pinia }
}

describe('MacrosModule', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('sends an empty card to the picker, which is a surface away', async () => {
    const { wrapper, openSurface } = mountModule()

    expect(wrapper.text()).toContain('No macros on the dashboard yet.')
    await wrapper.get('.button--primary').trigger('click')

    expect(openSurface).toHaveBeenCalledOnce()
  })

  it('runs a chosen macro', async () => {
    const { macros, wrapper } = mountModule({ macros: ['LOAD_FILAMENT'] })
    const run = vi.spyOn(macros, 'run').mockResolvedValue(true)
    macros.discovered = ['LOAD_FILAMENT']
    macros.hasDiscovered = true
    await flushPromises()

    const button = wrapper.get('.macro-grid .button')
    expect(button.text()).toBe('Load Filament')
    await button.trigger('click')

    expect(run).toHaveBeenCalledWith('LOAD_FILAMENT', undefined)
    // A macro whose body reads no parameters stays exactly one button — the
    // caret exists only where a form does.
    expect(wrapper.find('.macro-control__params').exists()).toBe(false)
  })

  it('gives a parameterized macro a caret whose panel prefills defaults and sends values', async () => {
    const { macros, printerConfig, wrapper } = mountModule({ macros: ['CLEAN_NOZZLE'] })
    const run = vi.spyOn(macros, 'run').mockResolvedValue(true)
    macros.discovered = ['CLEAN_NOZZLE']
    macros.hasDiscovered = true
    printerConfig.settings = {
      'gcode_macro clean_nozzle': {
        gcode: '{% set wipes = params.WIPES|default(5)|int %}{% set t = params.TEMP|int %}',
      },
    }
    await flushPromises()

    // The main segment still runs the macro bare, so its own defaults apply.
    await wrapper.get('.macro-control__run').trigger('click')
    expect(run).toHaveBeenCalledWith('CLEAN_NOZZLE', undefined)

    await wrapper.get('.macro-control__params').trigger('click')
    await flushPromises()
    const panel = document.body.querySelector('.macro-params')
    expect(panel).not.toBeNull()

    const fields = [...panel!.querySelectorAll('input')]
    expect(fields.map((field) => field.placeholder)).toEqual(['5', ''])

    fields[1]!.value = '210'
    fields[1]!.dispatchEvent(new Event('input', { bubbles: true }))
    panel!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()

    // An untouched field sends nothing for its parameter; the macro's own
    // default stays the macro's business.
    expect(run).toHaveBeenLastCalledWith('CLEAN_NOZZLE', { WIPES: '', TEMP: '210' })
    expect(document.body.querySelector('.macro-params')).toBeNull()
  })

  it('withholds the run and send actions while docked to its own settings surface', async () => {
    const { macros, printerConfig, wrapper } = mountModule({ macros: ['CLEAN_NOZZLE'] }, true)
    macros.discovered = ['CLEAN_NOZZLE']
    macros.hasDiscovered = true
    printerConfig.settings = {
      'gcode_macro clean_nozzle': { gcode: '{% set t = params.TEMP|int %}' },
    }
    await flushPromises()

    // The run segment is withheld so managing macros can't fire one by
    // accident, but the caret still opens — a value should stay reviewable.
    expect(wrapper.get('.macro-control__run').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.macro-control__params').attributes('disabled')).toBeUndefined()

    await wrapper.get('.macro-control__params').trigger('click')
    await flushPromises()
    const panel = document.body.querySelector('.macro-params')
    expect(panel?.querySelector('button[type="submit"]')).toHaveProperty('disabled', true)
  })

  it('tints a colored macro with its chosen accent, and leaves an uncolored one alone', async () => {
    const { macros, wrapper } = mountModule({
      macros: ['LOAD_FILAMENT', 'UNLOAD_FILAMENT'],
      colors: { LOAD_FILAMENT: 'sky' },
    })
    macros.discovered = ['LOAD_FILAMENT', 'UNLOAD_FILAMENT']
    macros.hasDiscovered = true
    await flushPromises()

    const buttons = wrapper.findAll('.macro-control__run')
    const colored = buttons.find((button) => button.text() === 'Load Filament')!
    const plain = buttons.find((button) => button.text() === 'Unload Filament')!

    expect(colored.classes()).toContain('macro-control__run--accent')
    // The custom property is set once on the shared `.macro-control` wrapper
    // and inherits into the run button, rather than being repeated on it.
    expect(colored.element.parentElement?.getAttribute('style')).toContain('--color-data-sky')
    expect(colored.find('.macro-control__accent-dot').exists()).toBe(true)

    expect(plain.classes()).not.toContain('macro-control__run--accent')
    expect(plain.find('.macro-control__accent-dot').exists()).toBe(false)
  })

  it('hides one macro during a print without touching the rest of the card', async () => {
    const { macros, printer, wrapper } = mountModule({
      macros: ['LOAD_FILAMENT', 'PRINT_PAUSE_MACRO'],
      hiddenInPrinting: ['PRINT_PAUSE_MACRO'],
    })
    macros.discovered = ['LOAD_FILAMENT', 'PRINT_PAUSE_MACRO']
    macros.hasDiscovered = true
    await flushPromises()

    expect(wrapper.findAll('.macro-control__run')).toHaveLength(2)

    printer.printStats.state = 'printing'
    await flushPromises()

    const labels = wrapper.findAll('.macro-control__run').map((button) => button.text())
    expect(labels).toEqual(['Load Filament'])
  })

  it('replaces the whole grid with a notice when the card is hidden for the current state', async () => {
    const { printer, wrapper } = mountModule({
      macros: ['LOAD_FILAMENT'],
      showInPrinting: false,
    })
    await flushPromises()
    expect(wrapper.find('.macro-grid').exists()).toBe(true)

    printer.printStats.state = 'printing'
    await flushPromises()

    expect(wrapper.find('.macro-grid').exists()).toBe(false)
    expect(wrapper.text()).toContain('Hidden while printing.')
  })

  it('says every candidate is hidden for this state, not that they are missing', async () => {
    const { printer, wrapper } = mountModule({
      macros: ['PRINT_ONLY_MACRO'],
      hiddenInStandby: ['PRINT_ONLY_MACRO'],
    })
    printer.printStats.state = 'standby'
    await flushPromises()

    expect(wrapper.text()).toContain('Hidden while idle.')
    expect(wrapper.text()).not.toContain('is missing from the printer')
  })

  it('disables a selected macro the printer no longer reports', async () => {
    const { macros, wrapper } = mountModule({ macros: ['CALIBRATE_MESH'] })
    macros.discovered = []
    macros.hasDiscovered = true
    await flushPromises()

    const button = wrapper.get('.macro-grid .button')
    expect(button.classes()).toContain('macro-control__run--missing')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('title')).toBe(
      'Calibrate Mesh is no longer in the printer configuration',
    )
  })

  it('says the card is empty because its macros are missing, not because none were chosen', async () => {
    const { macros, wrapper } = mountModule({ macros: ['CALIBRATE_MESH'], hideMissing: true })
    macros.discovered = []
    macros.hasDiscovered = true
    await flushPromises()

    // Offering "choose macros" to someone who already has would be a card
    // lying about its own configuration.
    expect(wrapper.find('.macro-grid').exists()).toBe(false)
    expect(wrapper.text()).toContain('Every macro on this card is missing')
    expect(wrapper.text()).not.toContain('No macros on the dashboard yet.')
  })

  it('renders a section heading between the macros it labels', async () => {
    const { macros, wrapper } = mountModule({
      macros: ['LOAD_FILAMENT', 'divider::abc', 'UNLOAD_FILAMENT'],
      dividerLabels: { abc: 'Filament' },
    })
    macros.discovered = ['LOAD_FILAMENT', 'UNLOAD_FILAMENT']
    macros.hasDiscovered = true
    await flushPromises()

    const grid = wrapper.get('.macro-grid')
    const headings = grid.findAll('.macro-heading')
    expect(headings).toHaveLength(1)
    expect(headings[0]?.text()).toBe('Filament')
    expect(wrapper.findAll('.macro-control__run')).toHaveLength(2)
  })

  it('renders an unlabeled heading as a bare rule instead of skipping it', async () => {
    const { wrapper } = mountModule({ macros: ['divider::abc'] })
    await flushPromises()

    const heading = wrapper.get('.macro-heading')
    expect(heading.text()).toBe('')
    expect(heading.attributes('aria-hidden')).toBe('true')
  })

  it('never lets a heading count as a chosen or missing macro', async () => {
    const { macros, wrapper } = mountModule({
      macros: ['divider::abc'],
      dividerLabels: { abc: 'Maintenance' },
    })
    macros.discovered = []
    macros.hasDiscovered = true
    await flushPromises()

    // A card holding only a heading has no macros to be "missing" or to
    // prompt "choose macros" for — it still shows the heading the user typed.
    expect(wrapper.text()).not.toContain('Every macro on this card is missing')
    expect(wrapper.text()).not.toContain('No macros on the dashboard yet.')
    expect(wrapper.get('.macro-heading').text()).toBe('Maintenance')
  })

  it('pushes a toast when a macro fails, instead of a permanent card alert', async () => {
    const { macros, printer, pinia } = mountModule({ macros: ['CALIBRATE_MESH'] })
    vi.spyOn(printer, 'sendMacro').mockRejectedValue(new Error('Klipper refused'))

    await macros.run('CALIBRATE_MESH')
    await flushPromises()

    const toasts = useToastsStore(pinia)
    expect(toasts.entries).toHaveLength(1)
    expect(toasts.entries[0]?.message).toContain('Klipper refused')
  })
})
