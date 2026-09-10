/**
 * The one surface the G-code viewer's page is allowed to see.
 *
 * Everything above this line — the view, its overlay, planned playback,
 * simulation — is written against `GcodeSceneRenderer` and knows nothing about
 * which library draws the toolpath. Everything below it lives in `vendor/`.
 * That is the whole point of the seam: replacing the renderer a second time
 * should be a job with a finite checklist rather than a rewrite of the page,
 * and ADR 0011 records why the first replacement was not.
 *
 * Two rules keep the seam real, and `__tests__/architecture.spec.ts` fails the
 * build when either is broken:
 *
 * - the library is imported statically only inside `vendor/`, so the route
 *   chunk carries it and no other page pays for it;
 * - the factory below is the only way to get a renderer, so a component can
 *   never reach past the interface for one more method.
 */

import type { GcodeBounds, GcodeColorMode } from '@/features/gcode/types'

/**
 * The library's render-quality ladder, which is the reason Alabaster adopted
 * it: each tier is a vertex budget the library meets by choosing a cheaper
 * representation and drawing fewer of them, so there is a rung low enough for
 * a machine with no discrete GPU. Tier 1 is its "single-board computer" rung
 * (25,000 vertices, travels off); tier 5 draws everything.
 *
 * Tier 6 exists in the library and is deliberately never offered: it forces
 * solid 3D blocks with no decimation at any file size, which is the setting
 * most likely to end a session in a dead tab.
 */
export type GcodeRenderTier = 1 | 2 | 3 | 4 | 5

/** Every colour the library is allowed to paint, as `#rrggbb`. */
export interface GcodeSceneColors {
  background: string
  bed: string
  /** Painted at the frontier while a print or simulation reveals geometry. */
  progress: string
  feedSlow: string
  feedFast: string
  /**
   * One entry per extruder, in tool order. The library indexes tools by the
   * file's `T` number and would throw on a file that selects a tool it has no
   * colour for, so this is never empty.
   */
  tools: readonly string[]
}

export interface GcodeSceneOptions {
  colors: GcodeSceneColors
  tier: GcodeRenderTier
  /** Device-pixel-ratio cap; the governor's live lever. */
  resolutionScale: number
  /** Fallback bead width for moves that declare no extruded volume. */
  nozzleDiameter: number
  bedBounds: GcodeBounds | null
  delta: boolean
  /**
   * Called once per frame the scene actually drew, with the interval since the
   * previous one. Idle frames never call it, which is what the quality
   * governor needs: an idle frame looks infinitely fast.
   */
  onFrame?: ((intervalMilliseconds: number) => void) | undefined
}

export interface GcodeSceneLoadOptions {
  /** Fractional parse progress, 0 to 1. */
  onProgress?: ((fraction: number) => void) | undefined
}

export class GcodeSceneUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('The G-code scene renderer could not be created')
    this.name = 'GcodeSceneUnavailableError'
    this.cause = cause
  }
}

export interface GcodeSceneRenderer {
  /**
   * True when the previous parse in this browser never reached its end — the
   * shape a tab that ran out of memory leaves behind. The renderer has already
   * dropped to the cheapest tier by the time anyone reads this; it is here so
   * the page can say why rather than looking mysteriously coarse.
   */
  readonly recoveredFromFailedLoad: boolean
  readonly tier: GcodeRenderTier
  /**
   * False at the two cheapest tiers, where the library builds no travel
   * geometry at all. The travels control renders as unavailable-with-reason
   * rather than as a toggle that does nothing.
   */
  readonly travelsAvailable: boolean

  load(text: string, options?: GcodeSceneLoadOptions): Promise<void>
  cancelLoad(): void
  clear(): void
  /** The canvas the scene draws on, created and owned by the renderer. */
  readonly canvas: HTMLCanvasElement

  /**
   * The byte offset up to which geometry is drawn, or null for the whole file.
   * Live follow, simulation and the transport scrubber all end here, which is
   * what keeps one definition of "printed so far" across the three of them.
   */
  setProgressBytes(bytes: number | null): void
  /**
   * False is ADR 0007's reveal rule: nothing ahead of the cursor is drawn.
   * True releases it, which is what showing a whole file means.
   */
  setRevealAhead(reveal: boolean): void
  /**
   * The visible band's boundaries in millimetres of printer Z, and null to end
   * the band at the model. These are boundaries *between* layers rather than
   * layer heights: a layer's geometry is a slab centred on its height, so a
   * plane at the height itself would cut the layer in half.
   */
  setLayerRange(bottomHeight: number | null, topHeight: number | null): void
  setTravels(visible: boolean): void
  /** Reparses the file: the library builds colour into its geometry. */
  setColorMode(mode: GcodeColorMode): Promise<void>
  /** In mm/min, matching the parser's stored units. */
  setFeedrateRange(minimum: number, maximum: number): void
  /** Reparses the file at a new vertex budget. */
  setTier(tier: GcodeRenderTier): Promise<void>
  setResolutionScale(scale: number): void
  applyColors(colors: GcodeSceneColors): void
  setBedBounds(bounds: GcodeBounds | null, delta: boolean): void

  /**
   * The colour the library painted a feature, found by trying the labels the
   * slicers use for it. Null when this file's slicer names it something the
   * table does not carry, which is the case the legend has to omit rather than
   * guess at. See ADR 0011 on why feature colour is not a theme token.
   */
  featureColor(labels: readonly string[]): string | null

  resetCamera(): void
  frameBounds(bounds: GcodeBounds): void
  orbitBy(deltaX: number, deltaY: number): void
  panBy(deltaX: number, deltaY: number): void
  zoomBy(factor: number): void
  /** Camera position in printer coordinates, for the overlay's face culling. */
  cameraPosition(): [number, number, number]
  /**
   * A printer-space point in CSS pixels of the canvas, or null when it is
   * behind the camera. The overlay nozzle is drawn from this.
   */
  project(point: readonly [number, number, number]): [number, number] | null
  screenshot(): string | null
  resize(): void
  dispose(): void
}

/**
 * The only way to get a renderer. Dynamically imports the adapter so the
 * library is in the viewer route's chunk and nowhere else — the weight
 * argument in ADR 0001 is about what the route costs, and this is what keeps
 * that true.
 *
 * Takes the element the scene should live in rather than a canvas, because the
 * canvas is the adapter's to own: the library can only ever hold one live
 * instance per page, so the adapter keeps one engine and moves its canvas from
 * one mount to the next. `dispose` therefore means "let go of this file and
 * detach", not "tear the engine down" — ADR 0011 records why, and what it
 * costs.
 */
export async function createGcodeSceneRenderer(
  host: HTMLElement,
  options: GcodeSceneOptions,
): Promise<GcodeSceneRenderer> {
  const module = await import('@/features/gcode/vendor/libraryRenderer')
  return module.createLibraryGcodeRenderer(host, options)
}
