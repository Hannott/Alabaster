import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import NonlinearPressureAdvancePanel from '@/components/calibration/NonlinearPressureAdvancePanel.vue'
import { i18n } from '@/i18n'
import { useAvailabilityStore } from '@/stores/availability'
import { useCalibrationStore } from '@/stores/calibration'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'

enableAutoUnmount(afterEach)

let pinia: Pinia

function seed(extruder: Record<string, unknown>): void {
  usePrinterConfigStore(pinia).settings = {
    extruder: { nozzle_diameter: 0.4, ...extruder },
    pa_test: { height: 50 },
    printer: { max_accel: 5000 },
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  pinia = createPinia()
  setActivePinia(pinia)
  const moonraker = useMoonrakerStore(pinia)
  moonraker.connectionPhase = 'connected'
  const availability = useAvailabilityStore(pinia)
  availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
  availability.printerSnapshotSynchronized()
  vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({} as never)
})

async function mountPanel(): Promise<VueWrapper> {
  const panel = mount(NonlinearPressureAdvancePanel, { global: { plugins: [i18n, pinia] } })
  await flushPromises()
  return panel
}

function tab(panel: VueWrapper, label: string) {
  const found = panel.findAll('.tab-select').find((button) => button.text() === label)
  if (!found) throw new Error(`no "${label}" tab`)
  return found
}

async function setField(panel: VueWrapper, label: string, value: string): Promise<void> {
  const field = panel.findAll('.app-field').find((candidate) => candidate.text().includes(label))
  if (!field) throw new Error(`no "${label}" field`)
  const input = field.find('input')
  await input.setValue(value)
  await input.trigger('change')
  await input.trigger('blur')
  await flushPromises()
}

describe('NonlinearPressureAdvancePanel', () => {
  it('opens on the starting values while the extruder runs a linear model', async () => {
    seed({ pressure_advance: 0.04 })
    const panel = await mountPanel()
    expect(tab(panel, 'Start').attributes('aria-pressed')).toBe('true')
    expect(panel.text()).toContain('Next: write the starting values.')
    expect(panel.text()).toContain('Removes pressure_advance')
  })

  it('prints the tower it suggests with the range it shows', async () => {
    seed({
      pressure_advance_model: 'recipr',
      linear_advance: 0,
      nonlinear_offset: 0,
      linearization_velocity: 1,
      pressure_advance_smooth_time: 0.02,
      pressure_advance_time_offset: 0,
    })
    const sendGcode = vi.spyOn(usePrinterStore(pinia), 'sendGcode').mockResolvedValue(true)
    const panel = await mountPanel()
    expect(tab(panel, 'Offset').attributes('aria-pressed')).toBe('true')
    await panel
      .findAll('button')
      .find((button) => button.text() === 'Print tower')!
      .trigger('click')
    await flushPromises()
    expect(sendGcode).toHaveBeenCalledWith(
      'RUN_PA_TEST NOZZLE=0.4 TARGET_TEMP=210 BED_TEMP=60 TESTPARAM=1 PA_VALUE=0.5 PA_RANGE=0.5',
      'calibration',
      // The tower heats and prints before the macro returns; no local deadline cuts it short.
      { timeoutMs: null },
    )
  })

  it('turns a side height into a value and suggests the next tower', async () => {
    seed({ pressure_advance_model: 'recipr', linear_advance: 0, nonlinear_offset: 0 })
    const calibration = useCalibrationStore(pinia)
    const panel = await mountPanel()
    await setField(panel, 'Side', '13.5')
    expect(panel.text()).toContain('Keep nonlinear_offset = 0.135.')
    expect(panel.text()).toContain('Then print the advance tower.')

    await panel
      .findAll('button')
      .find((button) => button.text() === 'Save reading')!
      .trigger('click')
    await flushPromises()
    const [entry] = calibration.historyFor('nonlinearPressureAdvance')
    expect(entry?.values).toMatchObject({ kind: 'reading', tower: 'offset', side: '13.5' })
    expect(panel.text()).toContain('Next: print the advance tower.')
    expect(panel.find('.calibration-history').text()).toContain('nonlinear_offset 0.135')
  })

  it('asks for the offset to come down when the side converges below the front', async () => {
    seed({ pressure_advance_model: 'recipr', linear_advance: 0, nonlinear_offset: 0.135 })
    const panel = await mountPanel()
    await tab(panel, 'Advance').trigger('click')
    await setField(panel, 'Side', '5')
    await setField(panel, 'Front', '20')
    expect(panel.text()).toContain('The side converges 15 mm below the front.')
    expect(panel.text()).toContain('Lower nonlinear_offset 10% to 0.1215')
  })
})
