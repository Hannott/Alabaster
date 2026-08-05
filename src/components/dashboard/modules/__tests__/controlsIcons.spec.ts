import { describe, expect, it } from 'vitest'

import {
  defaultOutputIcon,
  noneOutputIconOverride,
  outputIcon,
  outputIconTokens,
} from '@/components/dashboard/modules/controlsIcons'

describe('output icons', () => {
  it('defaults a fan to looking like a fan, and a pin to no icon at all', () => {
    expect(defaultOutputIcon('fan')).toBe('fan')
    expect(defaultOutputIcon('pin')).toBeNull()
  })

  it('reads the same default for an object with no override', () => {
    expect(outputIcon('hotend_fan', 'fan')).toBe('fan')
    expect(outputIcon('interior_light', 'pin')).toBeNull()
    expect(outputIcon('interior_light', 'pin', {})).toBeNull()
  })

  it('lets a card override the default, and ignores an override it cannot honour', () => {
    expect(outputIcon('interior_light', 'pin', { interior_light: 'bulb' })).toBe('bulb')
    expect(outputIcon('probe_enable', 'pin', { probe_enable: 'probe' })).toBe('probe')

    // A hand-edited profile naming an icon outside this module's own
    // catalogue falls back to the row's own default rather than producing an
    // unrenderable name.
    expect(outputIcon('interior_light', 'pin', { interior_light: 'trash' })).toBeNull()
    expect(outputIcon('interior_light', 'pin', { interior_light: 'not-a-real-icon' })).toBeNull()
  })

  it('only offers icons that actually represent a physical output', () => {
    expect(outputIconTokens).toEqual(['fan', 'bulb', 'probe', 'temperature', 'bolt'])
  })

  it('lets any row, fan included, opt explicitly into no icon', () => {
    const none = noneOutputIconOverride()
    expect(outputIcon('hotend_fan', 'fan', { hotend_fan: none })).toBeNull()
    expect(outputIcon('interior_light', 'pin', { interior_light: none })).toBeNull()
  })
})
