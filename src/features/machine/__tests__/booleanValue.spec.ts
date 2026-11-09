import { describe, expect, it } from 'vitest'

import { booleanChoices, booleanOptionIn, flippedBoolean } from '@/features/machine/booleanValue'

describe('booleanOptionIn', () => {
  it('finds the value of a plain boolean option, with its columns', () => {
    expect(booleanOptionIn('auto_enable: True')).toEqual({
      option: 'auto_enable',
      value: 'True',
      start: 13,
      end: 17,
    })
    expect(booleanOptionIn('graph = false  # draw it')?.value).toBe('false')
  })

  it('leaves out template bodies, other values, and words a boolean is only part of', () => {
    expect(booleanOptionIn('  {% if true %}')).toBeNull()
    expect(booleanOptionIn('  enabled: True')).toBeNull()
    expect(booleanOptionIn('pin: PA8')).toBeNull()
    expect(booleanOptionIn('flag: True#x')).toBeNull()
    expect(booleanOptionIn('flag: Truest')).toBeNull()
    expect(booleanOptionIn('#flag: True')).toBeNull()
  })
})

describe('flipping a boolean', () => {
  it('keeps the file’s own spelling', () => {
    expect(booleanChoices('False')).toEqual(['True', 'False'])
    expect(booleanChoices('true')).toEqual(['true', 'false'])
    expect(flippedBoolean('True')).toBe('False')
    expect(flippedBoolean('false')).toBe('true')
  })
})
