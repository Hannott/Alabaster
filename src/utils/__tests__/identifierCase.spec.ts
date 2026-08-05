import { describe, expect, it } from 'vitest'

import { titleCaseIdentifier } from '@/utils/identifierCase'

describe('titleCaseIdentifier', () => {
  it('title-cases a shouting macro-style identifier', () => {
    expect(titleCaseIdentifier('RESONANCE_TEST_X')).toBe('Resonance Test X')
  })

  it('title-cases a lower snake_case config key', () => {
    expect(titleCaseIdentifier('nonlinear_offset')).toBe('Nonlinear Offset')
  })

  it('leaves a single-letter word capitalized rather than erroring', () => {
    expect(titleCaseIdentifier('AXIS_X')).toBe('Axis X')
  })

  it('is idempotent on an identifier with no underscores', () => {
    expect(titleCaseIdentifier('PAUSE')).toBe('Pause')
  })
})
