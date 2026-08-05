import { describe, expect, it } from 'vitest'

import { fittedCamera, gcodeBoundsAreVisible, projectionFor } from '@/features/gcode/camera'
import { buildGcodeChunkSupergroups, buildGcodeRenderChunks } from '@/features/gcode/lod'
import {
  GcodeMoveKind,
  gcodeSegment,
  gcodeSegmentStride,
  type GcodeBounds,
} from '@/features/gcode/types'

function segment(
  start: readonly [number, number, number],
  end: readonly [number, number, number],
  kind = GcodeMoveKind.Extrusion,
  layer = 0,
  progress = 0,
): number[] {
  const values = new Array<number>(gcodeSegmentStride).fill(0)
  values.splice(gcodeSegment.startX, 3, ...start)
  values.splice(gcodeSegment.endX, 3, ...end)
  values[gcodeSegment.layer] = layer
  values[gcodeSegment.kind] = kind
  values[gcodeSegment.progress] = progress
  values[gcodeSegment.extrusionHeight] = kind === GcodeMoveKind.Extrusion ? 0.2 : 0
  values[gcodeSegment.extrusionWidth] = kind === GcodeMoveKind.Extrusion ? 0.4 : 0
  return values
}

describe('G-code render LOD', () => {
  it('records bounded, layer-aware batches without changing move order', () => {
    const values: number[] = []
    for (let index = 0; index < 2_050; index += 1) {
      values.push(
        ...segment([index, 0, 0.2], [index + 1, 0, 0.2], undefined, index < 2_048 ? 0 : 1),
      )
    }

    const chunks = buildGcodeRenderChunks(new Float32Array(values))

    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toMatchObject({ first: 0, count: 2_048, minimumLayer: 0, maximumLayer: 0 })
    expect(chunks[1]).toMatchObject({ first: 2_048, count: 2, minimumLayer: 1, maximumLayer: 1 })
    expect(chunks[1]?.bounds.minX).toBeLessThanOrEqual(2_048)
    expect(chunks[1]?.bounds.maxX).toBeGreaterThanOrEqual(2_050)
  })

  /**
   * Supergroups exist to make the per-frame cull cheap on large files. They
   * are only ever an accelerator: their bounds must contain every member, or
   * culling would start dropping geometry that is actually on screen.
   */
  it('groups chunks into cull units that contain every member', () => {
    const values: number[] = []
    for (let index = 0; index < 40 * 2_048; index += 1) {
      values.push(...segment([index, 0, 0.2], [index + 1, 0, 0.2], undefined, index % 7))
    }
    const chunks = buildGcodeRenderChunks(new Float32Array(values))
    const groups = buildGcodeChunkSupergroups(chunks)

    expect(chunks).toHaveLength(40)
    // 32 chunks per group.
    expect(groups).toHaveLength(2)
    expect(groups.flatMap((group) => group.chunks)).toEqual(chunks)
    for (const group of groups) {
      for (const chunk of group.chunks) {
        expect(chunk.bounds.minX).toBeGreaterThanOrEqual(group.bounds.minX)
        expect(chunk.bounds.maxX).toBeLessThanOrEqual(group.bounds.maxX)
        expect(chunk.minimumLayer).toBeGreaterThanOrEqual(group.minimumLayer)
        expect(chunk.maximumLayer).toBeLessThanOrEqual(group.maximumLayer)
      }
    }
  })

  it('returns no supergroups for an empty stream', () => {
    expect(buildGcodeChunkSupergroups([])).toEqual([])
  })

  it('rejects chunks completely outside the camera frustum', () => {
    const model: GcodeBounds = { minX: 0, maxX: 20, minY: 0, maxY: 20, minZ: 0, maxZ: 20 }
    const projection = projectionFor(model, fittedCamera(model, 800, 600), 800, 600)

    expect(gcodeBoundsAreVisible(model, projection)).toBe(true)
    expect(
      gcodeBoundsAreVisible(
        { minX: 10_000, maxX: 10_020, minY: 10_000, maxY: 10_020, minZ: 0, maxZ: 20 },
        projection,
      ),
    ).toBe(false)
  })
})
