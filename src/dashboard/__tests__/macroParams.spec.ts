import { describe, expect, it } from 'vitest'

import { macroParamsFromSettings, parseMacroParams } from '@/dashboard/macroParams'

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
