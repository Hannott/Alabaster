import { describe, expect, it } from 'vitest'

import { meshRampColor, type MeshPalette } from '@/features/bedMesh/painter'
import {
  meshColourRange,
  meshHeightLimits,
  meshScalePosition,
  thinMeshMatrix,
  type MeshScale,
} from '@/features/bedMesh/scale'

const scale: MeshScale = { low: -0.1, high: 0.1 }

describe('meshScalePosition', () => {
  it('puts the middle of the scale at zero and each end at one', () => {
    expect(meshScalePosition(0, scale)).toBe(0)
    expect(meshScalePosition(0.1, scale)).toBe(1)
    expect(meshScalePosition(-0.1, scale)).toBe(-1)
  })

  it('clamps past either end rather than rescaling to the outlier', () => {
    expect(meshScalePosition(0.9, scale)).toBe(1)
    expect(meshScalePosition(-0.9, scale)).toBe(-1)
  })

  it('reports the middle for a scale with no range, instead of dividing by zero', () => {
    expect(meshScalePosition(0.05, { low: 0.05, high: 0.05 })).toBe(0)
  })
})

describe('meshColourRange', () => {
  it('centres on the mean rather than the plane', () => {
    expect(meshColourRange([0.1, 0.1, 0.1, 0.1])).toEqual({ low: 0.1, high: 0.1 })
  })

  it('sets its reach from the mean absolute deviation, not the raw span', () => {
    // Mean 0, deviations [0.1, 0.1, 0.1, 0.1] average to 0.1, so reach is 0.2.
    expect(meshColourRange([-0.1, 0.1, -0.1, 0.1])).toEqual({ low: -0.2, high: 0.2 })
  })

  it('lets one outlier clamp instead of stretching the whole scale', () => {
    // Nineteen points sit at 0 and one is a bad probe at 20. A min/max range
    // would stretch all the way to 20, flattening every real point into a
    // sliver near zero. Mean absolute deviation only feels a nineteenth of
    // that spike, so the scale stays a small fraction of the outlier's size.
    const values = [...Array<number>(19).fill(0), 20]
    const { low, high } = meshColourRange(values)
    expect(high).toBeLessThan(10)
    expect(low).toBeGreaterThan(-10)
  })

  it('is a point at zero with nothing measured', () => {
    expect(meshColourRange([])).toEqual({ low: 0, high: 0 })
  })
})

describe('meshHeightLimits', () => {
  it('never lets the axis be shorter than the mesh, which would clip a peak flat', () => {
    expect(meshHeightLimits(-0.2, 1.4).min).toBe(1.4)
    expect(meshHeightLimits(-0.009, 0.17).min).toBe(0.2)
  })

  it('keeps a floor for a bed flat enough to have almost no reach', () => {
    expect(meshHeightLimits(0, 0)).toEqual({ min: 0.1, max: 1 })
  })

  it('offers at least a millimetre of choice above the floor', () => {
    expect(meshHeightLimits(-0.05, 0.05).max).toBe(1)
    expect(meshHeightLimits(-2, 2).max).toBe(2)
  })
})

describe('thinMeshMatrix', () => {
  it('leaves a mesh within the limit untouched', () => {
    const matrix = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => 0))
    expect(thinMeshMatrix(matrix, 24)).toBe(matrix)
  })

  it('thins a dense mesh to the limit and keeps both edges', () => {
    const matrix = Array.from({ length: 61 }, (_, row) =>
      Array.from({ length: 61 }, (_, column) => row * 100 + column),
    )
    const thinned = thinMeshMatrix(matrix, 24)
    expect(thinned).toHaveLength(24)
    expect(thinned[0]).toHaveLength(24)
    expect(thinned[0]?.[0]).toBe(matrix[0]?.[0])
    expect(thinned[23]?.[23]).toBe(matrix[60]?.[60])
  })
})

describe('meshRampColor', () => {
  const palette: MeshPalette = {
    lowDeep: [0, 0, 128],
    low: [0, 0, 255],
    middle: [255, 255, 255],
    high: [255, 0, 0],
    highDeep: [128, 0, 0],
    plane: [204, 121, 167],
    line: [255, 255, 255],
    guide: [128, 128, 128],
  }

  it('returns the neutral middle for a point on plane', () => {
    expect(meshRampColor(0, scale, palette)).toEqual([255, 255, 255])
  })

  it('reaches full saturation at the midpoint of each half, not only at the ends', () => {
    // Five stops rather than three: a straight lerp from a colour to white
    // spends most of its travel looking merely pale, which is what made the
    // centre read as wider than it is. Reaching `low`/`high` at the halfway
    // mark puts real colour on the surface sooner.
    expect(meshRampColor(-0.05, scale, palette)).toEqual([0, 0, 255])
    expect(meshRampColor(0.05, scale, palette)).toEqual([255, 0, 0])
  })

  it('reaches the deep colour only at the true end of the scale', () => {
    expect(meshRampColor(-0.1, scale, palette)).toEqual([0, 0, 128])
    expect(meshRampColor(0.1, scale, palette)).toEqual([128, 0, 0])
  })

  it('does not saturate further past the end of a fixed scale', () => {
    expect(meshRampColor(5, scale, palette)).toEqual(meshRampColor(0.1, scale, palette))
    expect(meshRampColor(-5, scale, palette)).toEqual(meshRampColor(-0.1, scale, palette))
  })
})
