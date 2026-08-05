import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { beforeAll, describe, expect, it } from 'vitest'

import ControlsSettingsPane from '@/components/dashboard/modules/ControlsSettingsPane.vue'
import { dashboardModuleContextKey } from '@/dashboard/context'
import { i18n } from '@/i18n'
import { usePrinterConfigStore } from '@/stores/printerConfig'

beforeAll(() => {
  // jsdom ships <dialog> without its modal methods — copied from
  // SettingsView.spec.ts, needed here because the icon picker is a real
  // <dialog> mounted alongside this pane's own section.
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

function mountPane(options: { settings?: Record<string, unknown> } = {}) {
  const pinia = createPinia()
  const printerConfig = usePrinterConfigStore(pinia)
  if (options.settings) printerConfig.settings = options.settings

  const config = ref<Record<string, unknown>>({})
  const wrapper = mount(ControlsSettingsPane, {
    global: {
      plugins: [pinia, i18n],
      provide: {
        [dashboardModuleContextKey as symbol]: {
          instanceId: 'controls',
          moduleId: 'controls',
          config: computed(() => config.value),
          updateConfig: (patch: Record<string, unknown>) => {
            config.value = { ...config.value, ...patch }
          },
          isSettingsOpen: computed(() => false),
          openSettings: () => {},
          closeSettings: () => {},
        },
      },
    },
  })
  return { wrapper, config, printerConfig }
}

describe('ControlsSettingsPane', () => {
  // Motion limits moved to their own Machine card — this pane is now only
  // the card's own visibility toggles, the ones it shares with the quick
  // layer.
  it('carries only the card-settings toggles, not a motion-limits form', () => {
    const { wrapper } = mountPane()

    expect(wrapper.text()).toContain('Show output pins')
    expect(wrapper.text()).toContain('Show the fans Klipper controls')
    expect(wrapper.find('.app-field').exists()).toBe(false)
    expect(wrapper.find('form').exists()).toBe(false)
  })

  it('promotes a toggled setting straight through to the config', async () => {
    const { wrapper, config } = mountPane()

    const checkbox = wrapper.findAll('input[type="checkbox"]').at(0)
    await checkbox?.setValue(false)

    expect(config.value.showOutputPins).toBe(false)
  })

  it('has no Icons section when the printer reports no fans or pins', () => {
    const { wrapper } = mountPane()
    expect(wrapper.text()).not.toContain('Icons')
  })

  it('lists every fan and pin, each with its default icon shown', () => {
    const { wrapper } = mountPane({
      settings: { fan: {}, 'output_pin interior_light': {} },
    })

    const rows = wrapper.findAll('.settings-row')
    // First .settings-row is the card-visibility toggles' own; skip it.
    const iconRows = rows.filter((row) => row.find('.settings-row__label').exists())
    expect(iconRows.map((row) => row.get('.settings-row__label').text())).toEqual([
      'Part fan',
      'interior light',
    ])

    const triggers = wrapper.findAll('button[aria-label^="Choose icon for"]')
    expect(triggers).toHaveLength(2)
  })

  it('opens the picker, writes the choice to outputIcons, and updates the trigger', async () => {
    const { wrapper, config } = mountPane({
      settings: { 'output_pin interior_light': {} },
    })

    await wrapper.get('button[aria-label="Choose icon for interior light"]').trigger('click')
    expect(wrapper.get('dialog').attributes('aria-labelledby')).toBeTruthy()
    expect(wrapper.text()).toContain('Choose an icon — interior light')

    const bulbTile = wrapper.get('.icon-picker-dialog__grid button[aria-label="Light"]')
    await bulbTile.trigger('click')

    expect(config.value.outputIcons).toEqual({ 'output_pin interior_light': 'bulb' })
    expect(wrapper.get('button[aria-label="Choose icon for interior light"] svg').html()).toContain(
      'M16 16h-1.5c0-1.415',
    ) // the bulb glyph's own path data
  })
})
