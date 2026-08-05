import { describe, expect, it } from 'vitest'

import {
  extrudedBeadLength,
  isExtruderMoving,
  volumetricFlow,
} from '@/components/dashboard/modules/extruderFlow'

describe('extruderFlow', () => {
  it('converts filament speed to volumetric flow through the filament cross-section', () => {
    // 1.75 mm filament is 2.4053 mm² in section, so 5 mm/s is ~12.03 mm³/s —
    // the units a hotend is rated in.
    expect(volumetricFlow(5, 1.75)).toBeCloseTo(12.026, 3)
    expect(volumetricFlow(5, 2.85)).toBeCloseTo(31.897, 3)
  })

  /*
   * The reason this returns null rather than assuming 1.75. Flow goes with the
   * square of the diameter, so the two cases above differ by 2.65x: assuming
   * 1.75 on a 2.85 mm machine shows a number the real flow is 165% above, in
   * exactly the units someone compares to their hotend's limit.
   */
  it('has no answer without a filament diameter, rather than assuming one', () => {
    expect(volumetricFlow(5, null)).toBeNull()
    expect(volumetricFlow(5, undefined)).toBeNull()
    expect(volumetricFlow(5, 0)).toBeNull()
    expect(volumetricFlow(5, -1.75)).toBeNull()
    expect(volumetricFlow(5, Number.NaN)).toBeNull()
  })

  it('has no answer for a velocity the machine did not report', () => {
    expect(volumetricFlow(Number.NaN, 1.75)).toBeNull()
    expect(volumetricFlow(Number.POSITIVE_INFINITY, 1.75)).toBeNull()
  })

  /* A retract is not an extrude, and the sign is what says so. */
  it('keeps the sign, so a retract reads as a retract', () => {
    expect(volumetricFlow(-5, 1.75)).toBeCloseTo(-12.026, 3)
    expect(volumetricFlow(0, 1.75)).toBe(0)
  })

  /*
   * `motion_report` reports small nonzero values as a move settles. Without a
   * deadband the reading flickers between moving and idle on the tail of every
   * move, and the eye follows the change rather than the number.
   */
  it('treats the tail of a settling move as stopped', () => {
    expect(isExtruderMoving(0)).toBe(false)
    expect(isExtruderMoving(0.01)).toBe(false)
    expect(isExtruderMoving(-0.01)).toBe(false)
    expect(isExtruderMoving(0.05)).toBe(true)
    expect(isExtruderMoving(-2.4)).toBe(true)
    expect(isExtruderMoving(Number.NaN)).toBe(false)
  })

  describe('extrudedBeadLength', () => {
    /*
     * Volume is conserved between the filament fed in and the bead pushed
     * out, so the length ratio is the inverse square of the diameter ratio:
     * 25 mm of 1.75 mm filament through a 0.4 mm nozzle is a much longer,
     * thinner 478.5 mm bead.
     */
    it('converts a fed length to the bead length the nozzle actually lays down', () => {
      expect(extrudedBeadLength(25, 1.75, 0.4)).toBeCloseTo(478.515625, 5)
      // A nozzle the same size as the filament changes nothing.
      expect(extrudedBeadLength(25, 1.75, 1.75)).toBeCloseTo(25, 5)
    })

    /*
     * Assuming 1.75 mm filament through an unmeasured nozzle would be a
     * fabricated figure dressed as a measurement — the same refusal
     * `volumetricFlow` already takes for its own diameter argument.
     */
    it('has no answer without both diameters, rather than assuming one', () => {
      expect(extrudedBeadLength(25, null, 0.4)).toBeNull()
      expect(extrudedBeadLength(25, 1.75, null)).toBeNull()
      expect(extrudedBeadLength(25, undefined, undefined)).toBeNull()
      expect(extrudedBeadLength(25, 0, 0.4)).toBeNull()
      expect(extrudedBeadLength(25, 1.75, 0)).toBeNull()
      expect(extrudedBeadLength(25, -1.75, 0.4)).toBeNull()
    })

    it('has no answer for a length that is not a positive number', () => {
      expect(extrudedBeadLength(0, 1.75, 0.4)).toBeNull()
      expect(extrudedBeadLength(-25, 1.75, 0.4)).toBeNull()
      expect(extrudedBeadLength(Number.NaN, 1.75, 0.4)).toBeNull()
    })
  })
})
