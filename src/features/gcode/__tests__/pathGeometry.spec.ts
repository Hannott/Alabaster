import { describe, expect, it } from 'vitest'

import { parseGcode } from '@/features/gcode/parser'
import {
  GcodePathFlags,
  gcodeCap,
  gcodeCapStride,
  gcodePathDetail,
  gcodePathDetailStride,
} from '@/features/gcode/types'

function detailValue(details: Float32Array, index: number, field: number): number {
  return details[index * gcodePathDetailStride + field] ?? Number.NaN
}

function extrusionFor(width: number, length: number, height: number): number {
  return (width * length * height) / (Math.PI * (1.75 / 2) ** 2)
}

describe('continuous G-code path geometry', () => {
  it('cuts connected endpoints on their shared turn bisector', () => {
    const geometry = parseGcode(`G90
M82
G1 X10 Y0 Z0.2 E1
G1 X10 Y10 E2
`)

    expect(geometry.capCount).toBe(2)
    expect(detailValue(geometry.pathDetails, 0, gcodePathDetail.flags)).toBe(
      GcodePathFlags.StartCap,
    )
    expect(detailValue(geometry.pathDetails, 1, gcodePathDetail.flags)).toBe(GcodePathFlags.EndCap)
    expect(detailValue(geometry.pathDetails, 0, gcodePathDetail.startOffsetX)).toBeCloseTo(0)
    expect(detailValue(geometry.pathDetails, 0, gcodePathDetail.startOffsetY)).toBeCloseTo(1)
    expect(detailValue(geometry.pathDetails, 0, gcodePathDetail.endOffsetX)).toBeCloseTo(-1)
    expect(detailValue(geometry.pathDetails, 0, gcodePathDetail.endOffsetY)).toBeCloseTo(1)
    expect(detailValue(geometry.pathDetails, 1, gcodePathDetail.startOffsetX)).toBeCloseTo(-1)
    expect(detailValue(geometry.pathDetails, 1, gcodePathDetail.startOffsetY)).toBeCloseTo(1)
    expect(detailValue(geometry.pathDetails, 1, gcodePathDetail.endOffsetX)).toBeCloseTo(-1)
    expect(detailValue(geometry.pathDetails, 1, gcodePathDetail.endOffsetY)).toBeCloseTo(0)
  })

  it('keeps the perpendicular width constant and rejects unbounded sharp miters', () => {
    const rightAngle = parseGcode(`G90
M83
G1 X10 Y0 Z0.2 E1
G1 X10 Y10 E1
`)
    const rightAngleOffsetX = detailValue(rightAngle.pathDetails, 0, gcodePathDetail.endOffsetX)
    const rightAngleOffsetY = detailValue(rightAngle.pathDetails, 0, gcodePathDetail.endOffsetY)
    // The 45-degree cut is longer than the bead is wide, but its projection
    // onto this move's normal remains exactly one full half-width.
    expect(Math.hypot(rightAngleOffsetX, rightAngleOffsetY)).toBeCloseTo(Math.SQRT2)
    expect(rightAngleOffsetY).toBeCloseTo(1)

    const sharpTurn = parseGcode(`G90
M83
G1 X10 Y0 Z0.2 E1
G1 X9 Y1 E1
`)
    const sharpOffsetX = detailValue(sharpTurn.pathDetails, 0, gcodePathDetail.endOffsetX)
    const sharpOffsetY = detailValue(sharpTurn.pathDetails, 0, gcodePathDetail.endOffsetY)
    const sharpLength = Math.hypot(sharpOffsetX, sharpOffsetY)
    expect(sharpLength).toBeCloseTo(1)
    expect(sharpOffsetX).toBeCloseTo(0)
    expect(sharpOffsetY).toBeCloseTo(1)
  })

  it('uses one measured width from the start of each move to its end', () => {
    const narrow = extrusionFor(0.4, 10, 0.2)
    const wide = extrusionFor(0.8, 10, 0.2)
    const geometry = parseGcode(`G90
M83
G1 X10 Z0.2 E${narrow}
G1 X20 E${wide}
G1 X30 E${narrow}
G1 X40 E${wide}
`)

    const expectedWidths = [0.4, 0.8, 0.4, 0.8]
    for (let index = 0; index < expectedWidths.length; index += 1) {
      const startWidth = detailValue(geometry.pathDetails, index, gcodePathDetail.startWidth)
      const endWidth = detailValue(geometry.pathDetails, index, gcodePathDetail.endWidth)
      expect(startWidth).toBeCloseTo(expectedWidths[index] ?? 0, 2)
      expect(endWidth).toBeCloseTo(startWidth, 6)
    }
  })

  it('leaves the width unset when the move carries no usable extrusion volume', () => {
    const geometry = parseGcode(`G90
M83
G0 X10 Z0.2
G1 X20 E0.0000001
`)

    expect(detailValue(geometry.pathDetails, 1, gcodePathDetail.startWidth)).toBe(0)
    expect(detailValue(geometry.pathDetails, 1, gcodePathDetail.endWidth)).toBe(0)
  })

  it('creates rounded endpoints only where travel breaks the extrusion run', () => {
    const geometry = parseGcode(`G90
M83
G1 X10 Z0.2 E1
G0 X20
G1 X30 E1
`)

    expect(geometry.capCount).toBe(4)
    expect(geometry.caps.length).toBe(4 * gcodeCapStride)
    expect(geometry.caps[gcodeCap.x]).toBeCloseTo(0)
    expect(geometry.caps[gcodeCap.directionX]).toBeCloseTo(-1)
    expect(geometry.caps[3 * gcodeCapStride + gcodeCap.x]).toBeCloseTo(30)
    expect(geometry.caps[3 * gcodeCapStride + gcodeCap.directionX]).toBeCloseTo(1)
  })

  it('closes perimeter runs without overlapping endpoint caps', () => {
    const geometry = parseGcode(`G90
M83
G0 Z0.2
G1 X10 Y0 E1
G1 X10 Y10 E1
G1 X0 Y10 E1
G1 X0 Y0 E1
`)

    expect(geometry.capCount).toBe(0)
    expect(detailValue(geometry.pathDetails, 1, gcodePathDetail.flags)).toBe(0)
    expect(detailValue(geometry.pathDetails, 4, gcodePathDetail.flags)).toBe(0)
    expect(detailValue(geometry.pathDetails, 1, gcodePathDetail.startOffsetX)).toBeCloseTo(1)
    expect(detailValue(geometry.pathDetails, 1, gcodePathDetail.startOffsetY)).toBeCloseTo(1)
    expect(detailValue(geometry.pathDetails, 4, gcodePathDetail.endOffsetX)).toBeCloseTo(1)
    expect(detailValue(geometry.pathDetails, 4, gcodePathDetail.endOffsetY)).toBeCloseTo(1)
  })
})
