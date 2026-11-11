import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import HeaderHeaters from '@/components/HeaderHeaters.vue'
import { i18n } from '@/i18n'
import { useTelemetryStore, type SensorReading } from '@/stores/telemetry'

function reading(overrides: Partial<SensorReading> & Pick<SensorReading, 'objectName' | 'kind'>) {
  return {
    name: overrides.objectName,
    temperature: 25,
    target: 0,
    power: null,
    speed: null,
    isSettable: overrides.kind !== 'sensor',
    ...overrides,
  } satisfies SensorReading
}

function mountHeaters(readings: SensorReading[]) {
  const telemetry = useTelemetryStore()
  telemetry.sensorObjects = readings.map((entry) => entry.objectName)
  telemetry.readings = Object.fromEntries(readings.map((entry) => [entry.objectName, entry]))
  return {
    telemetry,
    wrapper: mount(HeaderHeaters, {
      global: { plugins: [i18n], stubs: { transition: false, 'transition-group': false } },
    }),
  }
}

describe('HeaderHeaters', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('shows a pill only for heaters with a target, never for fans or sensors', () => {
    const { wrapper } = mountHeaters([
      reading({ objectName: 'extruder', kind: 'extruder', temperature: 142.4, target: 220 }),
      reading({ objectName: 'heater_bed', kind: 'bed', temperature: 24, target: 0 }),
      reading({
        objectName: 'heater_generic chamber',
        name: 'chamber',
        kind: 'heater',
        temperature: 31,
        target: 40,
      }),
      reading({ objectName: 'temperature_fan mcu', kind: 'temperatureFan', target: 45 }),
      reading({ objectName: 'temperature_sensor host', kind: 'sensor', temperature: 50 }),
    ])

    const pills = wrapper.findAll('.header-heater')
    expect(pills.map((pill) => pill.attributes('aria-label'))).toEqual([
      'Hotend: 142 °C, target 220 °C',
      'chamber: 31 °C, target 40 °C',
    ])
    expect(pills[0]!.get('.header-heater__reading').text()).toBe('142°')
    expect(pills[0]!.get('.header-heater__target').text()).toBe('/ 220°')
  })

  /** PID wobble at temperature must not fold and unfold the target on every sample. */
  it('keeps the target unfolded only while the reading is more than 2° away', async () => {
    const { wrapper, telemetry } = mountHeaters([
      reading({ objectName: 'heater_bed', kind: 'bed', temperature: 48, target: 60 }),
    ])
    expect(wrapper.get('.header-heater').classes()).toContain('header-heater--approaching')

    telemetry.readings = {
      heater_bed: reading({ objectName: 'heater_bed', kind: 'bed', temperature: 58.5, target: 60 }),
    }
    await nextTick()
    expect(wrapper.get('.header-heater').classes()).not.toContain('header-heater--approaching')
  })

  it('leaves the header the moment the target goes to zero, however hot the heater still is', async () => {
    const { wrapper, telemetry } = mountHeaters([
      reading({ objectName: 'heater_bed', kind: 'bed', temperature: 60, target: 60 }),
    ])
    expect(wrapper.findAll('.header-heater')).toHaveLength(1)

    telemetry.readings = {
      heater_bed: reading({ objectName: 'heater_bed', kind: 'bed', temperature: 60, target: 0 }),
    }
    await nextTick()
    expect(wrapper.findAll('.header-heater')).toHaveLength(0)
  })

  it('is display only', () => {
    const { wrapper } = mountHeaters([
      reading({ objectName: 'extruder', kind: 'extruder', temperature: 220, target: 220 }),
    ])
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.find('a').exists()).toBe(false)
  })
})
