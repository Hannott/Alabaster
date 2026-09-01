import { describe, expect, it } from 'vitest'

import {
  buildMeshScene,
  meshIsometricOrientation,
  meshOrientationAt,
  meshOrientationFor,
  meshOrientationPresets,
  meshProjectionFixesAngle,
  meshProjections,
  meshTickStep,
  meshTopDown,
  type MeshArea,
  type MeshLayer,
  type MeshProjection,
  type MeshSceneInput,
} from '@/features/bedMesh/scene'

const bed: MeshArea = { minX: 0, minY: 0, maxX: 250, maxY: 250 }
const probed: MeshArea = { minX: 20, minY: 20, maxX: 230, maxY: 230 }
const viewport = { width: 360, height: 240 }

function tilted(rows: number, columns: number): number[][] {
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => (row - column) * 0.01),
  )
}

function layer(matrix: number[][], overrides: Partial<MeshLayer> = {}): MeshLayer {
  return { key: 'mesh', matrix, area: probed, opacity: 1, ...overrides }
}

function scene(overrides: Partial<MeshSceneInput> = {}) {
  return buildMeshScene({
    bed,
    layers: [layer(tilted(5, 5))],
    zMax: 0.5,
    orientation: meshOrientationPresets.rightFront,
    viewport,
    ...overrides,
  })
}

describe('meshTickStep', () => {
  it('picks intervals a person reads without decoding', () => {
    expect(meshTickStep(250, 4)).toBe(50)
    expect(meshTickStep(1, 4)).toBe(0.2)
    expect(meshTickStep(9, 4)).toBe(2)
  })

  it('survives a span of nothing rather than dividing by it', () => {
    expect(meshTickStep(0, 4)).toBe(1)
  })
})

describe('meshOrientationAt', () => {
  it('starts looking straight down, whatever the resting angle', () => {
    expect(meshOrientationAt(meshOrientationPresets.leftFront, 0)).toEqual(meshTopDown)
  })

  it('arrives at the resting angle', () => {
    expect(meshOrientationAt(meshOrientationPresets.leftFront, 1)).toEqual(
      meshOrientationPresets.leftFront,
    )
  })

  it('passes through the angles between, which is the animation', () => {
    const half = meshOrientationAt({ alpha: 30, beta: 40 }, 0.5)
    expect(half.alpha).toBeCloseTo(60, 6)
    expect(half.beta).toBeCloseTo(20, 6)
  })
})

describe('buildMeshScene', () => {
  it('refuses a bed with no extent rather than dividing by it', () => {
    expect(scene({ bed: { minX: 0, minY: 0, maxX: 0, maxY: 0 } })).toBeNull()
    expect(scene({ zMax: 0 })).toBeNull()
  })

  it('keeps the whole box inside the viewport at every angle', () => {
    for (const preset of Object.values(meshOrientationPresets)) {
      const built = scene({ orientation: preset })
      const points = [
        ...(built?.quads.flatMap((quad) => quad.points) ?? []),
        // The guides are handed over in bed coordinates for the renderer to
        // place, so they are projected here to check the same containment.
        ...(built?.guides.map((point) => built.place(point[0], point[1], point[2])) ?? []),
      ]
      expect(points.length).toBeGreaterThan(0)
      for (const [x, y] of points) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(viewport.width)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(viewport.height)
      }
    }
  })

  it('fits the box, not the mesh, so a flat bed is not drawn larger than a rough one', () => {
    const rough = scene({ layers: [layer(tilted(5, 5))] })
    const flat = scene({
      layers: [layer(Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => 0)))],
    })
    expect(flat?.place(0, 0, 0)).toEqual(rough?.place(0, 0, 0))
    expect(flat?.place(250, 250, 0)).toEqual(rough?.place(250, 250, 0))
  })

  it('puts the probed area in its place on the bed, not stretched across it', () => {
    const built = scene()
    const points = built?.quads.flatMap((quad) => quad.points) ?? []
    const bedCorner = built?.place(bed.minX, bed.minY, 0) ?? [0, 0]
    const nearest = points.reduce((best, point) =>
      Math.hypot(point[0] - bedCorner[0], point[1] - bedCorner[1]) <
      Math.hypot(best[0] - bedCorner[0], best[1] - bedCorner[1])
        ? point
        : best,
    )
    // The mesh starts 20 mm in, so no part of it may reach the bed's corner.
    expect(Math.hypot(nearest[0] - bedCorner[0], nearest[1] - bedCorner[1])).toBeGreaterThan(5)
  })

  it('puts the front of the bed nearest the viewer, not behind it', () => {
    const built = scene({ orientation: meshOrientationPresets.front })
    const front = built?.place(125, 0, 0) ?? [0, 0]
    const back = built?.place(125, 250, 0) ?? [0, 0]
    expect(front[1]).toBeGreaterThan(back[1])
  })

  it('looks straight down at the top preset, so the flat map has no tilt in it', () => {
    const built = scene({ orientation: meshTopDown })
    const nearLeft = built?.place(0, 0, 0) ?? [0, 0]
    const nearRight = built?.place(250, 0, 0) ?? [0, 0]
    // One edge of the bed shares a screen row from directly above; any leaked
    // tilt or height would break that.
    expect(nearLeft[1]).toBeCloseTo(nearRight[1], 6)
    expect(built?.place(0, 0, 0.4)).toEqual(built?.place(0, 0, -0.4))
  })

  it('sorts every layer together so a level plane is buried where the bed rises through it', () => {
    const built = scene({
      layers: [
        layer(tilted(5, 5)),
        layer(
          [
            [0, 0],
            [0, 0],
          ],
          { key: 'flat', opacity: 0.35, neutral: true },
        ),
      ],
    })
    const depths = built?.quads.map((quad) => quad.depth) ?? []
    expect(depths).toEqual([...depths].sort((first, second) => first - second))
    // Both layers took part in the one ordering rather than being drawn in turn.
    expect(built?.quads.some((quad) => quad.neutral)).toBe(true)
    expect(built?.quads.some((quad) => !quad.neutral)).toBe(true)
  })

  it('gives the level plane the mesh grid, so it can cut through cell by cell', () => {
    // A plane described as one quad spanning the whole area has exactly one
    // depth, so it has no way to sit in front of some cells of a tilted
    // surface and behind others — which is what a plane genuinely crossed by
    // the surface requires. Matching the mesh's own resolution is what lets
    // each flat cell be sorted independently against the mesh cell over it.
    const meshMatrix = tilted(5, 5) // (row - column) * 0.01: crosses zero on the diagonal
    const flatMatrix = meshMatrix.map((row) => row.map(() => 0))
    const built = scene({
      layers: [
        layer(meshMatrix, { key: 'mesh' }),
        layer(flatMatrix, { key: 'flat', neutral: true, opacity: 0.35 }),
      ],
    })
    const cellCount = 4 * 4
    const meshQuads = built?.quads.filter((quad) => !quad.neutral) ?? []
    const flatQuads = built?.quads.filter((quad) => quad.neutral) ?? []
    expect(meshQuads).toHaveLength(cellCount)
    expect(flatQuads).toHaveLength(cellCount)

    // Genuine interleaving, not two slabs stacked: a surface crossing the
    // plane puts some cells in front of it and some behind, so the two types
    // must alternate through the depth order rather than each forming one
    // contiguous run.
    let runs = 0
    for (let index = 0; index < (built?.quads.length ?? 0); index += 1) {
      if (index === 0 || built?.quads[index]?.neutral !== built?.quads[index - 1]?.neutral) {
        runs += 1
      }
    }
    expect(runs).toBeGreaterThan(2)
  })

  it('labels the axes with bed millimetres', () => {
    const built = scene()
    expect(built?.xTicks.map((tick) => tick.value)).toEqual([0, 50, 100, 150, 200, 250])
    expect(built?.zTicks.map((tick) => tick.value)).toEqual([-0.4, -0.2, 0, 0.2, 0.4])
  })

  it('shares one ground step between X and Y, so a rectangular bed is not finer on one side', () => {
    // 350 alone rounds to a 100 mm ladder and 200 alone to a 50 mm one; the
    // long side must fall back to the short side's finer step rather than
    // each axis choosing its own.
    const built = scene({ bed: { minX: 0, minY: 0, maxX: 350, maxY: 200 } })
    expect(built?.xTicks.map((tick) => tick.value)).toEqual([0, 50, 100, 150, 200, 250, 300, 350])
    expect(built?.yTicks.map((tick) => tick.value)).toEqual([0, 50, 100, 150, 200])
  })

  it('turns in place: an orbit changes no scale and no center', () => {
    // Fitting to the camera being drawn means a rotating box rescales, because
    // its bounding box does. The distance between two given corners is allowed
    // to change as they foreshorten — that is what turning looks like — but the
    // scale itself is not, and the box's middle must stay put.
    const resting = meshOrientationPresets.rightFront
    const turned = (turn: number) =>
      buildMeshScene({
        bed,
        layers: [layer(tilted(5, 5))],
        zMax: 0.5,
        orientation: { alpha: resting.alpha, beta: resting.beta + turn },
        fitOrientation: resting,
        viewport,
      })
    // The height axis at the box's own center foreshortens with the tilt only,
    // so under one fit it is the same length however far the bed is turned.
    const axisLength = (built: ReturnType<typeof turned>) => {
      const top = built?.place(125, 125, 0.5) ?? [0, 0]
      const bottom = built?.place(125, 125, -0.5) ?? [0, 0]
      return Math.hypot(top[0] - bottom[0], top[1] - bottom[1])
    }

    const reference = axisLength(turned(0))
    for (const turn of [-120, -60, -20, 20, 60, 120]) {
      const built = turned(turn)
      expect(axisLength(built)).toBeCloseTo(reference, 6)
      expect(built?.place(125, 125, 0)?.[0]).toBeCloseTo(viewport.width / 2, 6)
      expect(built?.place(125, 125, 0)?.[1]).toBeCloseTo(viewport.height / 2, 6)
    }
  })

  it('would rescale on every frame of that orbit without the held fit', () => {
    // The contrast that makes the guard above mean something: fitted to the
    // camera being drawn, the same two turns are drawn at two different sizes.
    const resting = meshOrientationPresets.rightFront
    const drawnFit = (turn: number) => {
      const built = buildMeshScene({
        bed,
        layers: [layer(tilted(5, 5))],
        zMax: 0.5,
        orientation: { alpha: resting.alpha, beta: resting.beta + turn },
        viewport,
      })
      const top = built?.place(125, 125, 0.5) ?? [0, 0]
      const bottom = built?.place(125, 125, -0.5) ?? [0, 0]
      return Math.hypot(top[0] - bottom[0], top[1] - bottom[1])
    }
    expect(drawnFit(0)).not.toBeCloseTo(drawnFit(45), 1)
  })

  it('still reframes for the flat-to-3D toggle, where the camera really does move', () => {
    const flat = scene({ orientation: meshTopDown, fitOrientation: meshTopDown })
    const solid = scene({
      orientation: meshOrientationPresets.rightFront,
      fitOrientation: meshOrientationPresets.rightFront,
    })
    const width = (built: ReturnType<typeof scene>) => {
      const left = built?.place(bed.minX, bed.minY, 0) ?? [0, 0]
      const right = built?.place(bed.maxX, bed.minY, 0) ?? [0, 0]
      return Math.hypot(left[0] - right[0], left[1] - right[1])
    }
    expect(width(flat)).not.toBeCloseTo(width(solid), 1)
  })

  it('puts the height axis on the leftmost corner, clear of the surface', () => {
    for (const preset of [
      meshOrientationPresets.rightFront,
      meshOrientationPresets.leftFront,
      meshOrientationPresets.front,
    ]) {
      const built = scene({ orientation: preset, fitOrientation: preset })
      const axisX = built?.zTicks[0]?.at[0] ?? 0
      const surface = built?.quads.flatMap((quad) => quad.points) ?? []
      const leftmostSurface = Math.min(...surface.map((point) => point[0]))
      // The numbers are written to the left of the axis, so the axis has to be
      // at or left of everything drawn — otherwise the mesh covers its scale.
      expect(axisX).toBeLessThanOrEqual(leftmostSurface + 1)
    }
  })

  it('narrows the far edge under perspective, and not under orthographic', () => {
    const settings = {
      bed,
      layers: [layer(tilted(5, 5))],
      zMax: 0.5,
      orientation: meshOrientationPresets.front,
      viewport,
    }
    const widthAt = (built: ReturnType<typeof scene>, y: number) => {
      const left = built?.place(bed.minX, y, 0) ?? [0, 0]
      const right = built?.place(bed.maxX, y, 0) ?? [0, 0]
      return Math.abs(right[0] - left[0])
    }
    const flatCamera = buildMeshScene({ ...settings, projection: 'orthographic' })
    expect(widthAt(flatCamera, bed.minY)).toBeCloseTo(widthAt(flatCamera, bed.maxY), 6)

    const lens = buildMeshScene({ ...settings, projection: 'perspective' })
    expect(widthAt(lens, bed.minY)).toBeGreaterThan(widthAt(lens, bed.maxY))
  })

  it('leaves the padded room for the axis numbers unpainted', () => {
    const padding = { left: 32, right: 6, top: 8, bottom: 22 }
    const built = scene({ padding })
    const points = built?.quads.flatMap((quad) => quad.points) ?? []
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(padding.left)
      expect(y).toBeLessThanOrEqual(viewport.height - padding.bottom)
    }
  })

  it('clamps a point past the height axis instead of letting it leave the box', () => {
    const built = scene({ zMax: 0.1 })
    expect(built?.place(125, 125, 5)).toEqual(built?.place(125, 125, 0.1))
  })

  it('draws every projection identically at zero strength, which is the 2D map', () => {
    // The 2D map is defined as "always orthographic" by never asking for any
    // lens at all, rather than by special-casing the flat state. Every kind
    // must therefore agree at amount 0, or the map would carry a trace of
    // whichever projection happens to be saved for the 3D view.
    const base = { bed, layers: [layer(tilted(5, 5))], zMax: 0.5, viewport, projectionAmount: 0 }
    const orthographic = buildMeshScene({
      ...base,
      orientation: meshTopDown,
      projection: 'orthographic',
    })
    for (const kind of Object.keys(meshProjections) as MeshProjection[]) {
      const built = buildMeshScene({ ...base, orientation: meshTopDown, projection: kind })
      expect(built?.quads.map((q) => q.points)).toEqual(orthographic?.quads.map((q) => q.points))
    }
  })

  it('fades a lens in rather than cutting to it, at whatever amount is asked for', () => {
    const settings = {
      bed,
      layers: [layer(tilted(5, 5))],
      zMax: 0.5,
      orientation: meshOrientationPresets.front,
      viewport,
      projection: 'perspective' as const,
    }
    const spanAt = (amount: number) => {
      const built = buildMeshScene({ ...settings, projectionAmount: amount })
      const near = built?.place(bed.minX, bed.minY, 0) ?? [0, 0]
      const far = built?.place(bed.minX, bed.maxY, 0) ?? [0, 0]
      return Math.hypot(near[0] - far[0], near[1] - far[1])
    }
    const none = spanAt(0)
    const half = spanAt(0.5)
    const full = spanAt(1)
    // Strictly increasing distortion, not a jump straight to the full effect at
    // the first sign of `t` — that is what "fades" rules out.
    expect(half).toBeGreaterThan(none)
    expect(full).toBeGreaterThan(half)
  })

  it('draws the front face true shape under an oblique projection', () => {
    // That is the definition: the plane facing the viewer is undistorted, and
    // depth is skewed away from it instead of being turned away. A bed square
    // on the X axis must therefore measure its own width on screen, whatever
    // the resting angle happens to be.
    const settings = {
      bed,
      layers: [layer(tilted(5, 5))],
      zMax: 0.5,
      orientation: meshOrientationPresets.rightFront,
      viewport,
    }
    for (const projection of ['cavalier', 'cabinet'] as const) {
      const built = buildMeshScene({ ...settings, projection })
      const left = built?.place(bed.minX, bed.minY, 0) ?? [0, 0]
      const right = built?.place(bed.maxX, bed.minY, 0) ?? [0, 0]
      // Level: the front edge is horizontal, unrotated.
      expect(left[1], projection).toBeCloseTo(right[1] ?? 0, 6)
      const above = built?.place(bed.minX, bed.minY, 0.5) ?? [0, 0]
      // And upright: height rises straight up the screen off that same edge.
      expect(above[0], projection).toBeCloseTo(left[0] ?? 0, 6)
      expect(above[1] ?? 0).toBeLessThan(left[1] ?? 0)
    }
  })

  it('halves the depth under cabinet, which is the whole of what it is', () => {
    const settings = {
      bed,
      layers: [layer(tilted(5, 5))],
      zMax: 0.5,
      orientation: meshOrientationPresets.front,
      viewport,
      // Both fit the viewport separately, so the comparison is made in scene
      // units by cancelling each one's own fit rather than in pixels.
      projectionAmount: 1,
    }
    const depthRun = (projection: MeshProjection) => {
      const built = buildMeshScene({ ...settings, projection })
      const near = built?.place(bed.minX, bed.minY, 0) ?? [0, 0]
      const far = built?.place(bed.minX, bed.maxY, 0) ?? [0, 0]
      const fit = (built?.camera.fit ?? 1) * (built?.camera.zoom ?? 1)
      return Math.hypot((near[0] ?? 0) - (far[0] ?? 0), (near[1] ?? 0) - (far[1] ?? 0)) / fit
    }
    expect(depthRun('cabinet')).toBeCloseTo(depthRun('cavalier') / 2, 6)
  })

  it('keeps uprights parallel under two-point perspective, and not under three', () => {
    // The count of vanishing points is not decoration: it is whether the
    // divide is measured along the ground or along the full view ray, and the
    // visible consequence is whether the box's vertical edges converge.
    const settings = {
      bed,
      layers: [layer(tilted(5, 5))],
      zMax: 0.5,
      orientation: meshOrientationPresets.rightFront,
      viewport,
    }
    const uprightLean = (projection: MeshProjection) => {
      const built = buildMeshScene({ ...settings, projection })
      const foot = built?.place(bed.minX, bed.minY, -0.5) ?? [0, 0]
      const head = built?.place(bed.minX, bed.minY, 0.5) ?? [0, 0]
      const otherFoot = built?.place(bed.maxX, bed.maxY, -0.5) ?? [0, 0]
      const otherHead = built?.place(bed.maxX, bed.maxY, 0.5) ?? [0, 0]
      // Two uprights at opposite corners: parallel means the same lean.
      return (head[0] ?? 0) - (foot[0] ?? 0) - ((otherHead[0] ?? 0) - (otherFoot[0] ?? 0))
    }
    expect(uprightLean('twoPoint')).toBeCloseTo(0, 6)
    expect(Math.abs(uprightLean('perspective'))).toBeGreaterThan(0.5)
  })

  it('snaps a one-point view square-on without touching how high it stands', () => {
    // Square-on is all a one-point perspective asks for. Snapping the elevation
    // too would put the camera level with a bed and show it edge-on.
    expect(meshOrientationFor('onePoint', { alpha: 25, beta: 40 })).toEqual({ alpha: 25, beta: 0 })
    expect(meshOrientationFor('onePoint', { alpha: 25, beta: 130 })).toEqual({
      alpha: 25,
      beta: 90,
    })
  })

  it('lets a projection that names its own angle override whatever it is given', () => {
    expect(meshOrientationFor('isometric', { alpha: 5, beta: 5 })).toEqual(meshIsometricOrientation)
    expect(meshOrientationFor('perspective', { alpha: 5, beta: 5 })).toEqual({ alpha: 5, beta: 5 })

    // The two answers have to agree, or the orientation control would be live
    // for a projection that ignores it, or dead for one that does not.
    for (const projection of Object.keys(meshProjections) as MeshProjection[]) {
      const here = meshOrientationFor(projection, { alpha: 12, beta: 34 })
      const there = meshOrientationFor(projection, { alpha: 44, beta: 200 })
      const ignoresWhatItIsGiven = here.alpha === there.alpha && here.beta === there.beta
      // Oblique ignores the angle inside the formula rather than in this
      // answer, so it is the one that reports fixed while still passing an
      // angle through. Snapping is not fixing: one-point still answers two
      // different faces for two different inputs.
      const oblique = meshProjections[projection].oblique !== undefined
      expect(meshProjectionFixesAngle(projection), projection).toBe(ignoresWhatItIsGiven || oblique)
    }
  })

  it('draws isometric exactly like orthographic for a given orientation', () => {
    // The two are the same geometry; what makes isometric distinct is the
    // camera angle it is called with, decided by the caller, not by this file.
    const settings = {
      bed,
      layers: [layer(tilted(5, 5))],
      zMax: 0.5,
      orientation: meshIsometricOrientation,
      viewport,
    }
    const isometric = buildMeshScene({ ...settings, projection: 'isometric' })
    const orthographic = buildMeshScene({ ...settings, projection: 'orthographic' })
    expect(isometric?.quads.map((q) => q.points)).toEqual(orthographic?.quads.map((q) => q.points))
  })

  it('bends fisheye outward from the center, unlike orthographic', () => {
    const settings = {
      bed,
      layers: [layer(tilted(5, 5))],
      zMax: 0.5,
      orientation: meshOrientationPresets.rightFront,
      viewport,
    }
    const center = { x: (bed.minX + bed.maxX) / 2, y: (bed.minY + bed.maxY) / 2 }
    const cornerDistance = (built: ReturnType<typeof scene>) => {
      const mid = built?.place(center.x, center.y, 0) ?? [0, 0]
      const corner = built?.place(bed.maxX, bed.maxY, 0) ?? [0, 0]
      return Math.hypot(corner[0] - mid[0], corner[1] - mid[1])
    }
    const flat = buildMeshScene({ ...settings, projection: 'orthographic' })
    const bent = buildMeshScene({ ...settings, projection: 'fisheye' })
    expect(cornerDistance(bent)).toBeGreaterThan(cornerDistance(flat))
  })

  it('zooms about the mesh center, so the middle holds still while the edges move', () => {
    const center = { x: (bed.minX + bed.maxX) / 2, y: (bed.minY + bed.maxY) / 2 }
    const at = (zoom: number) => scene({ zoom })
    const middleAt = (zoom: number) => at(zoom)?.place(center.x, center.y, 0) ?? [0, 0]
    const edgeAt = (zoom: number) => at(zoom)?.place(bed.maxX, bed.maxY, 0) ?? [0, 0]

    const unzoomed = middleAt(1)
    expect(middleAt(2)).toEqual(unzoomed)
    expect(middleAt(0.5)).toEqual(unzoomed)

    const near = edgeAt(1)
    const zoomedIn = edgeAt(2)
    const distance = (a: [number, number], b: [number, number]) =>
      Math.hypot(a[0] - b[0], a[1] - b[1])
    expect(distance(zoomedIn, unzoomed)).toBeCloseTo(distance(near, unzoomed) * 2, 5)
  })

  it('keeps zoom out of the fit, so the box does not resize as the wheel turns', () => {
    // Zoom is a magnification applied after the box is measured, not a change
    // to what "fits" means — otherwise the mesh would jump in size on every
    // scroll tick instead of smoothly magnifying in place.
    const unzoomed = scene({ zoom: 1 })
    const zoomed = scene({ zoom: 2 })
    const width = (built: ReturnType<typeof scene>) => {
      const left = built?.place(bed.minX, bed.minY, 0) ?? [0, 0]
      const right = built?.place(bed.maxX, bed.minY, 0) ?? [0, 0]
      return Math.hypot(left[0] - right[0], left[1] - right[1])
    }
    // The zoomed width is exactly double, which only holds if the underlying
    // fit was not itself recomputed for the larger zoom.
    expect(width(zoomed)).toBeCloseTo(width(unzoomed) * 2, 5)
  })

  it('carries the whole scene by the pan, in the pixels the gesture was made in', () => {
    // A pan has to move the picture exactly as far as the finger did, at every
    // magnification — which is why it is applied in CSS pixels after the fit
    // rather than as a translation of the bed.
    const center = { x: (bed.minX + bed.maxX) / 2, y: (bed.minY + bed.maxY) / 2 }
    const at = (pan: { x: number; y: number }, zoom = 1) =>
      scene({ pan, zoom })?.place(center.x, center.y, 0) ?? [0, 0]

    const rest = at({ x: 0, y: 0 })
    const panned = at({ x: 40, y: -25 })

    expect(panned[0] - rest[0]).toBeCloseTo(40, 5)
    expect(panned[1] - rest[1]).toBeCloseTo(-25, 5)

    // Zoomed in, the same gesture still travels the same distance on the card.
    const zoomedRest = at({ x: 0, y: 0 }, 3)
    const zoomedPan = at({ x: 40, y: -25 }, 3)
    expect(zoomedPan[0] - zoomedRest[0]).toBeCloseTo(40, 5)
    expect(zoomedPan[1] - zoomedRest[1]).toBeCloseTo(-25, 5)
  })

  it('keeps pan out of the fit, so the box does not resize as it is dragged', () => {
    const width = (built: ReturnType<typeof scene>) => {
      const left = built?.place(bed.minX, bed.minY, 0) ?? [0, 0]
      const right = built?.place(bed.maxX, bed.minY, 0) ?? [0, 0]
      return Math.hypot(left[0] - right[0], left[1] - right[1])
    }

    expect(width(scene({ pan: { x: 120, y: 90 } }))).toBeCloseTo(width(scene()), 5)
  })

  it('ignores a pan that is not a number, rather than losing the frame to NaN', () => {
    // The offset is added to every projected point, so one NaN reaching it
    // blanks the card — axes included — instead of misplacing the mesh.
    const built = scene({ pan: { x: Number.NaN, y: 0 } })

    expect(built?.camera.offsetX).toBeCloseTo(scene()?.camera.offsetX ?? 0, 5)
  })
})

describe('the full orbit', () => {
  const cameraAt = (alpha: number) => scene({ orientation: { alpha, beta: 0 } })?.camera

  it('reaches level with the bed, not only the hemisphere above it', () => {
    const level = cameraAt(0)
    expect(level?.cosAlpha).toBeCloseTo(1, 6)
    expect(level?.sinAlpha).toBeCloseTo(0, 6)
  })

  it('reaches looking straight up from underneath, the mirror of straight down', () => {
    const below = cameraAt(-90)
    const above = cameraAt(90)
    expect(below?.cosAlpha).toBeCloseTo(0, 6)
    expect(below?.sinAlpha).toBeCloseTo(-1, 6)
    // The underside is the same pole as the topside with height's sign
    // flipped, not a different or degenerate camera.
    expect(below?.cosAlpha).toBeCloseTo(above?.cosAlpha ?? NaN, 6)
    expect(below?.sinAlpha).toBeCloseTo(-(above?.sinAlpha ?? NaN), 6)
  })

  it('clamps beyond the poles rather than flipping past them', () => {
    expect(cameraAt(-200)?.sinAlpha).toBeCloseTo(cameraAt(-90)?.sinAlpha ?? NaN, 6)
    expect(cameraAt(200)?.sinAlpha).toBeCloseTo(cameraAt(90)?.sinAlpha ?? NaN, 6)
  })
})
