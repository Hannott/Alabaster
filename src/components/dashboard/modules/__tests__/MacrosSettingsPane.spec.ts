import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MacrosSettingsPane from '@/components/dashboard/modules/MacrosSettingsPane.vue'
import { dashboardModuleContextKey, dashboardSurfaceGroupSwitchKey } from '@/dashboard/context'
import { i18n } from '@/i18n'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'
import { useMacrosStore } from '@/stores/macros'

function mountPane(initialConfig: Record<string, unknown> = {}, attach = false) {
  const pinia = createPinia()
  const macros = useMacrosStore(pinia)
  const layout = useDashboardLayoutStore(pinia)
  const refresh = vi.spyOn(macros, 'refresh').mockResolvedValue()
  const config = ref<Record<string, unknown>>(initialConfig)
  const switchTo = vi.fn()
  const mountIt = () =>
    mount(MacrosSettingsPane, {
      ...(attach ? { attachTo: document.body } : {}),
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
            isSurfaceOpen: computed(() => true),
            openSurface: () => undefined,
            closeSurface: () => undefined,
          },
          [dashboardSurfaceGroupSwitchKey as symbol]: { switchTo },
        },
      },
    })
  return { macros, layout, refresh, config, switchTo, mountIt }
}

/** jsdom's plain `Event` has no `dataTransfer`; a native drag handler reads
 * one, so tests attach a minimal stand-in rather than a real `DragEvent`. */
function dragEvent(type: string): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: { setData: vi.fn(), dropEffect: '', effectAllowed: '' },
  })
  return event
}

describe('MacrosSettingsPane', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('asks the printer what it defines, since opening this is the first time anyone needs it', async () => {
    const { refresh, mountIt } = mountPane()
    mountIt()
    await flushPromises()

    expect(refresh).toHaveBeenCalledOnce()
  })

  it('does not ask again once the list is already known', async () => {
    const { macros, refresh, mountIt } = mountPane()
    macros.hasDiscovered = true
    mountIt()
    await flushPromises()

    expect(refresh).not.toHaveBeenCalled()
  })

  it('searches the discovered macros and adds one to the card', async () => {
    const { macros, config, mountIt } = mountPane()
    macros.discovered = ['CALIBRATE_MESH', 'LOAD_FILAMENT']
    macros.hasDiscovered = true
    const wrapper = mountIt()
    await flushPromises()

    await wrapper.get('#dashboard-macro-search').setValue('load')
    const candidates = wrapper.findAll('.macro-picker__available .macro-row')
    expect(candidates).toHaveLength(1)

    await candidates[0]?.get('button').trigger('click')
    expect(config.value.macros).toEqual(['LOAD_FILAMENT'])
  })

  it('finds a macro by the label on the screen, not only its underscored name', async () => {
    const { macros, mountIt } = mountPane()
    macros.discovered = ['CALIBRATE_MESH', 'LOAD_FILAMENT']
    macros.hasDiscovered = true
    const wrapper = mountIt()
    await flushPromises()

    // The list renders "CALIBRATE MESH"; typing exactly that must find it.
    await wrapper.get('#dashboard-macro-search').setValue('calibrate mesh')
    expect(wrapper.findAll('.macro-picker__available .macro-row')).toHaveLength(1)
  })

  it('offers the available macros as rows, never as anything shaped like a run button', async () => {
    const { macros, mountIt } = mountPane()
    macros.discovered = ['CALIBRATE_MESH']
    macros.hasDiscovered = true
    const wrapper = mountIt()
    await flushPromises()

    // The docked card stands beside this pane, live — its mono buttons really
    // run G-code. A pane that draws the same shape for "add" is a pane where
    // adding and firing the printer look identical.
    expect(wrapper.find('.macro-grid').exists()).toBe(false)
    expect(wrapper.find('.button--value').exists()).toBe(false)
  })

  it('reorders and removes what the card carries', async () => {
    const { macros, config, mountIt } = mountPane({
      macros: ['CALIBRATE_MESH', 'LOAD_FILAMENT'],
    })
    macros.discovered = ['CALIBRATE_MESH', 'LOAD_FILAMENT']
    macros.hasDiscovered = true
    const wrapper = mountIt()
    await flushPromises()

    expect(wrapper.findAll('.macro-row')).toHaveLength(2)

    await wrapper.get('[title="Move Load Filament earlier"]').trigger('click')
    expect(config.value.macros).toEqual(['LOAD_FILAMENT', 'CALIBRATE_MESH'])

    await wrapper.get('[title="Remove Load Filament"]').trigger('click')
    expect(config.value.macros).toEqual(['CALIBRATE_MESH'])
  })

  it('creates a fresh empty card beside this one, which is what a new group is', async () => {
    const { macros, layout, mountIt } = mountPane({ macros: ['CALIBRATE_MESH'] })
    macros.hasDiscovered = true
    const wrapper = mountIt()
    await flushPromises()

    const addGroup = wrapper
      .findAll('.macro-groups button')
      .find((button) => button.text() === 'Add group')
    expect(addGroup).toBeDefined()
    await addGroup!.trigger('click')

    expect(layout.instanceCountFor('macros')).toBe(2)
    expect(
      layout.profile.instances.find((instance) => instance.instanceId === 'macros-2')?.config,
    ).toEqual({})
  })

  it('marks a chosen macro the printer no longer reports rather than dropping it', async () => {
    const { macros, mountIt } = mountPane({ macros: ['CALIBRATE_MESH'] })
    macros.discovered = []
    macros.hasDiscovered = true
    const wrapper = mountIt()
    await flushPromises()

    expect(wrapper.get('.macro-row').text()).toContain('Missing')
  })

  it('drags a selected macro to reorder it, without touching the up/down buttons', async () => {
    const { macros, config, mountIt } = mountPane({
      macros: ['CALIBRATE_MESH', 'LOAD_FILAMENT', 'HEAT_SOAK'],
    })
    macros.discovered = ['CALIBRATE_MESH', 'LOAD_FILAMENT', 'HEAT_SOAK']
    macros.hasDiscovered = true
    const wrapper = mountIt()
    await flushPromises()

    const rows = wrapper.findAll('.macro-picker__selected .macro-row--selected')
    expect(rows).toHaveLength(3)

    // Drag the first row (CALIBRATE_MESH) onto the third (HEAT_SOAK).
    await rows[0]!.element.dispatchEvent(dragEvent('dragstart'))
    await rows[2]!.element.dispatchEvent(dragEvent('dragover'))
    await rows[2]!.element.dispatchEvent(dragEvent('drop'))

    expect(config.value.macros).toEqual(['LOAD_FILAMENT', 'HEAT_SOAK', 'CALIBRATE_MESH'])
  })

  /**
   * A native browser drag can silently end without ever firing `drop` if the
   * row it is dragging gets moved in the DOM mid-drag — which is exactly what
   * an earlier version did by live-splicing the list on every `dragover`. The
   * fix keeps every row in place until `drop`, so this asserts the mid-drag
   * DOM never reorders (only a highlight class moves), which is the condition
   * that keeps the browser's drag session alive long enough to reach `drop`.
   */
  it('never reorders the DOM mid-drag, only highlighting the hovered row', async () => {
    const { macros, config, mountIt } = mountPane({
      macros: ['CALIBRATE_MESH', 'LOAD_FILAMENT', 'HEAT_SOAK'],
    })
    macros.discovered = ['CALIBRATE_MESH', 'LOAD_FILAMENT', 'HEAT_SOAK']
    macros.hasDiscovered = true
    const wrapper = mountIt()
    await flushPromises()

    const rows = () => wrapper.findAll('.macro-picker__selected .macro-row--selected')
    await rows()[0]!.element.dispatchEvent(dragEvent('dragstart'))
    await rows()[2]!.element.dispatchEvent(dragEvent('dragover'))

    // Still in the committed order — nothing moved before drop.
    expect(rows().map((row) => row.get('.macro-row__name').text())).toEqual([
      'Calibrate Mesh',
      'Load Filament',
      'Heat Soak',
    ])
    expect(rows()[2]!.classes()).toContain('macro-row--drop-target')
    expect(config.value.macros).toEqual(['CALIBRATE_MESH', 'LOAD_FILAMENT', 'HEAT_SOAK'])

    await rows()[2]!.element.dispatchEvent(dragEvent('drop'))
    expect(config.value.macros).toEqual(['LOAD_FILAMENT', 'HEAT_SOAK', 'CALIBRATE_MESH'])
  })

  it('renders a title field that renames this instance on change', async () => {
    const { layout, mountIt } = mountPane()
    const wrapper = mountIt()
    await flushPromises()

    await wrapper.get('input[type="text"]').setValue('Bed prep')
    await wrapper.get('input[type="text"]').trigger('change')

    expect(
      layout.profile.instances.find((instance) => instance.instanceId === 'macros')?.title,
    ).toBe('Bed prep')
  })

  it('offers "Add group" even with a single instance, since it is how a second one gets made', async () => {
    const { mountIt } = mountPane()
    const wrapper = mountIt()
    await flushPromises()

    // The groups strip is always present now — it is the only way to reach
    // "Add group" — but with one instance it holds exactly that one chip.
    const chips = wrapper.findAll('.macro-groups .button')
    expect(chips.map((chip) => chip.text())).toEqual(['Macros', 'Add group'])
  })

  it('switches to a sibling group when its chip is clicked, and marks the current one', async () => {
    const { layout, switchTo, mountIt } = mountPane()
    layout.duplicateInstance('desktop', 'macros', { emptyConfig: true })
    layout.renameInstance('macros-2', 'Bed prep')
    const wrapper = mountIt()
    await flushPromises()

    // Every button in the strip but the trailing "Add group" one is a group.
    const chips = wrapper.findAll('.macro-groups .button').slice(0, -1)
    expect(chips).toHaveLength(2)
    const current = chips.find((chip) => chip.attributes('aria-current') === 'true')
    expect(current?.text()).toBe('Macros')

    const sibling = chips.find((chip) => chip.text() === 'Bed prep')
    await sibling!.trigger('click')
    expect(switchTo).toHaveBeenCalledWith('macros-2')
  })

  it('cycles a selected macro through the palette and back to none', async () => {
    const { macros, config, mountIt } = mountPane({ macros: ['CLEAN_NOZZLE'] })
    macros.discovered = ['CLEAN_NOZZLE']
    macros.hasDiscovered = true
    const wrapper = mountIt()
    await flushPromises()

    const swatch = wrapper.get('.macro-row__color')
    expect(swatch.classes()).toContain('macro-row__color--none')

    await swatch.trigger('click')
    expect(config.value.colors).toEqual({ CLEAN_NOZZLE: 'orange' })
    expect(wrapper.get('.macro-row__color').classes()).not.toContain('macro-row__color--none')

    // Six more clicks walks the remaining six hues; the eighth click wraps.
    for (let step = 0; step < 6; step += 1) {
      await wrapper.get('.macro-row__color').trigger('click')
    }
    expect(config.value.colors).toEqual({ CLEAN_NOZZLE: 'yellow' })

    await wrapper.get('.macro-row__color').trigger('click')
    expect(config.value.colors).toEqual({})
    expect(wrapper.get('.macro-row__color').classes()).toContain('macro-row__color--none')
  })

  it('deletes with a plain, always-visible trash button, not a hover overlay', async () => {
    const { macros, mountIt } = mountPane({ macros: ['CLEAN_NOZZLE'] })
    macros.discovered = ['CLEAN_NOZZLE']
    macros.hasDiscovered = true
    const wrapper = mountIt()
    await flushPromises()

    // The hover-to-reveal "Remove?" shortcut was tried and reverted: it made
    // the row's own drag handle unreachable. Deleting is one control again.
    expect(wrapper.find('.macro-row__remove-overlay').exists()).toBe(false)
    const remove = wrapper.get('[title="Remove Clean Nozzle"]')
    expect(remove.classes()).toContain('button--danger-quiet')
    expect(remove.find('svg').exists()).toBe(true)
  })

  it('toggles a macro hidden for one print state without touching the others', async () => {
    const { macros, config, mountIt } = mountPane({ macros: ['CLEAN_NOZZLE'] })
    macros.discovered = ['CLEAN_NOZZLE']
    macros.hasDiscovered = true
    const wrapper = mountIt()
    await flushPromises()

    const printingToggle = wrapper.get('[aria-label="Clean Nozzle: Show while printing"]')
    expect(printingToggle.attributes('aria-pressed')).toBe('true')

    await printingToggle.trigger('click')
    expect(config.value.hiddenInPrinting).toEqual(['CLEAN_NOZZLE'])
    expect(config.value.hiddenInPaused).toBeUndefined()
    expect(
      wrapper.get('[aria-label="Clean Nozzle: Show while printing"]').attributes('aria-pressed'),
    ).toBe('false')

    await printingToggle.trigger('click')
    expect(config.value.hiddenInPrinting).toEqual([])
  })

  it('hides the whole card for a print state from the group row, defaulting to shown', async () => {
    const { mountIt } = mountPane()
    const wrapper = mountIt()
    await flushPromises()

    const pausedToggle = wrapper.get('[title="Show while paused"]')
    expect(pausedToggle.attributes('aria-pressed')).toBe('true')

    await pausedToggle.trigger('click')
    expect(wrapper.get('[title="Show while paused"]').attributes('aria-pressed')).toBe('false')
  })

  it('switches to the newly created group instead of leaving it behind', async () => {
    const { switchTo, mountIt } = mountPane()
    const wrapper = mountIt()
    await flushPromises()

    const addGroup = wrapper
      .findAll('.macro-groups button')
      .find((button) => button.text() === 'Add group')
    await addGroup!.trigger('click')

    expect(switchTo).toHaveBeenCalledWith('macros-2')
  })

  it('appends a focused, empty heading above the available list', async () => {
    const { config, mountIt } = mountPane({ macros: ['CALIBRATE_MESH'] }, true)
    const wrapper = mountIt()
    await flushPromises()

    const addDivider = wrapper
      .findAll('.macro-picker__available-header button')
      .find((button) => button.text() === 'Add heading')
    expect(addDivider).toBeDefined()
    await addDivider!.trigger('click')

    expect(config.value.macros).toHaveLength(2)
    const entry = (config.value.macros as string[])[1]!
    expect(entry.startsWith('divider::')).toBe(true)

    const input = wrapper.get<HTMLInputElement>('.macro-row__divider-input')
    expect(input.element).toBe(document.activeElement)
  })

  it('types a heading, reorders it, and removes it exactly like a macro', async () => {
    const { macros, config, mountIt } = mountPane({
      macros: ['CALIBRATE_MESH', 'divider::abc', 'LOAD_FILAMENT'],
      dividerLabels: { abc: '' },
    })
    macros.discovered = ['CALIBRATE_MESH', 'LOAD_FILAMENT']
    macros.hasDiscovered = true
    const wrapper = mountIt()
    await flushPromises()

    const rows = wrapper.findAll('.macro-picker__selected .macro-row--selected')
    expect(rows).toHaveLength(3)
    const dividerRow = rows[1]!
    expect(dividerRow.classes()).toContain('macro-row--divider')
    // No color swatch, no visibility toggles, no missing badge — only the field.
    expect(dividerRow.find('.macro-row__color').exists()).toBe(false)
    expect(dividerRow.find('.macro-visibility').exists()).toBe(false)

    const input = dividerRow.get<HTMLInputElement>('.macro-row__divider-input')
    await input.setValue('Bed leveling')
    await input.trigger('change')
    expect(config.value.dividerLabels).toEqual({ abc: 'Bed leveling' })

    await dividerRow.get('[title="Move Bed leveling earlier"]').trigger('click')
    expect(config.value.macros).toEqual(['divider::abc', 'CALIBRATE_MESH', 'LOAD_FILAMENT'])

    await wrapper.get('[title="Remove Bed leveling"]').trigger('click')
    expect(config.value.macros).toEqual(['CALIBRATE_MESH', 'LOAD_FILAMENT'])
  })

  it('falls back to a generic label for reordering and removing an untitled heading', async () => {
    const { mountIt } = mountPane({ macros: ['divider::abc'] })
    const wrapper = mountIt()
    await flushPromises()

    expect(wrapper.find('[title="Remove Untitled heading"]').exists()).toBe(true)
  })

  it('scrolls each macro list on its own, and separates them with a rule', async () => {
    const { macros, mountIt } = mountPane({ macros: ['CLEAN_NOZZLE'] })
    macros.discovered = ['CLEAN_NOZZLE', 'LOAD_FILAMENT']
    macros.hasDiscovered = true
    const wrapper = mountIt()
    await flushPromises()

    expect(wrapper.find('.macro-picker__selected').exists()).toBe(true)
    expect(wrapper.find('.macro-picker__available').exists()).toBe(true)
    expect(wrapper.find('.macro-picker__rule').exists()).toBe(true)

    // Selected renders before available now — the swap this pass made.
    const html = wrapper.html()
    expect(html.indexOf('macro-picker__selected')).toBeLessThan(
      html.indexOf('macro-picker__available'),
    )
  })
})
