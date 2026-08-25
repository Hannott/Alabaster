import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SensorsModule from '@/components/dashboard/modules/SensorsModule.vue'
import { i18n } from '@/i18n'
import { useSensorsStore } from '@/stores/sensors'

function mountModule(pinia: ReturnType<typeof createPinia>) {
  return mount(SensorsModule, { global: { plugins: [pinia, i18n] } })
}

describe('SensorsModule', () => {
  it('says so when nothing has reported yet', () => {
    const pinia = createPinia()
    const wrapper = mountModule(pinia)

    expect(wrapper.text()).toContain('No sensors reporting yet.')
  })

  it('shows a single-value sensor under its own name', () => {
    const pinia = createPinia()
    const sensors = useSensorsStore(pinia)
    sensors.sensors = [{ id: 'chamber', friendlyName: 'Chamber', values: { temperature: 22.456 } }]
    const wrapper = mountModule(pinia)

    expect(wrapper.text()).toContain('Chamber')
    expect(wrapper.text()).toContain('22.46')
  })

  /*
   * A sensor with more than one reported value has no single number that
   * speaks for it, so each gets its own row named after the value itself —
   * the same reasoning `TemperaturesModule` never needs, since every one of
   * its rows already has exactly one reading.
   */
  it('splits a multi-value sensor into one row per value', () => {
    const pinia = createPinia()
    const sensors = useSensorsStore(pinia)
    sensors.sensors = [
      { id: 'power', friendlyName: 'Power meter', values: { value1: 0, value2: 119.8 } },
    ]
    const wrapper = mountModule(pinia)

    expect(wrapper.text()).toContain('Power meter · Value1')
    expect(wrapper.text()).toContain('Power meter · Value2')
    expect(wrapper.text()).toContain('119.8')
  })
})
