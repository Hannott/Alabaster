import { gcodeMovesConnected } from '@/features/gcode/pathGeometry'
import {
  GcodeMoveKind,
  defaultGcodeExtrusionWidth,
  gcodeSegment,
  gcodeSegmentStride,
  type GcodeDecimationTier,
} from '@/features/gcode/types'

/**
 * Far-zoom geometry reduction for the toolpath LOD ladder.
 *
 * This replaced a voxel-column surface mode whose look nobody wanted: it
 * merged vertical gaps, dilated silhouettes, and turned a printed object into
 * a field of boxes exactly when a large model should look its best. The
 * insight is that a distant model does not need *different* geometry, only
 * *less* of it — so a decimated tier is still the toolpath, still drawn by the
 * pill shader with the same lighting, shadow, and reveal rules. Only the
 * number of instances falls.
 *
 * Consecutive extrusions merge into one longer bead while every guard below
 * holds. The guards are what keep the result honest:
 *
 * - **Only within one connected path**, using the same predicate the path
 *   builder uses, so a merge can never bridge a travel move or a layer change.
 * - **Only at equal bead width and height**, because a merged run renders with
 *   a single width and a wider or thinner neighbour would visibly change size.
 * - **Only while the merged chord stays within a fraction of one bead width**
 *   of every point it replaces, which is what bounds the visible error.
 * - **Never more than `maximumRunSegments`**, because one merged instance
 *   spanning a whole spiral would have a bounding box the size of the model
 *   and defeat the frustum culling that pays for this in the first place.
 *
 * The merged segment inherits the **last** original's progress, so a run is
 * revealed only once every move inside it has actually printed: the reveal
 * frontier quantizes to the run rather than running ahead of the printer.
 */

export interface GcodeDecimationSettings {
  /**
   * Chord tolerance as a fraction of the bead's own width. Relative rather than
   * absolute because the number that matters is whether a merged bead stays
   * inside the footprint of the beads it replaces: 0.15 mm is nothing on a
   * 0.8 mm bead and a third of the way across a 0.4 mm one. It also makes both
   * tiers correct for any nozzle without recalibration.
   */
  chordErrorWidthFraction: number
  maximumRunSegments: number
}

/*
 * Both tiers stay well inside one bead width.
 *
 * An earlier calibration set these in absolute millimetres (0.3 and 1.2) on the
 * reasoning that a tier engages only once a bead is sub-pixel, so a deviation of
 * a pixel or two could not be seen. The render disproved it. One displaced bead
 * is indeed invisible — but a surface is made of many parallel beads, and
 * displacing each by up to three bead widths makes neighbours cross. The model
 * then reads as a field of speckle rather than a solid object, which is the very
 * failure the voxel mode was replaced for.
 *
 * Holding the tolerance under half a bead width keeps a merged bead inside the
 * footprint of the beads it replaces, so a wall can only get slightly
 * straighter, never tangled with the wall beside it.
 */
export const gcodeDecimationSettings: Record<GcodeDecimationTier, GcodeDecimationSettings> = {
  decimated: { chordErrorWidthFraction: 0.2, maximumRunSegments: 48 },
  coarse: { chordErrorWidthFraction: 0.45, maximumRunSegments: 256 },
}

const widthEpsilon = 0.001

function field(segments: Float32Array, index: number, name: number): number {
  return segments[index * gcodeSegmentStride + name] ?? 0
}

function isExtrusion(segments: Float32Array, index: number): boolean {
  return field(segments, index, gcodeSegment.kind) === GcodeMoveKind.Extrusion
}

/** Perpendicular distance from `point` to the segment `start`–`end`, in 3D. */
function distanceToChord(
  pointX: number,
  pointY: number,
  pointZ: number,
  startX: number,
  startY: number,
  startZ: number,
  endX: number,
  endY: number,
  endZ: number,
): number {
  const chordX = endX - startX
  const chordY = endY - startY
  const chordZ = endZ - startZ
  const chordLengthSquared = chordX * chordX + chordY * chordY + chordZ * chordZ
  if (chordLengthSquared <= 1e-12) {
    return Math.hypot(pointX - startX, pointY - startY, pointZ - startZ)
  }
  const projection =
    ((pointX - startX) * chordX + (pointY - startY) * chordY + (pointZ - startZ) * chordZ) /
    chordLengthSquared
  const clamped = Math.min(1, Math.max(0, projection))
  return Math.hypot(
    pointX - (startX + chordX * clamped),
    pointY - (startY + chordY * clamped),
    pointZ - (startZ + chordZ * clamped),
  )
}

function canExtend(segments: Float32Array, left: number, right: number): boolean {
  if (!isExtrusion(segments, right)) return false
  if (
    Math.abs(
      field(segments, left, gcodeSegment.extrusionWidth) -
        field(segments, right, gcodeSegment.extrusionWidth),
    ) > widthEpsilon
  ) {
    return false
  }
  if (
    Math.abs(
      field(segments, left, gcodeSegment.extrusionHeight) -
        field(segments, right, gcodeSegment.extrusionHeight),
    ) > widthEpsilon
  ) {
    return false
  }
  return gcodeMovesConnected(
    field(segments, left, gcodeSegment.endX),
    field(segments, left, gcodeSegment.endY),
    field(segments, left, gcodeSegment.endZ),
    field(segments, left, gcodeSegment.kind),
    field(segments, left, gcodeSegment.layer),
    field(segments, right, gcodeSegment.startX),
    field(segments, right, gcodeSegment.startY),
    field(segments, right, gcodeSegment.startZ),
    field(segments, right, gcodeSegment.kind),
    field(segments, right, gcodeSegment.layer),
  )
}

/**
 * Returns a reduced copy of `segments`. Travels and unmergeable extrusions
 * pass through unchanged, so the result is always a valid segment stream the
 * existing path builder and shaders can consume without special cases.
 */
export function decimateGcodeSegments(
  segments: Float32Array,
  settings: GcodeDecimationSettings,
): Float32Array {
  const count = Math.floor(segments.length / gcodeSegmentStride)
  const output = new Float32Array(segments.length)
  let written = 0

  for (let index = 0; index < count;) {
    if (!isExtrusion(segments, index)) {
      output.set(
        segments.subarray(index * gcodeSegmentStride, (index + 1) * gcodeSegmentStride),
        written * gcodeSegmentStride,
      )
      written += 1
      index += 1
      continue
    }

    const startX = field(segments, index, gcodeSegment.startX)
    const startY = field(segments, index, gcodeSegment.startY)
    const startZ = field(segments, index, gcodeSegment.startZ)
    // The run's own bead width sets its tolerance. A move that declared no
    // width renders at the nozzle default, so it is measured against that.
    const runWidth =
      field(segments, index, gcodeSegment.extrusionWidth) || defaultGcodeExtrusionWidth
    const chordTolerance = runWidth * settings.chordErrorWidthFraction
    let end = index
    let weightedFeedrate = 0
    let totalLength = 0

    while (end + 1 < count && end - index + 1 < settings.maximumRunSegments) {
      if (!canExtend(segments, end, end + 1)) break
      const candidateX = field(segments, end + 1, gcodeSegment.endX)
      const candidateY = field(segments, end + 1, gcodeSegment.endY)
      const candidateZ = field(segments, end + 1, gcodeSegment.endZ)
      // Every interior point this merge would erase must stay within tolerance
      // of the chord that replaces it, checked against the *candidate* chord
      // rather than the accepted one so error cannot creep as a run grows.
      let worstError = 0
      for (let interior = index; interior <= end; interior += 1) {
        worstError = Math.max(
          worstError,
          distanceToChord(
            field(segments, interior, gcodeSegment.endX),
            field(segments, interior, gcodeSegment.endY),
            field(segments, interior, gcodeSegment.endZ),
            startX,
            startY,
            startZ,
            candidateX,
            candidateY,
            candidateZ,
          ),
        )
        if (worstError > chordTolerance) break
      }
      if (worstError > chordTolerance) break
      end += 1
    }

    for (let member = index; member <= end; member += 1) {
      const length = Math.hypot(
        field(segments, member, gcodeSegment.endX) - field(segments, member, gcodeSegment.startX),
        field(segments, member, gcodeSegment.endY) - field(segments, member, gcodeSegment.startY),
        field(segments, member, gcodeSegment.endZ) - field(segments, member, gcodeSegment.startZ),
      )
      weightedFeedrate += field(segments, member, gcodeSegment.feedrate) * length
      totalLength += length
    }

    const target = written * gcodeSegmentStride
    output.set(
      segments.subarray(index * gcodeSegmentStride, (index + 1) * gcodeSegmentStride),
      target,
    )
    output[target + gcodeSegment.endX] = field(segments, end, gcodeSegment.endX)
    output[target + gcodeSegment.endY] = field(segments, end, gcodeSegment.endY)
    output[target + gcodeSegment.endZ] = field(segments, end, gcodeSegment.endZ)
    // The run is revealed when its last move has printed, never earlier.
    output[target + gcodeSegment.progress] = field(segments, end, gcodeSegment.progress)
    // Length-weighted so a merged bead reports the speed it was mostly printed
    // at; feed-rate coloring reads this at every tier.
    output[target + gcodeSegment.feedrate] =
      totalLength > 0
        ? weightedFeedrate / totalLength
        : field(segments, index, gcodeSegment.feedrate)
    written += 1
    index = end + 1
  }

  return output.slice(0, written * gcodeSegmentStride)
}
