import { describe, expect, it } from 'vitest'

import { gcodeFeatureFromComment } from '@/features/gcode/features'
import { parseGcode } from '@/features/gcode/parser'
import {
  GcodeFeature,
  defaultGcodeBeadOverlap,
  gcodeSegment,
  gcodeSegmentStride,
} from '@/features/gcode/types'

/**
 * Feature colouring is only worth having if it is right across the slicers
 * people actually use. The reference Klipper viewer defaults to this mode and
 * renders an entire OrcaSlicer print in one flat colour because its table has
 * no entry for that vocabulary — so these tests cover each supported slicer's
 * own words, and pin that anything unrecognized stays visibly unclassified.
 */

function widthAt(segments: Float32Array, index: number): number {
  return segments[index * gcodeSegmentStride + gcodeSegment.extrusionWidth] ?? Number.NaN
}

function featureAt(segments: Float32Array, index: number): number {
  return segments[index * gcodeSegmentStride + gcodeSegment.feature] ?? Number.NaN
}

describe('gcodeFeatureFromComment', () => {
  it('reads PrusaSlicer and SuperSlicer types', () => {
    expect(gcodeFeatureFromComment(';TYPE:External perimeter')).toBe(GcodeFeature.PerimeterOuter)
    expect(gcodeFeatureFromComment(';TYPE:Perimeter')).toBe(GcodeFeature.PerimeterInner)
    expect(gcodeFeatureFromComment(';TYPE:Internal infill')).toBe(GcodeFeature.Infill)
    expect(gcodeFeatureFromComment(';TYPE:Solid infill')).toBe(GcodeFeature.InfillSolid)
    expect(gcodeFeatureFromComment(';TYPE:Bridge infill')).toBe(GcodeFeature.Bridge)
    expect(gcodeFeatureFromComment(';TYPE:Support material')).toBe(GcodeFeature.Support)
    expect(gcodeFeatureFromComment(';TYPE:Skirt/Brim')).toBe(GcodeFeature.Skirt)
  })

  it('reads OrcaSlicer and Bambu Studio types', () => {
    expect(gcodeFeatureFromComment(';TYPE:Outer wall')).toBe(GcodeFeature.PerimeterOuter)
    expect(gcodeFeatureFromComment(';TYPE:Inner wall')).toBe(GcodeFeature.PerimeterInner)
    expect(gcodeFeatureFromComment(';TYPE:Sparse infill')).toBe(GcodeFeature.Infill)
    expect(gcodeFeatureFromComment(';TYPE:Internal solid infill')).toBe(GcodeFeature.InfillSolid)
    expect(gcodeFeatureFromComment(';TYPE:Overhang wall')).toBe(GcodeFeature.Bridge)
    expect(gcodeFeatureFromComment(';TYPE:Support interface')).toBe(GcodeFeature.Support)
  })

  it('reads Cura and ideaMaker types', () => {
    expect(gcodeFeatureFromComment(';TYPE:WALL-OUTER')).toBe(GcodeFeature.PerimeterOuter)
    expect(gcodeFeatureFromComment(';TYPE:WALL-INNER')).toBe(GcodeFeature.PerimeterInner)
    expect(gcodeFeatureFromComment(';TYPE:FILL')).toBe(GcodeFeature.Infill)
    expect(gcodeFeatureFromComment(';TYPE:SKIN')).toBe(GcodeFeature.InfillSolid)
    expect(gcodeFeatureFromComment(';TYPE:Solid-Fill')).toBe(GcodeFeature.InfillSolid)
    expect(gcodeFeatureFromComment(';TYPE:Raft')).toBe(GcodeFeature.Skirt)
  })

  /**
   * "Solid infill" and "Internal infill" differ by one word and belong in
   * different categories, so matching is on the whole label. A substring match
   * on "infill" would quietly merge the two and the mode would stop meaning
   * anything on the distinction people most want from it.
   */
  it('matches whole labels, not substrings', () => {
    expect(gcodeFeatureFromComment(';TYPE:Internal infill')).not.toBe(
      gcodeFeatureFromComment(';TYPE:Solid infill'),
    )
    expect(gcodeFeatureFromComment(';TYPE:Ludicrous infill mode')).toBe(GcodeFeature.Other)
  })

  it('returns null for a line with no type comment, so the current one stays', () => {
    expect(gcodeFeatureFromComment('G1 X10 Y10 E1')).toBeNull()
    expect(gcodeFeatureFromComment('; layer 3')).toBeNull()
  })

  it('marks an unknown slicer vocabulary unclassified rather than guessing', () => {
    expect(gcodeFeatureFromComment(';TYPE:Warp Field Stabiliser')).toBe(GcodeFeature.Other)
  })

  it('tolerates spacing and the FEATURE spelling', () => {
    expect(gcodeFeatureFromComment('; TYPE : Outer wall ')).toBe(GcodeFeature.PerimeterOuter)
    expect(gcodeFeatureFromComment(';FEATURE:Inner wall')).toBe(GcodeFeature.PerimeterInner)
  })
})

describe('parser feature classification', () => {
  it('holds a declared feature in force across the moves that follow it', () => {
    const geometry = parseGcode(`G90
M83
;TYPE:External perimeter
G1 X0 Y0 Z0.2 F1200
G1 X10 Y0 E1
G1 X10 Y10 E1
;TYPE:Sparse infill
G1 X5 Y5 E1
`)

    // The lead-in travel is not a feature; the two walls share the declared one.
    expect(featureAt(geometry.segments, 1)).toBe(GcodeFeature.PerimeterOuter)
    expect(featureAt(geometry.segments, 2)).toBe(GcodeFeature.PerimeterOuter)
    expect(featureAt(geometry.segments, 3)).toBe(GcodeFeature.Infill)
  })

  it('leaves travels unclassified even inside a declared feature', () => {
    const geometry = parseGcode(`G90
M83
;TYPE:Outer wall
G1 X0 Y0 Z0.2 F1200
G1 X10 Y0 E1
G1 X20 Y0
`)

    expect(featureAt(geometry.segments, 1)).toBe(GcodeFeature.PerimeterOuter)
    expect(featureAt(geometry.segments, 2)).toBe(GcodeFeature.Other)
  })

  it('classifies a file with no type comments as unclassified throughout', () => {
    const geometry = parseGcode(`G90
M83
G1 X0 Y0 Z0.2 F1200
G1 X10 Y0 E1
`)

    expect(featureAt(geometry.segments, 1)).toBe(GcodeFeature.Other)
  })
})

describe('feed-rate range', () => {
  /**
   * Travels run far faster than any bead is laid down. Including them stretched
   * the reported range until every extrusion coloured to the same end of the
   * ramp — the mode was on, and said nothing.
   */
  it('spans the speeds extrusions use, not the travels between them', () => {
    const geometry = parseGcode(`G90
M83
G1 X0 Y0 Z0.2 F1200
G1 X10 Y0 E1 F1800
G1 X20 Y0 E1 F3600
G1 X40 Y0 F30000
`)

    expect(geometry.minimumFeedrate).toBe(1_800)
    expect(geometry.maximumFeedrate).toBe(3_600)
  })
})

describe('bead width derivation', () => {
  /**
   * The filament's cross-section is squared into the derived width, so assuming
   * 1.75 mm on a 2.85 mm machine understates every bead by (2.85/1.75)^2 —
   * about two and a half times. The diameter therefore comes from the machine.
   */
  it('scales derived width with the filament diameter it was told', () => {
    const source = `G90
M83
G1 X0 Y0 Z0.2 F1200
G1 X10 Y0 E0.5
`
    const thin = parseGcode(source, 1.75)
    const thick = parseGcode(source, 2.85)

    // Segment 0 is the lead-in travel, which has no width; segment 1 extrudes.
    const thinWidth = widthAt(thin.segments, 1)
    const thickWidth = widthAt(thick.segments, 1)
    expect(thinWidth).toBeGreaterThan(0)
    expect(thickWidth / thinWidth).toBeCloseTo((2.85 / 1.75) ** 2, 2)
  })

  it('falls back to 1.75 mm for an absent or nonsensical diameter', () => {
    const source = `G90
M83
G1 X0 Y0 Z0.2 F1200
G1 X10 Y0 E0.5
`
    const assumed = widthAt(parseGcode(source).segments, 1)
    expect(assumed).toBeGreaterThan(0)
    expect(widthAt(parseGcode(source, 0).segments, 1)).toBeCloseTo(assumed, 6)
    expect(widthAt(parseGcode(source, Number.NaN).segments, 1)).toBeCloseTo(assumed, 6)
  })

  /**
   * A slicer spaces adjacent lines by their extrusion width, so drawn at
   * exactly that width they leave a hairline of background between every pair
   * and the surface reads as stripes. Beads are drawn slightly wider so they
   * overlap, as they do on a real print.
   */
  it('draws beads wider than they were extruded, but only slightly', () => {
    expect(defaultGcodeBeadOverlap).toBeGreaterThan(1)
    expect(defaultGcodeBeadOverlap).toBeLessThanOrEqual(1.25)
  })
})
