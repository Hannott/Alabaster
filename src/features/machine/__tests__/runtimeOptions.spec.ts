import { describe, expect, it } from 'vitest'

import { runtimeCommandFor } from '@/features/machine/runtimeOptions'

describe('runtimeCommandFor', () => {
  it('applies velocity limits through SET_VELOCITY_LIMIT', () => {
    expect(runtimeCommandFor('printer', 'max_accel', '7000')).toEqual({
      script: 'SET_VELOCITY_LIMIT ACCEL=7000',
      key: 'limits',
    })
    expect(runtimeCommandFor('printer', 'square_corner_velocity', ' 5.0 ')).toEqual({
      script: 'SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=5.0',
      key: 'limits',
    })
  })

  it('names the extruder pressure advance is set on', () => {
    expect(runtimeCommandFor('extruder1', 'pressure_advance', '0.04')).toEqual({
      script: 'SET_PRESSURE_ADVANCE EXTRUDER=extruder1 ADVANCE=0.04',
      key: 'pressureAdvance',
    })
    expect(
      runtimeCommandFor('extruder_stepper belt', 'pressure_advance_smooth_time', '0.02'),
    ).toEqual({
      script: 'SET_PRESSURE_ADVANCE EXTRUDER=belt SMOOTH_TIME=0.02',
      key: 'pressureAdvance',
    })
  })

  it('applies input shaping and retraction', () => {
    expect(runtimeCommandFor('input_shaper', 'shaper_type_x', 'MZV')).toEqual({
      script: 'SET_INPUT_SHAPER SHAPER_TYPE_X=mzv',
      key: 'calibration',
    })
    expect(runtimeCommandFor('firmware_retraction', 'retract_length', '0.8')).toEqual({
      script: 'SET_RETRACTION RETRACT_LENGTH=0.8',
      key: 'retraction',
    })
  })

  it('sets a macro variable under the macro name as its header spells it', () => {
    expect(runtimeCommandFor('gcode_macro PARK', 'variable_z_lift', '10')).toEqual({
      script: 'SET_GCODE_VARIABLE MACRO=PARK VARIABLE=z_lift VALUE=10',
      key: 'macroVariable',
    })
    expect(runtimeCommandFor('gcode_macro PARK', 'variable_mode', "'fast'")?.script).toBe(
      "SET_GCODE_VARIABLE MACRO=PARK VARIABLE=mode VALUE='fast'",
    )
    expect(runtimeCommandFor('gcode_macro PARK', 'variable_note', "'two words'")).toBeNull()
  })

  it('refuses a value the command would not take as written', () => {
    expect(runtimeCommandFor('printer', 'max_accel', '7000\nM112')).toBeNull()
    expect(runtimeCommandFor('printer', 'max_accel', '7000 ACCEL=1')).toBeNull()
    expect(runtimeCommandFor('printer', 'max_accel', '')).toBeNull()
    expect(runtimeCommandFor('input_shaper', 'shaper_type_x', 'mzv M112')).toBeNull()
  })

  it('has nothing for an option Klipper cannot be told at runtime', () => {
    expect(runtimeCommandFor('printer', 'kinematics', 'corexy')).toBeNull()
    expect(runtimeCommandFor('bed_mesh', 'probe_count', '5, 5')).toBeNull()
  })
})
