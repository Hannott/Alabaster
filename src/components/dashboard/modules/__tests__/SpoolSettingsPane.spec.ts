import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'

import SpoolSettingsPane from '@/components/dashboard/modules/SpoolSettingsPane.vue'
import { dashboardModuleContextKey } from '@/dashboard/context'
import { i18n } from '@/i18n'

function mountPane() {
  const pinia = createPinia()
  const config = ref<Record<string, unknown>>({})
  const wrapper = mount(SpoolSettingsPane, {
    global: {
      plugins: [pinia, i18n],
      provide: {
        [dashboardModuleContextKey as symbol]: {
          instanceId: 'spool',
          moduleId: 'spool',
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
  return { wrapper, config }
}

describe('SpoolSettingsPane', () => {
  it('offers the auto-pause toggle, off by default', () => {
    const { wrapper } = mountPane()

    const checkbox = wrapper.get('input[type="checkbox"]')
    expect((checkbox.element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.text()).toContain('Pause the print automatically')
  })

  it('writes the toggle straight to the config', async () => {
    const { wrapper, config } = mountPane()

    await wrapper.get('input[type="checkbox"]').setValue(true)

    expect(config.value.autoPauseOnEmpty).toBe(true)
  })

  it('shows promoted by default, since a never-customized card shows it', () => {
    const { wrapper } = mountPane()

    const pin = wrapper.get('[aria-label*="quick settings"]')
    expect(pin.attributes('aria-pressed')).toBe('true')
  })
})
