import { describe, expect, it } from 'vitest'

import { decimateGcodeSegments, gcodeDecimationSettings } from '@/features/gcode/decimate'
import { parseGcode } from '@/features/gcode/parser'
import {
  GcodeMoveKind,
  defaultGcodeExtrusionWidth,
  gcodeSegment,
  gcodeSegmentStride,
} from '@/features/gcode/types'

/**
 * Decimation replaced a voxel-column far-zoom mode, so its whole promise is
 * that a reduced tier is still the same object: the same toolpath with fewer,
 * longer beads. These tests pin the guards that make that true — a merge that
 * crossed a travel, changed a bead's width, or ran ahead of the print frontier
 * would each be visible on screen.
 */

const settings = gcodeDecimationSettings.coarse

function at(segments: Float32Array, index: number, name: number): number {
  return segments[index * gcodeSegmentStride + name] ?? Number.NaN
}

function count(segments: Float32Array): number {
  return Math.floor(segments.length / gcodeSegmentStride)
}

describe('decimateGcodeSegments', () => {
  it('merges a straight run of equal beads into one segment end to end', () => {
    const geometry = parseGcode(`G90
M83
G1 X0 Y0 Z0.2 F1200
G1 X10 Y0 E1
G1 X20 Y0 E1
G1 X30 Y0 E1
G1 X40 Y0 E1
`)
    const reduced = decimateGcodeSegments(geometry.segments, settings)

    // The lead-in travel survives; the four collinear extrusions become one.
    expect(count(geometry.segments)).toBe(5)
    expect(count(reduced)).toBe(2)
    expect(at(reduced, 1, gcodeSegment.startX)).toBeCloseTo(0)
    expect(at(reduced, 1, gcodeSegment.endX)).toBeCloseTo(40)
    expect(at(reduced, 1, gcodeSegment.kind)).toBe(GcodeMoveKind.Extrusion)
  })

  it('refuses to merge across a corner sharper than the tolerance', () => {
    const geometry = parseGcode(`G90
M83
G1 X0 Y0 Z0.2 F1200
G1 X10 Y0 E1
G1 X10 Y10 E1
`)
    const reduced = decimateGcodeSegments(geometry.segments, settings)

    // A right angle is far outside any chord tolerance, so both moves survive.
    expect(count(reduced)).toBe(count(geometry.segments))
  })

  it('keeps every merged point within the chord tolerance', () => {
    /*
     * Equal-length chords around a large circle: consecutive moves are nearly
     * collinear, and equal length with equal extrusion means equal derived
     * width, so the width guard cannot mask what the tolerance is doing.
     */
    const radius = 400
    const chord = 4
    const step = 2 * Math.asin(chord / (2 * radius))
    const points = Array.from({ length: 30 }, (_, index) => {
      const angle = index * step
      return [radius * Math.sin(angle), radius - radius * Math.cos(angle)] as const
    })
    const moves = points
      .slice(1)
      .map(([x, y]) => `G1 X${x.toFixed(4)} Y${y.toFixed(4)} E0.05`)
      .join('\n')
    const geometry = parseGcode(`G90
M83
G1 X0 Y0 Z0.2 F1200
${moves}
`)
    const reduced = decimateGcodeSegments(geometry.segments, settings)

    expect(count(reduced)).toBeLessThan(count(geometry.segments))

    // Every original endpoint must sit within tolerance of some merged chord.
    const tolerance =
      (geometry.segments[gcodeSegment.extrusionWidth] || defaultGcodeExtrusionWidth) *
      settings.chordErrorWidthFraction
    for (let original = 0; original < count(geometry.segments); original += 1) {
      if (at(geometry.segments, original, gcodeSegment.kind) !== GcodeMoveKind.Extrusion) continue
      const pointX = at(geometry.segments, original, gcodeSegment.endX)
      const pointY = at(geometry.segments, original, gcodeSegment.endY)
      let best = Number.POSITIVE_INFINITY
      for (let merged = 0; merged < count(reduced); merged += 1) {
        const startX = at(reduced, merged, gcodeSegment.startX)
        const startY = at(reduced, merged, gcodeSegment.startY)
        const endX = at(reduced, merged, gcodeSegment.endX)
        const endY = at(reduced, merged, gcodeSegment.endY)
        const chordX = endX - startX
        const chordY = endY - startY
        const lengthSquared = chordX * chordX + chordY * chordY
        const projection =
          lengthSquared > 0
            ? Math.min(
                1,
                Math.max(
                  0,
                  ((pointX - startX) * chordX + (pointY - startY) * chordY) / lengthSquared,
                ),
              )
            : 0
        best = Math.min(
          best,
          Math.hypot(
            pointX - (startX + chordX * projection),
            pointY - (startY + chordY * projection),
          ),
        )
      }
      expect(best).toBeLessThanOrEqual(tolerance + 1e-6)
    }
  })

  /**
   * The failure that sent the first calibration back: a merged bead displaced
   * further than its own width crosses the bead beside it, and a surface of
   * crossed beads renders as speckle rather than as a solid object.
   */
  it('never displaces a bead by more than half its own width', () => {
    for (const settings of Object.values(gcodeDecimationSettings)) {
      expect(settings.chordErrorWidthFraction).toBeLessThan(0.5)
    }
  })

  it('never merges across a travel move', () => {
    const geometry = parseGcode(`G90
M83
G1 X0 Y0 Z0.2 F1200
G1 X10 Y0 E1
G1 X20 Y0
G1 X30 Y0 E1
`)
    const reduced = decimateGcodeSegments(geometry.segments, settings)

    // Travels pass through untouched and both walls stay separate beads.
    const travels = Array.from({ length: count(reduced) }, (_, index) =>
      at(reduced, index, gcodeSegment.kind),
    ).filter((kind) => kind === GcodeMoveKind.Travel)
    expect(travels).toHaveLength(2)
    expect(count(reduced)).toBe(4)
  })

  it('never merges across a layer change even when the moves line up', () => {
    const geometry = parseGcode(`G90
M83
;LAYER:0
G1 X0 Y0 Z0.2 F1200
G1 X10 Y0 E1
;LAYER:1
G1 X20 Y0 E1
`)
    const reduced = decimateGcodeSegments(geometry.segments, settings)
    const layers = new Set(
      Array.from({ length: count(reduced) }, (_, index) => at(reduced, index, gcodeSegment.layer)),
    )

    expect(count(reduced)).toBe(count(geometry.segments))
    expect(layers).toEqual(new Set([0, 1]))
  })

  it('never merges beads of different widths', () => {
    // Two collinear moves whose extruded volume differs, so the derived widths
    // differ: merging them would render one of the two at the wrong size.
    const geometry = parseGcode(`G90
M83
G1 X0 Y0 Z0.2 F1200
G1 X10 Y0 E1
G1 X20 Y0 E3
`)
    const widths = new Set([
      at(geometry.segments, 1, gcodeSegment.extrusionWidth),
      at(geometry.segments, 2, gcodeSegment.extrusionWidth),
    ])
    expect(widths.size).toBe(2)

    const reduced = decimateGcodeSegments(geometry.segments, settings)
    expect(count(reduced)).toBe(count(geometry.segments))
  })

  /**
   * The reveal frontier must never run ahead of the printer. A merged run
   * therefore inherits its *last* member's progress, so it appears only once
   * every move inside it has actually been printed.
   */
  it('takes the last member progress so a run is never revealed early', () => {
    const geometry = parseGcode(`G90
M83
G1 X0 Y0 Z0.2 F1200
G1 X10 Y0 E1
G1 X20 Y0 E1
G1 X30 Y0 E1
`)
    const reduced = decimateGcodeSegments(geometry.segments, settings)
    const lastOriginal = at(geometry.segments, count(geometry.segments) - 1, gcodeSegment.progress)

    expect(count(reduced)).toBe(2)
    expect(at(reduced, 1, gcodeSegment.progress)).toBeCloseTo(lastOriginal)
  })

  it('bounds a merged run so one instance cannot span the whole model', () => {
    const moves = Array.from({ length: 400 }, (_, index) => `G1 X${index + 1} Y0 E0.1`).join('\n')
    const geometry = parseGcode(`G90\nM83\nG1 X0 Y0 Z0.2 F1200\n${moves}\n`)
    const reduced = decimateGcodeSegments(geometry.segments, settings)

    // Capped runs, so the merged count cannot fall below the cap's quotient.
    expect(count(reduced)).toBeGreaterThanOrEqual(Math.ceil(400 / settings.maximumRunSegments))
  })

  it('reduces a real toolpath at coarse tolerance more than at decimated', () => {
    const rows = Array.from({ length: 40 }, (_, row) => {
      const y = row * 0.4
      const forward = Array.from(
        { length: 20 },
        (_, index) => `G1 X${index * 0.5 + 0.5} Y${y} E0.05`,
      ).join('\n')
      return `G1 X0 Y${y}\n${forward}`
    }).join('\n')
    const geometry = parseGcode(`G90\nM83\nG1 X0 Y0 Z0.2 F1200\n${rows}\n`)

    const decimated = decimateGcodeSegments(geometry.segments, gcodeDecimationSettings.decimated)
    const coarse = decimateGcodeSegments(geometry.segments, gcodeDecimationSettings.coarse)

    expect(count(decimated)).toBeLessThan(count(geometry.segments))
    expect(count(coarse)).toBeLessThanOrEqual(count(decimated))
  })

  it('leaves a stream of nothing but travels untouched', () => {
    const geometry = parseGcode(`G90
G1 X10 Y0 Z0.2
G1 X20 Y0
`)
    const reduced = decimateGcodeSegments(geometry.segments, settings)

    expect([...reduced]).toEqual([...geometry.segments])
  })
})
