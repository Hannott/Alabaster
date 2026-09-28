import { describe, expect, it } from 'vitest'

import { indexConfig } from '@/features/config/optionLocator'
import anchors from '@/features/machine/docsAnchors.json'
import type { DocsAnchors } from '@/features/machine/docsLinks'
import { resolveEditorContext } from '@/features/machine/editorContext'
import {
  buildEditorMenu,
  type EditorMenu,
  type EditorMenuFacts,
  type EditorMenuItem,
} from '@/features/machine/editorMenu'

const printerCfg = [
  '[include macros.cfg]', // 0
  '[printer]', // 1
  'kinematics: corexy', // 2
  'max_accel: 7000', // 3
  'max_velocity: 300', // 4
  '', // 5
  '[bed_mesh]', // 6
  'probe_count: 5, 5', // 7
  '', // 8
  '[probe]', // 9
  'pin: ^EBBCan:PB5', // 10
  'z_offset: 1.0', // 11
  '', // 12
  '[mcu EBBCan]', // 13
  'canbus_uuid: abc', // 14
  '', // 15
  '[gcode_macro START]', // 16
  'gcode:', // 17
  '  G28', // 18
  '  PARK', // 19
  '  TYPO_COMMAND', // 20
  '  {% if printer.toolhead.homed_axes %}', // 21
  '  {% endif %}', // 22
  '', // 23
  '#*# <---------------------- SAVE_CONFIG ---------------------->', // 24
  '#*# [probe]', // 25
  '#*# z_offset = 1.250', // 26
]
const macrosCfg = ['[gcode_macro PARK]', 'variable_z_lift: 10', 'gcode:', '  G0 Z10']

const files = new Map([
  ['printer.cfg', printerCfg.join('\n')],
  ['macros.cfg', macrosCfg.join('\n')],
])
const index = indexConfig('printer.cfg', files, [...files.keys()])

function facts(overrides: Partial<EditorMenuFacts> = {}): EditorMenuFacts {
  return {
    path: 'printer.cfg',
    lines: printerCfg,
    readOnly: false,
    selection: '',
    site: 'klipper',
    anchors: (anchors as DocsAnchors).klipper,
    index,
    files: [...files.keys()],
    settings: {
      printer: { kinematics: 'corexy', max_accel: 5000, max_velocity: 300 },
      bed_mesh: { probe_count: [5, 5] },
      probe: { z_offset: 1.25 },
      'gcode_macro start': {},
      'gcode_macro park': { variable_z_lift: 10 },
    },
    settingsLoaded: true,
    loadedConfig: { printer: { max_accel: '5000', max_velocity: '300.0' } },
    pendingItems: {},
    isPinned: () => false,
    pinnableSections: new Set(['printer', 'bed_mesh', 'probe', 'gcode_macro park']),
    commandHelp: new Map([
      ['G28', 'Home'],
      ['PARK', 'Park the toolhead'],
      ['BED_MESH_CALIBRATE', 'Probe a mesh'],
    ]),
    klipperReady: true,
    ...overrides,
  }
}

function menuAt(line: number, text: string, overrides: Partial<EditorMenuFacts> = {}): EditorMenu {
  const lines = overrides.lines ?? printerCfg
  const column = (lines[line] ?? '').indexOf(text)
  return buildEditorMenu(resolveEditorContext(lines, line, column), facts(overrides))
}

function items(menu: EditorMenu): EditorMenuItem[] {
  return menu.groups.flatMap((group) => group.items)
}

function ids(menu: EditorMenu): string[] {
  return items(menu).map((item) => item.id)
}

function item(menu: EditorMenu, id: string): EditorMenuItem | undefined {
  return items(menu).find((candidate) => candidate.id === id)
}

describe('buildEditorMenu', () => {
  it('offers a section its reference, guide, Quick config picker, and section editing', () => {
    const menu = menuAt(6, 'bed_mesh')
    expect(menu.heading).toBe('[bed_mesh]')
    expect(item(menu, 'reference')?.href).toBe(
      'https://www.klipper3d.org/Config_Reference.html#bed_mesh',
    )
    expect(item(menu, 'guide')?.href).toBe('https://www.klipper3d.org/Bed_Mesh.html')
    expect(item(menu, 'choosePins')?.action).toEqual({ type: 'choosePins', section: 'bed_mesh' })
    expect(item(menu, 'commentSection')?.action).toEqual({
      type: 'commentLines',
      range: { from: 6, to: 7 },
    })
    expect(ids(menu)).toContain('selectSection')
  })

  it('says when Klipper did not load a section', () => {
    const menu = menuAt(6, 'bed_mesh', { settings: {} })
    expect(menu.facts.map((fact) => fact.label.key)).toContain(
      'configuration.editorMenu.facts.notLoaded',
    )
  })

  it('links a merged section to its other definition', () => {
    const menu = menuAt(9, 'probe')
    expect(item(menu, 'otherSection0')?.action).toEqual({
      type: 'goTo',
      path: 'printer.cfg',
      line: 25,
    })
  })

  it('pins an option, or offers to show and remove one already pinned', () => {
    expect(item(menuAt(3, 'max_accel'), 'pin')?.action).toEqual({
      type: 'pinOption',
      section: 'printer',
      option: 'max_accel',
    })
    const pinned = menuAt(3, 'max_accel', { isPinned: () => true })
    expect(ids(pinned)).toEqual(expect.arrayContaining(['showPin', 'unpin']))
    expect(ids(pinned)).not.toContain('pin')
  })

  it('does not pin a template key', () => {
    expect(ids(menuAt(17, 'gcode'))).not.toContain('pin')
  })

  it('says what Klipper is running when the line differs, and nothing when it matches', () => {
    const differs = menuAt(3, 'max_accel')
    expect(differs.facts[0]?.label).toEqual({
      key: 'configuration.editorMenu.facts.running',
      params: { value: '5000' },
    })
    expect(menuAt(4, 'max_velocity').facts).toEqual([])
  })

  it('points an option shadowed by the SAVE_CONFIG block at the value Klipper uses', () => {
    const menu = menuAt(11, 'z_offset')
    expect(menu.facts[0]?.label.key).toBe('configuration.editorMenu.facts.savedBySaveConfig')
    expect(item(menu, 'effective')?.action).toEqual({ type: 'goTo', path: 'printer.cfg', line: 26 })
  })

  it('warns when a pending calibration would overwrite the option', () => {
    const menu = menuAt(7, 'probe_count', { pendingItems: { bed_mesh: { probe_count: '6, 6' } } })
    expect(menu.facts.map((fact) => fact.label.key)).toContain(
      'configuration.editorMenu.facts.pendingCalibration',
    )
  })

  it('applies a runtime option until restart only while Klipper is ready', () => {
    expect(item(menuAt(3, 'max_accel'), 'apply')?.action).toEqual({
      type: 'applyRuntime',
      command: { script: 'SET_VELOCITY_LIMIT ACCEL=7000', key: 'limits' },
    })
    expect(ids(menuAt(3, 'max_accel', { klipperReady: false }))).not.toContain('apply')
  })

  it('leaves every editing row off a read-only file', () => {
    const menu = menuAt(6, 'bed_mesh', { readOnly: true, selection: 'bed' })
    expect(ids(menu)).not.toEqual(expect.arrayContaining(['cut']))
    expect(ids(menu)).not.toContain('toggleComment')
    expect(ids(menu)).not.toContain('commentSection')
    expect(ids(menu)).toContain('copy')
  })

  it('cuts only a selection, and copies the target when nothing is selected', () => {
    expect(ids(menuAt(3, 'max_accel'))).not.toContain('cut')
    expect(ids(menuAt(3, 'max_accel'))).toContain('copy')
    expect(ids(menuAt(3, 'max_accel', { selection: '7000' }))).toContain('cut')
  })

  it('goes from a pin to its MCU and searches for its other uses', () => {
    const menu = menuAt(10, 'PB5')
    expect(menu.heading).toBe('^EBBCan:PB5')
    expect(item(menu, 'mcu')?.action).toEqual({ type: 'goTo', path: 'printer.cfg', line: 13 })
    expect(item(menu, 'search')?.action).toEqual({ type: 'search', query: 'EBBCan:PB5' })
  })

  it('opens and reveals an include, or creates one that is missing', () => {
    const menu = menuAt(0, 'macros')
    expect(item(menu, 'open')?.action).toEqual({ type: 'openFile', path: 'macros.cfg' })
    expect(ids(menu)).toContain('reveal')
    const missing = menuAt(0, 'macros', { files: ['printer.cfg'] })
    expect(item(missing, 'create')?.action).toEqual({ type: 'createFile', path: 'macros.cfg' })
    expect(ids(menuAt(0, 'macros', { files: ['printer.cfg'], readOnly: true }))).not.toContain(
      'create',
    )
  })

  it('names a macro by its description and goes to its definition', () => {
    const menu = menuAt(19, 'PARK')
    expect(menu.facts[0]?.label.params).toEqual({ text: 'Park the toolhead' })
    expect(item(menu, 'definition')?.action).toEqual({ type: 'goTo', path: 'macros.cfg', line: 0 })
    expect(ids(menu)).toContain('selectBody')
  })

  it('says Klipper does not know a command, once it has listed the ones it does', () => {
    expect(menuAt(20, 'TYPO_COMMAND').facts[0]?.label.key).toBe(
      'configuration.editorMenu.facts.unknownCommand',
    )
    expect(menuAt(20, 'TYPO_COMMAND', { commandHelp: null }).facts).toEqual([])
  })

  it('links a numbered code to the standard code list', () => {
    expect(item(menuAt(18, 'G28'), 'commandReference')?.href).toBe(
      'https://www.klipper3d.org/G-Codes.html#g-code-commands',
    )
  })

  it('watches the printer object a template path reads, and links its status entry', () => {
    const menu = menuAt(21, 'printer')
    expect(menu.watch).toEqual({ object: 'toolhead', attributes: ['homed_axes'] })
    expect(item(menu, 'status')?.href).toBe(
      'https://www.klipper3d.org/Status_Reference.html#toolhead',
    )
    expect(item(menu, 'template')?.href).toBe(
      'https://www.klipper3d.org/Command_Templates.html#the-printer-variable',
    )
  })

  it('links a Jinja keyword to Jinja', () => {
    expect(item(menuAt(22, 'endif'), 'jinja')?.href).toBe(
      'https://jinja.palletsprojects.com/en/stable/templates/#if',
    )
  })

  it('leaves documentation out until the anchor table has loaded', () => {
    const menu = menuAt(6, 'bed_mesh', { anchors: null })
    expect(items(menu).some((entry) => entry.href)).toBe(false)
  })

  it('links the Kalico site when the printer runs Kalico', () => {
    const menu = menuAt(6, 'bed_mesh', { site: 'kalico', anchors: (anchors as DocsAnchors).kalico })
    expect(item(menu, 'reference')?.href).toBe(
      'https://docs.kalico.gg/Config_Reference.html#bed_mesh',
    )
    expect(item(menu, 'reference')?.label.key).toBe('configuration.editorMenu.reference.kalico')
  })

  it('offers only the general rows on a blank line', () => {
    expect(ids(menuAt(5, ''))).toEqual(['toggleComment', 'goToLine', 'shortcuts'])
  })
})

describe('macro help text', () => {
  it('leaves out the placeholder Klipper gives a macro with no description', () => {
    const menu = menuAt(19, 'PARK', { commandHelp: new Map([['PARK', 'G-Code macro']]) })
    expect(menu.facts).toEqual([])
  })
})
