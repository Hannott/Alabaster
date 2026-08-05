import {
  defaultGcodeExtrusionWidth,
  gcodeCap,
  gcodeCapStride,
  gcodeSegment,
  gcodeSegmentStride,
  type GcodeBounds,
  type GcodeRenderChunk,
} from '@/features/gcode/types'

const segmentsPerChunk = 2_048
const capsPerChunk = 1_024
// How many chunks one supergroup covers. Culling tests supergroups first, so a
// 3.5 M-segment file costs ~55 bounds tests per frame instead of ~1,700 — the
// per-frame JS walk was itself a measurable cost at that scale.
const chunksPerSupergroup = 32

function emptyBounds(): GcodeBounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  }
}

function include(bounds: GcodeBounds, x: number, y: number, z: number, padding = 0): void {
  bounds.minX = Math.min(bounds.minX, x - padding)
  bounds.maxX = Math.max(bounds.maxX, x + padding)
  bounds.minY = Math.min(bounds.minY, y - padding)
  bounds.maxY = Math.max(bounds.maxY, y + padding)
  bounds.minZ = Math.min(bounds.minZ, z - padding)
  bounds.maxZ = Math.max(bounds.maxZ, z + padding)
}

// `firstIndex` offsets chunk records into a larger instance buffer, so a
// streamed batch's chunks address the growing GPU buffer rather than the batch.
export function buildGcodeRenderChunks(segments: Float32Array, firstIndex = 0): GcodeRenderChunk[] {
  const segmentCount = Math.floor(segments.length / gcodeSegmentStride)
  const chunks: GcodeRenderChunk[] = []
  for (let first = 0; first < segmentCount; first += segmentsPerChunk) {
    const count = Math.min(segmentsPerChunk, segmentCount - first)
    const bounds = emptyBounds()
    let minimumLayer = Number.POSITIVE_INFINITY
    let maximumLayer = Number.NEGATIVE_INFINITY
    for (let index = first; index < first + count; index += 1) {
      const offset = index * gcodeSegmentStride
      const layer = segments[offset + gcodeSegment.layer] ?? 0
      const width = segments[offset + gcodeSegment.extrusionWidth] || defaultGcodeExtrusionWidth
      const height = segments[offset + gcodeSegment.extrusionHeight] ?? 0
      const padding = Math.max(width, height) * 0.5
      include(
        bounds,
        segments[offset + gcodeSegment.startX] ?? 0,
        segments[offset + gcodeSegment.startY] ?? 0,
        (segments[offset + gcodeSegment.startZ] ?? 0) - height * 0.5,
        padding,
      )
      include(
        bounds,
        segments[offset + gcodeSegment.endX] ?? 0,
        segments[offset + gcodeSegment.endY] ?? 0,
        (segments[offset + gcodeSegment.endZ] ?? 0) - height * 0.5,
        padding,
      )
      minimumLayer = Math.min(minimumLayer, layer)
      maximumLayer = Math.max(maximumLayer, layer)
    }
    chunks.push({ first: firstIndex + first, count, minimumLayer, maximumLayer, bounds })
  }
  return chunks
}

export function buildGcodeCapRenderChunks(caps: Float32Array, firstIndex = 0): GcodeRenderChunk[] {
  const capCount = Math.floor(caps.length / gcodeCapStride)
  const chunks: GcodeRenderChunk[] = []
  for (let first = 0; first < capCount; first += capsPerChunk) {
    const count = Math.min(capsPerChunk, capCount - first)
    const bounds = emptyBounds()
    let minimumLayer = Number.POSITIVE_INFINITY
    let maximumLayer = Number.NEGATIVE_INFINITY
    for (let index = first; index < first + count; index += 1) {
      const offset = index * gcodeCapStride
      const layer = caps[offset + gcodeCap.layer] ?? 0
      const width = caps[offset + gcodeCap.extrusionWidth] || defaultGcodeExtrusionWidth
      const height = caps[offset + gcodeCap.extrusionHeight] ?? 0
      include(
        bounds,
        caps[offset + gcodeCap.x] ?? 0,
        caps[offset + gcodeCap.y] ?? 0,
        (caps[offset + gcodeCap.z] ?? 0) - height * 0.5,
        Math.max(width, height) * 0.5,
      )
      minimumLayer = Math.min(minimumLayer, layer)
      maximumLayer = Math.max(maximumLayer, layer)
    }
    chunks.push({ first: firstIndex + first, count, minimumLayer, maximumLayer, bounds })
  }
  return chunks
}

export interface GcodeChunkSupergroup {
  chunks: GcodeRenderChunk[]
  minimumLayer: number
  maximumLayer: number
  bounds: GcodeBounds
}

/**
 * Groups consecutive chunks into coarser cull units. A supergroup is rejected
 * only when every chunk inside it would be, so this never changes what is
 * drawn — only how much work deciding costs.
 */
export function buildGcodeChunkSupergroups(
  chunks: readonly GcodeRenderChunk[],
): GcodeChunkSupergroup[] {
  const groups: GcodeChunkSupergroup[] = []
  for (let first = 0; first < chunks.length; first += chunksPerSupergroup) {
    const members = chunks.slice(first, first + chunksPerSupergroup)
    if (members.length === 0) continue
    const bounds = emptyBounds()
    let minimumLayer = Number.POSITIVE_INFINITY
    let maximumLayer = Number.NEGATIVE_INFINITY
    for (const chunk of members) {
      bounds.minX = Math.min(bounds.minX, chunk.bounds.minX)
      bounds.maxX = Math.max(bounds.maxX, chunk.bounds.maxX)
      bounds.minY = Math.min(bounds.minY, chunk.bounds.minY)
      bounds.maxY = Math.max(bounds.maxY, chunk.bounds.maxY)
      bounds.minZ = Math.min(bounds.minZ, chunk.bounds.minZ)
      bounds.maxZ = Math.max(bounds.maxZ, chunk.bounds.maxZ)
      minimumLayer = Math.min(minimumLayer, chunk.minimumLayer)
      maximumLayer = Math.max(maximumLayer, chunk.maximumLayer)
    }
    groups.push({ chunks: members, minimumLayer, maximumLayer, bounds })
  }
  return groups
}
