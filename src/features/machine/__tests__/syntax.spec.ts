import { describe, expect, it } from 'vitest'

import {
  isConfigSyntaxFile,
  isEmptyPropertyLine,
  splitTokensForSearch,
  tokenizeMachineConfig,
  tokenizeMachineLine,
} from '@/features/machine/syntax'

describe('Klipper configuration syntax highlighting', () => {
  it('recognizes sections, properties, templates, strings, and comments', () => {
    expect(tokenizeMachineLine('[gcode_macro CANCEL_PRINT] # action')).toEqual([
      { kind: 'section', text: '[gcode_macro CANCEL_PRINT]' },
      { kind: 'plain', text: ' ' },
      { kind: 'comment', text: '# action' },
    ])
    expect(tokenizeMachineLine('description: "Cancel print" # shown in UI')).toEqual([
      { kind: 'key', text: 'description:' },
      { kind: 'value', text: ' "Cancel print" ' },
      { kind: 'comment', text: '# shown in UI' },
    ])
    expect(tokenizeMachineLine('  {% set park_x = 10 %}')).toEqual([
      { kind: 'plain', text: '  ' },
      { kind: 'template', text: '{% set park_x = 10 %}' },
    ])
  })

  it('highlights named command parameters, including single-letter axis args', () => {
    expect(tokenizeMachineConfig('G28\n\n  SET_GCODE_OFFSET Z=0.1')).toEqual([
      [{ kind: 'command', text: 'G28' }],
      [],
      [
        { kind: 'plain', text: '  ' },
        { kind: 'command', text: 'SET_GCODE_OFFSET' },
        { kind: 'plain', text: ' ' },
        { kind: 'parameter', text: 'Z=' },
        { kind: 'plain', text: '0.1' },
      ],
    ])
    expect(tokenizeMachineLine('SET_PIN PIN=interior_light VALUE=1')).toEqual([
      { kind: 'command', text: 'SET_PIN' },
      { kind: 'plain', text: ' ' },
      { kind: 'parameter', text: 'PIN=' },
      { kind: 'plain', text: 'interior_light ' },
      { kind: 'parameter', text: 'VALUE=' },
      { kind: 'plain', text: '1' },
    ])
  })

  it('highlights single-brace Klipper substitution, not just standard {{ }} Jinja', () => {
    expect(tokenizeMachineLine('M140 S{bed_temp}')).toEqual([
      { kind: 'command', text: 'M140' },
      { kind: 'plain', text: ' S' },
      { kind: 'template', text: '{bed_temp}' },
    ])
    expect(
      tokenizeMachineLine('SET_GCODE_VARIABLE MACRO=PAUSE VALUE={printer.extruder.target|int}'),
    ).toEqual([
      { kind: 'command', text: 'SET_GCODE_VARIABLE' },
      { kind: 'plain', text: ' ' },
      { kind: 'parameter', text: 'MACRO=' },
      { kind: 'plain', text: 'PAUSE ' },
      { kind: 'parameter', text: 'VALUE=' },
      { kind: 'template', text: '{printer.extruder.target|int}' },
    ])
  })

  it('distinguishes pin modifiers and booleans from ordinary values', () => {
    expect(tokenizeMachineLine('enable_pin: !X_EN')).toEqual([
      { kind: 'key', text: 'enable_pin:' },
      { kind: 'value', text: ' ' },
      { kind: 'pin', text: '!X_EN' },
    ])
    expect(tokenizeMachineLine('endstop_pin: ^!PROBE_SENSOR')).toEqual([
      { kind: 'key', text: 'endstop_pin:' },
      { kind: 'value', text: ' ' },
      { kind: 'pin', text: '^!PROBE_SENSOR' },
    ])
    expect(tokenizeMachineLine('step_pin: X_STEP')).toEqual([
      { kind: 'key', text: 'step_pin:' },
      { kind: 'value', text: ' X_STEP' },
    ])
    expect(tokenizeMachineLine('interpolate: False')).toEqual([
      { kind: 'key', text: 'interpolate:' },
      { kind: 'value', text: ' ' },
      { kind: 'boolean', text: 'False' },
    ])
  })

  it('dims the auto-generated SAVE_CONFIG block separately from ordinary comments', () => {
    expect(tokenizeMachineLine('#*# z_offset = 0.05')).toEqual([
      { kind: 'autogen', text: '#*# z_offset = 0.05' },
    ])
    expect(tokenizeMachineLine('# Hardware')).toEqual([{ kind: 'comment', text: '# Hardware' }])
  })

  it('recognizes ; inline G-code comments alongside # comments', () => {
    expect(
      tokenizeMachineLine('TEMPERATURE_WAIT MINIMUM={s} MAXIMUM={s+1}   ; Wait for hotend temp'),
    ).toEqual([
      { kind: 'command', text: 'TEMPERATURE_WAIT' },
      { kind: 'plain', text: ' ' },
      { kind: 'parameter', text: 'MINIMUM=' },
      { kind: 'template', text: '{s}' },
      { kind: 'plain', text: ' ' },
      { kind: 'parameter', text: 'MAXIMUM=' },
      { kind: 'template', text: '{s+1}' },
      { kind: 'plain', text: '   ' },
      { kind: 'comment', text: '; Wait for hotend temp' },
    ])
  })

  it('keeps empty lines untokenized', () => {
    expect(tokenizeMachineConfig('G28\n\nG90')).toEqual([
      [{ kind: 'command', text: 'G28' }],
      [],
      [{ kind: 'command', text: 'G90' }],
    ])
  })

  it('tags an [include] target as its own token, so the editor can hotlink it', () => {
    expect(tokenizeMachineLine('[include macros.cfg]')).toEqual([
      { kind: 'section', text: '[include ' },
      { kind: 'includePath', text: 'macros.cfg' },
      { kind: 'section', text: ']' },
    ])
  })

  it('matches includes.ts on spacing and case, so hotlink and rewrite agree on what is an include', () => {
    expect(tokenizeMachineLine('  [ INCLUDE   sub/dir/thing.cfg ]  ')).toEqual([
      { kind: 'plain', text: '  ' },
      { kind: 'section', text: '[ INCLUDE   ' },
      { kind: 'includePath', text: 'sub/dir/thing.cfg' },
      { kind: 'section', text: ' ]  ' },
    ])
  })

  it('does not tag a bracket line as an include when it only looks like one', () => {
    expect(tokenizeMachineLine('[include]')).toEqual([{ kind: 'section', text: '[include]' }])
    expect(tokenizeMachineLine('[includes not-a-section.cfg]')).toEqual([
      { kind: 'section', text: '[includes not-a-section.cfg]' },
    ])
    expect(tokenizeMachineLine('[include macros.cfg] # trailing text')[0]).toEqual({
      kind: 'section',
      text: '[include macros.cfg]',
    })
  })

  it('identifies a bare key: line as an empty-value property', () => {
    expect(isEmptyPropertyLine('kinematics:')).toBe(true)
    expect(isEmptyPropertyLine('  gcode:')).toBe(true)
    expect(isEmptyPropertyLine('kinematics: limited_cartesian')).toBe(false)
    expect(isEmptyPropertyLine('[stepper_x]')).toBe(false)
    expect(isEmptyPropertyLine('')).toBe(false)
  })
})

describe('splitTokensForSearch', () => {
  it('leaves tokens untouched, but still marked unmatched, when the query is empty', () => {
    expect(splitTokensForSearch(tokenizeMachineLine('speed: 100'), '')).toEqual([
      { kind: 'key', text: 'speed:', matched: false },
      { kind: 'value', text: ' 100', matched: false },
    ])
  })

  it('carves the matched substring out of a token while keeping its syntax kind', () => {
    expect(splitTokensForSearch(tokenizeMachineLine('speed: 100'), 'spe')).toEqual([
      { kind: 'key', text: 'spe', matched: true },
      { kind: 'key', text: 'ed:', matched: false },
      { kind: 'value', text: ' 100', matched: false },
    ])
  })

  it('matches case-insensitively', () => {
    expect(splitTokensForSearch(tokenizeMachineLine('[stepper_x]'), 'STEPPER')).toEqual([
      { kind: 'section', text: '[', matched: false },
      { kind: 'section', text: 'stepper', matched: true },
      { kind: 'section', text: '_x]', matched: false },
    ])
  })

  it('marks every occurrence on a line, including more than one inside the same token', () => {
    expect(splitTokensForSearch(tokenizeMachineLine('# hot hot'), 'hot')).toEqual([
      { kind: 'comment', text: '# ', matched: false },
      { kind: 'comment', text: 'hot', matched: true },
      { kind: 'comment', text: ' ', matched: false },
      { kind: 'comment', text: 'hot', matched: true },
    ])
  })

  it('leaves a token unmatched entirely when the query does not appear in it', () => {
    expect(splitTokensForSearch(tokenizeMachineLine('G28'), 'heater')).toEqual([
      { kind: 'command', text: 'G28', matched: false },
    ])
  })
})

describe('isConfigSyntaxFile', () => {
  it('recognizes the formats this tokenizer actually describes', () => {
    for (const name of [
      'printer.cfg',
      'macros.CFG',
      'moonraker.conf',
      'smb.cnf',
      'settings.ini',
      'thing.toml',
      'printer.cfg.bkp',
    ]) {
      expect(isConfigSyntaxFile(name), name).toBe(true)
    }
  })

  /**
   * Everything here used to be colored by the Klipper config tokenizer, either
   * through a format-specific tokenizer or through its fall-through. That
   * invents structure a log or a sliced file does not have — and these are
   * exactly the multi-megabyte files whose highlighting cost the editor the most.
   */
  it('leaves everything that is not a config file as plain text', () => {
    for (const name of [
      'klippy.log',
      'notes.txt',
      'benchy.gcode',
      'part.nc',
      'notes.md',
      'moonraker-secrets.json',
      'klipper.service',
      'script.py',
      'moonraker',
      '',
    ]) {
      expect(isConfigSyntaxFile(name), name).toBe(false)
    }
  })
})
