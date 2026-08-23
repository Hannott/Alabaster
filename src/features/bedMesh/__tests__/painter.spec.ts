import { describe, expect, it } from 'vitest'

import {
  buildMeshScene,
  nearestMeshProbe,
  paintMeshOverlay,
  type MeshPaintOptions,
  type MeshPalette,
} from '@/features/bedMesh/painter'
import { meshOrientationPresets, meshTopDown, type MeshArea } from '@/features/bedMesh/scene'

const palette: MeshPalette = {
  lowDeep: [0, 76, 119],
  low: [0, 114, 178],
  middle: [240, 240, 240],
  high: [213, 94, 0],
  highDeep: [142, 63, 0],
  plane: [204, 121, 167],
  line: [255, 255, 255],
  guide: [160, 160, 160],
}

const bed: MeshArea = { minX: 0, minY: 0, maxX: 250, maxY: 250 }
const probed: MeshArea = { minX: 20, minY: 20, maxX: 230, maxY: 230 }

/**
 * A stand-in for the 2D context. The overlay is exercised for what it draws,
 * not how it draws it, so only the calls that carry a decision are recorded.
 */
function fakeContext(characterWidth = 6) {
  const texts: string[] = []
  const arcs: Array<{ x: number; y: number }> = []
  return {
    texts,
    arcs,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    clearRect: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    setLineDash: () => undefined,
    arc: (x: number, y: number) => arcs.push({ x, y }),
    fillText: (value: string) => texts.push(value),
    measureText: (value: string) => ({ width: value.length * characterWidth }),
  }
}

function options(overrides: Partial<MeshPaintOptions> = {}): MeshPaintOptions {
  const size = 5
  const matrix = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => (row + column) * 0.01),
  )
  const step = (probed.maxX - probed.minX) / (size - 1)
  const probes = matrix.flatMap((line, row) =>
    line.map((deviation, column) => ({
      x: probed.minX + column * step,
      y: probed.minY + row * step,
      deviation,
      label: deviation.toFixed(3),
    })),
  )
  return {
    bed,
    layers: [{ key: 'mesh', matrix, area: probed, opacity: 1 }],
    zMax: 0.5,
    orientation: meshTopDown,
    viewport: { width: 400, height: 260 },
    t: 0,
    scale: { low: -0.1, high: 0.1 },
    palette,
    fontFamily: 'ui-monospace, monospace',
    probes,
    showProbes: true,
    forceProbeLabels: false,
    wireframe: false,
    axisLabels: { x: 'X', y: 'Y', z: 'Z' },
    formatTick: (value) => value.toString(),
    ...overrides,
  }
}

describe('paintMeshOverlay', () => {
  it('prints every probed number when the card has room for them', () => {
    const context = fakeContext()
    paintMeshOverlay(context as unknown as CanvasRenderingContext2D, options())
    expect(context.texts).toHaveLength(25)
    // The dot fades in as the number fades out — at full label opacity it has
    // not appeared yet.
    expect(context.arcs).toHaveLength(0)
  })

  it('drops the numbers rather than overprinting them in a narrow card', () => {
    // The same mesh in a column a fifth as wide. Shrinking the type instead is
    // how the old numbered grid became unreadable in the first place. The dot
    // still marks every probed point regardless of whether its number fits.
    const context = fakeContext()
    paintMeshOverlay(
      context as unknown as CanvasRenderingContext2D,
      options({ viewport: { width: 80, height: 52 } }),
    )
    expect(context.texts).toHaveLength(0)
    expect(context.arcs).toHaveLength(25)
  })

  /**
   * `forceProbeLabels` is the Calibration page's opt-in: its stage is
   * generously sized enough that the density fallback above would essentially
   * never trigger anyway, and the page exists specifically to read these
   * numbers. It skips only that fallback — the tilt fade below is untouched,
   * since a number lying flat against a surface seen edge-on is unreadable
   * regardless of how much room it has.
   */
  it('keeps the numbers in a narrow card when the density fallback is forced off', () => {
    const context = fakeContext()
    paintMeshOverlay(
      context as unknown as CanvasRenderingContext2D,
      options({ viewport: { width: 80, height: 52 }, forceProbeLabels: true }),
    )
    expect(context.texts).toHaveLength(25)
    expect(context.arcs).toHaveLength(0)
  })

  it('still drops the numbers once tilted, even with the density fallback forced off', () => {
    const context = fakeContext()
    paintMeshOverlay(
      context as unknown as CanvasRenderingContext2D,
      options({
        t: 1,
        orientation: meshOrientationPresets.rightFront,
        forceProbeLabels: true,
      }),
    )
    expect(context.texts).not.toContain('0.000')
    expect(context.arcs).toHaveLength(25)
  })

  it('drops the numbers once the surface is tilted, without touching the point itself', () => {
    const context = fakeContext()
    paintMeshOverlay(
      context as unknown as CanvasRenderingContext2D,
      options({ t: 1, orientation: meshOrientationPresets.rightFront }),
    )
    expect(context.texts).not.toContain('0.000')
    expect(context.arcs).toHaveLength(25)
  })

  it('draws no axes while the map is flat, and axes once it is not', () => {
    const flat = fakeContext()
    paintMeshOverlay(flat as unknown as CanvasRenderingContext2D, options())
    expect(flat.texts).not.toContain('X')

    const tilted = fakeContext()
    paintMeshOverlay(
      tilted as unknown as CanvasRenderingContext2D,
      options({ t: 1, orientation: meshOrientationPresets.rightFront }),
    )
    expect(tilted.texts).toContain('X')
    expect(tilted.texts).toContain('Y')
    // Bed millimetres along the floor, and the height axis in its own numbers.
    expect(tilted.texts).toContain('250')
    expect(tilted.texts).toContain('0.4')
  })

  it('draws nothing of the probed grid when the user turned it off', () => {
    const context = fakeContext()
    paintMeshOverlay(context as unknown as CanvasRenderingContext2D, options({ showProbes: false }))
    expect(context.texts).toHaveLength(0)
    expect(context.arcs).toHaveLength(0)
  })

  it('fills a marker dot at every probed point once its number has faded', () => {
    const context = fakeContext()
    let fills = 0
    const counting = { ...context, fill: () => fills++ }
    paintMeshOverlay(
      counting as unknown as CanvasRenderingContext2D,
      options({ t: 1, orientation: meshOrientationPresets.rightFront }),
    )
    expect(fills).toBe(25)
  })

  it('survives a mesh too small to draw, instead of throwing at the card', () => {
    const context = fakeContext()
    expect(() =>
      paintMeshOverlay(
        context as unknown as CanvasRenderingContext2D,
        options({
          layers: [{ key: 'mesh', matrix: [[0.1]], area: probed, opacity: 1 }],
          probes: [],
        }),
      ),
    ).not.toThrow()
  })
})

describe('nearestMeshProbe', () => {
  it('finds the point under the pointer', () => {
    const settings = options()
    const scene = buildMeshScene(settings)
    expect(scene).not.toBeNull()
    const target = settings.probes[7]
    if (!scene || !target) throw new Error('scene did not build')
    const [x, y] = scene.place(target.x, target.y, target.deviation)
    expect(nearestMeshProbe(scene, settings.probes, x + 2, y + 2, 14)).toBe(target)
  })

  it('reports nothing when the pointer is over bare bed', () => {
    const settings = options()
    const scene = buildMeshScene(settings)
    if (!scene) throw new Error('scene did not build')
    expect(nearestMeshProbe(scene, settings.probes, -500, -500, 14)).toBeNull()
  })
})
