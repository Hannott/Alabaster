import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'

import BedMeshQuickSettings from '@/components/dashboard/modules/BedMeshQuickSettings.vue'
import { dashboardModuleContextKey } from '@/dashboard/context'
import { i18n } from '@/i18n'

function mountQuickSettings(initialConfig: Record<string, unknown> = {}) {
  const config = ref<Record<string, unknown>>(initialConfig)
  const wrapper = mount(BedMeshQuickSettings, {
    global: {
      plugins: [createPinia(), i18n],
      provide: {
        [dashboardModuleContextKey as symbol]: {
          instanceId: 'bedMesh',
          moduleId: 'bedMesh',
          config: computed(() => config.value),
          updateConfig: (patch: Record<string, unknown>) => {
            config.value = { ...config.value, ...patch }
          },
          isSettingsOpen: computed(() => true),
          openSettings: () => undefined,
          closeSettings: () => undefined,
          isSurfaceOpen: computed(() => false),
          openSurface: () => undefined,
          closeSurface: () => undefined,
        },
      },
    },
  })
  return { config, wrapper }
}

describe('BedMeshQuickSettings', () => {
  it('stays within the four rows the dashboard contract allows on a card', () => {
    // The three layers share one row deliberately. Stacked, they would push
    // this layer past the point where the contract says configuration belongs
    // in the settings surface instead.
    // Every row is one `.settings-row`, whichever shape it takes inside — the
    // layer choices are a label beside a check set, the rest a single checkbox.
    const { wrapper } = mountQuickSettings()
    const rows = wrapper.findAll('.settings-row')
    expect(rows).toHaveLength(4)
    const layerRow = wrapper.find('.settings-row')
    expect(layerRow.text()).toContain('Mesh')
    expect(layerRow.text()).toContain('Probed')
    expect(layerRow.text()).toContain('Level')
  })

  it('shows the interpolated mesh by default and leaves the rest to be asked for', () => {
    const { wrapper } = mountQuickSettings()
    const boxes = wrapper.findAll('input[type="checkbox"]')
    // In pane order — the layer set, then the rest of the height map, then the
    // color scale. A promoted row never moves, so the card lists them exactly
    // as the pane does.
    expect(boxes.map((box) => (box.element as HTMLInputElement).checked)).toEqual([
      true, // mesh
      false, // probed
      false, // level reference plane
      true, // wireframe
      true, // probed points
      false, // scale colors to this mesh
    ])
  })

  it('drops a row the pane demoted, and keeps the others where they were', async () => {
    const { config, wrapper } = mountQuickSettings({ quickSettings: ['wireframe', 'showProbes'] })
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(2)
    expect(wrapper.text()).not.toContain('Scale colors')

    // Emptied deliberately is a real state, distinct from never customized:
    // the card's gear then opens the full surface instead of an empty layer.
    config.value = { quickSettings: [] }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('input').exists()).toBe(false)
  })

  it('never offers the pin from the card, only from the pane', () => {
    // Demoting a setting is a decision made where every setting is visible.
    const { wrapper } = mountQuickSettings()
    expect(wrapper.findAll('[aria-label*="quick settings"]')).toHaveLength(0)
  })

  it('writes each layer to its own key, so one card can differ from another', async () => {
    const { config, wrapper } = mountQuickSettings()
    await wrapper.findAll('input[type="checkbox"]')[1]?.trigger('change')
    expect(config.value.showProbedLayer).toBe(true)
    expect(config.value.showMeshLayer).toBeUndefined()
  })
})
