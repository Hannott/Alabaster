import { describe, expect, it } from 'vitest'

import { filamentChips } from '@/dashboard/filamentMetadata'

describe('filamentChips', () => {
  it('returns nothing for a file with no filament metadata at all', () => {
    expect(filamentChips({ filename: 'blank.gcode' })).toEqual([])
    expect(filamentChips(null)).toEqual([])
  })

  it('builds one chip from the plain totals when there is only one filament', () => {
    expect(
      filamentChips({ filename: 'cube.gcode', filament_type: 'PLA', filament_weight_total: 27.3 }),
    ).toEqual([{ color: null, type: 'PLA', weightGrams: 27.3 }])
  })

  it('parses a JSON-encoded multi-material filament_type rather than treating it as one name', () => {
    const chips = filamentChips({
      filename: 'dual.gcode',
      filament_type: '["PLA","PETG"]',
      filament_colors: ['FF0000', '00FF00'],
      filament_weights: [15, 20],
    })
    expect(chips).toEqual([
      { color: '#FF0000', type: 'PLA', weightGrams: 15 },
      { color: '#00FF00', type: 'PETG', weightGrams: 20 },
    ])
  })

  it('keeps a hex color that already carries its leading #', () => {
    expect(
      filamentChips({
        filename: 'dual.gcode',
        filament_colors: ['#FF0000', '#00FF00'],
        filament_weights: [15, 20],
      })[0]?.color,
    ).toBe('#FF0000')
  })

  it('falls back to the single filament_type for every chip when only one type was reported', () => {
    const chips = filamentChips({
      filename: 'dual.gcode',
      filament_type: 'PLA',
      filament_colors: ['FF0000', '00FF00'],
    })
    expect(chips.map((chip) => chip.type)).toEqual(['PLA', 'PLA'])
  })

  it('never mistakes a genuinely single quoted string for JSON', () => {
    expect(
      filamentChips({ filename: 'cube.gcode', filament_type: 'Generic PLA Brown' })[0]?.type,
    ).toBe('Generic PLA Brown')
  })
})
