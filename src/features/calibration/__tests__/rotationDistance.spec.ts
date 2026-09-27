import { describe, expect, it } from 'vitest'

import { rotationDistanceFrom } from '@/features/calibration/rotationDistance'

describe('rotationDistanceFrom', () => {
  /*
   * Klipper's worked example: rotation_distance 32.0, 50 mm requested, marked
   * at 70 mm and 22.5 mm left, so 47.5 mm actually moved — 32 × 47.5 / 50.
   */
  it('scales the current value by how far the filament actually moved', () => {
    expect(rotationDistanceFrom(32, 50, 70, 22.5)).toBeCloseTo(30.4, 6)
  })

  it('leaves an exact extruder unchanged', () => {
    expect(rotationDistanceFrom(22.6, 100, 120, 20)).toBeCloseTo(22.6, 6)
  })

  it('refuses a measurement that cannot be right', () => {
    expect(rotationDistanceFrom(32, 50, 70, 70)).toBeNull()
    expect(rotationDistanceFrom(32, 50, 70, -1)).toBeNull()
    expect(rotationDistanceFrom(0, 50, 70, 20)).toBeNull()
    expect(rotationDistanceFrom(32, 50, 70, Number.NaN)).toBeNull()
  })
})
