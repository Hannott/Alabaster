import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'

import ExtruderMacroSettingsFields from '@/components/dashboard/modules/ExtruderMacroSettingsFields.vue'
import { dashboardModuleContextKey } from '@/dashboard/context'
import { i18n } from '@/i18n'
import { useMacrosStore } from '@/stores/macros'

function mountFields(initialConfig: Record<string, unknown> = {}) {
  const pinia = createPinia()
  const macros = useMacrosStore(pinia)
  const config = ref<Record<string, unknown>>(initialConfig)
  const wrapper = mount(ExtruderMacroSettingsFields, {
    global: {
      plugins: [pinia, i18n],
      provide: {
        [dashboardModuleContextKey as symbol]: {
          instanceId: 'extruder',
          moduleId: 'extruder',
          config: computed(() => config.value),
          updateConfig: (patch: Record<string, unknown>) => {
            config.value = { ...config.value, ...patch }
          },
          isSettingsOpen: computed(() => false),
          openSettings: () => undefined,
          closeSettings: () => undefined,
          isSurfaceOpen: computed(() => false),
          openSurface: () => undefined,
          closeSurface: () => undefined,
        },
      },
    },
  })
  return { macros, config, wrapper }
}

describe('ExtruderMacroSettingsFields', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  /*
   * The whole point of the block. Klipper defines no filament macros, so any
   * default here is a different person's `printer.cfg` — which is exactly what
   * the hardcoded LOAD_FILAMENT/UNLOAD_FILAMENT pair was.
   */
  it('starts with nothing chosen', async () => {
    const { macros, wrapper } = mountFields()
    macros.discovered = ['LOAD_FILAMENT', 'M600']
    macros.hasDiscovered = true
    await flushPromises()

    expect(wrapper.findAll('.macro-picker__selected .macro-row')).toHaveLength(0)
    expect(wrapper.text()).toContain('Add macros from the list below')
  })

  it('offers whatever this printer reports, and moves a choice between the lists', async () => {
    const { macros, config, wrapper } = mountFields()
    macros.discovered = ['M600', 'PURGE_LINE']
    macros.hasDiscovered = true
    await flushPromises()

    const available = wrapper.findAll('.macro-picker__available .macro-row')
    expect(available.map((row) => row.get('.macro-row__name').text())).toEqual([
      'M600',
      'Purge Line',
    ])

    await available[0]?.get('button').trigger('click')
    expect(config.value.macros).toEqual(['M600'])
    // Chosen macros leave the available list, so one cannot be added twice.
    expect(wrapper.findAll('.macro-picker__available .macro-row')).toHaveLength(1)

    // Scoped to the row rather than selected from the wrapper: this component
    // has a fragment root, and a descendant selector run against it does not
    // reach past the first root.
    const chosen = wrapper.findAll('.macro-picker__selected .macro-row')
    expect(chosen).toHaveLength(1)
    await chosen[0]?.get('button').trigger('click')
    expect(config.value.macros).toEqual([])
  })

  it('keeps the order they were added in, because the card draws them in it', async () => {
    const { macros, config, wrapper } = mountFields()
    macros.discovered = ['A_MACRO', 'B_MACRO', 'C_MACRO']
    macros.hasDiscovered = true
    await flushPromises()

    const rows = () => wrapper.findAll('.macro-picker__available .macro-row')
    await rows()[2]?.get('button').trigger('click')
    await rows()[0]?.get('button').trigger('click')
    expect(config.value.macros).toEqual(['C_MACRO', 'A_MACRO'])
  })

  /*
   * A macro the printer stopped defining keeps its row rather than vanishing:
   * the row is the only place the user can find out why a button on the card
   * stopped working.
   */
  it('marks a chosen macro the printer no longer defines instead of dropping it', async () => {
    const { macros, wrapper } = mountFields({ macros: ['LOAD_PLA'] })
    macros.discovered = ['M600']
    macros.hasDiscovered = true
    await flushPromises()

    const selected = wrapper.findAll('.macro-picker__selected .macro-row')
    expect(selected).toHaveLength(1)
    expect(selected[0]?.text()).toContain('Missing')
  })

  it('tells a printer that reported no macros apart from one whose macros are all chosen', async () => {
    const none = mountFields()
    none.macros.hasDiscovered = true
    await flushPromises()
    expect(none.wrapper.text()).toContain('Moonraker reported no macros')

    const all = mountFields({ macros: ['M600'] })
    all.macros.discovered = ['M600']
    all.macros.hasDiscovered = true
    await flushPromises()
    expect(all.wrapper.text()).toContain('already on the card')
  })
})
