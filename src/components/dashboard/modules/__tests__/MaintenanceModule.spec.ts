import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import MaintenanceModule from '@/components/dashboard/modules/MaintenanceModule.vue'
import { i18n } from '@/i18n'
import { useHistoryStore } from '@/stores/history'
import { useMaintenanceStore } from '@/stores/maintenance'

function mountModule(pinia: ReturnType<typeof createPinia>) {
  return mount(MaintenanceModule, { global: { plugins: [pinia, i18n] } })
}

describe('MaintenanceModule', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('says so when there are no intervals yet', () => {
    const pinia = createPinia()
    const wrapper = mountModule(pinia)

    expect(wrapper.text()).toContain('No maintenance intervals yet.')
  })

  it('lists an interval with how long until it is due', () => {
    const pinia = createPinia()
    const history = useHistoryStore(pinia)
    history.totals = {
      jobs: 1,
      totalTime: 0,
      printTime: 0,
      filamentUsed: 0,
      longestJob: 0,
      longestPrint: 0,
      auxiliaryTotals: [],
    }
    const maintenance = useMaintenanceStore(pinia)
    maintenance.addInterval('Belt tension', 'printtime', 100)
    // Ten hours have printed since the interval was created.
    history.totals = { ...history.totals, printTime: 10 * 3600 }
    const wrapper = mountModule(pinia)

    expect(wrapper.text()).toContain('Belt tension')
    expect(wrapper.text()).toContain('in 90h')
  })

  it('reports overdue, distinctly from ok, on the same row shape', () => {
    const pinia = createPinia()
    const history = useHistoryStore(pinia)
    history.totals = {
      jobs: 1,
      totalTime: 0,
      printTime: 0,
      filamentUsed: 0,
      longestJob: 0,
      longestPrint: 0,
      auxiliaryTotals: [],
    }
    const maintenance = useMaintenanceStore(pinia)
    maintenance.addInterval('Belt tension', 'printtime', 10)
    history.totals = { ...history.totals, printTime: 11 * 3600 }
    const wrapper = mountModule(pinia)

    expect(wrapper.get('.maintenance-row').classes()).toContain('maintenance-row--overdue')
    expect(wrapper.text()).toContain('1h over')
  })

  it('clears an overdue row by marking it performed', async () => {
    const pinia = createPinia()
    const history = useHistoryStore(pinia)
    history.totals = {
      jobs: 1,
      totalTime: 0,
      printTime: 0,
      filamentUsed: 0,
      longestJob: 0,
      longestPrint: 0,
      auxiliaryTotals: [],
    }
    const maintenance = useMaintenanceStore(pinia)
    maintenance.addInterval('Belt tension', 'printtime', 10)
    history.totals = { ...history.totals, printTime: 11 * 3600 }
    const wrapper = mountModule(pinia)
    expect(wrapper.get('.maintenance-row').classes()).toContain('maintenance-row--overdue')

    await wrapper.get('button').trigger('click')

    expect(wrapper.get('.maintenance-row').classes()).toContain('maintenance-row--ok')
  })

  it('adds a new interval through the inline form', async () => {
    const pinia = createPinia()
    const wrapper = mountModule(pinia)

    await wrapper.get('button').trigger('click')
    await wrapper.get('#maintenance-name').setValue('Nozzle change')
    await wrapper.get('#maintenance-value').setValue(200)
    await wrapper.get('form').trigger('submit')

    const maintenance = useMaintenanceStore(pinia)
    expect(maintenance.intervals).toHaveLength(1)
    expect(maintenance.intervals[0]).toMatchObject({ name: 'Nozzle change', value: 200 })
  })
})
