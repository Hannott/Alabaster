import { gcodeSegment, gcodeSegmentStride } from '@/features/gcode/types'

const fallbackFeedrateMillimetersPerMinute = 60

export interface GcodeSimulationSample {
  cursor: number
  move: number
  layer: number
  progress: number
  position: [number, number, number]
}

export interface GcodeSimulationTimeline {
  cumulativeSeconds: Float64Array
  totalSeconds: number
}

export function buildGcodeSimulationTimeline(segments: Float32Array): GcodeSimulationTimeline {
  const count = Math.floor(segments.length / gcodeSegmentStride)
  const cumulativeSeconds = new Float64Array(count + 1)
  let elapsedSeconds = 0
  let lastFeedrate = fallbackFeedrateMillimetersPerMinute

  for (let index = 0; index < count; index += 1) {
    const offset = index * gcodeSegmentStride
    const feedrate = segments[offset + gcodeSegment.feedrate] ?? 0
    if (Number.isFinite(feedrate) && feedrate > 0) lastFeedrate = feedrate

    const deltaX =
      (segments[offset + gcodeSegment.endX] ?? 0) - (segments[offset + gcodeSegment.startX] ?? 0)
    const deltaY =
      (segments[offset + gcodeSegment.endY] ?? 0) - (segments[offset + gcodeSegment.startY] ?? 0)
    const deltaZ =
      (segments[offset + gcodeSegment.endZ] ?? 0) - (segments[offset + gcodeSegment.startZ] ?? 0)
    const distance = Math.hypot(deltaX, deltaY, deltaZ)
    elapsedSeconds += distance > 0 ? (distance * 60) / lastFeedrate : 0
    cumulativeSeconds[index + 1] = elapsedSeconds
  }

  return { cumulativeSeconds, totalSeconds: elapsedSeconds }
}

export function simulationTimeForCursor(
  timeline: GcodeSimulationTimeline,
  requestedCursor: number,
): number {
  const count = Math.max(0, timeline.cumulativeSeconds.length - 1)
  const cursor = Math.min(count, Math.max(0, requestedCursor))
  const index = Math.min(count, Math.floor(cursor))
  if (index >= count) return timeline.totalSeconds
  const start = timeline.cumulativeSeconds[index] ?? 0
  const end = timeline.cumulativeSeconds[index + 1] ?? start
  return start + (end - start) * (cursor - index)
}

export function sampleGcodeSimulationAtTime(
  segments: Float32Array,
  timeline: GcodeSimulationTimeline,
  requestedSeconds: number,
): GcodeSimulationSample | null {
  const count = Math.floor(segments.length / gcodeSegmentStride)
  if (count === 0) return null

  const seconds = Math.min(timeline.totalSeconds, Math.max(0, requestedSeconds))
  if (seconds >= timeline.totalSeconds) return sampleGcodeSimulation(segments, count)

  let low = 0
  let high = count
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if ((timeline.cumulativeSeconds[middle + 1] ?? 0) <= seconds) low = middle + 1
    else high = middle
  }

  const start = timeline.cumulativeSeconds[low] ?? 0
  const end = timeline.cumulativeSeconds[low + 1] ?? start
  const fraction = end > start ? (seconds - start) / (end - start) : 1
  return sampleGcodeSimulation(segments, low + fraction)
}

export function sampleGcodeSimulation(
  segments: Float32Array,
  requestedCursor: number,
): GcodeSimulationSample | null {
  const count = Math.floor(segments.length / gcodeSegmentStride)
  if (count === 0) return null

  const cursor = Math.min(count, Math.max(0, requestedCursor))
  const segmentIndex = Math.min(count - 1, Math.floor(cursor))
  const offset = segmentIndex * gcodeSegmentStride
  const fraction = cursor >= count ? 1 : cursor - segmentIndex
  const previousProgress =
    segmentIndex === 0
      ? 0
      : (segments[(segmentIndex - 1) * gcodeSegmentStride + gcodeSegment.progress] ?? 0)
  const endProgress = segments[offset + gcodeSegment.progress] ?? previousProgress

  return {
    cursor,
    move: Math.min(count, Math.floor(cursor)),
    layer: Math.max(0, Math.round(segments[offset + gcodeSegment.layer] ?? 0)),
    progress: previousProgress + (endProgress - previousProgress) * fraction,
    position: [
      (segments[offset + gcodeSegment.startX] ?? 0) +
        ((segments[offset + gcodeSegment.endX] ?? 0) -
          (segments[offset + gcodeSegment.startX] ?? 0)) *
          fraction,
      (segments[offset + gcodeSegment.startY] ?? 0) +
        ((segments[offset + gcodeSegment.endY] ?? 0) -
          (segments[offset + gcodeSegment.startY] ?? 0)) *
          fraction,
      (segments[offset + gcodeSegment.startZ] ?? 0) +
        ((segments[offset + gcodeSegment.endZ] ?? 0) -
          (segments[offset + gcodeSegment.startZ] ?? 0)) *
          fraction,
    ],
  }
}
