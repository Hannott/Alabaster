import { describe, expect, it } from 'vitest'

import {
  effectiveOption,
  includedConfigFiles,
  indexConfig,
  removeOption,
  writeOption,
  type OptionWrite,
} from '@/features/config/optionLocator'

function config(files: Record<string, string>) {
  const map = new Map(Object.entries(files))
  return { map, index: indexConfig('printer.cfg', map, map.keys()) }
}

function written(result: OptionWrite): Extract<OptionWrite, { ok: true }> {
  if (!result.ok) throw new Error(`write failed: ${result.reason}`)
  return result
}

/*
 * The SAVE_CONFIG block as Klipper writes it, including the two header lines
 * that precede the first section.
 */
const autosave = [
  '#*# <---------------------- SAVE_CONFIG ---------------------->',
  '#*# DO NOT EDIT THIS BLOCK OR BELOW. The contents are auto-generated.',
  '#*#',
  '#*# [input_shaper]',
  '#*# shaper_type_x = mzv',
  '#*# shaper_freq_x = 53.8',
  '#*#',
  '#*# [bed_mesh default]',
  '#*# version = 1',
  '#*# points =',
  '#*# \t0.023447, 0.049697',
  '#*# \t-0.001084, 0.026885',
  '#*# x_count = 2',
  '',
].join('\n')

describe('indexConfig', () => {
  it('uses the last definition across includes, as Klipper does', () => {
    // The layout that makes "first file containing the section" write a line Klipper ignores.
    const { index } = config({
      'printer.cfg': '[extruder]\npressure_advance: 0.02\n\n[include tuning.cfg]\n',
      'tuning.cfg': '[extruder]\npressure_advance: 0.035\n',
    })

    const effective = effectiveOption(index, 'extruder', 'pressure_advance')
    expect(effective).toMatchObject({ path: 'tuning.cfg', line: 1, value: '0.035' })
    expect(index.files).toEqual(['printer.cfg', 'tuning.cfg'])
  })

  it('reads a definition after an include as overriding the include', () => {
    const { index } = config({
      'printer.cfg': '[include tuning.cfg]\n[extruder]\npressure_advance: 0.04\n',
      'tuning.cfg': '[extruder]\npressure_advance: 0.035\n',
    })

    expect(effectiveOption(index, 'extruder', 'pressure_advance')).toMatchObject({
      path: 'printer.cfg',
      value: '0.04',
    })
  })

  it('reads the SAVE_CONFIG block last and marks it', () => {
    const { index } = config({
      'printer.cfg': `[input_shaper]\nshaper_freq_x: 40\n\n${autosave}`,
    })

    expect(effectiveOption(index, 'input_shaper', 'shaper_freq_x')).toMatchObject({
      autosave: true,
      value: '53.8',
      line: 8,
    })
  })

  it('only reads a SAVE_CONFIG block from the primary file', () => {
    const { index } = config({
      'printer.cfg': '[include other.cfg]\n',
      'other.cfg': `[printer]\nmax_accel: 5000\n${autosave}`,
    })

    expect(effectiveOption(index, 'input_shaper', 'shaper_freq_x')).toBeNull()
  })

  it('ignores a SAVE_CONFIG block Klipper would refuse as corrupted', () => {
    const corrupted = autosave.replace('#*# x_count = 2', 'x_count = 2')
    const { index } = config({ 'printer.cfg': `[printer]\nmax_accel: 5000\n${corrupted}` })

    expect(effectiveOption(index, 'input_shaper', 'shaper_freq_x')).toBeNull()
    expect(index.problems).toEqual([{ kind: 'unreadableAutosave', path: 'printer.cfg', line: 2 }])
  })

  it('reads continuation lines as one multi-line value', () => {
    const { index } = config({
      'printer.cfg': [
        '[z_tilt]',
        'z_positions:',
        '  -50, 18',
        '',
        '  # the far corner',
        '  350, 18',
        'retries: 5',
      ].join('\n'),
    })

    expect(effectiveOption(index, 'z_tilt', 'z_positions')).toMatchObject({
      multiline: true,
      line: 1,
      endLine: 5,
      value: '\n-50, 18\n\n\n350, 18',
    })
    expect(effectiveOption(index, 'z_tilt', 'retries')).toMatchObject({ line: 6, value: '5' })
  })

  it('reads a continuation inside the SAVE_CONFIG block', () => {
    const { index } = config({ 'printer.cfg': `[printer]\n${autosave}` })

    expect(effectiveOption(index, 'bed_mesh default', 'points')).toMatchObject({
      multiline: true,
      endLine: 12,
    })
    expect(effectiveOption(index, 'bed_mesh default', 'x_count')?.value).toBe('2')
  })

  it('strips comments the way Klipper and its parser do', () => {
    const { index } = config({
      'printer.cfg': [
        '[printer]',
        'max_velocity: 600 # fast',
        'max_accel: 5000;not a comment',
        'max_z_velocity: 15 ; a comment',
        'square_corner_velocity=5.0',
      ].join('\n'),
    })

    expect(effectiveOption(index, 'printer', 'max_velocity')?.value).toBe('600')
    expect(effectiveOption(index, 'printer', 'max_accel')?.value).toBe('5000;not a comment')
    expect(effectiveOption(index, 'printer', 'max_z_velocity')?.value).toBe('15')
    expect(effectiveOption(index, 'printer', 'square_corner_velocity')?.value).toBe('5.0')
  })

  it('matches sections and options without case, and keeps names with spaces', () => {
    const { index } = config({
      'printer.cfg': '[heater_generic chamber]\nMax_Temp: 70\n',
    })

    expect(effectiveOption(index, 'heater_generic chamber', 'max_temp')).toMatchObject({
      section: 'heater_generic chamber',
      option: 'Max_Temp',
    })
    expect(effectiveOption(index, 'heater_generic', 'max_temp')).toBeNull()
  })

  it('ends the current section at an include', () => {
    // Klipper parses the text after an include on its own; an option there has no section.
    const { index } = config({
      'printer.cfg': '[printer]\n[include a.cfg]\nmax_accel: 5000\n',
      'a.cfg': '',
    })

    expect(effectiveOption(index, 'printer', 'max_accel')).toBeNull()
  })

  it('expands glob includes in sorted order', () => {
    const { index } = config({
      'printer.cfg': '[include parts/*.cfg]\n',
      'parts/b.cfg': '[printer]\nmax_accel: 7000\n',
      'parts/a.cfg': '[printer]\nmax_accel: 5000\n',
      'parts/.a.cfg.swp': '[printer]\nmax_accel: 1\n',
      'parts/deep/c.cfg': '[printer]\nmax_accel: 9000\n',
    })

    expect(index.files).toEqual(['printer.cfg', 'parts/a.cfg', 'parts/b.cfg'])
    expect(effectiveOption(index, 'printer', 'max_accel')?.value).toBe('7000')
  })

  it('resolves includes relative to the file declaring them', () => {
    const { index } = config({
      'printer.cfg': '[include hw/main.cfg]\n',
      'hw/main.cfg': '[include ../shared.cfg]\n[include steppers.cfg]\n',
      'hw/steppers.cfg': '[stepper_x]\nrotation_distance: 40\n',
      'shared.cfg': '[printer]\nmax_accel: 5000\n',
    })

    expect(index.files).toEqual(['printer.cfg', 'hw/main.cfg', 'shared.cfg', 'hw/steppers.cfg'])
  })

  it('reports include problems instead of guessing', () => {
    const map = new Map([
      [
        'printer.cfg',
        '[include gone.cfg]\n[include loop.cfg]\n[include later.cfg]\n[include /home/pi/x.cfg]\n[include none/*.cfg]\n',
      ],
      ['loop.cfg', '[include printer.cfg]\n'],
    ])
    const index = indexConfig('printer.cfg', map, [...map.keys(), 'later.cfg'])

    expect(index.problems).toEqual([
      { kind: 'missingInclude', path: 'printer.cfg', line: 0, target: 'gone.cfg' },
      { kind: 'recursiveInclude', path: 'loop.cfg', line: 0, target: 'printer.cfg' },
      { kind: 'unloadedInclude', path: 'printer.cfg', line: 2, target: 'later.cfg' },
      { kind: 'unreachableInclude', path: 'printer.cfg', line: 3, target: '/home/pi/x.cfg' },
    ])
  })

  it('reads a file included twice from different places both times', () => {
    const { index } = config({
      'printer.cfg': '[include common.cfg]\n[printer]\nmax_accel: 1\n[include common.cfg]\n',
      'common.cfg': '[printer]\nmax_accel: 5000\n',
    })

    expect(index.options.get('printer\nmax_accel')).toHaveLength(3)
    expect(effectiveOption(index, 'printer', 'max_accel')?.path).toBe('common.cfg')
  })
})

describe('includedConfigFiles', () => {
  it('lists includes in order, expanding globs and skipping the SAVE_CONFIG block', () => {
    const text =
      '[include b.cfg]\n[include parts/*.cfg] # hardware\n#[include off.cfg]\n' + autosave
    const available = ['b.cfg', 'parts/y.cfg', 'parts/x.cfg', 'off.cfg']

    expect(includedConfigFiles('printer.cfg', text, available)).toEqual([
      'b.cfg',
      'parts/x.cfg',
      'parts/y.cfg',
    ])
  })
})

describe('writeOption', () => {
  it('edits the effective line in place, keeping separator and comment', () => {
    const files = {
      'printer.cfg': '[extruder]\npressure_advance: 0.02\n[include tuning.cfg]\n',
      'tuning.cfg': '[extruder]\npressure_advance = 0.035   # tuned 2026-09\n',
    }
    const { map, index } = config(files)

    const result = written(writeOption(index, map, 'extruder', 'pressure_advance', ' 0.04 '))

    expect(result).toMatchObject({
      path: 'tuning.cfg',
      line: 1,
      placement: 'replaced',
      autosave: false,
    })
    expect(result.content).toBe('[extruder]\npressure_advance = 0.04   # tuned 2026-09\n')
  })

  it('writes inside the SAVE_CONFIG block in its own format', () => {
    const { map, index } = config({
      'printer.cfg': `[input_shaper]\nshaper_freq_x: 40\n${autosave}`,
    })

    const result = written(writeOption(index, map, 'input_shaper', 'shaper_freq_x', '55.2'))

    expect(result.autosave).toBe(true)
    expect(result.content.split('\n')[7]).toBe('#*# shaper_freq_x = 55.2')
    expect(result.content.split('\n')[1]).toBe('shaper_freq_x: 40')
  })

  it('gives an empty value the space the other lines have', () => {
    const { map, index } = config({ 'printer.cfg': '[extruder]\npressure_advance:\n' })

    const result = written(writeOption(index, map, 'extruder', 'pressure_advance', '0.03'))

    expect(result.content).toBe('[extruder]\npressure_advance: 0.03\n')
  })

  it('adds an option at its default to the end of the last block of its section', () => {
    const { map, index } = config({
      'printer.cfg': [
        '[printer]',
        'kinematics: corexy',
        '',
        '[include limits.cfg]',
        '',
        '[stepper_x]',
      ].join('\n'),
      'limits.cfg': '[printer]\nmax_velocity: 600\nmax_accel: 5000\n\n# notes\n[fan]\n',
    })

    const result = written(writeOption(index, map, 'printer', 'square_corner_velocity', '8'))

    expect(result).toMatchObject({ path: 'limits.cfg', line: 3, placement: 'inserted' })
    expect(result.content).toBe(
      '[printer]\nmax_velocity: 600\nmax_accel: 5000\nsquare_corner_velocity: 8\n\n# notes\n[fan]\n',
    )
  })

  it('adds to the body rather than the SAVE_CONFIG block when both hold the section', () => {
    const { map, index } = config({
      'printer.cfg': `[input_shaper]\nshaper_type_x: mzv\n${autosave}`,
    })

    const result = written(writeOption(index, map, 'input_shaper', 'damping_ratio_x', '0.1'))

    expect(result).toMatchObject({ line: 2, autosave: false })
  })

  it('adds to the SAVE_CONFIG block when that is the only place the section exists', () => {
    const { map, index } = config({ 'printer.cfg': `[printer]\n${autosave}` })

    const result = written(writeOption(index, map, 'input_shaper', 'shaper_type_y', 'ei'))

    expect(result).toMatchObject({ autosave: true, line: 7 })
    expect(result.content.split('\n')[7]).toBe('#*# shaper_type_y = ei')
  })

  it('keeps CRLF line endings', () => {
    const { map, index } = config({ 'printer.cfg': '[printer]\r\nmax_accel: 5000\r\n' })

    const replaced = written(writeOption(index, map, 'printer', 'max_accel', '7000'))
    const inserted = written(writeOption(index, map, 'printer', 'max_velocity', '600'))

    expect(replaced.content).toBe('[printer]\r\nmax_accel: 7000\r\n')
    expect(inserted.content).toBe('[printer]\r\nmax_accel: 5000\r\nmax_velocity: 600\r\n')
  })

  it('refuses a multi-line value', () => {
    const { map, index } = config({ 'printer.cfg': '[z_tilt]\nz_positions:\n  0, 0\n  10, 0\n' })

    expect(writeOption(index, map, 'z_tilt', 'z_positions', '1, 1')).toEqual({
      ok: false,
      reason: 'multiline',
    })
  })

  it('refuses values Klipper would read differently', () => {
    const { map, index } = config({ 'printer.cfg': '[printer]\nmax_accel: 5000\n' })

    for (const value of ['', '   ', '5000 # fast', '5000 ;x', ';x', '1\n2']) {
      expect(writeOption(index, map, 'printer', 'max_accel', value)).toEqual({
        ok: false,
        reason: 'invalidValue',
      })
    }
    expect(writeOption(index, map, 'printer', 'max_accel', '5000;x').ok).toBe(true)
  })

  it('refuses an option whose section is not configured', () => {
    const { map, index } = config({ 'printer.cfg': '[printer]\n' })

    expect(writeOption(index, map, 'firmware_retraction', 'retract_length', '0.5')).toEqual({
      ok: false,
      reason: 'sectionMissing',
    })
  })
})

describe('removeOption', () => {
  it('undoes an inserted option exactly', () => {
    const { map, index } = config({ 'printer.cfg': '[printer]\nmax_accel: 5000\n' })
    const inserted = written(writeOption(index, map, 'printer', 'max_velocity', '600'))
    const next = new Map([['printer.cfg', inserted.content]])
    const nextIndex = indexConfig('printer.cfg', next, next.keys())

    expect(removeOption(nextIndex, next, 'printer', 'max_velocity')).toEqual({
      path: 'printer.cfg',
      content: '[printer]\nmax_accel: 5000\n',
    })
  })

  it('refuses a multi-line value and an option that is not there', () => {
    const { map, index } = config({ 'printer.cfg': '[z_tilt]\nz_positions:\n  0, 0\n' })

    expect(removeOption(index, map, 'z_tilt', 'z_positions')).toBeNull()
    expect(removeOption(index, map, 'z_tilt', 'retries')).toBeNull()
  })
})
