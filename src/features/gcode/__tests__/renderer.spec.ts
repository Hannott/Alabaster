import { describe, expect, it } from 'vitest'

import { buildGcodeBedGrid, buildGcodeBedOrigin } from '@/features/gcode/renderer'
import type { GcodeBounds } from '@/features/gcode/types'

const configuredVolume: GcodeBounds = {
  minX: -1,
  maxX: 301,
  minY: -1,
  maxY: 251,
  minZ: -1,
  maxZ: 305,
}

describe('G-code bed geometry', () => {
  it('uses the configured XY limits exactly and aligns grid lines to the machine origin', () => {
    const grid = buildGcodeBedGrid(configuredVolume, true)
    const vertices = [...grid.vertices]
    const lines = Array.from({ length: vertices.length / 6 }, (_, index) =>
      vertices.slice(index * 6, index * 6 + 6),
    )

    expect(grid.bounds).toEqual({
      minX: -1,
      maxX: 301,
      minY: -1,
      maxY: 251,
      minZ: 0,
      maxZ: 1,
    })
    expect(lines).toContainEqual([0, -1, 0, 0, 251, 0])
    expect(lines).toContainEqual([-1, 0, 0, 301, 0, 0])
  })

  it('adds a padded grid only when printer limits are unavailable', () => {
    const model: GcodeBounds = { minX: 20, maxX: 40, minY: 30, maxY: 50, minZ: 0.2, maxZ: 4 }
    const grid = buildGcodeBedGrid(model, false)

    expect(grid.bounds.minX).toBeLessThan(model.minX)
    expect(grid.bounds.maxX).toBeGreaterThan(model.maxX)
    expect(grid.bounds.minY).toBeLessThan(model.minY)
    expect(grid.bounds.maxY).toBeGreaterThan(model.maxY)
  })

  it('builds the origin marker as bed geometry the print can occlude', () => {
    const bed: GcodeBounds = { minX: 0, maxX: 300, minY: 0, maxY: 250, minZ: 0, maxZ: 300 }
    const origin = buildGcodeBedOrigin(bed)
    const vertices = [...origin.vertices]

    expect(vertices.length / 3).toBe(origin.axisVertexCount * 2 + origin.dotVertexCount)
    // Flat on the bed, just clear of the grid lines and the cast shadows.
    for (let index = 2; index < vertices.length; index += 3) {
      expect(vertices[index]).toBeGreaterThan(bed.minZ)
      expect(vertices[index]).toBeLessThan(bed.minZ + 0.05)
    }
    // The X strip runs towards +X and the Y strip towards +Y from the origin.
    const xStrip = vertices.slice(0, origin.axisVertexCount * 3)
    const yStrip = vertices.slice(origin.axisVertexCount * 3, origin.axisVertexCount * 6)
    expect(Math.max(...xStrip.filter((_, index) => index % 3 === 0))).toBeGreaterThan(1)
    expect(Math.max(...xStrip.filter((_, index) => index % 3 === 1))).toBeLessThan(1)
    expect(Math.max(...yStrip.filter((_, index) => index % 3 === 1))).toBeGreaterThan(1)
    expect(Math.max(...yStrip.filter((_, index) => index % 3 === 0))).toBeLessThan(1)
  })
})
