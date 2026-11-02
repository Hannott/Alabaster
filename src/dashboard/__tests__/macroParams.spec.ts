import { describe, expect, it } from 'vitest'

import {
  commandParams,
  macroParamsFromSettings,
  parseMacroParams,
  schemaParams,
} from '@/dashboard/macroParams'

describe('parseMacroParams', () => {
  it('reads params with literal defaults, in first-appearance order', () => {
    const body = [
      '{% set wipes = params.WIPES|default(5)|int %}',
      "{% set material = params.MATERIAL|default('PLA')|string %}",
      '{% set temp = params.TEMP|int %}',
      'G1 X{params.WIPES}',
    ].join('\n')

    expect(parseMacroParams(body)).toEqual([
      { name: 'WIPES', defaultValue: '5' },
      { name: 'MATERIAL', defaultValue: 'PLA' },
      { name: 'TEMP', defaultValue: null },
    ])
  })

  it('treats an expression default as the macro deciding, not as a prefill', () => {
    // Prefilling the expression's text would invite sending it back as a
    // literal string, which Klipper would read as exactly that.
    const body = '{% set t = params.TEMP|default(printer.extruder.target)|float %}'
    expect(parseMacroParams(body)).toEqual([{ name: 'TEMP', defaultValue: null }])
  })

  it('finds params referenced only through membership tests and .get()', () => {
    const body = [
      "{% if 'BEEP' in params %}M300{% endif %}",
      '{% if "LEVEL" not in params %}{% endif %}',
      "{% set speed = params.get('SPEED', 100) %}",
    ].join('\n')

    expect(parseMacroParams(body)).toEqual([
      { name: 'BEEP', defaultValue: null },
      { name: 'LEVEL', defaultValue: null },
      { name: 'SPEED', defaultValue: '100' },
    ])
  })

  it('hides underscore-led params and never reports a body it cannot read', () => {
    expect(parseMacroParams('{% set x = params._INTERNAL|default(1) %}')).toEqual([])
    expect(parseMacroParams(undefined)).toEqual([])
    expect(parseMacroParams(42)).toEqual([])
    expect(parseMacroParams('')).toEqual([])
    expect(parseMacroParams('G28\nG1 X10 F3000')).toEqual([])
  })

  it('dedupes a param read twice, keeping the reference that carries the default', () => {
    const body = [
      '{% if params.TEMP %}',
      '{% set t = params.TEMP|default(220)|int %}',
      '{% endif %}',
    ].join('\n')

    expect(parseMacroParams(body)).toEqual([{ name: 'TEMP', defaultValue: '220' }])
  })
})

describe('macroParamsFromSettings', () => {
  it('reads the lowercased gcode_macro section the config store stores', () => {
    const settings = {
      'gcode_macro clean_nozzle': {
        gcode: '{% set wipes = params.WIPES|default(3)|int %}',
      },
    }

    expect(macroParamsFromSettings(settings, 'CLEAN_NOZZLE')).toEqual([
      { name: 'WIPES', defaultValue: '3' },
    ])
    expect(macroParamsFromSettings(settings, 'MISSING_MACRO')).toEqual([])
    expect(macroParamsFromSettings({ 'gcode_macro broken': 7 }, 'BROKEN')).toEqual([])
  })
})

describe('schemaParams', () => {
  it('reads the declared parameters in declaration order, with literal defaults', () => {
    expect(
      schemaParams({
        STEPPER: { type: 'string', required: true },
        PASSES: { type: 'int', default: 1 },
        PROBE: { type: 'float', default: 0.0 },
        GRAPH: { type: 'int', required: false },
        name: { type: 'string', default: 'x' },
      }),
    ).toEqual([
      { name: 'STEPPER', defaultValue: null },
      { name: 'PASSES', defaultValue: '1' },
      { name: 'PROBE', defaultValue: '0' },
      { name: 'GRAPH', defaultValue: null },
      { name: 'NAME', defaultValue: 'x' },
    ])
  })

  it('yields nothing for a printer that publishes no schema', () => {
    expect(schemaParams(undefined)).toEqual([])
    expect(schemaParams(null)).toEqual([])
    expect(schemaParams('STEPPER')).toEqual([])
    expect(schemaParams(['STEPPER'])).toEqual([])
    expect(schemaParams({})).toEqual([])
  })

  it('keeps a computed default out of the prefill, like an expression default', () => {
    expect(schemaParams({ SPEED: { type: 'float', default: null } })).toEqual([
      { name: 'SPEED', defaultValue: null },
    ])
    expect(schemaParams({ _INTERNAL: { type: 'int' } })).toEqual([])
  })
})

describe('commandParams', () => {
  const entries = [
    { command: 'G28', params: [] },
    {
      command: 'PHASE_STEPPING_CALIBRATE',
      params: [{ name: 'STEPPER', defaultValue: null }],
    },
  ]
  const settings = {
    'gcode_macro run_pa_test': { gcode: '{% set n = params.NOZZLE|default(0.4) %}' },
  }

  it('prefers the schema the machine publishes', () => {
    expect(commandParams(entries, settings, 'phase_stepping_calibrate')).toEqual([
      { name: 'STEPPER', defaultValue: null },
    ])
  })

  it('falls back to the macro body where the machine declares nothing', () => {
    expect(commandParams(entries, settings, 'RUN_PA_TEST')).toEqual([
      { name: 'NOZZLE', defaultValue: '0.4' },
    ])
    expect(commandParams(entries, settings, 'G28')).toEqual([])
    expect(commandParams(entries, settings, 'UNKNOWN')).toEqual([])
  })
})
