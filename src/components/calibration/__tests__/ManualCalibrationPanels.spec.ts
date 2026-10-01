import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Component } from 'vue'

import BedLayoutCard from '@/components/calibration/BedLayoutCard.vue'
import LoadCellPanel from '@/components/calibration/LoadCellPanel.vue'
import ProbeXyOffsetPanel from '@/components/calibration/ProbeXyOffsetPanel.vue'
import ScrewPositionsPanel from '@/components/calibration/ScrewPositionsPanel.vue'
import SensorlessHomingPanel from '@/components/calibration/SensorlessHomingPanel.vue'
import SkewCorrectionPanel from '@/components/calibration/SkewCorrectionPanel.vue'
import TuningTowerPanel from '@/components/calibration/TuningTowerPanel.vue'
import { resetCalibrationSelection } from '@/composables/useCalibrationSelection'
import { i18n } from '@/i18n'
import { useAvailabilityStore } from '@/stores/availability'
import { useCalibrationStore } from '@/stores/calibration'
import { useConsoleStore } from '@/stores/console'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'

enableAutoUnmount(afterEach)

let pinia: Pinia

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  resetCalibrationSelection()
  pinia = createPinia()
  setActivePinia(pinia)
  const moonraker = useMoonrakerStore(pinia)
  moonraker.connectionPhase = 'connected'
  const availability = useAvailabilityStore(pinia)
  availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
  availability.printerSnapshotSynchronized()
  vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({} as never)
})

/** `written` is what the files hold; the settings carry Klipper's defaults on top of it. */
function seed(
  settings: Record<string, Record<string, unknown>>,
  written: Record<string, Record<string, string>> = {},
): void {
  const printerConfig = usePrinterConfigStore(pinia)
  printerConfig.settings = settings
  printerConfig.loadedConfig = written
}

/** Klipper goes away and comes back ready, as a restart or a firmware restart does. */
async function restartKlipper(): Promise<void> {
  const availability = useAvailabilityStore(pinia)
  availability.handleKlipperNotification('notify_klippy_disconnected')
  await flushPromises()
  availability.handleKlipperNotification('notify_klippy_ready')
  availability.printerSnapshotSynchronized()
  await flushPromises()
}

async function mountPanel(component: Component): Promise<VueWrapper> {
  const panel = mount(component, { global: { plugins: [i18n, pinia] } })
  await flushPromises()
  return panel
}

async function setField(panel: VueWrapper, label: string, value: string, index = 0): Promise<void> {
  const fields = panel.findAll('.app-field').filter((field) => field.text().includes(label))
  const field = fields[index]
  if (!field) throw new Error(`no "${label}" field`)
  const input = field.find('input')
  await input.setValue(value)
  await input.trigger('change')
  await input.trigger('blur')
  await flushPromises()
}

async function press(panel: VueWrapper, label: string): Promise<void> {
  const button = panel.findAll('button').find((candidate) => candidate.text() === label)
  if (!button) throw new Error(`no "${label}" button`)
  await button.trigger('click')
  await flushPromises()
}

async function standAt(x: number, y: number): Promise<void> {
  const printer = usePrinterStore(pinia)
  printer.motion.homedAxes = 'xyz'
  printer.motion.position = [x, y, 5]
  await flushPromises()
}

describe('SkewCorrectionPanel', () => {
  it('shows the skew as it is typed, and sets and saves only the planes measured', async () => {
    seed({ skew_correction: {} })
    const sendGcode = vi.spyOn(usePrinterStore(pinia), 'sendGcode').mockResolvedValue(true)
    const panel = await mountPanel(SkewCorrectionPanel)
    await setField(panel, 'AC', '140.4')
    await setField(panel, 'BD', '142.8')
    await setField(panel, 'AD', '99.8')
    expect(panel.text()).toContain('Skew -0.97°')
    expect(panel.text()).toContain('No macro loads a skew profile.')

    await press(panel, 'Set and save profile')
    expect(sendGcode).toHaveBeenCalledWith(
      'SET_SKEW CLEAR=1\nSET_SKEW XY=140.4,142.8,99.8\nSKEW_PROFILE SAVE=default',
      'calibration',
    )
    expect(useCalibrationStore(pinia).historyFor('skewCorrection')[0]?.rows).toEqual([
      { label: { literal: 'XY' }, after: '-0.97' },
    ])
  })
})

describe('TuningTowerPanel', () => {
  it('arms the tower, then turns the measured height into the value to keep', async () => {
    seed({ extruder: { pressure_advance: 0.04 } })
    const sendGcode = vi.spyOn(usePrinterStore(pinia), 'sendGcode').mockResolvedValue(true)
    const runAction = vi.spyOn(useCalibrationStore(pinia), 'runAction').mockResolvedValue('saved')
    const panel = await mountPanel(TuningTowerPanel)
    await panel.find('input[value="bowden"]').setValue(true)
    await flushPromises()
    await press(panel, 'Send tower')
    expect(sendGcode).toHaveBeenCalledWith(
      'SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=1 ACCEL=500\n' +
        'TUNING_TOWER COMMAND=SET_PRESSURE_ADVANCE PARAMETER=ADVANCE START=0 FACTOR=0.02',
      'calibration',
    )

    expect(panel.text()).toContain('Tower armed.')
    // A restart disarms the tower, so the note that says it is armed goes with it.
    await restartKlipper()
    expect(panel.text()).not.toContain('Tower armed.')

    await setField(panel, 'Height', '12.9')
    expect(panel.find('.calibration-result').text()).toContain('0.258')
    await press(panel, 'Save and restart')
    expect(runAction).toHaveBeenCalledWith(
      expect.objectContaining({
        section: 'extruder',
        changes: [{ option: 'pressure_advance', value: '0.258' }],
        restart: true,
      }),
    )
  })
})

describe('ProbeXyOffsetPanel', () => {
  it('works the offset out from where the nozzle and then the probe stood on the mark', async () => {
    seed({ probe: { x_offset: 0, y_offset: 25, z_offset: 1 } })
    const runAction = vi.spyOn(useCalibrationStore(pinia), 'runAction').mockResolvedValue('saved')
    await standAt(150, 150)
    const panel = await mountPanel(ProbeXyOffsetPanel)
    await press(panel, 'Record nozzle')
    await standAt(175, 140)
    await press(panel, 'Record probe')
    expect(panel.find('.calibration-result').text()).toContain('-25')
    await press(panel, 'Save and restart')
    expect(runAction).toHaveBeenCalledWith(
      expect.objectContaining({
        section: 'probe',
        changes: [
          { option: 'x_offset', value: '-25' },
          { option: 'y_offset', value: '10' },
        ],
      }),
    )
  })
})

describe('ScrewPositionsPanel', () => {
  it('turns nozzle positions into probe-aimed coordinates and drops the screw no longer there', async () => {
    seed(
      {
        probe: { x_offset: -25, y_offset: 10, z_offset: 1 },
        screws_tilt_adjust: {
          screw1: [30, 30],
          screw1_name: 'screw at 30.000,30.000',
          screw2: [200, 30],
          screw3: [200, 200],
          screw4: [30, 200],
        },
      },
      {
        screws_tilt_adjust: {
          screw1: '30, 30',
          screw2: '200, 30',
          screw3: '200, 200',
          screw4: '30, 200',
        },
      },
    )
    const runAction = vi.spyOn(useCalibrationStore(pinia), 'runAction').mockResolvedValue('saved')
    const panel = await mountPanel(ScrewPositionsPanel)
    await panel.find('input[value="nozzle"]').setValue(true)
    for (const [x, y] of [
      [40, 40],
      [180, 40],
      [110, 190],
    ] as const) {
      await standAt(x, y)
      await press(panel, `Record screw ${panel.findAll('.calibration-screw-record').length + 1}`)
    }
    expect(panel.find('.calibration-screw-records').text()).toContain('65, 30')
    await press(panel, 'Save and restart')
    expect(runAction).toHaveBeenCalledWith(
      expect.objectContaining({
        section: 'screws_tilt_adjust',
        changes: [
          { option: 'screw1', value: '65, 30' },
          { option: 'screw2', value: '205, 30' },
          { option: 'screw3', value: '135, 180' },
        ],
        removes: ['screw4'],
      }),
    )
  })
})

describe('SensorlessHomingPanel', () => {
  it('homes at each sensitivity and keeps a third of the way up from the minimum', async () => {
    seed({
      stepper_x: { endstop_pin: 'tmc2209_stepper_x:virtual_endstop', homing_retract_dist: 0 },
      'tmc2209 stepper_x': { driver_sgthrs: 100 },
    })
    const sendGcode = vi.spyOn(usePrinterStore(pinia), 'sendGcode').mockResolvedValue(true)
    const panel = await mountPanel(SensorlessHomingPanel)
    expect(panel.text()).not.toContain('homing_retract_dist')

    for (const [value, outcome] of [
      ['120', 'Homed, one touch'],
      ['60', 'Homed, one touch'],
      ['40', 'Homed, banged'],
    ] as const) {
      await setField(panel, 'SGTHRS', value)
      await press(panel, 'Set and home X')
      await press(panel, outcome)
    }
    expect(sendGcode).toHaveBeenCalledWith(
      'SET_TMC_FIELD STEPPER=stepper_x FIELD=sgthrs VALUE=120\nG4 P2000\nG28 X',
      'calibration',
      { timeoutMs: null },
    )
    expect(panel.text()).toContain('driver_SGTHRS: 80')
  })
})

describe('SensorlessHomingPanel when a home finds no stall', () => {
  it("records Klipper's no-trigger as the answer and offers a more sensitive value", async () => {
    seed(
      {
        stepper_x: { endstop_pin: 'tmc2209_stepper_x:virtual_endstop', homing_retract_dist: 0 },
        'tmc2209 stepper_x': { driver_sgthrs: 100 },
      },
      { 'tmc2209 stepper_x': { diag_pin: '^STOP0' } },
    )
    const printer = usePrinterStore(pinia)
    vi.spyOn(printer, 'sendGcode').mockImplementation(async () => {
      printer.lastCommandErrorMessage = 'No trigger on x after full movement'
      return false
    })
    const panel = await mountPanel(SensorlessHomingPanel)
    await setField(panel, 'SGTHRS', '100')
    await press(panel, 'Set and home X')
    expect(panel.text()).toContain('The driver reported no stall the whole move')
    expect(panel.text()).not.toContain('What did it do at 100?')
    expect(panel.find('.calibration-result').text()).toContain('No stall seen')
    expect(panel.findAll('input').map((input) => input.element.value)).toContain('110')
  })
})

describe('SensorlessHomingPanel on an axis that homes on a switch', () => {
  it('says what to write instead of offering a home that would only find the switch', async () => {
    seed(
      {
        stepper_x: { endstop_pin: 'tmc2209_stepper_x:virtual_endstop', homing_retract_dist: 0 },
        'tmc2209 stepper_x': { driver_sgthrs: 100, hold_current: 2 },
        stepper_y: { endstop_pin: '^STOP1', homing_retract_dist: 1 },
        'tmc2209 stepper_y': { hold_current: 2 },
      },
      { 'tmc2209 stepper_y': { hold_current: '2' } },
    )
    const panel = await mountPanel(SensorlessHomingPanel)
    // X's hold_current is Klipper's default, not a line in the file: nothing to change.
    expect(panel.find('.calibration-sensorless-setup').exists()).toBe(false)

    await panel.find('input[value="stepper_y"]').setValue(true)
    await flushPromises()
    expect(panel.text()).toContain('stepper_y homes on a switch.')
    expect(panel.find('.calibration-snippet').text()).toContain(
      'endstop_pin: tmc2209_stepper_y:virtual_endstop',
    )
    expect(panel.text()).toContain('Remove hold_current from [tmc2209 stepper_y].')
    expect(panel.findAll('button').some((button) => button.text() === 'Set and home Y')).toBe(false)
  })

  it('fixes both sections of the axis with one restart, the DIAG pin taken from the field', async () => {
    seed(
      {
        stepper_y: { endstop_pin: '^STOP1', homing_retract_dist: 1 },
        'tmc2209 stepper_y': { hold_current: 2 },
      },
      { 'tmc2209 stepper_y': { hold_current: '2' } },
    )
    const runAction = vi.spyOn(useCalibrationStore(pinia), 'runAction').mockResolvedValue('saved')
    const panel = await mountPanel(SensorlessHomingPanel)
    // The DIAG jumper connects the driver to the endstop input, so that is where it starts.
    expect(panel.find('.calibration-snippet').text()).toContain('diag_pin: ^STOP1')

    await setField(panel, 'DIAG pin', '^PG6')
    await press(panel, 'Fix config and restart')
    expect(runAction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        section: 'stepper_y',
        changes: [
          { option: 'endstop_pin', value: 'tmc2209_stepper_y:virtual_endstop' },
          { option: 'homing_retract_dist', value: '0' },
        ],
        removes: [],
        restart: false,
      }),
    )
    expect(runAction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        section: 'tmc2209 stepper_y',
        changes: [
          { option: 'diag_pin', value: '^PG6' },
          { option: 'driver_SGTHRS', value: '255' },
        ],
        removes: ['hold_current'],
        restart: true,
      }),
    )
  })
})

describe('LoadCellPanel', () => {
  it('follows the helper through its own lines, and accepts only once calibrated', async () => {
    seed({ load_cell_probe: { counts_per_gram: 600 } })
    const sendGcode = vi.spyOn(usePrinterStore(pinia), 'sendGcode').mockResolvedValue(true)
    const panel = await mountPanel(LoadCellPanel)
    await press(panel, 'Start')
    expect(sendGcode).toHaveBeenCalledWith('LOAD_CELL_CALIBRATE', 'calibration')

    const gcodeConsole = useConsoleStore(pinia)
    const say = (raw: string) => {
      const id = (gcodeConsole.consoleEntries.at(-1)?.id ?? 0) + 1
      gcodeConsole.consoleEntries = [
        ...gcodeConsole.consoleEntries,
        { id, raw, message: raw, kind: 'response', at: 0 },
      ]
    }
    say('// Starting load cell calibration.')
    say('// Load cell tare value: 0.35% (29360)')
    await flushPromises()
    const accept = () => panel.findAll('button').find((button) => button.text() === 'Accept')!
    expect(accept().attributes('disabled')).toBeDefined()

    say('// Calibration value: 4.12% (345600), Counts/gram: 632.48000, Total capacity: +/- 13.23Kg')
    await flushPromises()
    expect(panel.find('.calibration-result').text()).toContain('632.48')
    expect(accept().attributes('disabled')).toBeUndefined()

    // A restart closes Klipper's helper: no Accept for a calibration that is gone.
    await restartKlipper()
    expect(panel.findAll('button').some((button) => button.text() === 'Accept')).toBe(false)
    expect(panel.find('.calibration-result').exists()).toBe(false)
  })
})

describe('BedLayoutCard', () => {
  it('draws probed screws where the probe measures them, and says so', async () => {
    seed({
      probe: { x_offset: -25, y_offset: 10, z_offset: 1 },
      screws_tilt_adjust: { screw1: [30, 30], screw2: [200, 30], screw3: [115, 200] },
    })
    const printer = usePrinterStore(pinia)
    printer.buildVolume.minimum = [0, 0, 0]
    printer.buildVolume.maximum = [235, 235, 250]
    const card = mount(BedLayoutCard, {
      props: { procedure: 'screwsTilt' },
      global: { plugins: [i18n, pinia] },
    })
    await flushPromises()
    expect(card.text()).toContain('Drawn where the probe measures.')
    const first = card.find('.calibration-layout__screw circle')
    const box = card.find('svg').attributes('viewBox')!.split(' ').map(Number)
    // Screw 1 sits at 30 - 25 = 5 on X, which the drawing's left margin puts inside the box.
    expect(Number(first.attributes('cx'))).toBeLessThan(box[2]! * 0.1)
  })
})
