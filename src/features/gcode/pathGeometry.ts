import {
  GcodeMoveKind,
  GcodePathFlags,
  gcodeCapStride,
  gcodePathDetail,
  gcodePathDetailStride,
  gcodeSegment,
  gcodeSegmentStride,
} from '@/features/gcode/types'

const connectionEpsilon = 0.001
const directionEpsilon = 0.000_001
const capsPerChunk = 65_536
const miterLimit = 2

export interface GcodePathData {
  pathDetails: Float32Array
  caps: Float32Array
  capCount: number
}

interface Direction {
  x: number
  y: number
}

class CapBuffer {
  private readonly chunks: Float32Array[] = []
  private current = new Float32Array(gcodeCapStride * capsPerChunk)
  private offset = 0
  count = 0

  push(values: readonly number[]): void {
    if (this.offset + gcodeCapStride > this.current.length) {
      this.chunks.push(this.current)
      this.current = new Float32Array(gcodeCapStride * capsPerChunk)
      this.offset = 0
    }
    this.current.set(values, this.offset)
    this.offset += gcodeCapStride
    this.count += 1
  }

  finish(): Float32Array {
    const result = new Float32Array(this.count * gcodeCapStride)
    let targetOffset = 0
    for (const chunk of this.chunks) {
      result.set(chunk, targetOffset)
      targetOffset += chunk.length
    }
    result.set(this.current.subarray(0, this.offset), targetOffset)
    return result
  }
}

function value(segments: Float32Array, index: number, field: number): number {
  return segments[index * gcodeSegmentStride + field] ?? 0
}

function extrusion(segments: Float32Array, index: number): boolean {
  return value(segments, index, gcodeSegment.kind) === GcodeMoveKind.Extrusion
}

function direction(segments: Float32Array, index: number): Direction | null {
  const deltaX =
    value(segments, index, gcodeSegment.endX) - value(segments, index, gcodeSegment.startX)
  const deltaY =
    value(segments, index, gcodeSegment.endY) - value(segments, index, gcodeSegment.startY)
  const length = Math.hypot(deltaX, deltaY)
  if (length <= directionEpsilon) return null
  return { x: deltaX / length, y: deltaY / length }
}

/**
 * The one connectivity rule for joining consecutive moves into a path. The
 * streaming parser uses this same predicate to choose batch boundaries, so a
 * boundary can never fall where this function would have joined two moves —
 * diverging copies of this rule would reintroduce caps in the middle of walls.
 */
export function gcodeMovesConnected(
  leftEndX: number,
  leftEndY: number,
  leftEndZ: number,
  leftKind: number,
  leftLayer: number,
  rightStartX: number,
  rightStartY: number,
  rightStartZ: number,
  rightKind: number,
  rightLayer: number,
): boolean {
  if (leftKind !== GcodeMoveKind.Extrusion || rightKind !== GcodeMoveKind.Extrusion) return false
  if (leftLayer !== rightLayer) return false
  return (
    Math.abs(leftEndX - rightStartX) <= connectionEpsilon &&
    Math.abs(leftEndY - rightStartY) <= connectionEpsilon &&
    Math.abs(leftEndZ - rightStartZ) <= connectionEpsilon
  )
}

function connected(segments: Float32Array, left: number, right: number): boolean {
  if (left < 0 || right * gcodeSegmentStride >= segments.length) return false
  return gcodeMovesConnected(
    value(segments, left, gcodeSegment.endX),
    value(segments, left, gcodeSegment.endY),
    value(segments, left, gcodeSegment.endZ),
    value(segments, left, gcodeSegment.kind),
    value(segments, left, gcodeSegment.layer),
    value(segments, right, gcodeSegment.startX),
    value(segments, right, gcodeSegment.startY),
    value(segments, right, gcodeSegment.startZ),
    value(segments, right, gcodeSegment.kind),
    value(segments, right, gcodeSegment.layer),
  )
}

function normal(vector: Direction): Direction {
  return { x: -vector.y, y: vector.x }
}

// A connected endpoint is cut on the turn bisector. The normal component of
// this vector stays exactly one, so the bead keeps its measured width; only a
// tangent component is added to shear the end face and close the outer corner.
// Near-reversals fall back to a square cut instead of growing an unbounded tip.
function miterCutOffset(incoming: Direction, outgoing: Direction, squareCut: Direction): Direction {
  const incomingNormal = normal(incoming)
  const outgoingNormal = normal(outgoing)
  const sumX = incomingNormal.x + outgoingNormal.x
  const sumY = incomingNormal.y + outgoingNormal.y
  const sumLength = Math.hypot(sumX, sumY)
  if (sumLength <= directionEpsilon) return squareCut

  const miterX = sumX / sumLength
  const miterY = sumY / sumLength
  const projection = Math.abs(miterX * outgoingNormal.x + miterY * outgoingNormal.y)
  const scale = 1 / Math.max(directionEpsilon, projection)
  if (scale > miterLimit) return squareCut

  return { x: miterX * scale, y: miterY * scale }
}

function pushCap(
  caps: CapBuffer,
  segments: Float32Array,
  index: number,
  atStart: boolean,
  segmentDirection: Direction,
  startProgress: number,
  capWidth: number,
): void {
  const positionField = atStart ? gcodeSegment.startX : gcodeSegment.endX
  const directionScale = atStart ? -1 : 1
  caps.push([
    value(segments, index, positionField),
    value(segments, index, positionField + 1),
    value(segments, index, positionField + 2),
    segmentDirection.x * directionScale,
    segmentDirection.y * directionScale,
    value(segments, index, gcodeSegment.layer),
    atStart ? startProgress : value(segments, index, gcodeSegment.progress),
    value(segments, index, gcodeSegment.extrusionHeight),
    capWidth,
  ])
}

/**
 * `initialStartProgress` is the progress of the segment immediately before
 * this array — 0 for a whole file, the previous batch's last progress for a
 * streamed batch. Without it, the first segment of every batch would report a
 * start progress of 0 and be revealed too early during playback.
 */
export function buildGcodePathData(
  segments: Float32Array,
  initialStartProgress = 0,
): GcodePathData {
  const count = Math.floor(segments.length / gcodeSegmentStride)
  const pathDetails = new Float32Array(count * gcodePathDetailStride)
  const caps = new CapBuffer()
  const previousSegments = new Int32Array(count)
  const nextSegments = new Int32Array(count)
  previousSegments.fill(-1)
  nextSegments.fill(-1)

  for (let index = 0; index + 1 < count; index += 1) {
    if (!connected(segments, index, index + 1)) continue
    nextSegments[index] = index + 1
    previousSegments[index + 1] = index
  }

  for (let runStart = 0; runStart < count; runStart += 1) {
    if (!extrusion(segments, runStart) || (previousSegments[runStart] ?? -1) >= 0) continue
    let runEnd = runStart
    let nextSegment = nextSegments[runEnd] ?? -1
    while (nextSegment >= 0) {
      runEnd = nextSegment
      nextSegment = nextSegments[runEnd] ?? -1
    }
    if (runEnd !== runStart && connected(segments, runEnd, runStart)) {
      nextSegments[runEnd] = runStart
      previousSegments[runStart] = runEnd
    }
  }

  for (let index = 0; index < count; index += 1) {
    const offset = index * gcodePathDetailStride
    const currentDirection = direction(segments, index)
    const startProgress =
      index === 0 ? initialStartProgress : value(segments, index - 1, gcodeSegment.progress)
    pathDetails[offset + gcodePathDetail.startProgress] = startProgress

    if (!extrusion(segments, index) || !currentDirection) continue

    const previousIndex = previousSegments[index] ?? -1
    const nextIndex = nextSegments[index] ?? -1
    const connectsPrevious = previousIndex >= 0
    const connectsNext = nextIndex >= 0
    const currentNormal = normal(currentDirection)
    const previousDirection = connectsPrevious ? direction(segments, previousIndex) : null
    const nextDirection = connectsNext ? direction(segments, nextIndex) : null
    const startOffset = previousDirection
      ? miterCutOffset(previousDirection, currentDirection, currentNormal)
      : currentNormal
    const endOffset = nextDirection
      ? miterCutOffset(currentDirection, nextDirection, currentNormal)
      : currentNormal
    const flags =
      (connectsPrevious ? 0 : GcodePathFlags.StartCap) | (connectsNext ? 0 : GcodePathFlags.EndCap)
    const extrusionWidth = value(segments, index, gcodeSegment.extrusionWidth)

    pathDetails.set(
      [
        startOffset.x,
        startOffset.y,
        endOffset.x,
        endOffset.y,
        startProgress,
        flags,
        extrusionWidth,
        extrusionWidth,
      ],
      offset,
    )
    if (!connectsPrevious) {
      pushCap(caps, segments, index, true, currentDirection, startProgress, extrusionWidth)
    }
    if (!connectsNext) {
      pushCap(caps, segments, index, false, currentDirection, startProgress, extrusionWidth)
    }
  }

  return {
    pathDetails,
    caps: caps.finish(),
    capCount: caps.count,
  }
}
