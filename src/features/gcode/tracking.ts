import { gcodeSegment, gcodeSegmentStride } from '@/features/gcode/types'

export function gcodeLayerAtProgress(
  segments: Float32Array,
  requestedProgress: number,
  layerCount: number,
): number {
  const segmentCount = Math.floor(segments.length / gcodeSegmentStride)
  if (segmentCount === 0 || layerCount <= 1) return 0
  const progress = Math.min(1, Math.max(0, requestedProgress))
  let low = 0
  let high = segmentCount - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const endProgress = segments[middle * gcodeSegmentStride + gcodeSegment.progress] ?? 0
    if (endProgress < progress) low = middle + 1
    else high = middle
  }
  const layer = Math.round(segments[low * gcodeSegmentStride + gcodeSegment.layer] ?? 0)
  return Math.min(layerCount - 1, Math.max(0, layer))
}

export function currentGcodeLayer(
  segments: Float32Array,
  layerCount: number,
  reportedCurrentLayer: number | null,
  rawFileProgress: number,
): number {
  if (reportedCurrentLayer !== null && Number.isFinite(reportedCurrentLayer)) {
    // SET_PRINT_STATS_INFO is conventionally fed `layer_num + 1`. Preserve an
    // explicit zero for slicers that report their native zero-based first layer.
    const index = reportedCurrentLayer <= 0 ? 0 : Math.floor(reportedCurrentLayer) - 1
    return Math.min(Math.max(0, layerCount - 1), Math.max(0, index))
  }
  return gcodeLayerAtProgress(segments, rawFileProgress, layerCount)
}
