import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'

import PrintSettingsPane from '@/components/dashboard/modules/PrintSettingsPane.vue'
import { dashboardModuleContextKey } from '@/dashboard/context'
import { i18n } from '@/i18n'
import { usePrinterStore } from '@/stores/printer'

function mountPane(initial: Record<string, unknown> = {}) {
  const pinia = createPinia()
  const printer = usePrinterStore(pinia)
  const config = ref<Record<string, unknown>>(initial)
  const wrapper = mount(PrintSettingsPane, {
    global: {
      plugins: [pinia, i18n],
      provide: {
        [dashboardModuleContextKey as symbol]: {
          instanceId: 'print',
          moduleId: 'print',
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
      },
    },
  })
  return { printer, wrapper, config }
}

describe('PrintSettingsPane', () => {
  it('offers per-state reset settings, off by default', async () => {
    const { wrapper } = mountPane()
    await flushPromises()

    for (const label of ['Completes', 'Is cancelled', 'Fails']) {
      const row = wrapper.findAll('.check-row').find((candidate) => candidate.text() === label)
      expect(row?.find('input').element.checked, label).toBe(false)
    }
  })

  it.each([
    ['Start a print without confirming', 'skipStartWarning'],
    ['Pause a print without confirming', 'skipPauseWarning'],
    ['Cancel a print without confirming', 'skipCancelWarning'],
  ])('offers to skip its own confirmation: %s', async (text, key) => {
    const { wrapper, config } = mountPane()
    await flushPromises()

    const row = wrapper.findAll('.check-row').find((candidate) => candidate.text().includes(text))
    const checkbox = row?.get('input[type="checkbox"]')
    expect((checkbox?.element as HTMLInputElement).checked).toBe(false)

    await checkbox?.setValue(true)
    expect(config.value[key]).toBe(true)
  })

  /**
   * The reset choices used to hide with a speed block on this card. Both factors
   * now live on the cards whose commands they scale, so there is no block left
   * to hide with — and *when a job ends* is a print-lifecycle policy either way.
   * Klipper never clears these itself, so a reset that quietly stopped being
   * configurable because an unrelated toggle was off was the worse outcome.
   */
  it('always offers the reset-on-finish choices, with no card block left to gate them', async () => {
    const { wrapper } = mountPane()
    await flushPromises()

    expect(wrapper.text()).toContain('Completes')
    expect(wrapper.text()).toContain('Remaining time from')
    // The speed control itself is Movement's now, so nothing here configures it.
    expect(wrapper.text()).not.toContain('Always show speed')
  })

  it('says so when M73 was asked for and the printer never reports it', async () => {
    const { printer, wrapper } = mountPane({ useSlicerProgress: true })
    await flushPromises()

    expect(wrapper.text()).toContain('not reporting M73 progress')

    printer.displayProgress = 0.6
    await flushPromises()
    expect(wrapper.text()).not.toContain('not reporting M73 progress')
  })
})
