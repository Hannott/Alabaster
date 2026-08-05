import { describe, expect, it } from 'vitest'

import {
  offsetMagnitude,
  offsetStepSets,
  offsetValue,
  signedOffsetStep,
} from '@/components/dashboard/modules/movementSteps'

describe('offsetMagnitude', () => {
  /**
   * The buttons are sized against these exact strings — eight across a 299px
   * card — so any change to how they are written changes whether the row fits.
   */
  it('writes every offered step as whole micrometres', () => {
    expect(offsetStepSets.fine.map((step) => offsetMagnitude(step, 'micrometre'))).toEqual([
      '5',
      '10',
      '25',
      '50',
    ])
    expect(offsetStepSets.coarse.map((step) => offsetMagnitude(step, 'micrometre'))).toEqual([
      '10',
      '25',
      '50',
      '100',
    ])
  })

  it('writes millimetres with a dot and no leading zero', () => {
    expect(offsetStepSets.fine.map((step) => offsetMagnitude(step, 'millimetre'))).toEqual([
      '.005',
      '.01',
      '.025',
      '.05',
    ])
    expect(offsetStepSets.coarse.map((step) => offsetMagnitude(step, 'millimetre'))).toEqual([
      '.01',
      '.025',
      '.05',
      '.1',
    ])
  })

  /**
   * Trailing zeros go only after the decimal point. Stripping them from the
   * whole string turns 10 into 1 — a ten-fold error in the one place a
   * ten-fold error drives the nozzle into the bed.
   */
  it('never strips a zero that is part of the integer', () => {
    expect(offsetMagnitude(10, 'millimetre')).toBe('10')
    expect(offsetMagnitude(1.1, 'millimetre')).toBe('1.1')
    expect(offsetMagnitude(0.1, 'millimetre')).toBe('.1')
  })

  it('writes an offset of nothing as a bare zero in either unit', () => {
    expect(offsetMagnitude(0, 'micrometre')).toBe('0')
    expect(offsetMagnitude(0, 'millimetre')).toBe('0')
  })
})

describe('signedOffsetStep', () => {
  it('says which way each step moves the nozzle', () => {
    expect(signedOffsetStep(-0.005, 'micrometre')).toBe('−5')
    expect(signedOffsetStep(0.005, 'micrometre')).toBe('+5')
    expect(signedOffsetStep(-0.005, 'millimetre')).toBe('−.005')
    expect(signedOffsetStep(0.05, 'millimetre')).toBe('+.05')
  })
})

describe('offsetValue', () => {
  it('carries the sign of a live offset', () => {
    expect(offsetValue(-0.125, 'micrometre')).toBe('−125')
    expect(offsetValue(-0.125, 'millimetre')).toBe('−.125')
    expect(offsetValue(0.125, 'micrometre')).toBe('125')
  })

  /**
   * An offset rounding to nothing is not a negative offset. `−0` reads as a
   * direction that was never applied.
   */
  it('shows an unsigned zero for an offset that rounds away', () => {
    expect(offsetValue(0, 'micrometre')).toBe('0')
    expect(offsetValue(-0.0001, 'micrometre')).toBe('0')
    expect(offsetValue(-0.0001, 'millimetre')).toBe('0')
  })
})
