import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import ControlsModule from '@/components/dashboard/modules/ControlsModule.vue'
import { dashboardModuleContextKey } from '@/dashboard/context'
import { i18n } from '@/i18n'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { useTelemetryStore } from '@/stores/telemetry'

function mountModule(
  options: {
    config?: Record<string, unknown>
    configure?: (stores: {
      printerConfig: ReturnType<typeof usePrinterConfigStore>
      telemetry: ReturnType<typeof useTelemetryStore>
    }) => void
  } = {},
) {
  const pinia = createPinia()
  const printerConfig = usePrinterConfigStore(pinia)
  const telemetry = useTelemetryStore(pinia)
  options.configure?.({ printerConfig, telemetry })

  const config = ref<Record<string, unknown>>(options.config ?? {})
  const wrapper = mount(ControlsModule, {
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
  return { printerConfig, telemetry, wrapper }
}

describe('ControlsModule', () => {
  it('reads the fans Klipper drives on its own as AppOutputRow readings', async () => {
    const { wrapper } = mountModule({
      configure: ({ printerConfig, telemetry }) => {
        printerConfig.settings = {
          'heater_fan hotend_fan': {},
          'controller_fan controller_fan': {},
        }
        telemetry.fans = {
          'heater_fan hotend_fan': { objectName: 'heater_fan hotend_fan', speed: 1, rpm: 4200 },
          'controller_fan controller_fan': {
            objectName: 'controller_fan controller_fan',
            speed: 0,
            rpm: null,
          },
        }
      },
    })
    await flushPromises()

    const rows = wrapper.findAll('.app-output-row').filter((row) => row.find('.fan-icon').exists())
    expect(rows).toHaveLength(2)
    expect(rows[0]?.get('.app-output-row__label').text()).toBe('hotend fan')
    // The unit is a visible sibling of the value, matching AppField/AppSlider.
    expect(rows[0]?.get('.app-output-row__value').text()).toBe('100%')
    expect(rows[1]?.get('.app-output-row__value').text()).toBe('0%')

    // The running fan's icon spins; the idle one's does not.
    const icons = rows.map((row) => row.get('.fan-icon'))
    expect(icons[0]?.classes()).toContain('fan-icon--spinning')
    expect(icons[1]?.classes()).not.toContain('fan-icon--spinning')
  })

  it('drives the part-cooling fan from an AppSlider that commits on release or a stepper press', async () => {
    const { printerConfig, wrapper } = mountModule({
      configure: ({ printerConfig, telemetry }) => {
        printerConfig.settings = { fan: {} }
        telemetry.fans = { fan: { objectName: 'fan', speed: 0.4, rpm: null } }
      },
    })
    await flushPromises()

    const setFanSpeed = vi.spyOn(usePrinterStore(), 'setFanSpeed').mockResolvedValue(true)
    const slider = wrapper.get('.app-slider')
    expect(slider.text()).toContain('Part fan')

    const track = slider.get('.app-slider__track')
    ;(track.element as HTMLInputElement).value = '75'
    await track.trigger('input')
    expect(setFanSpeed).not.toHaveBeenCalled()
    await track.trigger('change')
    expect(setFanSpeed).toHaveBeenLastCalledWith(75)

    await slider.get('.app-slider__stepper--up').trigger('click')
    expect(setFanSpeed).toHaveBeenLastCalledWith(76)

    expect(printerConfig.fans[0]?.kind).toBe('part')
  })

  it('shows the unavailable dash rather than a stale speed before Klipper reports one', async () => {
    const { wrapper } = mountModule({
      configure: ({ printerConfig }) => {
        printerConfig.settings = { 'heater_fan hotend_fan': {} }
      },
    })
    await flushPromises()

    // No unit rides along beside a placeholder that is not itself a value.
    expect(wrapper.get('.app-output-row__value').text()).toBe('—')
  })

  it('renders a digital pin and a PWM pin in the same list, each keeping its own control', async () => {
    const { wrapper } = mountModule({
      configure: ({ printerConfig }) => {
        printerConfig.settings = {
          'output_pin led': { pwm: false },
          'output_pin laser': { pwm: true, scale: 255 },
        }
      },
    })
    await flushPromises()

    const rows = wrapper.findAll('.pin-row, .output-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.find('input.switch').exists()).toBe(true)
    expect(rows[0]?.find('input[type="range"]').exists()).toBe(false)
    expect(rows[1]?.find('input[type="range"]').exists()).toBe(true)
  })

  it('shares one separator across fan sliders, pins, and monitored fans, flush only on the true last row', async () => {
    const { wrapper } = mountModule({
      configure: ({ printerConfig, telemetry }) => {
        printerConfig.settings = {
          fan: {},
          'output_pin led': { pwm: false },
          'heater_fan hotend_fan': {},
        }
        telemetry.fans = {
          fan: { objectName: 'fan', speed: 0.5, rpm: null },
          'heater_fan hotend_fan': { objectName: 'heater_fan hotend_fan', speed: 1, rpm: 4200 },
        }
      },
    })
    await flushPromises()

    // Sliders and AppOutputRow take `output-row`, since `.pin-row`'s own
    // layout rules would collapse AppSlider's two-row anatomy into one.
    const rows = wrapper.findAll('.output-row')
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.classes('output-row--flush'))).toEqual([false, false, true])
  })

  it('toggles a digital pin through the switch rather than a button', async () => {
    const { wrapper } = mountModule({
      configure: ({ printerConfig }) => {
        printerConfig.settings = { 'output_pin led': { pwm: false } }
      },
    })
    await flushPromises()

    const setOutputPin = vi.spyOn(usePrinterStore(), 'setOutputPin').mockResolvedValue(true)
    const toggle = wrapper.get('.output-row input.switch')
    expect((toggle.element as HTMLInputElement).checked).toBe(false)

    await toggle.setValue(true)

    expect(setOutputPin).toHaveBeenCalledWith('output_pin led', 1)
  })
})
