import { describe, expect, it } from 'vitest'

import {
  bedExtents,
  nudgeCoordinate,
  planCoordinate,
  planPoint,
  type BedExtents,
} from '@/dashboard/bedPlan'

const square: BedExtents = {
  minimumX: 0,
  maximumX: 235,
  minimumY: 0,
  maximumY: 235,
  width: 235,
  depth: 235,
}

describe('bedExtents', () => {
  it('reads the volume the printer reported', () => {
    expect(bedExtents([0, 0, 0], [235, 235, 250])).toEqual(square)
  })

  /**
   * The same rule parking follows: coordinates come from the reported volume
   * or they do not exist. A plan drawn to a guessed bed size puts the nozzle
   * marker somewhere plausible and wrong, and a tap on it commands a move to a
   * coordinate that was never on this machine.
   */
  it('is null until every extent it needs has been reported', () => {
    expect(bedExtents([null, null, null], [null, null, null])).toBeNull()
    expect(bedExtents([0, 0, 0], [235, null, 250])).toBeNull()
    expect(bedExtents([null, 0, 0], [235, 235, 250])).toBeNull()
  })

  it('is null for a span that is not a bed', () => {
    expect(bedExtents([0, 0, 0], [0, 235, 250])).toBeNull()
    expect(bedExtents([100, 0, 0], [50, 235, 250])).toBeNull()
  })

  it('keeps a rectangular bed rectangular', () => {
    const extents = bedExtents([0, 0, 0], [350, 250, 340])
    expect(extents?.width).toBe(350)
    expect(extents?.depth).toBe(250)
  })

  it('carries a negative origin through rather than shifting it to zero', () => {
    const extents = bedExtents([-5, -10, 0], [235, 225, 250])
    expect(extents).toMatchObject({ minimumX: -5, minimumY: -10, width: 240, depth: 235 })
  })
})

describe('planPoint', () => {
  /**
   * The bed's Y grows toward the back of the printer and every screen
   * coordinate grows downward. Without the flip the marker mirrors
   * front-to-back — the one error a picture of the bed must not make, because
   * it reads as correct right up until someone uses it to reach into the
   * machine.
   */
  it('puts the back of the bed at the top of the plot', () => {
    expect(planPoint({ x: 0, y: 235 }, square)).toEqual({ x: 0, y: 0 })
    expect(planPoint({ x: 0, y: 0 }, square)).toEqual({ x: 0, y: 1 })
  })

  it('puts the centre in the centre', () => {
    expect(planPoint({ x: 117.5, y: 117.5 }, square)).toEqual({ x: 0.5, y: 0.5 })
  })

  /**
   * A toolhead really can sit outside the reported volume, and pinning the
   * marker to the edge would report it as being somewhere it is not. The plot
   * hides its overflow, so off the bed reads as off the bed.
   */
  it('does not pretend a position outside the volume is on its edge', () => {
    expect(planPoint({ x: -23.5, y: 117.5 }, square).x).toBeCloseTo(-0.1)
    expect(planPoint({ x: 258.5, y: 117.5 }, square).x).toBeCloseTo(1.1)
  })
})

describe('planCoordinate', () => {
  it('reads a tap back as the coordinate it points at', () => {
    expect(planCoordinate({ x: 0.5, y: 0.5 }, square)).toEqual({ x: 117.5, y: 117.5 })
    expect(planCoordinate({ x: 0, y: 0 }, square)).toEqual({ x: 0, y: 235 })
  })

  /**
   * Clamped in this direction and not in the other, because this value becomes
   * a move the printer is asked to make: a tap a pixel outside the plot would
   * otherwise ask for a coordinate past the travel limits, which Klipper
   * refuses with a command error.
   */
  it('clamps a tap past the edge to the edge', () => {
    expect(planCoordinate({ x: -0.2, y: 1.4 }, square)).toEqual({ x: 0, y: 0 })
    expect(planCoordinate({ x: 1.3, y: -0.5 }, square)).toEqual({ x: 235, y: 235 })
  })

  it('round-trips a coordinate through the plot unchanged', () => {
    const extents = bedExtents([-5, -10, 0], [235, 225, 250])
    if (!extents) throw new Error('extents')
    for (const coordinate of [
      { x: 0, y: 0 },
      { x: 117.5, y: 92 },
      { x: -5, y: 225 },
    ]) {
      const back = planCoordinate(planPoint(coordinate, extents), extents)
      expect(back.x).toBeCloseTo(coordinate.x)
      expect(back.y).toBeCloseTo(coordinate.y)
    }
  })
})

describe('nudgeCoordinate', () => {
  it('steps in millimetres, so one press is the same distance at any card width', () => {
    expect(nudgeCoordinate({ x: 100, y: 100 }, 10, -10, square)).toEqual({ x: 110, y: 90 })
  })

  it('stops at the travel limits rather than stepping past them', () => {
    expect(nudgeCoordinate({ x: 230, y: 5 }, 10, -10, square)).toEqual({ x: 235, y: 0 })
    expect(nudgeCoordinate({ x: 2, y: 232 }, -10, 10, square)).toEqual({ x: 0, y: 235 })
  })
})
