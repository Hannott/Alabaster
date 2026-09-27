import { describe, expect, it } from 'vitest'

import {
  isConfigSyntaxFile,
  isEmptyPropertyLine,
  splitTokensForSearch,
  tokenizeMachineConfig,
  tokenizeMachineLine,
  tokenizeMachineRange,
  type MachineSyntaxToken,
} from '@/features/machine/syntax'

/** The tokens of one line, as `kind:text`, without the whitespace between them. */
function kinds(tokens: MachineSyntaxToken[]): string[] {
  return tokens
    .filter((token) => token.text.trim() !== '')
    .map((token) => `${token.kind}:${token.text.trim()}`)
}

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
    expect(kinds(tokenizeMachineLine('  {% set park_x = 10 %}'))).toEqual([
      'templateDelimiter:{%',
      'templateKeyword:set',
      'plain:park_x =',
      'number:10',
      'templateDelimiter:%}',
    ])
  })

  it('takes # as a comment in a value only after whitespace, as configparser does', () => {
    expect(kinds(tokenizeMachineLine('variable_color: "#ff0000"'))).toEqual([
      'key:variable_color:',
      'value:"#ff0000"',
    ])
    expect(kinds(tokenizeMachineLine('max_velocity = 300 ; tuned'))).toEqual([
      'key:max_velocity =',
      'value:300',
      'comment:; tuned',
    ])
  })

  it('highlights named command parameters, including single-letter axis args', () => {
    expect(tokenizeMachineConfig('G28\n\n  SET_GCODE_OFFSET Z=0.1')).toEqual([
      [{ kind: 'gcode', text: 'G28' }],
      [],
      [
        { kind: 'plain', text: '  ' },
        { kind: 'command', text: 'SET_GCODE_OFFSET' },
        { kind: 'plain', text: ' ' },
        { kind: 'parameter', text: 'Z=' },
        { kind: 'number', text: '0.1' },
      ],
    ])
    expect(tokenizeMachineLine('SET_PIN PIN=interior_light VALUE=1')).toEqual([
      { kind: 'command', text: 'SET_PIN' },
      { kind: 'plain', text: ' ' },
      { kind: 'parameter', text: 'PIN=' },
      { kind: 'plain', text: 'interior_light ' },
      { kind: 'parameter', text: 'VALUE=' },
      { kind: 'number', text: '1' },
    ])
    expect(kinds(tokenizeMachineLine('G1 X-10.5 Y20 F3000'))).toEqual([
      'gcode:G1',
      'parameter:X',
      'number:-10.5',
      'parameter:Y',
      'number:20',
      'parameter:F',
      'number:3000',
    ])
  })

  it('reads single-letter arguments only after a numbered G/M/T code', () => {
    expect(kinds(tokenizeMachineLine('ACTIVATE_EXTRUDER EXTRUDER=extruder1'))).toEqual([
      'command:ACTIVATE_EXTRUDER',
      'parameter:EXTRUDER=',
      'plain:extruder1',
    ])
    expect(kinds(tokenizeMachineLine('SAVE_CONFIG X1'))).toEqual([
      'command:SAVE_CONFIG',
      'plain:X1',
    ])
  })

  it('highlights single-brace Klipper substitution, not just standard {{ }} Jinja', () => {
    expect(tokenizeMachineLine('M140 S{bed_temp}')).toEqual([
      { kind: 'gcode', text: 'M140' },
      { kind: 'plain', text: ' ' },
      { kind: 'parameter', text: 'S' },
      { kind: 'templateDelimiter', text: '{' },
      { kind: 'plain', text: 'bed_temp' },
      { kind: 'templateDelimiter', text: '}' },
    ])
    expect(
      kinds(
        tokenizeMachineLine('SET_GCODE_VARIABLE MACRO=PAUSE VALUE={printer.extruder.target|int}'),
      ),
    ).toEqual([
      'command:SET_GCODE_VARIABLE',
      'parameter:MACRO=',
      'plain:PAUSE',
      'parameter:VALUE=',
      'templateDelimiter:{',
      'templateGlobal:printer',
      'plain:.extruder.target|',
      'templateFilter:int',
      'templateDelimiter:}',
    ])
    expect(kinds(tokenizeMachineLine('{{ x }}'))).toEqual([
      'templateDelimiter:{{',
      'plain:x',
      'templateDelimiter:}}',
    ])
  })

  it('colors what is inside a Jinja statement rather than the statement as one block', () => {
    expect(
      kinds(tokenizeMachineLine('{% if printer.toolhead.homed_axes != "xyz" and not x %}')),
    ).toEqual([
      'templateDelimiter:{%',
      'templateKeyword:if',
      'templateGlobal:printer',
      'plain:.toolhead.homed_axes !=',
      'string:"xyz"',
      'templateKeyword:and',
      'templateKeyword:not',
      'plain:x',
      'templateDelimiter:%}',
    ])
    expect(kinds(tokenizeMachineLine('{% set b = params.BED|default(60)|float %}'))).toEqual([
      'templateDelimiter:{%',
      'templateKeyword:set',
      'plain:b =',
      'templateGlobal:params',
      'plain:.BED|',
      'templateFilter:default',
      'plain:(',
      'number:60',
      'plain:)|',
      'templateFilter:float',
      'templateDelimiter:%}',
    ])
  })

  it('names a Jinja test after is, and colors none and true as literals', () => {
    expect(kinds(tokenizeMachineLine('{% if x is not defined or y == none %}'))).toEqual([
      'templateDelimiter:{%',
      'templateKeyword:if',
      'plain:x',
      'templateKeyword:is',
      'templateKeyword:not',
      'templateFilter:defined',
      'templateKeyword:or',
      'plain:y ==',
      'boolean:none',
      'templateDelimiter:%}',
    ])
  })

  it('does not treat an attribute that shares a global name as the global', () => {
    expect(kinds(tokenizeMachineLine('{x.printer}'))).toEqual([
      'templateDelimiter:{',
      'plain:x.printer',
      'templateDelimiter:}',
    ])
  })

  it('keeps a closing delimiter inside a string or a dict literal from ending the expression', () => {
    expect(kinds(tokenizeMachineLine('{action_respond_info("a %} b")}'))).toEqual([
      'templateDelimiter:{',
      'templateGlobal:action_respond_info',
      'plain:(',
      'string:"a %} b"',
      'plain:)',
      'templateDelimiter:}',
    ])
    expect(kinds(tokenizeMachineLine("{ {'a': 1}['a'] }"))).toEqual([
      'templateDelimiter:{',
      'plain:{',
      "string:'a'",
      'plain::',
      'number:1',
      'plain:}[',
      "string:'a'",
      'plain:]',
      'templateDelimiter:}',
    ])
  })

  it('colors a substitution inside a quoted message, since Klipper renders it first', () => {
    expect(kinds(tokenizeMachineLine('RESPOND MSG="Heating: {bed}"'))).toEqual([
      'command:RESPOND',
      'parameter:MSG=',
      'string:"Heating:',
      'templateDelimiter:{',
      'plain:bed',
      'templateDelimiter:}',
      'string:"',
    ])
  })

  it('reads the command after a statement, and a Jinja comment as a comment', () => {
    expect(kinds(tokenizeMachineLine('{% for i in range(3) %} G1 X{i * 10} {% endfor %}'))).toEqual(
      [
        'templateDelimiter:{%',
        'templateKeyword:for',
        'plain:i',
        'templateKeyword:in',
        'plain:range(',
        'number:3',
        'plain:)',
        'templateDelimiter:%}',
        'gcode:G1',
        'parameter:X',
        'templateDelimiter:{',
        'plain:i *',
        'number:10',
        'templateDelimiter:}',
        'templateDelimiter:{%',
        'templateKeyword:endfor',
        'templateDelimiter:%}',
      ],
    )
    expect(kinds(tokenizeMachineLine('{# park first #} G90'))).toEqual([
      'comment:{# park first #}',
      'gcode:G90',
    ])
  })
})

describe('Klipper syntax across lines', () => {
  const macro = [
    '[gcode_macro PARK]',
    'description: Park the head',
    'gcode:',
    '  {% set x = printer["gcode_macro _VARS"].park_x',
    '     | float %}',
    '  M117 done: yes',
    '',
    '  # not the end of the macro',
    '  G1 X{x}',
    '[stepper_x]',
    '  G28',
  ]

  it('carries an unclosed Jinja statement onto the next line', () => {
    const rows = tokenizeMachineConfig(macro.join('\n'))
    expect(kinds(rows[4] ?? [])).toEqual([
      'plain:|',
      'templateFilter:float',
      'templateDelimiter:%}',
    ])
  })

  it('reads an indented key: value inside a macro body as G-code, not a key', () => {
    const rows = tokenizeMachineConfig(macro.join('\n'))
    expect(kinds(rows[5] ?? [])).toEqual(['gcode:M117', 'plain:done: yes'])
  })

  it('keeps a macro body open across a blank line and a comment line', () => {
    const rows = tokenizeMachineConfig(macro.join('\n'))
    expect(kinds(rows[8] ?? [])).toEqual([
      'gcode:G1',
      'parameter:X',
      'templateDelimiter:{',
      'plain:x',
      'templateDelimiter:}',
    ])
  })

  it('ends a template at the next column-zero line', () => {
    const rows = tokenizeMachineConfig(
      ['gcode:', '  {% if a', '[stepper_x]', 'step_pin: {x}'].join('\n'),
    )
    expect(kinds(rows[3] ?? [])).toEqual(['key:step_pin:', 'value:{x}'])
  })

  it('colors only the keys Klipper renders as templates', () => {
    const rows = tokenizeMachineConfig(
      [
        '[display_template temp]',
        'text: {t}',
        'param_t: {t}',
        '[filament_switch_sensor runout]',
        'runout_gcode: PAUSE',
        '[gcode_macro VARS]',
        'variable_offsets: {"x": 1}',
      ].join('\n'),
    )
    expect(kinds(rows[1] ?? [])).toContain('templateDelimiter:{')
    expect(kinds(rows[2] ?? [])).toEqual(['key:param_t:', 'value:{t}'])
    expect(kinds(rows[4] ?? [])).toEqual(['key:runout_gcode:', 'command:PAUSE'])
    expect(kinds(rows[6] ?? [])).toEqual(['key:variable_offsets:', 'value:{"x": 1}'])
  })

  it('colors a window as though every line above it had been read', () => {
    const lines = macro
    const whole = tokenizeMachineConfig(lines.join('\n'))
    for (let start = 0; start < lines.length; start += 1) {
      expect(tokenizeMachineRange(lines, start, lines.length), `from line ${start}`).toEqual(
        whole.slice(start),
      )
    }
  })
})

describe('Klipper configuration syntax highlighting, values and structure', () => {
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
      { kind: 'templateDelimiter', text: '{' },
      { kind: 'plain', text: 's' },
      { kind: 'templateDelimiter', text: '}' },
      { kind: 'plain', text: ' ' },
      { kind: 'parameter', text: 'MAXIMUM=' },
      { kind: 'templateDelimiter', text: '{' },
      { kind: 'plain', text: 's+' },
      { kind: 'number', text: '1' },
      { kind: 'templateDelimiter', text: '}' },
      { kind: 'plain', text: '   ' },
      { kind: 'comment', text: '; Wait for hotend temp' },
    ])
  })

  it('keeps empty lines untokenized', () => {
    expect(tokenizeMachineConfig('G28\n\nG90')).toEqual([
      [{ kind: 'gcode', text: 'G28' }],
      [],
      [{ kind: 'gcode', text: 'G90' }],
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
      { kind: 'gcode', text: 'G28', matched: false },
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
