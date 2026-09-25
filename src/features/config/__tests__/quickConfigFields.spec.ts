import { describe, expect, it } from 'vitest'

import { indexConfig } from '@/features/config/optionLocator'
import { optionUnit } from '@/features/config/optionUnits'
import {
  buildQuickConfigCards,
  defaultQuickConfigPins,
  visiblePins,
  type QuickConfigInputs,
} from '@/features/config/quickConfigFields'

const saveConfigBlock = [
  '#*# <---------------------- SAVE_CONFIG ---------------------->',
  '#*# DO NOT EDIT THIS BLOCK OR BELOW. The contents are auto-generated.',
  '#*#',
  '#*# [input_shaper]',
  '#*# shaper_freq_x = 53.8',
  '',
].join('\n')

const disk = `[printer]\nmax_accel: 5000\nmax_velocity: 600\n\n[z_tilt]\nz_positions:\n  0, 0\n  10, 0\n${saveConfigBlock}`

function inputs(
  overrides: Partial<QuickConfigInputs> & { edited?: string } = {},
): QuickConfigInputs {
  const { edited, ...rest } = overrides
  const saved = new Map([['printer.cfg', disk]])
  const current = new Map([['printer.cfg', edited ?? disk]])
  return {
    pins: [
      { section: 'printer', option: 'max_accel' },
      { section: 'printer', option: 'square_corner_velocity' },
    ],
    current: indexConfig('printer.cfg', current, current.keys()),
    saved: indexConfig('printer.cfg', saved, saved.keys()),
    settings: {
      printer: { max_accel: 5000, max_velocity: 600, square_corner_velocity: 5 },
      input_shaper: { shaper_freq_x: 53.8 },
      z_tilt: {
        z_positions: [
          [0, 0],
          [10, 0],
        ],
      },
      stepper_x: { invert: false },
    },
    loadedConfig: {
      printer: { max_accel: '5000', max_velocity: '600' },
      input_shaper: { shaper_freq_x: '53.8' },
    },
    savePending: false,
    pendingItems: {},
    ...rest,
  }
}

function field(cards: ReturnType<typeof buildQuickConfigCards>, option: string) {
  const found = cards.flatMap((card) => card.fields).find((entry) => entry.option === option)
  if (!found) throw new Error(`no field ${option}`)
  return found
}

describe('buildQuickConfigCards', () => {
  it('reads a clean option from the file, typed by what Klipper reports', () => {
    const cards = buildQuickConfigCards(inputs())

    expect(field(cards, 'max_accel')).toMatchObject({
      kind: 'number',
      unit: 'mmPerSecondSquared',
      value: '5000',
      savedValue: '5000',
      location: { path: 'printer.cfg', line: 1 },
      unsaved: false,
      unapplied: false,
      lock: null,
    })
  })

  it('shows an option left at its default with Klipper’s value and no location', () => {
    const cards = buildQuickConfigCards(inputs())

    expect(field(cards, 'square_corner_velocity')).toMatchObject({
      value: null,
      defaultValue: '5',
      location: null,
      unsaved: false,
      lock: null,
    })
  })

  it('marks an edit in the buffer as unsaved against what is on disk', () => {
    const cards = buildQuickConfigCards(
      inputs({ edited: disk.replace('max_accel: 5000', 'max_accel: 7000') }),
    )

    expect(field(cards, 'max_accel')).toMatchObject({
      value: '7000',
      savedValue: '5000',
      unsaved: true,
      unapplied: false,
    })
  })

  it('marks a saved change Klipper has not loaded yet', () => {
    // The field must not look reverted after a plain save: disk says 7000, Klipper still runs 5000.
    const saved = disk.replace('max_accel: 5000', 'max_accel: 7000')
    const files = new Map([['printer.cfg', saved]])
    const index = indexConfig('printer.cfg', files, files.keys())
    const cards = buildQuickConfigCards(inputs({ current: index, saved: index }))

    expect(field(cards, 'max_accel')).toMatchObject({
      value: '7000',
      unsaved: false,
      unapplied: true,
    })
  })

  it('does not claim a change is unapplied before Klipper has reported its config', () => {
    const saved = disk.replace('max_accel: 5000', 'max_accel: 7000')
    const files = new Map([['printer.cfg', saved]])
    const index = indexConfig('printer.cfg', files, files.keys())
    const cards = buildQuickConfigCards(inputs({ current: index, saved: index, loadedConfig: {} }))

    expect(field(cards, 'max_accel').unapplied).toBe(false)
  })

  it('marks a SAVE_CONFIG line and locks it while calibration results are pending', () => {
    const pins = [{ section: 'input_shaper', option: 'shaper_freq_x' }]

    expect(field(buildQuickConfigCards(inputs({ pins })), 'shaper_freq_x')).toMatchObject({
      autosave: true,
      lock: null,
      unit: 'hertz',
    })
    expect(
      field(buildQuickConfigCards(inputs({ pins, savePending: true })), 'shaper_freq_x').lock,
    ).toBe('pendingCalibration')
  })

  it('locks a body option that is itself among the pending results', () => {
    const cards = buildQuickConfigCards(
      inputs({ savePending: true, pendingItems: { printer: { max_accel: '6000' } } }),
    )

    expect(field(cards, 'max_accel').lock).toBe('pendingCalibration')
    expect(field(cards, 'square_corner_velocity').lock).toBeNull()
  })

  it('locks a multi-line value', () => {
    const cards = buildQuickConfigCards(
      inputs({ pins: [{ section: 'z_tilt', option: 'z_positions' }] }),
    )

    expect(field(cards, 'z_positions').lock).toBe('multiline')
  })

  it('locks an option neither the file nor Klipper has', () => {
    // Klipper refuses to start on an option it does not read.
    const cards = buildQuickConfigCards(
      inputs({ pins: [{ section: 'printer', option: 'pressure_advance' }] }),
    )

    expect(field(cards, 'pressure_advance').lock).toBe('unknownOption')
  })

  it('reads a boolean option as a check box', () => {
    const current = new Map([['printer.cfg', '[stepper_x]\ninvert: False\n']])
    const index = indexConfig('printer.cfg', current, current.keys())
    const cards = buildQuickConfigCards(
      inputs({ current: index, saved: index, pins: [{ section: 'stepper_x', option: 'invert' }] }),
    )

    expect(field(cards, 'invert').kind).toBe('boolean')
  })

  it('keeps a pinned section that is gone, as a card of its own after the rest', () => {
    const cards = buildQuickConfigCards(
      inputs({
        pins: [
          { section: 'heater_generic chamber', option: 'max_temp' },
          { section: 'printer', option: 'max_accel' },
        ],
      }),
    )

    expect(cards.map((card) => [card.key, card.missing])).toEqual([
      ['printer', false],
      ['heater_generic chamber', true],
    ])
  })

  it('names every file a section is split across', () => {
    const files = new Map([
      ['printer.cfg', '[printer]\nmax_accel: 5000\n[include limits.cfg]\n'],
      ['limits.cfg', '[printer]\nmax_velocity: 600\n'],
    ])
    const index = indexConfig('printer.cfg', files, files.keys())
    const cards = buildQuickConfigCards(inputs({ current: index, saved: index }))

    expect(cards[0]?.files).toEqual(['printer.cfg', 'limits.cfg'])
  })
})

describe('visiblePins', () => {
  it('uses the stored list as it is, even when empty', () => {
    expect(visiblePins([], () => true)).toEqual([])
  })

  it('filters the defaults to what this printer’s config has', () => {
    const pins = visiblePins(null, (pin) => pin.section === 'printer')

    expect(pins).toEqual(defaultQuickConfigPins.filter((pin) => pin.section === 'printer'))
    expect(pins).toHaveLength(4)
  })
})

describe('optionUnit', () => {
  it('shares tables across numbered extruders and steppers', () => {
    expect(optionUnit('extruder1', 'rotation_distance')).toBe('millimetres')
    expect(optionUnit('stepper_z1', 'homing_speed')).toBe('mmPerSecond')
    expect(optionUnit('heater_generic chamber', 'max_temp')).toBe('degreesCelsius')
  })

  it('shows no unit rather than a guessed one', () => {
    expect(optionUnit('extruder', 'pressure_advance')).toBeNull()
    expect(optionUnit('my_section', 'speed')).toBeNull()
  })
})
