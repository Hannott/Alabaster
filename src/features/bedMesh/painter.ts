/**
 * Draws the bed mesh height map onto a 2D canvas.
 *
 * Colors and the font family arrive already resolved from the theme, because
 * a paint routine that reads CSS variables would re-read them on every frame
 * of the transition and would tie this file to a document. The card resolves
 * them once and again when the theme or the typeface changes. The font family
 * in particular has to arrive resolved rather than as `var(--font-mono)`: a
 * canvas font string cannot read a custom property at all, so passing the raw
 * reference through would leave the axis numbers on the browser's default
 * font regardless of what the card resolved.
 */

import { buildMeshScene, sceneOccludes, type MeshScene, type MeshSceneInput } from './scene'
import { meshScalePosition, type MeshScale } from './scale'

export type MeshRgb = readonly [number, number, number]

export interface MeshPalette {
  /** The very bottom of the scale: the deepest fraction of the bed's lowest valley. */
  lowDeep: MeshRgb
  /** A valley that is not the deepest — most of the negative half of the scale. */
  low: MeshRgb
  /** The middle of the scale, where the bed is on plane. */
  middle: MeshRgb
  /** A peak that is not the highest — most of the positive half of the scale. */
  high: MeshRgb
  /** The very top of the scale: the highest fraction of the bed's tallest peak. */
  highDeep: MeshRgb
  /**
   * The level reference plane. Deliberately a neutral, off-ramp grey rather
   * than a chromatic hue: once the plane's own geometry is subdivided finely
   * enough to depth-test correctly against the mesh (see `flatPlaneGrid` in
   * `BedMeshModule.vue`), the only place it still shows inside the mesh's own
   * footprint is a genuine dip below it — and a bright color there reads as
   * a defect, where a quiet grey close to the ramp's own near-white middle
   * reads as the reference plane it actually is.
   */
  plane: MeshRgb
  /** The probed markers. */
  line: MeshRgb
  /** The box, the axes, and the probed numbers. */
  guide: MeshRgb
}

export interface MeshProbeMarker {
  x: number
  y: number
  deviation: number
  label: string
}

export interface MeshPaintOptions extends MeshSceneInput {
  /** 0 is the flat heat map, 1 is the tilted surface. */
  t: number
  /** The range the gradient covers. Color only — it never reshapes the bed. */
  scale: MeshScale
  palette: MeshPalette
  /** Resolved from `--font-mono`, not the raw `var(...)` reference — see the file header. */
  fontFamily: string
  probes: readonly MeshProbeMarker[]
  showProbes: boolean
  /**
   * Skips the density fallback that drops a probed point's number for a dot
   * once the mesh is too dense for its labels to fit without overlapping —
   * see `spacingFitsLabels`. The dashboard card is narrow enough that the
   * fallback is the point of it; the Calibration page's much larger stage
   * opts in here instead, since a mesh that fits its labels there almost
   * always would, and the page exists specifically to read those numbers.
   */
  forceProbeLabels: boolean
  wireframe: boolean
  /** Axis names and the unit, localized by the card. */
  axisLabels: { x: string; y: string; z: string }
  /** Formats a tick. The card owns the locale, so this file never guesses one. */
  formatTick: (value: number, axis: 'x' | 'y' | 'z') => string
}

/** Where the box and the axes have finished fading in. */
const guideFadeStart = 0.3
/** Where the probed numbers have finished fading out. */
const labelFadeEnd = 0.4

function mix(from: MeshRgb, to: MeshRgb, amount: number): MeshRgb {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ]
}

function css(color: MeshRgb, alpha = 1): string {
  return `rgba(${Math.round(color[0])}, ${Math.round(color[1])}, ${Math.round(color[2])}, ${alpha})`
}

/**
 * The diverging ramp: one hue below the middle of the scale, a neutral at it,
 * another hue above. Color is never the only channel — the legend labels both
 * ends with their value, the axes carry numbers, and the card states the
 * lowest, highest and range in text.
 *
 * Five stops, not three. A straight lerp from a saturated color to white
 * spends much of its travel looking pale rather than white-to-color in equal
 * steps — white is a hard background to read a gradient away from, so a wide
 * band either side of the plane reads as "washed out" rather than "near
 * level." Reaching a fully saturated `low`/`high` at the *midpoint* of each
 * half, then continuing on to a deeper shade at the true extreme, gets real
 * color onto the surface sooner and leaves the pale band only immediately
 * around the plane, where "washed out" and "near level" are the same thing.
 */
export function meshRampColor(
  deviation: number,
  scale: MeshScale,
  palette: MeshPalette,
  /** Reads the ramp from the opposite end — see `MeshLayer.invertRamp`. */
  invert = false,
): MeshRgb {
  const raw = meshScalePosition(deviation, scale)
  const position = invert ? -raw : raw
  if (position < -0.5) return mix(palette.low, palette.lowDeep, (-position - 0.5) / 0.5)
  if (position < 0) return mix(palette.middle, palette.low, -position / 0.5)
  if (position < 0.5) return mix(palette.middle, palette.high, position / 0.5)
  return mix(palette.high, palette.highDeep, (position - 0.5) / 0.5)
}

/**
 * Draws everything the GPU cannot: the axis numbers, the axis names, and the
 * probed markers.
 *
 * The surfaces, their wireframes and the box grid are drawn by
 * `MeshGlRenderer` on a canvas underneath this one. Text is the one thing
 * WebGL has no answer for without shipping a glyph atlas, and the probed
 * markers ride along with it because they are annotations over the picture
 * rather than part of it.
 */
export function paintMeshOverlay(
  context: CanvasRenderingContext2D,
  options: MeshPaintOptions,
): void {
  const { viewport, t } = options
  context.clearRect(0, 0, viewport.width, viewport.height)
  // The real layers, not `[]`: a probe marker's own occlusion test reads
  // `scene.quads`, and an empty scene has none to hide anything behind.
  const scene = buildMeshScene(options)
  if (!scene) return

  context.font = `600 9px ${options.fontFamily}`
  context.textAlign = 'center'
  context.textBaseline = 'middle'

  const guideAlpha = Math.max(0, (t - guideFadeStart) / (1 - guideFadeStart))
  if (guideAlpha > 0.01) paintAxisLabels(context, scene, options, guideAlpha)

  if (options.showProbes && options.probes.length > 0) paintProbes(context, scene, options)
}

function paintAxisLabels(
  context: CanvasRenderingContext2D,
  scene: MeshScene,
  options: MeshPaintOptions,
  alpha: number,
): void {
  const { palette } = options
  context.fillStyle = css(palette.guide, alpha * 0.85)
  for (const tick of scene.xTicks) {
    context.fillText(options.formatTick(tick.value, 'x'), tick.at[0], tick.at[1] + 8)
  }
  for (const tick of scene.yTicks) {
    context.fillText(options.formatTick(tick.value, 'y'), tick.at[0], tick.at[1] + 8)
  }
  // Outside the axis, on the far side from the box, so the surface cannot cover
  // its own scale.
  context.textAlign = 'right'
  for (const tick of scene.zTicks) {
    context.fillText(options.formatTick(tick.value, 'z'), tick.at[0] - 5, tick.at[1])
  }
  context.textAlign = 'center'

  // The axis names sit outside their tick ladder, so a reader knows which
  // direction the numbers count without hunting for the origin.
  context.font = `700 9px ${options.fontFamily}`
  context.fillText(options.axisLabels.x, scene.xLabelAt[0], scene.xLabelAt[1] + 19)
  context.fillText(options.axisLabels.y, scene.yLabelAt[0], scene.yLabelAt[1] + 19)
  context.font = `600 9px ${options.fontFamily}`
}

function paintProbes(
  context: CanvasRenderingContext2D,
  scene: MeshScene,
  options: MeshPaintOptions,
): void {
  const { palette, scale, t } = options

  // Probed points travel with the surface. Their numbers are legible looking
  // straight down and illegible the moment anything is tilted, so the marker
  // stays and the number goes — that tilt fade applies regardless of
  // `forceProbeLabels`, which only ever overrides the *density* fallback
  // below it, never this one.
  //
  // On a card too narrow to hold the labels apart they never appear at all —
  // a dense mesh in a dashboard column would otherwise overprint a hundred
  // and eighty numbers into a smear, which is the reading problem this map
  // was rebuilt to solve rather than to reprint at a smaller size.
  // `forceProbeLabels` skips this fallback for a caller whose stage is
  // generously sized enough that it would essentially never trigger anyway.
  const labelAlpha =
    options.forceProbeLabels || spacingFitsLabels(context, scene, options)
      ? Math.max(0, 1 - t / labelFadeEnd)
      : 0

  for (const probe of options.probes) {
    const [x, y] = scene.place(probe.x, probe.y, probe.deviation)
    // The overlay is a second canvas with no depth buffer of its own, so a
    // number for a point genuinely behind a nearer part of the surface has
    // to be told to hide — nothing else here would stop it drawing on top.
    // The dot beside it has no such problem: it is a marker naming a value,
    // not a reading that could be mistaken for the surface itself.
    if (
      labelAlpha > 0.02 &&
      !sceneOccludes(scene, x, y, scene.depthAt(probe.x, probe.y, probe.deviation))
    ) {
      // Against a ramp running from a dark blue through a near-white to a deep
      // red, one ink color is unreadable at one end or the other. Each number
      // takes the ink its own patch of surface can carry.
      const beneath = meshRampColor(probe.deviation, scale, palette)
      const luminance = (beneath[0] * 0.299 + beneath[1] * 0.587 + beneath[2] * 0.114) / 255
      context.fillStyle = css(luminance > 0.55 ? [0, 0, 0] : [255, 255, 255], labelAlpha)
      context.fillText(probe.label, x, y)
    }
    if (labelAlpha < 1) {
      context.fillStyle = css(palette.line, (1 - labelAlpha) * 0.85)
      context.beginPath()
      context.arc(x, y, 1.4, 0, Math.PI * 2)
      context.fill()
    }
  }
}

function spacingFitsLabels(
  context: CanvasRenderingContext2D,
  scene: MeshScene,
  options: MeshPaintOptions,
): boolean {
  const [first, second] = options.probes
  if (!first || !second) return false
  const a = scene.place(first.x, first.y, 0)
  const b = scene.place(second.x, second.y, 0)
  const spacing = Math.hypot(b[0] - a[0], b[1] - a[1])
  return spacing >= context.measureText(first.label).width + 4
}

/**
 * The probed point nearest a pointer, so the card can say what is under it.
 * A dashboard card has no room for a floating tooltip, and one would be
 * unreachable by keyboard and on touch; the card reads the value out in a line
 * of its own instead.
 */
export function nearestMeshProbe(
  scene: MeshScene,
  probes: readonly MeshProbeMarker[],
  x: number,
  y: number,
  within: number,
): MeshProbeMarker | null {
  let best: MeshProbeMarker | null = null
  let bestDistance = within
  for (const probe of probes) {
    const [px, py] = scene.place(probe.x, probe.y, probe.deviation)
    const distance = Math.hypot(px - x, py - y)
    if (distance < bestDistance) {
      bestDistance = distance
      best = probe
    }
  }
  return best
}

export { buildMeshScene }
