/**
 * The bed mesh scene: a 3D box in bed coordinates, the surfaces standing in it,
 * and the axes that say where anything is.
 *
 * Two decisions shape this file.
 *
 * The projection is **one function of an orientation**, and the flat map is
 * simply the orientation looking straight down. Nothing about either end is
 * special-cased, which is what lets the card animate between them by moving the
 * camera rather than by swapping two drawings.
 *
 * Everything is placed in **millimetres on the bed**, not in grid indices. The
 * probed area is usually smaller than the bed, and Klipper's `probe_count` sets
 * each axis separately, so a grid index says nothing about where a point
 * physically is. Working in bed coordinates is also what lets the axes carry
 * real numbers and the probed area sit visibly inside the bed it was measured
 * on.
 *
 * Nothing here touches the DOM.
 */

/** Fraction of the viewport left clear around the fitted box. */
const viewportInset = 0.9
/**
 * The z axis stands this tall against the shorter side of the bed.
 *
 * Exported because anything that has to look *cubic* in this scene needs it:
 * the camera stretches z so a tenth of a millimetre is visible at all, and a
 * voxel has to undo exactly that stretch to project square.
 */
export const meshHeightAgainstBed = 0.85
const heightAgainstBed = meshHeightAgainstBed

export interface MeshViewport {
  width: number
  height: number
}

/** An axis-aligned rectangle of the bed, in millimetres. */
export interface MeshArea {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/**
 * Where the camera stands. `alpha` is its height above the bed in degrees —
 * 90 looks straight down, 0 is level with the bed, and negative values carry
 * the camera below it, looking up — and `beta` is the turn around the
 * vertical axis. The two together cover a full orbit: every direction the
 * bed could be looked at from, not only the hemisphere above it.
 */
export interface MeshOrientation {
  alpha: number
  beta: number
}

/** Looking straight down. The flat heat map is this and nothing more. */
export const meshTopDown: MeshOrientation = { alpha: 90, beta: 0 }

export const meshOrientationPresets = {
  rightFront: { alpha: 25, beta: 40 },
  leftFront: { alpha: 25, beta: -40 },
  front: { alpha: 25, beta: 0 },
  top: meshTopDown,
} as const

export type MeshOrientationName = keyof typeof meshOrientationPresets

/**
 * How the box is flattened onto the card.
 *
 * The two everyday choices are the parents of the standard taxonomy: parallel
 * projection, where edges that are parallel on the bed stay parallel on screen
 * so two features the same size are drawn the same size wherever they sit; and
 * perspective, which narrows the far edge, reads more like looking at the
 * machine, and gives up that comparability to do it. Orthographic is also the
 * only one the 2D map may ever use — a flat map is a plan view, and a plan view
 * is defined by having no perspective in it.
 *
 * The rest are the named members of each family, and they exist because a
 * height map earns a look from an angle the everyday pair cannot offer. They
 * are hidden behind a setting rather than removed: this is a long list, and a
 * dozen entries in front of someone who wanted "3D" is the wrong trade.
 *
 * Fisheye is the one entry with no place in the taxonomy. It bends the box
 * outward from its center, giving up straight lines as well as comparability.
 */
export type MeshProjection =
  | 'perspective'
  | 'orthographic'
  | 'isometric'
  | 'dimetric'
  | 'trimetric'
  | 'cavalier'
  | 'cabinet'
  | 'onePoint'
  | 'twoPoint'
  | 'fisheye'

/**
 * What each projection does to a point, as data rather than as a branch per
 * name. Three things can vary, and every member of the taxonomy is some
 * combination of them.
 */
export interface MeshProjectionSpec {
  /** The per-point formula: parallel, a perspective divide, or the fisheye warp. */
  lens: 'parallel' | 'perspective' | 'fisheye'
  /**
   * The angle this projection names for itself. A projection defined by its
   * viewing angle — every axonometric one, and the two perspectives that pin
   * how many vanishing points there are — carries that angle here, and the
   * resting-angle preset then has nothing to do while it is chosen.
   */
  orientation?: MeshOrientation
  /**
   * Square-on to the bed rather than at a named angle: the turn is snapped to
   * the nearest quarter, so the preset — or an orbit — still chooses *which*
   * face is being looked at. The elevation is left alone, because a one-point
   * view of a bed from dead level is a bed seen edge-on.
   */
  faceOn?: boolean
  /**
   * Oblique: the front face is drawn true shape and the depth axis is skewed
   * away from it at this angle, at this fraction of its true length. Cavalier
   * keeps depth full length, cabinet halves it because full-length depth reads
   * as too deep to the eye.
   */
  oblique?: { angle: number; scale: number }
  /**
   * Keeps upright edges parallel under a perspective divide, by measuring the
   * divide along the ground rather than along the full view ray. This is the
   * whole difference between two-point and three-point perspective.
   */
  uprightsStayParallel?: boolean
}

/** The camera angle every `isometric` view is locked to. */
export const meshIsometricOrientation: MeshOrientation = { alpha: 35.264, beta: 45 }

/**
 * Every projection, in the order they are offered.
 *
 * The axonometric angles are the ones that define each name, not house taste:
 * isometric is the angle where all three axes foreshorten equally, dimetric the
 * standard 1 : ½ : 1 where two of them match, and trimetric any angle where no
 * two do — so that last one is a choice, and a shallow three-quarter view is as
 * good a representative as any.
 */
export const meshProjections: Record<MeshProjection, MeshProjectionSpec> = {
  perspective: { lens: 'perspective' },
  orthographic: { lens: 'parallel' },
  isometric: { lens: 'parallel', orientation: meshIsometricOrientation },
  dimetric: { lens: 'parallel', orientation: { alpha: 20.705, beta: 22.208 } },
  trimetric: { lens: 'parallel', orientation: { alpha: 30, beta: 20 } },
  cavalier: { lens: 'parallel', oblique: { angle: 45, scale: 1 } },
  cabinet: { lens: 'parallel', oblique: { angle: 45, scale: 0.5 } },
  onePoint: { lens: 'perspective', faceOn: true, uprightsStayParallel: true },
  twoPoint: {
    lens: 'perspective',
    orientation: { alpha: 25, beta: 35 },
    uprightsStayParallel: true,
  },
  fisheye: { lens: 'fisheye' },
}

/**
 * The two shown without asking. Everything else is a named member of a family,
 * and someone who wanted a 3D view of their bed wants one of these two.
 */
export const meshEverydayProjections: readonly MeshProjection[] = ['perspective', 'orthographic']

/**
 * The full list in offering order, grouped by the family each name belongs to.
 * `family` is undefined for the everyday pair, which stands above the families
 * rather than inside one.
 */
export const meshProjectionGroups: readonly {
  family?: 'axonometric' | 'oblique' | 'vanishingPoints' | 'other'
  members: readonly MeshProjection[]
}[] = [
  { members: ['perspective', 'orthographic'] },
  { family: 'axonometric', members: ['isometric', 'dimetric', 'trimetric'] },
  { family: 'oblique', members: ['cavalier', 'cabinet'] },
  { family: 'vanishingPoints', members: ['onePoint', 'twoPoint'] },
  { family: 'other', members: ['fisheye'] },
]

/**
 * The angle a projection is actually drawn at, given the angle otherwise asked
 * for — a preset, or wherever an orbit has been dragged to.
 *
 * Three cases, and they are the reason the orientation control is sometimes
 * live and sometimes not: a projection that names its own angle takes it, a
 * square-on projection snaps whatever it is given to the nearest face, and
 * everything else is drawn exactly where it was asked to be.
 */
export function meshOrientationFor(
  projection: MeshProjection,
  from: MeshOrientation,
): MeshOrientation {
  const spec = meshProjections[projection] ?? meshProjections.perspective
  if (spec.orientation) return spec.orientation
  if (!spec.faceOn) return from
  return { alpha: from.alpha, beta: Math.round(from.beta / 90) * 90 }
}

/**
 * Whether the projection has taken the angle out of the user's hands. Both the
 * orientation control and the orbit read this: a drag that visibly does nothing
 * is worse than a drag the surface declines to offer.
 */
export function meshProjectionFixesAngle(projection: MeshProjection): boolean {
  const spec = meshProjections[projection] ?? meshProjections.perspective
  return spec.orientation !== undefined || spec.oblique !== undefined
}

/**
 * Camera distance for the perspective projection, in box widths from the
 * center. Near enough to be seen, far enough that the far corners are not
 * distorted into a funnel.
 */
const perspectiveDistance = 4

/** How strongly `fisheye` bends the box outward from its center. */
const fisheyeStrength = 1.1

export interface MeshLayer {
  key: string
  matrix: readonly (readonly number[])[]
  /** The patch of bed this layer covers. */
  area: MeshArea
  /** 0 to 1; the flat reference plane is translucent so the mesh reads through it. */
  opacity: number
  /** A layer with no color of its own takes the neutral middle of the ramp. */
  neutral?: boolean
  /**
   * Reads from the opposite end of the color ramp. Two layers occupying
   * nearly the same point in space — the probed points and the interpolated
   * cell under them — read as one blurred layer if both take their color
   * from the same end of the ramp for the same deviation; inverting one
   * keeps them visually apart at a glance, for any value either happens to
   * hold.
   */
  invertRamp?: boolean
}

export interface MeshQuad {
  points: readonly [number, number][]
  deviation: number
  /** The four corners' depth averaged into one number, for painter's-order sorting. */
  depth: number
  /** Each corner's own depth, in the same order as `points`, unaveraged. */
  cornerDepths: readonly [number, number, number, number]
  opacity: number
  neutral: boolean
  invertRamp: boolean
}

export interface MeshTick {
  /** Where the label goes. */
  at: [number, number]
  value: number
}

export interface MeshScene {
  quads: readonly MeshQuad[]
  /**
   * The surface's own grid, one polyline per mesh row and per mesh column.
   * Not per-cell outlines: those draw every interior edge twice and cost one
   * subpath per cell rather than one per line.
   */
  wireframe: readonly (readonly (readonly [number, number])[])[]
  /** Box grid segments in bed coordinates, two points per line. */
  guides: readonly (readonly [number, number, number])[]
  /** The camera this frame was built with, for the renderer to share. */
  camera: MeshCamera
  xTicks: readonly MeshTick[]
  yTicks: readonly MeshTick[]
  zTicks: readonly MeshTick[]
  /** Where the X and Y axis names sit, at the middle of their bottom edge. */
  xLabelAt: [number, number]
  yLabelAt: [number, number]
  /** Puts one point of the bed on the screen. */
  place: (x: number, y: number, z: number) => [number, number]
  /** How far towards the camera one point of the bed sits — larger is nearer. */
  depthAt: (x: number, y: number, z: number) => number
}

export interface MeshSceneInput {
  /** The whole bed, so the probed area is seen in its place on it. */
  bed: MeshArea
  layers: readonly MeshLayer[]
  /** Half the height of the z axis, in millimetres. */
  zMax: number
  orientation: MeshOrientation
  viewport: MeshViewport
  projection?: MeshProjection
  /**
   * The orientation the scale is worked out from, when it differs from the one
   * being drawn.
   *
   * Fitting to the camera that is actually drawing means the box grows and
   * shrinks as it turns, because a rotating rectangle's bounding box does. On a
   * drag that reads as the mesh pulsing under the pointer rather than turning
   * in place. Holding the fit at the resting camera makes an orbit a rotation
   * and nothing else; the flat-to-3D toggle still rescales, because there the
   * camera genuinely is moving between two framings.
   */
  fitOrientation?: MeshOrientation
  /** Room to leave for the axis numbers, which are drawn outside the box. */
  padding?: { left: number; right: number; top: number; bottom: number }
  /**
   * How strongly `projection` is applied, from 0 to 1. The 2D map is always
   * orthographic, and the chosen projection belongs to the 3D view alone — so
   * rather than cut between the two, the lens is faded in over the same `t`
   * that rotates the camera. At 0 every projection draws as orthographic; a
   * card that is not mid-transition passes 0 or 1 outright. Defaults to 1 for
   * callers with no transition to drive it, such as tests.
   *
   * Unlike orientation, nothing ever pulls this away from `t` the way an orbit
   * drag pulls orientation away from the resting angle — so the fit pass uses
   * this same value rather than a separate one. Forcing the fit to 1
   * regardless would fit a resting 2D view to a perspective box it never
   * actually draws, leaving the flat map wrongly small and off-center.
   */
  projectionAmount?: number
  /**
   * Uniform magnification about the box's own center, applied after the box is
   * fitted to the viewport. Not part of the fit itself: zooming in must not
   * change what "fits" means, or the box would resize under the pointer on
   * every scroll tick rather than staying put while the view magnifies.
   */
  zoom?: number
  /**
   * How far the fitted box is carried away from the center it was fitted to, in
   * CSS pixels on the card.
   *
   * Applied after the fit for the same reason `zoom` is: a pan that fed back
   * into the fit would resize the box as it was dragged, so the map would
   * shrink on the way to the corner it was being dragged towards. It is also
   * the reason panning is expressed in pixels rather than in millimetres of
   * bed — the gesture is a finger moving across the card, and it has to travel
   * exactly as far as the finger does at every magnification.
   */
  pan?: { x: number; y: number }
}

const degreesToRadians = Math.PI / 180

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * A camera offset is added to every projected point, so one NaN reaching it
 * takes the whole frame with it — including the axes, which is a blank card
 * rather than a misplaced mesh.
 */
function finite(value: number | undefined): number {
  return Number.isFinite(value) ? (value as number) : 0
}

/**
 * Interpolates the camera from looking straight down towards its resting
 * orientation. `t` of 0 is the flat map and 1 is the 3D view; the animation is
 * the values between, so the two ends need no separate code.
 */
export function meshOrientationAt(resting: MeshOrientation, t: number): MeshOrientation {
  return {
    alpha: meshTopDown.alpha + (resting.alpha - meshTopDown.alpha) * t,
    beta: meshTopDown.beta + (resting.beta - meshTopDown.beta) * t,
  }
}

/**
 * A tick interval that lands on numbers a person reads without decoding: 1, 2
 * or 5 times a power of ten, whichever gives roughly the wanted count.
 */
export function meshTickStep(span: number, wanted: number): number {
  if (!(span > 0) || wanted < 1) return 1
  const rough = span / wanted
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)))
  const normalized = rough / magnitude
  // Geometric breakpoints, so each candidate wins the interval it is closest to
  // in ratio. Splitting them at 2 and 5 instead rounds 6.25 up to 10, which is
  // what put a 250 mm bed on a 100 mm ladder and left it with three numbers.
  const step = normalized < Math.SQRT2 ? 1 : normalized < 3.162 ? 2 : normalized < 7.071 ? 5 : 10
  return step * magnitude
}

function ticksAtStep(low: number, high: number, step: number): number[] {
  const first = Math.ceil(low / step) * step
  const values: number[] = []
  for (let value = first; value <= high + step * 1e-6; value += step) {
    // Snapped, because repeated addition of 0.1 arrives at 0.30000000000000004
    // and a tick labeled that is worse than no tick at all. Adding zero
    // collapses negative zero with it, which every number formatter renders as
    // "-0" — a tick that reads as a mistake in the axis.
    values.push(Math.round(value / step) * step + 0)
  }
  return values
}

function ticksAcross(low: number, high: number, wanted: number): number[] {
  return ticksAtStep(low, high, meshTickStep(high - low, wanted))
}

/**
 * Everything needed to turn a point of the bed into a point on the card, as
 * plain numbers.
 *
 * This exists so the CPU and the GPU cannot disagree about where anything is.
 * The renderer runs this same transform in a vertex shader; the axes, the
 * probe markers, and pointer hit-testing run it here. Two independent
 * implementations of a projection drift the moment one of them is tuned, and
 * the symptom — labels a few pixels off the surface they annotate — is the
 * kind that gets explained away rather than fixed.
 */
export interface MeshCamera {
  centerX: number
  centerY: number
  longest: number
  boxHeight: number
  zMax: number
  cosAlpha: number
  sinAlpha: number
  cosBeta: number
  sinBeta: number
  projection: MeshProjection
  /**
   * The projection resolved to the numbers the per-point formula needs, so that
   * neither this function nor the vertex shader has to know a projection's
   * name. A new member of the taxonomy is a new row in `meshProjections`, not a
   * new branch in two places that then drift.
   */
  lens: MeshProjectionSpec['lens']
  /** The skewed depth axis, premultiplied by its scale. Zero when not oblique. */
  obliqueX: number
  obliqueY: number
  /** Length of the oblique view ray, and the flag that the projection is one. */
  obliqueNorm: number
  /** 1 when upright edges must stay parallel under the perspective divide. */
  uprightsParallel: number
  projectionAmount: number
  perspectiveDistance: number
  fisheyeStrength: number
  /** Scene units to CSS pixels, before zoom. */
  fit: number
  zoom: number
  offsetX: number
  offsetY: number
}

function trigFor(from: MeshOrientation) {
  // The full orbit: down to looking squarely along the bed at 0, and on
  // below it to looking straight up at -90 — nothing here singles out the
  // hemisphere above the bed as more reachable than the one below it.
  const alpha = clamp(from.alpha, -90, 90) * degreesToRadians
  const beta = from.beta * degreesToRadians
  return {
    cosAlpha: Math.cos(alpha),
    sinAlpha: Math.sin(alpha),
    cosBeta: Math.cos(beta),
    sinBeta: Math.sin(beta),
  }
}

/**
 * Projects one point with a camera. `toward` is positive towards the viewer,
 * which is both the depth the renderer sorts on and, under perspective, how
 * much nearer things are drawn larger.
 */
export function projectWithCamera(
  camera: MeshCamera,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const ux = (x - camera.centerX) / camera.longest
  const uy = -((y - camera.centerY) / camera.longest)
  const uz = (clamp(z, -camera.zMax, camera.zMax) / camera.zMax) * (camera.boxHeight / 2)
  const rotatedX = ux * camera.cosBeta - uy * camera.sinBeta
  const rotatedY = ux * camera.sinBeta + uy * camera.cosBeta
  const screenY = rotatedY * camera.sinAlpha - uz * camera.cosAlpha
  const toward = rotatedY * camera.cosAlpha + uz * camera.sinAlpha

  // Oblique is not a lens over the turned camera — it replaces it. The front
  // face is drawn true shape and depth is skewed away from it, which no amount
  // of turning produces. So the two are blended by the same amount that fades
  // every other projection in, and the flat map still morphs into it rather
  // than being cut to.
  if (camera.obliqueNorm > 0) {
    const depth = -uy
    const t = camera.projectionAmount
    const obliqueX = ux + depth * camera.obliqueX
    const obliqueY = -uz - depth * camera.obliqueY
    const obliqueToward = (ux * camera.obliqueX - depth + uz * camera.obliqueY) / camera.obliqueNorm
    return [
      rotatedX + (obliqueX - rotatedX) * t,
      screenY + (obliqueY - screenY) * t,
      toward + (obliqueToward - toward) * t,
    ]
  }

  // Measuring the divide along the ground rather than along the full view ray
  // is the entire difference between two-point and three-point perspective:
  // uprights all sit at one depth, so they all scale alike and stay parallel.
  const lensDepth = camera.uprightsParallel > 0 ? rotatedY * camera.cosAlpha : toward
  let lens = 1
  if (camera.lens === 'perspective') {
    const shrink =
      camera.perspectiveDistance / Math.max(0.2, camera.perspectiveDistance - lensDepth)
    lens = 1 + (shrink - 1) * camera.projectionAmount
  } else if (camera.lens === 'fisheye') {
    const radius = Math.hypot(rotatedX, screenY)
    const warp = 1 + camera.fisheyeStrength * radius * radius
    lens = 1 + (warp - 1) * camera.projectionAmount
  }
  // Every parallel projection shares `lens === 1`: the axonometric ones differ
  // only in which orientation they are given, never in the per-point formula.
  return [rotatedX * lens, screenY * lens, toward]
}

/** Places a projected point in CSS pixels on the card. */
export function placeWithCamera(
  camera: MeshCamera,
  x: number,
  y: number,
  z: number,
): [number, number] {
  const point = projectWithCamera(camera, x, y, z)
  return [
    point[0] * camera.fit * camera.zoom + camera.offsetX,
    point[1] * camera.fit * camera.zoom + camera.offsetY,
  ]
}

/**
 * Works out the camera for a frame: the orientation, the lens, and the scale
 * and offset that fit the bed's box into the viewport.
 */
export function meshCameraFor(input: MeshSceneInput): MeshCamera | null {
  const { bed, orientation, viewport, zMax } = input
  const bedWidth = bed.maxX - bed.minX
  const bedDepth = bed.maxY - bed.minY
  if (!(bedWidth > 0) || !(bedDepth > 0) || !(zMax > 0)) return null

  const longest = Math.max(bedWidth, bedDepth)
  const shortest = Math.min(bedWidth, bedDepth)
  const projection = input.projection ?? ('orthographic' as MeshProjection)
  const spec = meshProjections[projection] ?? meshProjections.orthographic
  const oblique = spec.oblique
  const obliqueAngle = (oblique?.angle ?? 0) * degreesToRadians
  const obliqueScale = oblique?.scale ?? 0
  const shared = {
    centerX: (bed.minX + bed.maxX) / 2,
    centerY: (bed.minY + bed.maxY) / 2,
    longest,
    boxHeight: (shortest / longest) * heightAgainstBed,
    zMax,
    projection,
    lens: spec.lens,
    obliqueX: obliqueScale * Math.cos(obliqueAngle),
    obliqueY: obliqueScale * Math.sin(obliqueAngle),
    obliqueNorm: oblique ? Math.hypot(1, obliqueScale) : 0,
    uprightsParallel: spec.uprightsStayParallel ? 1 : 0,
    projectionAmount: clamp(input.projectionAmount ?? 1, 0, 1),
    perspectiveDistance,
    fisheyeStrength,
  }

  // The fit takes the whole box, not the surfaces: a mesh that happens to be
  // flat must not be drawn larger than one that is not, or the two cannot be
  // compared, and the axes would drift as the printer is re-probed.
  //
  // It is also measured with the resting camera rather than the one being
  // drawn — see `fitOrientation`. Measured at unit scale, then solved for,
  // because the fit is what we are trying to find.
  const measuring: MeshCamera = {
    ...shared,
    ...trigFor(input.fitOrientation ?? orientation),
    fit: 1,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  }
  let minimumX = Infinity
  let maximumX = -Infinity
  let minimumY = Infinity
  let maximumY = -Infinity
  for (const cornerX of [bed.minX, bed.maxX]) {
    for (const cornerY of [bed.minY, bed.maxY]) {
      for (const cornerZ of [-zMax, zMax]) {
        const point = projectWithCamera(measuring, cornerX, cornerY, cornerZ)
        minimumX = Math.min(minimumX, point[0])
        maximumX = Math.max(maximumX, point[0])
        minimumY = Math.min(minimumY, point[1])
        maximumY = Math.max(maximumY, point[1])
      }
    }
  }
  const padding = input.padding ?? { left: 0, right: 0, top: 0, bottom: 0 }
  const usableWidth = Math.max(16, viewport.width - padding.left - padding.right)
  const usableHeight = Math.max(16, viewport.height - padding.top - padding.bottom)
  const spanX = Math.max(1e-6, maximumX - minimumX)
  const spanY = Math.max(1e-6, maximumY - minimumY)

  return {
    ...shared,
    ...trigFor(orientation),
    fit: Math.min(usableWidth / spanX, usableHeight / spanY) * viewportInset,
    // Applied after the fit and centered on the same anchor as the box itself,
    // so zooming magnifies about the mesh's own center rather than the corner
    // of the canvas — "turn in place", extended to scrolling.
    zoom: Math.max(0.1, input.zoom ?? 1),
    // The box is symmetric about its own center, so its projection is centered
    // on the scene origin at every orientation. Anchoring there rather than on
    // the measured bounding box is the other half of turning in place: a
    // bounding box that changes shape as the box turns also moves its middle.
    offsetX: padding.left + usableWidth / 2 + finite(input.pan?.x),
    offsetY: padding.top + usableHeight / 2 + finite(input.pan?.y),
  }
}

export function buildMeshScene(input: MeshSceneInput): MeshScene | null {
  const { bed, zMax } = input
  const camera = meshCameraFor(input)
  if (!camera) return null

  const toScene = (x: number, y: number, z: number): [number, number, number] =>
    projectWithCamera(camera, x, y, z)
  const fit = camera.fit
  const zoom = camera.zoom
  const offsetX = camera.offsetX
  const offsetY = camera.offsetY

  const place = (x: number, y: number, z: number): [number, number] => {
    const point = toScene(x, y, z)
    return [point[0] * fit * zoom + offsetX, point[1] * fit * zoom + offsetY]
  }
  const depthAt = (x: number, y: number, z: number): number => toScene(x, y, z)[2]

  const quads: MeshQuad[] = []
  const wireframe: Array<readonly (readonly [number, number])[]> = []
  for (const layer of input.layers) {
    const rows = layer.matrix.length
    const columns = layer.matrix[0]?.length ?? 0
    if (rows < 2 || columns < 2) continue
    const stepX = (layer.area.maxX - layer.area.minX) / (columns - 1)
    const stepY = (layer.area.maxY - layer.area.minY) / (rows - 1)

    // Every grid point projected exactly once, then shared by the four quads
    // that meet on it and by both wireframe polylines through it. Projecting
    // per quad corner instead repeated the same arithmetic four times over,
    // and separately again for depth — eight projections per point where one
    // will do.
    const screen: [number, number][][] = []
    const depths: number[][] = []
    for (let row = 0; row < rows; row += 1) {
      const screenRow: [number, number][] = []
      const depthRow: number[] = []
      const y = layer.area.minY + row * stepY
      for (let column = 0; column < columns; column += 1) {
        const value = layer.matrix[row]?.[column] ?? 0
        const point = toScene(layer.area.minX + column * stepX, y, value)
        screenRow.push([point[0] * fit * zoom + offsetX, point[1] * fit * zoom + offsetY])
        depthRow.push(point[2])
      }
      screen.push(screenRow)
      depths.push(depthRow)
    }

    for (let row = 0; row < rows - 1; row += 1) {
      for (let column = 0; column < columns - 1; column += 1) {
        const nearLeft = screen[row]?.[column]
        const nearRight = screen[row]?.[column + 1]
        const farRight = screen[row + 1]?.[column + 1]
        const farLeft = screen[row + 1]?.[column]
        if (!nearLeft || !nearRight || !farRight || !farLeft) continue
        quads.push({
          points: [nearLeft, nearRight, farRight, farLeft],
          deviation:
            ((layer.matrix[row]?.[column] ?? 0) +
              (layer.matrix[row]?.[column + 1] ?? 0) +
              (layer.matrix[row + 1]?.[column + 1] ?? 0) +
              (layer.matrix[row + 1]?.[column] ?? 0)) /
            4,
          depth:
            ((depths[row]?.[column] ?? 0) +
              (depths[row]?.[column + 1] ?? 0) +
              (depths[row + 1]?.[column + 1] ?? 0) +
              (depths[row + 1]?.[column] ?? 0)) /
            4,
          cornerDepths: [
            depths[row]?.[column] ?? 0,
            depths[row]?.[column + 1] ?? 0,
            depths[row + 1]?.[column + 1] ?? 0,
            depths[row + 1]?.[column] ?? 0,
          ],
          opacity: layer.opacity,
          neutral: layer.neutral ?? false,
          invertRamp: layer.invertRamp ?? false,
        })
      }
    }

    // The wireframe is a grid, so it is emitted as one polyline per row and
    // per column rather than as an outline around every cell. Outlining each
    // cell draws every interior edge twice and hands the renderer thousands of
    // separate subpaths; the same grid is a hundred or so polylines, which is
    // what took a 45x53 mesh from twenty-four milliseconds a frame to under
    // ten. The reference plane is excluded: its own grid says nothing, and
    // drawing it would only add lines over the surface it sits behind.
    if (!(layer.neutral ?? false)) {
      for (const line of screen) wireframe.push(line)
      for (let column = 0; column < columns; column += 1) {
        wireframe.push(screen.map((line) => line[column] as [number, number]))
      }
    }
  }
  // Painter's order across every layer at once, so the flat reference plane is
  // correctly buried where the bed rises through it rather than always sitting
  // in front of or behind the whole surface.
  quads.sort((first, second) => first.depth - second.depth)

  // X and Y share one ladder rather than each choosing its own step. A bed
  // that is not square has a longer and a shorter side, and rounding each
  // span to "about 4 ticks" independently picked 100 mm for the long side and
  // 50 mm for the short one — so the short axis read finer than the long one
  // for no reason a viewer could see on the bed itself. The finer of the two
  // wins for both, since a floor grid coarser than what the shorter axis
  // already earns would erase ticks that were otherwise legible.
  const groundStep = Math.min(
    meshTickStep(bed.maxX - bed.minX, 4),
    meshTickStep(bed.maxY - bed.minY, 4),
  )
  const xValues = ticksAtStep(bed.minX, bed.maxX, groundStep)
  const yValues = ticksAtStep(bed.minY, bed.maxY, groundStep)
  const zValues = ticksAcross(-zMax, zMax, 4)

  // The labeled edges are the ones at the front of the box for this camera, so
  // turning the bed moves the numbers to whichever side is legible.
  const nearY = depthAt(bed.minX, bed.minY, -zMax) > depthAt(bed.minX, bed.maxY, -zMax)
  const nearX = depthAt(bed.minX, bed.minY, -zMax) > depthAt(bed.maxX, bed.minY, -zMax)
  const xEdgeY = nearY ? bed.minY : bed.maxY
  const yEdgeX = nearX ? bed.minX : bed.maxX
  // The height axis goes on whichever upright corner projects furthest to the
  // left, and its numbers are written outside it. Choosing a corner by which
  // way the bed faces instead put the axis behind the surface at half the
  // angles, where the mesh covered its own scale.
  const uprights: Array<[number, number]> = [
    [bed.minX, bed.minY],
    [bed.maxX, bed.minY],
    [bed.maxX, bed.maxY],
    [bed.minX, bed.maxY],
  ]
  const zEdge = uprights.reduce((leftmost, corner) =>
    place(corner[0], corner[1], -zMax)[0] < place(leftmost[0], leftmost[1], -zMax)[0]
      ? corner
      : leftmost,
  )

  // Bed coordinates, in pairs, one pair per segment. The renderer depth-tests
  // these against the surface, so they are handed over unprojected rather than
  // flattened to the screen here — the shader places them exactly as `place`
  // would, and the surface then hides whichever part is genuinely behind it.
  const guides: [number, number, number][] = []
  const wall = (from: [number, number, number], to: [number, number, number]): void => {
    guides.push(from, to)
  }
  // The floor, then the two walls behind the bed. Drawing all four would put a
  // grid in front of the surface.
  const farY = nearY ? bed.maxY : bed.minY
  const farX = nearX ? bed.maxX : bed.minX
  for (const x of xValues) {
    wall([x, bed.minY, -zMax], [x, bed.maxY, -zMax])
    wall([x, farY, -zMax], [x, farY, zMax])
  }
  for (const y of yValues) {
    wall([bed.minX, y, -zMax], [bed.maxX, y, -zMax])
    wall([farX, y, -zMax], [farX, y, zMax])
  }
  for (const z of zValues) {
    wall([bed.minX, farY, z], [bed.maxX, farY, z])
    wall([farX, bed.minY, z], [farX, bed.maxY, z])
  }
  // The height axis itself, so its numbers have an edge to be read against even
  // when the corner they sit on is not one of the two the walls are drawn from.
  wall([zEdge[0], zEdge[1], -zMax], [zEdge[0], zEdge[1], zMax])

  return {
    quads,
    wireframe,
    guides,
    camera,
    xTicks: xValues.map((value) => ({ value, at: place(value, xEdgeY, -zMax) })),
    yTicks: yValues.map((value) => ({ value, at: place(yEdgeX, value, -zMax) })),
    zTicks: zValues.map((value) => ({ value, at: place(zEdge[0], zEdge[1], value) })),
    xLabelAt: place((bed.minX + bed.maxX) / 2, xEdgeY, -zMax),
    yLabelAt: place(yEdgeX, (bed.minY + bed.maxY) / 2, -zMax),
    place,
    depthAt,
  }
}

function signedArea(a: [number, number], b: [number, number], c: [number, number]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])
}

/**
 * The screen-space depth a triangle's own three corners interpolate to at
 * `p`, or `null` when `p` falls outside it — the exact barycentric
 * interpolation a GPU rasterizer performs, not an approximation of it. That
 * equivalence is what makes it trustworthy here: this camera's vertex
 * shader sets every vertex's clip-space `w` to 1, which turns off
 * perspective-correct interpolation and leaves the rasterizer doing the
 * same plain, affine, screen-space interpolation this does. A quad's four
 * corners averaged into one depth is not that — it is one number standing
 * in for a whole cell, and comparing a marker against it rather than
 * against the true depth at the marker's own screen position is exactly
 * what let a cell average a slope's higher neighbors into "in front of"
 * a marker nowhere near being covered by anything.
 */
function triangleDepthAt(
  p: [number, number],
  a: [number, number],
  b: [number, number],
  c: [number, number],
  depthA: number,
  depthB: number,
  depthC: number,
): number | null {
  const denom = signedArea(a, b, c)
  if (denom === 0) return null
  const weightA = signedArea(p, b, c) / denom
  const weightB = signedArea(p, c, a) / denom
  const weightC = 1 - weightA - weightB
  // A hair of tolerance for a point that lands exactly on a shared edge —
  // its own probe's corner, most often — rather than missing both
  // neighboring triangles by a rounding error.
  const edge = -1e-9
  if (weightA < edge || weightB < edge || weightC < edge) return null
  return weightA * depthA + weightB * depthB + weightC * depthC
}

/**
 * Whether the scene's own surfaces hide a point behind them — the question
 * an overlay drawn on a second canvas cannot otherwise answer. The GPU
 * resolves this per pixel with a real depth buffer for the surfaces it
 * draws; this reproduces that same per-pixel answer on the CPU for a probe
 * marker or its number, rather than approximating it from one quad's
 * averaged depth — see `triangleDepthAt`.
 */
export function sceneOccludes(scene: MeshScene, x: number, y: number, depth: number): boolean {
  const p: [number, number] = [x, y]
  // A rounding margin only, not a heuristic one: `triangleDepthAt` gives the
  // exact depth the GPU would compute, so the marker's own containing
  // triangle already returns (very nearly) its own depth back rather than
  // needing a margin to be told apart from a real occluder.
  const tolerance = 1e-6
  for (const quad of scene.quads) {
    // The level plane and the flat map's own mosaic stand in for no reading
    // of their own — they take the neutral color precisely because they are
    // not data — so a marker for a reading that is genuinely there hides
    // behind an actual surface, never behind the reference drawn beside it.
    if (quad.neutral) continue
    // `points` is typed as a plain array because it is built one push at a
    // time — see the loop in `buildMeshScene` — but every quad this loop ever
    // produces has exactly four corners.
    const [a, b, c, d] = quad.points as readonly [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ]
    const [depthA, depthB, depthC, depthD] = quad.cornerDepths
    const hit =
      triangleDepthAt(p, a, b, c, depthA, depthB, depthC) ??
      triangleDepthAt(p, a, c, d, depthA, depthC, depthD)
    if (hit !== null && hit > depth + tolerance) return true
  }
  return false
}
