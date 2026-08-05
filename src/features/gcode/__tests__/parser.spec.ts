import { describe, expect, it } from 'vitest'

import { GcodeParser, parseGcode } from '@/features/gcode/parser'
import {
  GcodeMoveKind,
  defaultGcodeFilamentDiameter,
  gcodeSegment,
  gcodeSegmentStride,
  gcodeSourceByte,
  gcodeSourceByteStride,
} from '@/features/gcode/types'

function segmentValue(segments: Float32Array, index: number, field: number): number {
  return segments[index * gcodeSegmentStride + field] ?? Number.NaN
}

function sourceByteValue(sourceBytes: Uint32Array, index: number, field: number): number {
  return sourceBytes[index * gcodeSourceByteStride + field] ?? Number.NaN
}

function extrusionFor(width: number, length: number, height: number): number {
  const crossSection = Math.PI * (defaultGcodeFilamentDiameter / 2) ** 2
  return (width * length * height) / crossSection
}

describe('GcodeParser', () => {
  it('parses absolute and relative extrusion moves into stable typed geometry', () => {
    const geometry = parseGcode(`G90
M82
G1 X10 Y20 Z0.2 F1200
G1 X20 E1
M83
G91
G1 Y5 E0.5
`)

    expect(geometry.segmentCount).toBe(3)
    expect(geometry.extrusionCount).toBe(2)
    expect(segmentValue(geometry.segments, 1, gcodeSegment.kind)).toBe(GcodeMoveKind.Extrusion)
    expect(segmentValue(geometry.segments, 2, gcodeSegment.endX)).toBe(20)
    expect(segmentValue(geometry.segments, 2, gcodeSegment.endY)).toBe(25)
    expect(segmentValue(geometry.segments, 1, gcodeSegment.extrusionHeight)).toBeCloseTo(0.2)
    expect(geometry.bounds).toMatchObject({ minX: 0, maxX: 20, minY: 0, maxY: 25 })
    expect(geometry.extrusionBounds).toMatchObject({ minX: 10, maxX: 20, minY: 20, maxY: 25 })
  })

  it('derives extrusion width from the filament consumed over each move', () => {
    const wideFirstLayer = extrusionFor(0.6, 10, 0.2)
    const narrowSecondLayer = extrusionFor(0.42, 10, 0.2)
    const geometry = parseGcode(`G90
M83
G1 X10 Z0.2 E${wideFirstLayer}
G1 X20 Z0.4 E${narrowSecondLayer}
`)

    expect(segmentValue(geometry.segments, 0, gcodeSegment.extrusionWidth)).toBeCloseTo(0.6, 2)
    expect(segmentValue(geometry.segments, 1, gcodeSegment.extrusionWidth)).toBeCloseTo(0.42, 2)
  })

  it('reports no derived width for travels and implausible extrusion volumes', () => {
    const geometry = parseGcode(`G90
M83
G1 X10 Z0.2
G1 X20 Z0.2 E0.000001
`)

    expect(segmentValue(geometry.segments, 0, gcodeSegment.kind)).toBe(GcodeMoveKind.Travel)
    expect(segmentValue(geometry.segments, 0, gcodeSegment.extrusionWidth)).toBe(0)
    expect(segmentValue(geometry.segments, 1, gcodeSegment.extrusionWidth)).toBe(0)
  })

  it('uses explicit layer comments without treating z-hop travel as a new layer', () => {
    const geometry = parseGcode(`;LAYER:0
G1 X1 Z0.2 E1
G1 Z0.6
G1 Z0.2
;LAYER:1
G1 X2 Z0.4 E2
`)

    expect(geometry.layerHeights).toEqual(new Float32Array([0.2, 0.4]))
    expect(segmentValue(geometry.segments, 3, gcodeSegment.layer)).toBe(1)
    expect(segmentValue(geometry.segments, 3, gcodeSegment.extrusionHeight)).toBeCloseTo(0.2)
  })

  it('does not create an empty layer before a slicer layer-change marker', () => {
    const geometry = parseGcode(`;LAYER_COUNT:2
;LAYER_CHANGE
G1 X1 Z0.2 E1
;LAYER_CHANGE
G1 X2 Z0.4 E2
`)

    expect(geometry.layerHeights).toEqual(new Float32Array([0.2, 0.4]))
  })

  it('approximates IJ arcs without collapsing them into a choppy chord', () => {
    const geometry = parseGcode(`G90
M82
G1 X10 Y0
G3 X0 Y10 I-10 J0 E1 F900
`)

    expect(geometry.extrusionCount).toBeGreaterThan(10)
    expect(
      segmentValue(geometry.segments, geometry.segmentCount - 1, gcodeSegment.endX),
    ).toBeCloseTo(0)
    expect(
      segmentValue(geometry.segments, geometry.segmentCount - 1, gcodeSegment.endY),
    ).toBeCloseTo(10)
  })

  it('adapts arc sampling to keep large-radius curves smooth', () => {
    const geometry = parseGcode(`G90
M82
G1 X100 Y0
G3 X0 Y100 I-100 J0 E1 F900
`)

    expect(geometry.extrusionCount).toBeGreaterThan(30)
    const firstProgress = segmentValue(geometry.segments, 1, gcodeSegment.progress)
    const middleProgress = segmentValue(
      geometry.segments,
      Math.floor(geometry.segmentCount / 2),
      gcodeSegment.progress,
    )
    const finalProgress = segmentValue(
      geometry.segments,
      geometry.segmentCount - 1,
      gcodeSegment.progress,
    )
    expect(firstProgress).toBeLessThan(middleProgress)
    expect(middleProgress).toBeLessThan(finalProgress)
  })

  it('retains exact command byte ranges across UTF-8 and CRLF chunk boundaries', () => {
    const encoder = new TextEncoder()
    const comment = '; blå printer\r\n'
    const linear = 'G1 X10 F1200\r\n'
    const arc = 'G3 X0 Y10 I-10 J0 E1\r\n'
    const bytes = encoder.encode(comment + linear + arc)
    const parser = new GcodeParser()
    for (let offset = 0; offset < bytes.length; offset += 3) {
      parser.pushBytes(bytes.subarray(offset, Math.min(bytes.length, offset + 3)))
    }

    const geometry = parser.finish()
    const linearStart = encoder.encode(comment).length
    const linearEnd = linearStart + encoder.encode(linear).length
    const arcEnd = linearEnd + encoder.encode(arc).length

    expect(geometry.sourceByteCount).toBe(bytes.length)
    expect(sourceByteValue(geometry.sourceBytes, 0, gcodeSourceByte.commandStart)).toBe(linearStart)
    expect(sourceByteValue(geometry.sourceBytes, 0, gcodeSourceByte.commandEnd)).toBe(linearEnd)
    expect(geometry.segmentCount).toBeGreaterThan(2)
    for (let index = 1; index < geometry.segmentCount; index += 1) {
      expect(sourceByteValue(geometry.sourceBytes, index, gcodeSourceByte.commandStart)).toBe(
        linearEnd,
      )
      expect(sourceByteValue(geometry.sourceBytes, index, gcodeSourceByte.commandEnd)).toBe(arcEnd)
    }
    expect(segmentValue(geometry.segments, geometry.segmentCount - 1, gcodeSegment.progress)).toBe(
      1,
    )
  })

  it('returns finite fallback bounds for empty or command-only files', () => {
    const geometry = parseGcode('G90\nM82\n')

    expect(geometry.segmentCount).toBe(0)
    expect(Object.values(geometry.bounds).every(Number.isFinite)).toBe(true)
    expect(geometry.layerHeights).toEqual(new Float32Array([0]))
  })
})
