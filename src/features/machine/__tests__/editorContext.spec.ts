import { describe, expect, it } from 'vitest'

import { resolveEditorContext, sectionLines } from '@/features/machine/editorContext'

const config = [
  '[include macros/*.cfg]', //  0
  '# Mesh over the usable area', //  1
  '[bed_mesh]', //  2
  'speed: 300', //  3
  'mesh_min: 30, 30 # corner', //  4
  '#algorithm: bicubic', //  5
  '', //  6
  '# the probe', //  7
  '[probe]', //  8
  'pin: ^!EBBCan:PB5', //  9
  '', // 10
  '[gcode_macro PARK]', // 11
  'variable_z_lift: 10', // 12
  'gcode:', // 13
  '  {% set th = printer.toolhead %}', // 14
  "  {% if 'xyz' in th.homed_axes %}", // 15
  '    G0 Z{(th.position.z + z_lift)|round(2)}', // 16
  '    RESPOND MSG="Parked"', // 17
  '    status: parked', // 18
  '  {% endif %}', // 19
  "  M117 {printer['gcode_macro PARK'].z_lift} {params.SPEED|default(5)}", // 20
  '', // 21
  '#[fan]', // 22
  '#pin: PA8', // 23
  '', // 24
  '# see https://www.klipper3d.org/Config_Reference.html for more', // 25
  '#*# <---------------------- SAVE_CONFIG ---------------------->', // 26
  '#*# [probe]', // 27
  '#*# z_offset = 1.250', // 28
]

function at(line: number, text: string, offset = 0) {
  const column = (config[line] ?? '').indexOf(text)
  if (column < 0) throw new Error(`"${text}" not on line ${line}`)
  return resolveEditorContext(config, line, column + offset)
}

describe('resolveEditorContext', () => {
  it('reads a section header and the lines the section holds', () => {
    const context = at(2, 'bed_mesh')
    expect(context.target).toEqual({ kind: 'section', name: 'bed_mesh', commented: false })
    // The comment above [probe] belongs to [probe], not to the section before it.
    expect(context.sectionRange).toEqual({ from: 2, to: 4 })
  })

  it('reads an include line as its path, wherever on the line the pointer is', () => {
    expect(at(0, 'include').target).toEqual({ kind: 'include', path: 'macros/*.cfg' })
    expect(at(0, 'macros').target).toEqual({ kind: 'include', path: 'macros/*.cfg' })
  })

  it('reads a key and its value as the option, leaving the inline comment out', () => {
    expect(at(4, 'mesh_min').target).toMatchObject({
      kind: 'option',
      option: 'mesh_min',
      value: '30, 30',
    })
    expect(at(4, '30').target).toMatchObject({ kind: 'option', option: 'mesh_min' })
    expect(at(4, 'mesh_min').span).toEqual({ start: 0, end: 8 })
    expect(at(4, 'mesh_min').section).toEqual({ name: 'bed_mesh', line: 2 })
  })

  it('reads a commented-out option and a commented-out section', () => {
    expect(at(5, 'algorithm').target).toMatchObject({
      kind: 'option',
      option: 'algorithm',
      value: 'bicubic',
      commented: true,
    })
    const section = at(22, 'fan')
    expect(section.target).toEqual({ kind: 'section', name: 'fan', commented: true })
    expect(section.sectionRange).toEqual({ from: 22, to: 23 })
  })

  it('splits a pin into its chip and name', () => {
    expect(at(9, 'PB5').target).toEqual({
      kind: 'pin',
      option: 'pin',
      pin: '^!EBBCan:PB5',
      chip: 'EBBCan',
      name: 'PB5',
    })
  })

  it('reads a template key as a template option', () => {
    const context = at(13, 'gcode')
    expect(context.target).toMatchObject({ kind: 'option', option: 'gcode', template: true })
    expect(context.templateBody).toEqual({ from: 13, to: 20 })
  })

  it('reads a key-shaped line inside a macro body as G-code, not as an option', () => {
    const context = at(18, 'status')
    expect(context.target).toEqual({ kind: 'command', name: 'status' })
    expect(context.templateBody).toEqual({ from: 13, to: 20 })
  })

  it('reads a command and its arguments as the command', () => {
    expect(at(17, 'RESPOND').target).toEqual({ kind: 'command', name: 'RESPOND' })
    expect(at(17, 'MSG').target).toEqual({ kind: 'command', name: 'RESPOND' })
    expect(at(16, 'G0').target).toEqual({ kind: 'command', name: 'G0' })
  })

  it('reads a printer path, and an alias a set in the same body bound to one', () => {
    expect(at(14, 'printer').target).toMatchObject({
      kind: 'printerPath',
      object: 'toolhead',
      attributes: [],
      display: 'printer.toolhead',
    })
    expect(at(15, 'homed_axes').target).toMatchObject({
      kind: 'printerPath',
      object: 'toolhead',
      attributes: ['homed_axes'],
      display: 'printer.toolhead.homed_axes',
    })
    expect(at(16, 'position').target).toMatchObject({
      kind: 'printerPath',
      attributes: ['position', 'z'],
    })
    expect(at(20, 'printer').target).toMatchObject({
      kind: 'printerPath',
      object: 'gcode_macro PARK',
      attributes: ['z_lift'],
      display: 'printer["gcode_macro PARK"].z_lift',
    })
  })

  it('reads Klipper names, Jinja keywords, filters, and tests', () => {
    expect(at(20, 'params').target).toEqual({ kind: 'templateGlobal', name: 'params' })
    expect(at(20, 'SPEED').target).toEqual({ kind: 'templateGlobal', name: 'params' })
    expect(at(15, 'if').target).toEqual({ kind: 'jinja', name: { kind: 'keyword', name: 'if' } })
    expect(at(16, 'round').target).toEqual({
      kind: 'jinja',
      name: { kind: 'filter', name: 'round' },
    })
    expect(at(20, 'default').target).toEqual({
      kind: 'jinja',
      name: { kind: 'filter', name: 'default' },
    })
    const test = resolveEditorContext(['gcode:', '  {% if x is defined %}'], 1, 17)
    expect(test.target).toEqual({ kind: 'jinja', name: { kind: 'test', name: 'defined' } })
  })

  it('spans a delimiter to the one that closes it', () => {
    const context = at(19, '{%')
    expect(context.target).toEqual({ kind: 'delimiter', start: 2, end: 13 })
  })

  it('finds a URL in a comment', () => {
    expect(at(25, 'klipper3d').target).toEqual({
      kind: 'url',
      href: 'https://www.klipper3d.org/Config_Reference.html',
    })
  })

  it('reads the SAVE_CONFIG block by the section each line belongs to', () => {
    expect(at(27, 'probe').target).toEqual({ kind: 'autogen', section: 'probe', option: null })
    expect(at(28, 'z_offset').target).toEqual({
      kind: 'autogen',
      section: 'probe',
      option: 'z_offset',
    })
  })

  it('reads past the end of a line as nothing in particular', () => {
    expect(resolveEditorContext(config, 3, 40).target).toEqual({ kind: 'plain' })
    expect(resolveEditorContext(config, 6, 0).target).toEqual({ kind: 'plain' })
  })

  it('ends a macro section at its last body line', () => {
    expect(sectionLines(config, 11)).toEqual({ from: 11, to: 20 })
  })
})
