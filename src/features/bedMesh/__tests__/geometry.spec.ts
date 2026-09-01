import { describe, expect, it } from 'vitest'

import { buildMeshGeometry, type MeshGeometryInput } from '@/features/bedMesh/geometry'

const area = { minX: 0, minY: 0, maxX: 100, maxY: 100 }

/** A bed that rises steadily from one corner to the other. */
function ramp(rows: number, columns: number): number[][] {
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => (row + column) * 0.05),
  )
}

function build(overrides: Partial<MeshGeometryInput> = {}) {
  return buildMeshGeometry({
    matrix: ramp(3, 3),
    area,
    style: 'surface',
    bandStep: 0.1,
    ...overrides,
  })
}

function verticesOf(geometry: ReturnType<typeof build>) {
  const points: Array<{ x: number; y: number; z: number; deviation: number }> = []
  for (let index = 0; index < geometry.deviations.length; index += 1) {
    points.push({
      x: geometry.positions[index * 3] ?? 0,
      y: geometry.positions[index * 3 + 1] ?? 0,
      z: geometry.positions[index * 3 + 2] ?? 0,
      deviation: geometry.deviations[index] ?? 0,
    })
  }
  return points
}

describe('buildMeshGeometry', () => {
  it('refuses a grid too small to have a cell in it', () => {
    for (const style of ['surface', 'bars', 'contour', 'terraced', 'mosaic'] as const) {
      expect(build({ style, matrix: [[0.1]] }).positions, style).toEqual([])
    }
  })

  it('keeps every vertex inside the area it was given', () => {
    // A column is centered on its point and would otherwise hang over the edge
    // of the probed area, putting readings on bed that was never measured.
    // Mosaic is the deliberate exception — see its own describe block below —
    // so it is left out of this loop rather than made to satisfy it.
    for (const style of ['surface', 'bars', 'contour', 'terraced'] as const) {
      for (const point of verticesOf(build({ style, matrix: ramp(5, 5) }))) {
        expect(point.x, style).toBeGreaterThanOrEqual(area.minX)
        expect(point.x, style).toBeLessThanOrEqual(area.maxX)
        expect(point.y, style).toBeGreaterThanOrEqual(area.minY)
        expect(point.y, style).toBeLessThanOrEqual(area.maxY)
      }
    }
  })

  describe('surface', () => {
    it('shares one vertex between every cell that meets on it', () => {
      const geometry = build({ matrix: ramp(4, 5) })
      expect(geometry.deviations).toHaveLength(20)
      // Two triangles per cell.
      expect(geometry.triangles).toHaveLength(3 * 4 * 2 * 3)
    })

    it('draws each interior edge once, not once per cell that owns it', () => {
      // Outlining every cell separately draws the shared edges twice, which is
      // wasted work and, at partial opacity, a visibly darker line.
      const geometry = build({ matrix: ramp(4, 5) })
      const seen = new Set<string>()
      for (let index = 0; index < geometry.lines.length; index += 2) {
        const pair = [geometry.lines[index], geometry.lines[index + 1]].sort().join('-')
        expect(seen.has(pair)).toBe(false)
        seen.add(pair)
      }
      // Rows of horizontal runs plus columns of vertical ones.
      expect(seen.size).toBe(4 * 4 + 5 * 3)
    })
  })

  describe('bars', () => {
    it('stands each column on the zero plane at its own reading', () => {
      const geometry = build({
        style: 'bars',
        matrix: [
          [0.2, -0.1],
          [0, 0.3],
        ],
      })
      const points = verticesOf(geometry)
      // Four columns, eight corners each.
      expect(points).toHaveLength(32)
      const heights = [...new Set(points.map((point) => point.z))].sort((a, b) => a - b)
      expect(heights).toEqual([-0.1, 0, 0.2, 0.3])
    })

    it('colors a whole column for the reading at its top', () => {
      // Coloring a foot by its own height would run a gradient up every
      // column, showing a spread of values the printer never reported.
      const geometry = build({
        style: 'bars',
        matrix: [
          [0.2, 0.2],
          [0.2, 0.2],
        ],
      })
      const points = verticesOf(geometry)
      expect(points.every((point) => point.deviation === 0.2)).toBe(true)
      expect(points.some((point) => point.z === 0)).toBe(true)
    })

    it('leaves the columns standing apart rather than merging into a slab', () => {
      const geometry = build({ style: 'bars', matrix: ramp(3, 3) })
      const xs = [...new Set(verticesOf(geometry).map((point) => point.x))].sort((a, b) => a - b)
      // Two faces per column, and a gap between neighboring columns: the
      // right face of one never coincides with the left face of the next.
      expect(new Set(xs).size).toBe(6)
    })
  })

  describe('mosaic', () => {
    it('keeps each tile at its own exact reading, not a band or an average', () => {
      // Terraced averages a cell's four corners and snaps the result; mosaic's
      // whole point is that the number printed over a tile is the reading that
      // tile is colored for, so it must never be banded or averaged away.
      const geometry = build({
        style: 'mosaic',
        bandStep: 0.1,
        matrix: [
          [0.2, -0.1],
          [0, 0.3],
        ],
      })
      const points = verticesOf(geometry)
      // Four tiles, eight corners each — one flat tile per probed point.
      expect(points).toHaveLength(32)
      const heights = [...new Set(points.map((point) => point.z))].sort((a, b) => a - b)
      expect(heights).toEqual([-0.1, 0, 0.2, 0.3])
    })

    it('leaves next to no gap between neighbors, unlike bars’ narrower footprint', () => {
      const matrix = ramp(3, 3)
      // The two faces where one column's tile ends and the next one's begins,
      // clear of the area's own edge — the gap a seamless grid must not have.
      const neighborGap = (style: 'bars' | 'mosaic'): number => {
        const xs = [...new Set(verticesOf(build({ style, matrix })).map((point) => point.x))]
          .filter((x) => x > area.minX && x < area.maxX)
          .sort((a, b) => a - b)
        return (xs[1] ?? 0) - (xs[0] ?? 0)
      }
      const stepX = 50
      expect(neighborGap('mosaic')).toBeLessThan(neighborGap('bars'))
      expect(neighborGap('mosaic')).toBeLessThan(stepX * 0.1)
    })

    it('draws its outer tiles whole, past the probed area rather than clipped to it', () => {
      // A grid's edge cells are whole cells: the point at the boundary is the
      // middle of its own tile, not the tile's edge, so the outward half of
      // that tile reaches past the area mosaic was given.
      const geometry = build({ style: 'mosaic', matrix: ramp(3, 3) })
      const xs = verticesOf(geometry).map((point) => point.x)
      const ys = verticesOf(geometry).map((point) => point.y)
      expect(Math.min(...xs)).toBeLessThan(area.minX)
      expect(Math.max(...xs)).toBeGreaterThan(area.maxX)
      expect(Math.min(...ys)).toBeLessThan(area.minY)
      expect(Math.max(...ys)).toBeGreaterThan(area.maxY)
    })
  })

  describe('terraced', () => {
    it('snaps every block to the band interval, height and color together', () => {
      const geometry = build({
        style: 'terraced',
        bandStep: 0.1,
        matrix: [
          [0.02, 0.04],
          [0.06, 0.28],
        ],
      })
      const points = verticesOf(geometry)
      // One block, one cell: the four corners average to 0.1.
      expect(points).toHaveLength(8)
      expect(new Set(points.map((point) => point.deviation))).toEqual(new Set([0.1]))
      expect(new Set(points.map((point) => point.z))).toEqual(new Set([0, 0.1]))
    })

    it('builds nothing rather than dividing by a band interval of zero', () => {
      expect(build({ style: 'terraced', bandStep: 0 }).positions).toEqual([])
    })
  })

  describe('contour', () => {
    it('is lines and nothing else, so it needs no surface under it', () => {
      const geometry = build({ style: 'contour', matrix: ramp(5, 5) })
      expect(geometry.triangles).toEqual([])
      expect(geometry.lines.length).toBeGreaterThan(0)
      expect(geometry.linesAreTheDrawing).toBe(true)
    })

    it('puts every line at a multiple of the band interval, and at its own height', () => {
      const geometry = build({ style: 'contour', bandStep: 0.1, matrix: ramp(5, 5) })
      for (const point of verticesOf(geometry)) {
        expect(Math.abs(point.z / 0.1 - Math.round(point.z / 0.1))).toBeLessThan(1e-9)
        // A contour line lies on the surface it describes, so the height it
        // is drawn at and the value it stands for are the same number.
        expect(point.deviation).toBeCloseTo(point.z, 9)
      }
    })

    it('emits whole segments, never a stray endpoint', () => {
      const geometry = build({ style: 'contour', matrix: ramp(6, 6) })
      expect(geometry.lines.length % 2).toBe(0)
      expect(geometry.deviations.length).toBe(geometry.lines.length)
      for (let index = 0; index < geometry.lines.length; index += 2) {
        const from = geometry.lines[index] ?? 0
        const to = geometry.lines[index + 1] ?? 0
        expect(to).toBe(from + 1)
      }
    })

    it('draws no line through a bed that is perfectly flat between the bands', () => {
      // Every corner equal means no crossing anywhere, and a level that lands
      // exactly on a corner must not be counted once per edge that touches it.
      const flat = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => 0.05))
      expect(build({ style: 'contour', bandStep: 0.1, matrix: flat }).lines).toEqual([])
    })

    it('follows a level right across the bed rather than stopping at a cell', () => {
      // A ramp crosses each level on one straight diagonal, so the segments at
      // that height have to add up to a run reaching both edges of the area.
      // 0.4 is the middle of this ramp's range, the diagonal corner to corner.
      const geometry = build({ style: 'contour', bandStep: 0.1, matrix: ramp(9, 9) })
      const atOneLevel = verticesOf(geometry).filter((point) => Math.abs(point.z - 0.4) < 1e-9)
      expect(atOneLevel.length).toBeGreaterThan(4)
      const xs = atOneLevel.map((point) => point.x)
      expect(Math.min(...xs)).toBeCloseTo(area.minX, 6)
      expect(Math.max(...xs)).toBeCloseTo(area.maxX, 6)
    })
  })
})
