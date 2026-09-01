import { describe, expect, it } from 'vitest'

import { zExtents, zFraction, zValue, type ZExtents } from '@/dashboard/zAxisPlan'

const travel: ZExtents = { minimum: 0, maximum: 250, span: 250 }

describe('zExtents', () => {
  it('reads the travel the printer reported', () => {
    expect(zExtents(0, 250)).toEqual(travel)
  })

  it('is null until both ends have been reported', () => {
    expect(zExtents(null, null)).toBeNull()
    expect(zExtents(0, null)).toBeNull()
    expect(zExtents(null, 250)).toBeNull()
  })

  it('is null for a span that is not a travel range', () => {
    expect(zExtents(0, 0)).toBeNull()
    expect(zExtents(250, 0)).toBeNull()
  })

  it('carries a negative origin through rather than shifting it to zero', () => {
    expect(zExtents(-5, 245)).toEqual({ minimum: -5, maximum: 245, span: 250 })
  })
})

describe('zFraction', () => {
  /**
   * The top of the track is the axis's own maximum, mirroring the gantry: Z
   * grows as the nozzle rises away from the bed, and so does the marker.
   */
  it('puts the maximum at the top of the track', () => {
    expect(zFraction(250, travel)).toBe(0)
    expect(zFraction(0, travel)).toBe(1)
  })

  it('puts the center in the center', () => {
    expect(zFraction(125, travel)).toBe(0.5)
  })

  /**
   * The toolhead can genuinely sit outside the reported travel, and pinning
   * the marker to the end of the track would report it as being somewhere it
   * is not.
   */
  it('does not pretend a height outside the travel is at the end of it', () => {
    expect(zFraction(-25, travel)).toBeCloseTo(1.1)
    expect(zFraction(275, travel)).toBeCloseTo(-0.1)
  })

  /**
   * A probe offset can carry the reported minimum a little below the bed
   * itself, so the bed line is drawn at Z 0 rather than at the travel's own
   * minimum — which is what this reads back for a travel starting below zero.
   */
  it('places Z 0 just above the bottom of a travel with a negative minimum', () => {
    const extents = zExtents(-2, 248)
    if (!extents) throw new Error('extents')
    expect(zFraction(0, extents)).toBeCloseTo(0.992, 3)
  })
})

describe('zValue', () => {
  it('reads a hover or a drag back as the height it points at', () => {
    expect(zValue(0, travel)).toBe(250)
    expect(zValue(1, travel)).toBe(0)
    expect(zValue(0.5, travel)).toBe(125)
  })

  /**
   * Clamped in this direction and not in the other, because a hover past the
   * end of the track must not be read as a height past the travel limits.
   */
  it('clamps a fraction past the end to the end', () => {
    expect(zValue(-0.2, travel)).toBe(250)
    expect(zValue(1.3, travel)).toBe(0)
  })

  it('round-trips a height through the track unchanged', () => {
    const extents = zExtents(-5, 245)
    if (!extents) throw new Error('extents')
    for (const value of [-5, 0, 92, 245]) {
      expect(zValue(zFraction(value, extents), extents)).toBeCloseTo(value)
    }
  })
})
