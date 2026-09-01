import { describe, expect, it } from 'vitest'

import {
  macroColorKey,
  macroColorVariable,
  nextMacroColorKey,
} from '@/components/dashboard/modules/macroColors'

describe('macroColorKey / macroColorVariable', () => {
  it('defaults to no color, unlike a sensor which always has one', () => {
    expect(macroColorKey('CLEAN_NOZZLE', {})).toBeNull()
    expect(macroColorVariable('CLEAN_NOZZLE', {})).toBeNull()
  })

  it('resolves a chosen color to its CSS variable', () => {
    const overrides = { CLEAN_NOZZLE: 'sky' }
    expect(macroColorKey('CLEAN_NOZZLE', overrides)).toBe('sky')
    expect(macroColorVariable('CLEAN_NOZZLE', overrides)).toBe('var(--color-data-sky)')
  })

  it('degrades a stale or hand-edited value to no color rather than crashing', () => {
    const overrides = { CLEAN_NOZZLE: 'ultraviolet' }
    expect(macroColorKey('CLEAN_NOZZLE', overrides)).toBeNull()
  })
})

describe('nextMacroColorKey', () => {
  it('cycles through every hue and back to none, never landing outside the palette', () => {
    let key: Parameters<typeof nextMacroColorKey>[0] = null
    const seen: (string | null)[] = [key]
    for (let step = 0; step < 8; step += 1) {
      key = nextMacroColorKey(key)
      seen.push(key)
    }
    // 7 hues plus the starting/ending null is 8 states before it repeats.
    expect(seen).toEqual([null, 'orange', 'sky', 'green', 'purple', 'blue', 'red', 'yellow', null])
  })
})
