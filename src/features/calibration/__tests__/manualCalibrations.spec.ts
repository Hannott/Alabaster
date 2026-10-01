import { describe, expect, it } from 'vitest'

import { loadCellWord, loadCells, readLoadCell } from '@/features/calibration/loadCell'
import {
  attemptScript,
  homingDirectionFix,
  nextValue,
  recommendedSensitivity,
  sensitivityRange,
  setupSnippet,
  stallDriversFor,
} from '@/features/calibration/sensorless'
import {
  macrosApplySkew,
  setSkewScript,
  skewDegrees,
  skewFactor,
  skewProfiles,
} from '@/features/calibration/skew'
import {
  isReachable,
  nearestIndex,
  nearestReachable,
  probeOffsetFrom,
  screwCoordinate,
  screwOnBed,
  screwWrite,
  standingOver,
  toolheadOver,
} from '@/features/calibration/toolheadPoints'
import { applyScript, towerScript, towerValue } from '@/features/calibration/tuningTower'

function settingsOf(table: Record<string, Record<string, unknown>>) {
  return (section: string) => table[section] ?? null
}

describe('skew correction', () => {
  it("matches Klipper's formula on its guide's example", () => {
    // skew_correction.py's calc_skew_factor(140.4, 142.8, 99.8), run in Python.
    const factor = skewFactor({ ac: 140.4, bd: 142.8, ad: 99.8 })!
    expect(factor).toBeCloseTo(-0.0169507, 6)
    expect(skewDegrees(factor)).toBeCloseTo(-0.9712, 3)
    expect(skewFactor({ ac: 141.42, bd: 141.42, ad: 100 })).toBeCloseTo(0, 3)
  })

  it('refuses lengths that describe no parallelogram', () => {
    expect(skewFactor({ ac: 10, bd: 10, ad: 100 })).toBeNull()
    expect(skewFactor({ ac: 0, bd: 140, ad: 100 })).toBeNull()
    expect(setSkewScript({ xy: { ac: 10, bd: 10, ad: 100 } })).toBeNull()
  })

  it('clears first, then sets only the planes that were measured', () => {
    expect(
      setSkewScript({
        xy: { ac: 140.4, bd: 142.8, ad: 99.8 },
        yz: { ac: 142.4, bd: 140.5, ad: 99.5 },
      }),
    ).toBe('SET_SKEW CLEAR=1\nSET_SKEW XY=140.4,142.8,99.8 YZ=142.4,140.5,99.5')
    expect(setSkewScript({})).toBeNull()
  })

  it('reads saved profiles and whether a macro loads one', () => {
    const settings = settingsOf({
      'skew_correction calibrated': { xy_skew: -0.0169, xz_skew: 0, yz_skew: 0.002 },
      'gcode_macro print_start': { gcode: 'G28\nSKEW_PROFILE LOAD=calibrated' },
    })
    const sections = ['skew_correction', 'skew_correction calibrated', 'gcode_macro print_start']
    expect(skewProfiles(sections, settings)).toEqual([
      { name: 'calibrated', factors: { xy: -0.0169, xz: 0, yz: 0.002 } },
    ])
    expect(macrosApplySkew(sections, settings)).toBe(true)
    expect(macrosApplySkew(['gcode_macro print_start'], settingsOf({}))).toBe(false)
  })
})

describe('tuning tower', () => {
  it("turns a height into the value Klipper's calc_value printed there", () => {
    // Klipper's pressure advance guide: 0 + 12.90 * .020 = .258.
    expect(towerValue({ start: 0, factor: 0.02, band: 0 }, 12.9)).toBeCloseTo(0.258, 6)
    // A band holds its middle value for the whole band.
    expect(towerValue({ start: 0, factor: 0.02, band: 5 }, 12.9)).toBeCloseTo(0.25, 6)
  })

  it("prepares pressure advance with the guide's slowed corners", () => {
    expect(towerScript('pressureAdvance', { start: 0, factor: 0.005, band: 0 })).toBe(
      'SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=1 ACCEL=500\n' +
        'TUNING_TOWER COMMAND=SET_PRESSURE_ADVANCE PARAMETER=ADVANCE START=0 FACTOR=0.005',
    )
    expect(towerScript('retractLength', { start: 0.2, factor: 0.02, band: 5 })).toBe(
      'TUNING_TOWER COMMAND=SET_RETRACTION PARAMETER=RETRACT_LENGTH START=0.2 FACTOR=0.02 BAND=5',
    )
    expect(towerScript('pressureAdvance', { start: 0, factor: 0, band: 0 })).toBeNull()
    expect(applyScript('pressureAdvance', 0.0645)).toBe('SET_PRESSURE_ADVANCE ADVANCE=0.0645')
  })
})

describe('toolhead points', () => {
  const offset = { x: -25, y: 10 }

  it("works out the probe offset the way Klipper's guide does", () => {
    expect(probeOffsetFrom({ x: 150, y: 150 }, { x: 175, y: 140 })).toEqual({ x: -25, y: 10 })
  })

  it('turns a toolhead position into what each screw section wants', () => {
    const toolhead = { x: 100, y: 100 }
    // Probe over the screw: the nozzle is exactly where screws_tilt_adjust wants it.
    expect(screwCoordinate('screwsTilt', 'probe', toolhead, offset)).toEqual(toolhead)
    // Nozzle over the screw: send the nozzle one offset back so the probe lands there.
    expect(screwCoordinate('screwsTilt', 'nozzle', toolhead, offset)).toEqual({ x: 125, y: 90 })
    expect(screwCoordinate('bedScrews', 'nozzle', toolhead, offset)).toEqual(toolhead)
    expect(screwCoordinate('bedScrews', 'probe', toolhead, offset)).toEqual({ x: 75, y: 110 })
  })

  it('finds the screw on the bed a stored coordinate names, and sends either part back over it', () => {
    const stored = screwCoordinate('screwsTilt', 'nozzle', { x: 100, y: 100 }, offset)
    expect(screwOnBed('screwsTilt', stored, offset)).toEqual({ x: 100, y: 100 })
    expect(screwOnBed('bedScrews', { x: 100, y: 100 }, offset)).toEqual({ x: 100, y: 100 })

    const screw = { x: 100, y: 100 }
    expect(toolheadOver('nozzle', screw, offset)).toEqual(screw)
    expect(toolheadOver('probe', screw, offset)).toEqual({ x: 125, y: 90 })
    expect(standingOver('probe', toolheadOver('probe', screw, offset), offset)).toEqual(screw)
  })

  it('picks the nearest point, and none from an empty list', () => {
    const points = [
      { x: 30, y: 30 },
      { x: 200, y: 30 },
      { x: 115, y: 200 },
    ]
    expect(nearestIndex(points, { x: 180, y: 60 })).toBe(1)
    expect(nearestIndex([], { x: 0, y: 0 })).toBeNull()
  })

  it('flags a coordinate the nozzle cannot reach, and offers the nearest one', () => {
    const travel = { minimum: [0, 0, 0], maximum: [235, 235, 250] }
    expect(isReachable({ x: 250, y: 20 }, travel)).toBe(false)
    expect(nearestReachable({ x: 250, y: -4 }, travel)).toEqual({ x: 235, y: 0 })
  })

  it('writes the recorded screws and removes every option past the new count', () => {
    const existing = {
      screw1: [30, 30],
      screw1_name: 'front left',
      screw2: [200, 30],
      screw3: [200, 200],
      screw4: [30, 200],
      screw4_name: 'rear left',
      screw4_fine_adjust: [30, 210],
    }
    const screws = [
      { point: { x: 31.24, y: 30 }, name: '' },
      { point: { x: 200, y: 30.05 }, name: 'front right' },
      { point: { x: 115, y: 205 }, name: 'rear' },
    ]
    expect(screwWrite('bedScrews', screws, existing)).toEqual({
      changes: [
        { option: 'screw1', value: '31.2, 30' },
        { option: 'screw2', value: '200, 30.1' },
        { option: 'screw2_name', value: 'front right' },
        { option: 'screw3', value: '115, 205' },
        { option: 'screw3_name', value: 'rear' },
      ],
      removes: ['screw1_name', 'screw4', 'screw4_name', 'screw4_fine_adjust'],
    })
  })
})

describe('sensorless homing', () => {
  const settings = settingsOf({
    stepper_x: { endstop_pin: 'tmc2209_stepper_x:virtual_endstop' },
    // Klipper reports the driver's maximum as hold_current whether or not the file sets one.
    'tmc2209 stepper_x': { hold_current: 2 },
    stepper_y: { endstop_pin: '^PA2' },
    'tmc2209 stepper_y': { hold_current: 0.5 },
    stepper_z: { endstop_pin: 'tmc5160_stepper_z:virtual_endstop' },
  })
  const written = (section: string) =>
    section === 'tmc2209 stepper_y' ? { hold_current: '0.5' } : null
  const drivers = stallDriversFor(
    ['tmc2209 stepper_x', 'tmc2209 stepper_y', 'tmc5160 stepper_z', 'tmc2208 stepper_e'],
    settings,
    written,
  )

  it('offers steppers that home against their driver, and X and Y that could', () => {
    expect(drivers.map((driver) => [driver.stepper, driver.field, driver.setup.blocking])).toEqual([
      ['stepper_x', 'sgthrs', false],
      ['stepper_y', 'sgthrs', true],
      ['stepper_z', 'sgt', false],
    ])
    // Z on a switch or on the probe is not offered: the guide advises against homing Z by stall.
    for (const pin of ['^PA3', 'probe:z_virtual_endstop']) {
      expect(
        stallDriversFor(
          ['tmc2209 stepper_z'],
          settingsOf({ stepper_z: { endstop_pin: pin } }),
          () => null,
        ),
      ).toEqual([])
    }
  })

  it('writes out the lines an axis on a switch needs, the DIAG pin left to the wiring', () => {
    const y = drivers[1]!
    expect(setupSnippet(y.setup, '<pin>')).toBe(
      [
        '[stepper_y]',
        'endstop_pin: tmc2209_stepper_y:virtual_endstop',
        'homing_retract_dist: 0',
        '',
        '[tmc2209 stepper_y]',
        'diag_pin: <pin>',
        'driver_SGTHRS: 255',
      ].join('\n'),
    )
    expect(y.setup.removes).toEqual([{ section: 'tmc2209 stepper_y', option: 'hold_current' }])
    // The default Klipper reports for a hold_current nobody wrote is not a line to remove.
    expect(drivers[0]!.setup.removes).toEqual([])
  })

  it("finds the range and keeps a third of the way up from the guide's minimum", () => {
    const x = drivers[0]!
    const range = sensitivityRange(x, [
      { value: 255, outcome: 'stoppedEarly' },
      { value: 120, outcome: 'singleTouch' },
      { value: 90, outcome: 'singleTouch' },
      { value: 60, outcome: 'singleTouch' },
      { value: 40, outcome: 'banged' },
    ])
    expect(range).toEqual({ maximum: 120, minimum: 60 })
    expect(recommendedSensitivity(range)).toBe(80)
  })

  it('counts sensitivity the other way on an sgt driver', () => {
    const z = drivers[2]!
    const range = sensitivityRange(z, [
      { value: -10, outcome: 'singleTouch' },
      { value: 5, outcome: 'singleTouch' },
      { value: 9, outcome: 'banged' },
    ])
    expect(range).toEqual({ maximum: -10, minimum: 5 })
    expect(recommendedSensitivity(range)).toBe(0)
    expect(nextValue(z, { value: 62, outcome: 'singleTouch' })).toBe(63)
  })

  it('pauses for the stall flag before homing the one axis', () => {
    expect(attemptScript(drivers[0]!, 120)).toBe(
      'SET_TMC_FIELD STEPPER=stepper_x FIELD=sgthrs VALUE=120\nG4 P2000\nG28 X',
    )
  })
})

describe('load cell', () => {
  it('finds every load cell section and the word that names it', () => {
    expect(loadCells(['load_cell', 'load_cell bed', 'load_cell_probe', 'probe'])).toEqual([
      'load_cell',
      'load_cell bed',
      'load_cell_probe',
    ])
    expect(loadCellWord('load_cell bed')).toBe('LOAD_CELL=bed')
    expect(loadCellWord('load_cell_probe')).toBeNull()
  })

  it("reads the helper's progress from its own lines", () => {
    const reading = readLoadCell([
      '// Starting load cell calibration. \n1.) Remove all load and run TARE.',
      '// Load cell tare value: 0.35% (29360)',
      '// Calibration value: 4.12% (345600), Counts/gram: 632.48000,             Total capacity: +/- 13.23Kg',
      '// Accept calibration with the ACCEPT command.',
    ])
    expect(reading).toMatchObject({
      phase: 'calibrated',
      tarePercent: 0.35,
      countsPerGram: 632.48,
      capacityKg: 13.23,
    })
    expect(readLoadCell(['// Load cell calibration aborted']).phase).toBe('aborted')
  })
})

describe('sensorless homing direction', () => {
  it('turns the homing direction toward the end position_endstop is at', () => {
    // FrankenForge: endstop at the top, homed downward, a 1.5 mm homing move.
    const top = { position_endstop: 300, position_min: -1, position_max: 301 }
    expect(homingDirectionFix({ ...top, homing_positive_dir: false })).toBe('True')
    expect(homingDirectionFix({ ...top, homing_positive_dir: true })).toBeNull()
    expect(
      homingDirectionFix({ position_endstop: 0, position_max: 300, homing_positive_dir: true }),
    ).toBe('False')
    // Left unset, Klipper works the direction out from the endstop itself.
    expect(homingDirectionFix(top)).toBeNull()
  })

  it('blocks the search while the direction is wrong, and steps toward sensitive after no stall', () => {
    const [x] = stallDriversFor(
      ['tmc2209 stepper_x'],
      settingsOf({
        stepper_x: {
          endstop_pin: 'tmc2209_stepper_x:virtual_endstop',
          homing_retract_dist: 0,
          position_endstop: 300,
          position_max: 301,
          homing_positive_dir: false,
        },
      }),
      () => ({ diag_pin: '^STOP0' }),
    )
    expect(x!.setup).toMatchObject({
      blocking: true,
      lines: [{ section: 'stepper_x', option: 'homing_positive_dir', value: 'True' }],
    })
    expect(nextValue(x!, { value: 100, outcome: 'noTrigger' })).toBe(110)
  })
})
