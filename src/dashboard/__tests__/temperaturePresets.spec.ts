import { describe, expect, it } from 'vitest'

import {
  defaultTemperaturePresets,
  presetFromDraft,
  readPresetDrafts,
  readPresets,
} from '@/dashboard/temperaturePresets'

describe('temperature presets', () => {
  it('seeds a card that has never been given any', () => {
    expect(readPresets({})).toEqual([...defaultTemperaturePresets])
    // Seeded rather than assumed: the values used to be constants in the
    // component, which is a guess about someone else's filament.
    expect(readPresets({ presets: [{ name: 'Nylon', extruder: 260, bed: 90 }] })).toEqual([
      { name: 'Nylon', extruder: 260, bed: 90 },
    ])
  })

  /*
   * A hand-edited profile should cost the user the row it broke, not the card.
   * A row that would set nothing at all is dropped, because a button that
   * presses to no effect is worse than a missing one — but a row that sets one
   * heater and leaves the other is kept, since that is a thing a preset is now
   * allowed to mean.
   */
  it('drops a row that would set nothing, and keeps one that sets half', () => {
    const presets = readPresets({
      presets: [
        { name: 'PLA', extruder: 210, bed: 60 },
        { name: '', extruder: 240, bed: 80 },
        { name: 'Nothing at all', extruder: 'hot', bed: null },
        { name: 'Hotend only', extruder: 240 },
        { name: 'Bed only', bed: 110 },
        { name: 'ABS', extruder: 250, bed: 100 },
        'not even an object',
      ],
    })
    expect(presets).toEqual([
      { name: 'PLA', extruder: 210, bed: 60 },
      // A junk half degrades to "leave that heater alone", never to zero: read
      // as zero it would cool a heater nobody asked to cool.
      { name: 'Hotend only', extruder: 240, bed: null },
      { name: 'Bed only', extruder: null, bed: 110 },
      { name: 'ABS', extruder: 250, bed: 100 },
    ])
  })

  it('keeps a preset to whole degrees at or above zero', () => {
    expect(readPresets({ presets: [{ name: 'Odd', extruder: 209.6, bed: -5 }] })).toEqual([
      { name: 'Odd', extruder: 210, bed: 0 },
    ])
  })

  it('lets a card empty the list deliberately', () => {
    // Distinct from never having been configured: an empty stored list falls
    // back to the defaults, so the way to have none is to remove them all and
    // accept that the card seeds again. Worth knowing rather than surprising.
    expect(readPresets({ presets: [] })).toEqual([...defaultTemperaturePresets])
  })

  /*
   * The editor's view is deliberately the opposite of the card's. Add wrote a
   * row with no name yet, the card's reader dropped it as unusable, and the
   * editor — which was reading through that same reader — never rendered the
   * row the user was meant to name. Add looked like a button that did nothing.
   */
  it('keeps an unfinished row for the editor that the card refuses to show', () => {
    const config = {
      presets: [
        { name: 'PLA', extruder: 210, bed: 60 },
        { name: '', extruder: 200, bed: 60 },
      ],
    }
    expect(readPresets(config).map((preset) => preset.name)).toEqual(['PLA'])
    expect(readPresetDrafts(config)).toEqual([
      { name: 'PLA', extruder: '210', bed: '60' },
      { name: '', extruder: '200', bed: '60' },
    ])
  })

  it('seeds the editor from the defaults too, so a first edit makes them real', () => {
    expect(readPresetDrafts({})).toEqual([
      { name: 'PLA', extruder: '210', bed: '60' },
      { name: 'PETG', extruder: '240', bed: '80' },
      { name: 'ABS', extruder: '250', bed: '100' },
    ])
  })

  /*
   * The two intentions a single field has to carry. A cleared field means
   * "leave that heater as it is"; a typed zero means "turn it off". They shared
   * the value `0` before, so a filament pulled from the catalogue with no
   * recommended bed temperature became a button that switched the bed off.
   */
  it('tells a cleared preset field apart from a typed zero', () => {
    expect(presetFromDraft({ name: '  Nylon  ', extruder: '260', bed: '90' })).toEqual({
      name: 'Nylon',
      extruder: 260,
      bed: 90,
    })
    expect(presetFromDraft({ name: 'Leave both', extruder: '', bed: '  ' })).toEqual({
      name: 'Leave both',
      extruder: null,
      bed: null,
    })
    expect(presetFromDraft({ name: 'Cold', extruder: '0', bed: '0' })).toEqual({
      name: 'Cold',
      extruder: 0,
      bed: 0,
    })
    expect(presetFromDraft({ name: 'Junk', extruder: 'hot', bed: '60' })).toEqual({
      name: 'Junk',
      extruder: null,
      bed: 60,
    })
  })

  /*
   * Vue casts a `v-model` on a `type="number"` input to a number by itself, so
   * an edited row reaches `presetFromDraft` holding numbers while an untouched
   * one still holds the seeded strings. Trimming without coercing first threw
   * on the first keystroke against a real editor and passed against every
   * string fixture.
   */
  it('commits a row the number inputs have already cast to numbers', () => {
    const edited = { name: 'Edited', extruder: 245, bed: 85 } as unknown as {
      name: string
      extruder: string
      bed: string
    }
    expect(presetFromDraft(edited)).toEqual({ name: 'Edited', extruder: 245, bed: 85 })
  })
})
