/**
 * The one file that talks to `@sindarius/gcodeviewer`.
 *
 * Everything here exists to make an untyped, opinionated library behave like
 * the narrow contract in `../scene.ts`. Three of its habits need active
 * containment, and each is a comment below rather than a line of code to
 * puzzle over later:
 *
 * - **It persists its own settings.** The library reads `renderQuality`,
 *   `cameraInertia`, `sceneBackgroundColor`, `progressColor`, `bedColor`,
 *   `buildVolume`, `renderBedMode` and seven processor keys straight out of
 *   `localStorage`, in its constructor and again in places like
 *   `getBackgroundColor()`. Alabaster owns its own settings, so the fix is not
 *   to read those keys but to write every one of them explicitly at creation:
 *   the library never sees a value we did not just set, and what is left in
 *   storage from a previous session cannot decide anything.
 * - **Colour is baked into geometry.** Feature and feed-rate colours are
 *   chosen while the file is parsed, so changing colour mode is a reparse, not
 *   a uniform. `setColorMode` and `setTier` are async for that reason.
 * - **It has no `dispose()`.** The engine, scene, meshes and the file text
 *   would outlive the page. Disposal is this adapter's job, on every unmount.
 *
 * Printer coordinates are (X, Y, Z) with Z up. The library's scene is
 * Babylon's Y-up, so a printer point (x, y, z) is the world point (x, z, y).
 * Every conversion in this file goes through that one sentence; nothing above
 * the seam needs to know it.
 */

// The library ships no types; `./gcodeviewer.d.ts` declares the surface this
// file uses. `tsconfig.node.json` lists that file explicitly, the way it lists
// `src/env.d.ts`, because that project includes specs and whatever they import
// rather than `vendor/` — without it the test project cannot resolve the module.
import GCodeViewer, { ColorMode } from '@sindarius/gcodeviewer'

import type {
  GcodeRenderTier,
  GcodeSceneColors,
  GcodeSceneLoadOptions,
  GcodeSceneOptions,
  GcodeSceneRenderer,
} from '@/features/gcode/scene'
import { GcodeSceneUnavailableError } from '@/features/gcode/scene'
import type { GcodeBounds, GcodeColorMode } from '@/features/gcode/types'

/**
 * Far enough outside any real build volume to mean "no limit", and small
 * enough to stay exact in a float. The library subtracts and negates these
 * before handing them to a clip plane, so a genuine infinity would poison the
 * plane equation.
 */
const unclampedHeight = 1_000_000

const colorModeValues: Record<GcodeColorMode, number> = {
  single: ColorMode.Color,
  feedrate: ColorMode.Feed,
  feature: ColorMode.Feature,
}

/**
 * Share of the camera distance one wheel notch zooms by. Babylon multiplies
 * this by a hundredth of the wheel delta, which is 100 for a notch on most
 * mice, so the share is per notch as written.
 */
const zoomStepShare = 0.05

/** The two cheapest tiers build no travel geometry, whatever the toggle says. */
function tierDrawsTravels(tier: GcodeRenderTier): boolean {
  return tier >= 3
}

function boundsCenter(bounds: GcodeBounds): [number, number, number] {
  return [
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    (bounds.minZ + bounds.maxZ) / 2,
  ]
}

function boundsRadius(bounds: GcodeBounds): number {
  const spanX = bounds.maxX - bounds.minX
  const spanY = bounds.maxY - bounds.minY
  const spanZ = bounds.maxZ - bounds.minZ
  return Math.max(10, Math.hypot(spanX, spanY, spanZ))
}

class LibraryGcodeRenderer implements GcodeSceneRenderer {
  readonly recoveredFromFailedLoad: boolean
  private currentTier: GcodeRenderTier
  private travelsVisible = false
  private revealAhead = true
  private progressBytes: number | null = null
  private layerBottom: number | null = null
  private layerTop: number | null = null
  private loadedText = false
  private disposed = false
  private lastFrameTimestamp = 0
  private readonly frameObserver: (() => void) | null = null
  private readonly panningTuner: () => void

  constructor(
    private readonly viewer: GCodeViewer,
    readonly canvas: HTMLCanvasElement,
    private readonly options: GcodeSceneOptions,
    recoveredFromFailedLoad: boolean,
  ) {
    this.currentTier = options.tier
    this.recoveredFromFailedLoad = recoveredFromFailedLoad
    const onFrame = options.onFrame
    if (onFrame) {
      // Only frames the scene actually drew reach the governor. The library's
      // render loop skips frames while nothing moves, so an idle frame never
      // arrives here at all — which is exactly the sampling rule the governor
      // needs, since an idle frame looks infinitely fast.
      this.frameObserver = () => {
        const now = performance.now()
        if (this.lastFrameTimestamp > 0) onFrame(now - this.lastFrameTimestamp)
        this.lastFrameTimestamp = now
      }
      this.viewer.scene.onAfterRenderObservable.add(this.frameObserver)
    }
    /*
     * Make a pan follow the pointer.
     *
     * Babylon moves the camera's target by a fixed number of millimetres per
     * pixel dragged, whatever the distance — the library's value is half a
     * millimetre — so a drag overshot the pointer from a distance and lagged
     * behind it up close. The number of pixels one millimetre covers at the
     * target's depth is known from the radius and the field of view, and it is
     * cheap enough to re-derive on every frame, which is when the radius
     * changes.
     */
    this.panningTuner = () => {
      const camera = this.viewer.scene.activeCamera
      if (!camera) return
      const heightPixels = this.canvas.clientHeight || 1
      const heightMillimetres = 2 * camera.radius * Math.tan(camera.fov / 2)
      camera.panningSensibility = heightPixels / heightMillimetres
    }
    this.viewer.scene.onBeforeRenderObservable.add(this.panningTuner)
  }

  get tier(): GcodeRenderTier {
    return this.currentTier
  }

  get travelsAvailable(): boolean {
    return tierDrawsTravels(this.currentTier)
  }

  async load(text: string, loadOptions: GcodeSceneLoadOptions = {}): Promise<void> {
    if (this.disposed) return
    const processor = this.viewer.gcodeProcessor
    processor.cancelLoad = false
    processor.loadingProgressCallback = loadOptions.onProgress
      ? (fraction: number) => loadOptions.onProgress?.(fraction)
      : null
    try {
      await this.viewer.processFile(text)
      this.loadedText = true
    } finally {
      processor.loadingProgressCallback = null
    }
    if (this.disposed) return
    // Every per-file setting is re-applied after a parse: the library rebuilds
    // its meshes from scratch, so travel visibility and the clip planes do not
    // survive one. Progress last, because it decides what is drawn at all.
    this.applyTravels()
    this.applyLayerRange()
    this.applyReveal()
    this.applyProgress()
    this.wake()
  }

  /**
   * Gets the idle render loop drawing again.
   *
   * The library skips frames once the camera has been still for a second, and
   * only its own setters render on their own. Two things that change what a
   * frame shows do not: the frontier position and the reveal flag are read by
   * the meshes' materials on the next frame, and a freshly built mesh spends
   * its first frame compiling its shader rather than drawing. A single forced
   * frame therefore showed an empty bed after a load until the camera moved.
   * `doUpdate` is the library's own wake-up call — the processor's last-update
   * stamp the render loop checks — and buys a second of frames, which is
   * enough for the compile and for every material to catch up.
   */
  private wake(): void {
    if (this.disposed) return
    this.viewer.gcodeProcessor.doUpdate()
    this.viewer.forceRender()
  }

  cancelLoad(): void {
    this.viewer.gcodeProcessor.cancelLoad = true
  }

  clear(): void {
    if (this.disposed) return
    this.loadedText = false
    this.viewer.clearScene(true)
    this.progressBytes = null
    this.layerBottom = null
    this.layerTop = null
  }

  setProgressBytes(bytes: number | null): void {
    this.progressBytes = bytes
    this.applyProgress()
  }

  private applyProgress(): void {
    if (this.disposed) return
    // A null cursor means "the whole file", which the library expresses as a
    // frontier past the last byte rather than as a mode of its own.
    const bytes = this.progressBytes ?? Number.MAX_SAFE_INTEGER
    this.viewer.gcodeProcessor.updateFilePosition(bytes)
    this.wake()
  }

  setRevealAhead(reveal: boolean): void {
    this.revealAhead = reveal
    this.applyReveal()
  }

  private applyReveal(): void {
    if (this.disposed) return
    // `liveTracking` is the library's name for "do not draw past the
    // frontier", which is ADR 0007's reveal rule. Its own look-ahead window
    // would draw a few moves the printer has not made yet, so it is zero.
    this.viewer.gcodeProcessor.lookAheadLength = 0
    this.viewer.gcodeProcessor.setLiveTracking(!this.revealAhead)
    this.wake()
  }

  setLayerRange(bottomHeight: number | null, topHeight: number | null): void {
    this.layerBottom = bottomHeight
    this.layerTop = topHeight
    this.applyLayerRange()
  }

  private applyLayerRange(): void {
    if (this.disposed) return
    // The library clips on the scene's vertical axis, which is printer Z, so
    // these are heights in millimetres and need no conversion. The caller
    // hands over the boundaries between layers; a hair of air on each side
    // keeps a face lying exactly on a boundary — the top of the top layer's
    // slabs — on the drawn side of the plane that would otherwise remove it.
    const top = this.layerTop ?? unclampedHeight
    const bottom = this.layerBottom ?? -unclampedHeight
    this.viewer.setZClipPlane(top + 0.001, bottom - 0.001)
  }

  setTravels(visible: boolean): void {
    this.travelsVisible = visible
    this.applyTravels()
  }

  private applyTravels(): void {
    if (this.disposed) return
    this.viewer.toggleTravels(this.travelsVisible && this.travelsAvailable)
  }

  async setColorMode(mode: GcodeColorMode): Promise<void> {
    if (this.disposed) return
    this.viewer.gcodeProcessor.setColorMode(colorModeValues[mode])
    await this.reload()
  }

  /**
   * Whether a reparse has anything to reparse.
   *
   * The library's `reload()` re-runs `processFile` over the text it is holding,
   * and it holds none until the first load. Calling it before then throws
   * inside the parser — which surfaced as every file reporting a failed load,
   * because the page sets the tier for a file before handing over its text.
   */
  private canReload(): boolean {
    return this.loadedText && !this.disposed
  }

  setFeedrateRange(minimum: number, maximum: number): void {
    if (this.disposed) return
    this.viewer.gcodeProcessor.updateColorRate(minimum, maximum)
  }

  async setTier(tier: GcodeRenderTier): Promise<void> {
    if (this.disposed || tier === this.currentTier) return
    this.currentTier = tier
    this.viewer.updateRenderQuality(tier)
    // Before the first load there is nothing to rebuild: the tier is simply
    // the budget the next parse will run at.
    if (this.canReload()) await this.reload()
  }

  /**
   * A full reparse and mesh rebuild, from the text the library still holds.
   * The only two things that need it are colour mode and tier, which is why
   * the resolution scale rather than the tier is the governor's live lever.
   */
  private async reload(): Promise<void> {
    if (!this.canReload()) return
    await this.viewer.reload()
    if (this.disposed) return
    this.applyTravels()
    this.applyLayerRange()
    this.applyReveal()
    this.applyProgress()
    this.wake()
  }

  setResolutionScale(scale: number): void {
    if (this.disposed) return
    const ratio = Math.max(0.25, Math.min(window.devicePixelRatio || 1, scale))
    // Babylon's hardware scaling level is CSS pixels per rendered pixel, so a
    // larger number renders fewer pixels. Below 1 the scene is drawn under CSS
    // resolution and scaled up, which is the saving that matters on hardware
    // with no discrete GPU.
    this.viewer.engine.setHardwareScalingLevel(1 / ratio)
  }

  applyColors(colors: GcodeSceneColors): void {
    if (this.disposed) return
    this.viewer.setBackgroundColor(colors.background)
    this.viewer.bed.setBedColor(colors.bed)
    this.viewer.setProgressColor(colors.progress)
    this.viewer.gcodeProcessor.updateMinFeedColor(colors.feedSlow)
    this.viewer.gcodeProcessor.updateMaxFeedColor(colors.feedFast)
    this.viewer.gcodeProcessor.resetTools()
    for (const tool of colors.tools) {
      this.viewer.gcodeProcessor.addTool(tool, this.options.nozzleDiameter)
    }
  }

  setBedBounds(bounds: GcodeBounds | null, delta: boolean): void {
    if (this.disposed) return
    const volume = this.viewer.bed.buildVolume
    if (bounds) {
      // Printer Y is the scene's depth and printer Z its height, which is why
      // the assignment looks transposed.
      volume.x.min = bounds.minX
      volume.x.max = bounds.maxX
      volume.y.min = bounds.minY
      volume.y.max = bounds.maxY
      volume.z.min = bounds.minZ
      volume.z.max = bounds.maxZ
    }
    this.viewer.bed.setDelta(delta)
    this.viewer.bed.commitBedSize()
  }

  featureColor(labels: readonly string[]): string | null {
    const list = this.viewer.gcodeProcessor.slicer?.featureList
    if (!list) return null
    const entries = Object.entries(list)
    for (const label of labels) {
      const match = entries.find(([key]) => key.toLowerCase() === label.toLowerCase())
      if (!match) continue
      const { r, g, b } = match[1].color
      const channel = (value: number): string =>
        Math.round(Math.min(1, Math.max(0, value)) * 255)
          .toString(16)
          .padStart(2, '0')
      return `#${channel(r)}${channel(g)}${channel(b)}`
    }
    return null
  }

  resetCamera(): void {
    if (this.disposed) return
    this.viewer.resetCamera()
  }

  frameBounds(bounds: GcodeBounds): void {
    if (this.disposed) return
    const camera = this.viewer.scene.activeCamera
    if (!camera) return
    const [x, y, z] = boundsCenter(bounds)
    camera.target.x = x
    camera.target.y = z
    camera.target.z = y
    camera.radius = boundsRadius(bounds) * 1.4
    this.viewer.forceRender()
  }

  orbitBy(deltaX: number, deltaY: number): void {
    const camera = this.viewer.scene.activeCamera
    if (this.disposed || !camera) return
    // The same inertial offsets the library's own pointer input writes, at the
    // same sensitivity, so a keyboard nudge and a drag of the same size move
    // the camera by the same amount — and setting them is what wakes the
    // library's render loop out of its idle state.
    camera.inertialAlphaOffset -= deltaX / 1_000
    camera.inertialBetaOffset -= deltaY / 1_000
  }

  panBy(deltaX: number, deltaY: number): void {
    const camera = this.viewer.scene.activeCamera
    if (this.disposed || !camera) return
    const sensibility = camera.panningSensibility || 50
    camera.inertialPanningX -= deltaX / sensibility
    camera.inertialPanningY += deltaY / sensibility
  }

  zoomBy(factor: number): void {
    const camera = this.viewer.scene.activeCamera
    if (this.disposed || !camera || factor <= 0) return
    camera.radius = Math.max(1, camera.radius / factor)
    this.viewer.forceRender()
  }

  cameraPosition(): [number, number, number] {
    const camera = this.viewer.scene.activeCamera
    if (!camera) return [0, 0, 0]
    const position = camera.globalPosition
    return [position.x, position.z, position.y]
  }

  project(point: readonly [number, number, number]): [number, number] | null {
    if (this.disposed) return null
    const matrix = this.viewer.scene.getTransformMatrix().m
    // Printer (x, y, z) is the world point (x, z, y): the scene is Y-up.
    const worldX = point[0]
    const worldY = point[2]
    const worldZ = point[1]
    // Row-vector convention, matching Babylon's own TransformCoordinates.
    const clipX =
      worldX * m(matrix, 0) + worldY * m(matrix, 4) + worldZ * m(matrix, 8) + m(matrix, 12)
    const clipY =
      worldX * m(matrix, 1) + worldY * m(matrix, 5) + worldZ * m(matrix, 9) + m(matrix, 13)
    const clipW =
      worldX * m(matrix, 3) + worldY * m(matrix, 7) + worldZ * m(matrix, 11) + m(matrix, 15)
    if (!Number.isFinite(clipW) || clipW <= 0) return null
    const width = this.canvas.clientWidth || 1
    const height = this.canvas.clientHeight || 1
    return [(clipX / clipW / 2 + 0.5) * width, (0.5 - clipY / clipW / 2) * height]
  }

  screenshot(): string | null {
    if (this.disposed) return null
    try {
      // The engine keeps no preserved drawing buffer, so the pixels are only
      // there for the rest of this task: render and read in one turn or read
      // a blank frame.
      this.viewer.scene.render(true)
      return this.canvas.toDataURL('image/png')
    } catch {
      return null
    }
  }

  resize(): void {
    if (this.disposed) return
    this.viewer.engine.resize()
    this.viewer.forceRender()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (liveRenderer === this) liveRenderer = null
    try {
      this.viewer.gcodeProcessor.cancelLoad = true
      this.viewer.gcodeProcessor.loadingProgressCallback = null
      if (this.frameObserver) {
        this.viewer.scene.onAfterRenderObservable.removeCallback(this.frameObserver)
      }
      this.viewer.scene.onBeforeRenderObservable.removeCallback(this.panningTuner)
      // Silence the orientation-cube hook first. It reaches module-level state
      // inside the library (see `createLibraryGcodeRenderer`), so a scene left
      // rendering it after teardown renders another instance's objects.
      this.viewer.scene.afterRender = null
      /*
       * Order matters: the scene owns the meshes, the engine owns the WebGL
       * context, and `clearScene(true)` is what drops the file text and the
       * split line array the library would otherwise hold for the session.
       *
       * The engine really is torn down rather than kept for the next visit.
       * Keeping it was tried, because the library's module-level state makes a
       * second instance throw while it draws its own setup — but a reused
       * engine loses its camera input when the canvas is detached and
       * re-parented, which left the model rendering and every drag, pan and
       * zoom silently dead. A rebuilt engine attaches its own controls, and
       * the setup throw is absorbed where it happens.
       */
      this.viewer.clearScene(true)
      this.viewer.scene.dispose()
      this.viewer.engine.dispose()
      this.canvas.remove()
    } catch {
      // A context already lost throws on teardown. There is nothing left to
      // free at that point and nothing useful to tell the user.
    }
  }
}

function m(matrix: Float32Array | readonly number[], index: number): number {
  return matrix[index] ?? 0
}

/** Whether a WebGL context was actually created before the library threw. */
function viewerHasEngine(viewer: GCodeViewer | undefined): boolean {
  try {
    return Boolean(viewer?.engine && viewer.scene?.getTransformMatrix)
  } catch {
    return false
  }
}

/**
 * The renderer currently holding the library, disposed before another is made.
 *
 * Vue mounts an incoming route before unmounting the outgoing one, so without
 * this the page would briefly hold two engines — and the library keeps its
 * orientation cube's scene and materials in module-level variables, so two
 * live instances corrupt each other's state. Serializing them is not a
 * complete fix on its own (see the setup block below for the throw that
 * remains), but it is the half that stops one instance drawing another's
 * objects.
 */
let liveRenderer: LibraryGcodeRenderer | null = null

export async function createLibraryGcodeRenderer(
  host: HTMLElement,
  options: GcodeSceneOptions,
): Promise<GcodeSceneRenderer> {
  liveRenderer?.dispose()
  liveRenderer = null

  /*
   * The canvas belongs to the adapter, not to the page's template. An engine
   * is bound to its canvas for life, so a fresh engine needs a fresh element —
   * and making that the adapter's business keeps the view from having to know
   * it.
   */
  const canvas = document.createElement('canvas')
  canvas.className = 'gcode-viewer-canvas'
  canvas.setAttribute('aria-hidden', 'true')
  host.prepend(canvas)

  let viewer: GCodeViewer | undefined
  let recovered = false
  try {
    viewer = new GCodeViewer(canvas)
    // Read before the first parse, because the library clears the flag as
    // soon as one finishes. A flag still set here means the previous parse
    // never reached its end — the shape a tab killed by memory pressure
    // leaves behind — so this session starts at the cheapest tier and the
    // page gets to say why.
    recovered = viewer.lastLoadFailed()
    if (recovered) viewer.clearLoadFlag()
    viewer.updateRenderQuality(recovered ? 1 : options.tier)
    await viewer.init(false)
  } catch (error) {
    /*
     * Tell a device with no hardware 3D apart from a library that drew too
     * early.
     *
     * `init` builds the bed, the axes and its orientation cube and renders the
     * scene several times on the way through, and some of that geometry
     * carries material and shader state the library keeps in module-level
     * variables — shared, and stale as soon as a second viewer has ever
     * existed in the page. One of those premature draws then throws from deep
     * inside Babylon with an effect that has no attributes.
     *
     * It is a real bug, but not this device's problem: the engine and the
     * scene exist by then, and the render loop draws the scene correctly on
     * its next tick. So a throw with a live engine behind it is logged and
     * carried on from, while a throw with nothing behind it is what the
     * "hardware rendering is unavailable" message is actually for.
     */
    const engineExists = Boolean(viewerHasEngine(viewer))
    if (!engineExists) throw new GcodeSceneUnavailableError(error)
    if (import.meta.env.DEV) {
      console.warn('[gcode viewer] the library threw while drawing its own setup', error)
    }
  }

  /*
   * Force synchronous shader compilation.
   *
   * The library renders straight from its setters — `setBackgroundColor`,
   * `setBedColor`, `commitBedSize` and `setZClipPlane` each end in a
   * `scene.render()` — and the adapter calls those while setting the scene up.
   * With Babylon's parallel compilation on, the bed's grid material reports
   * itself ready before its effect actually is, and one of those forced
   * renders reaches into an effect with no attributes yet and throws from deep
   * inside the engine. It surfaced as "hardware rendering is unavailable" on
   * the *second* visit to the page, which is as misleading a message as the
   * cause allows.
   *
   * The cost is a slightly slower first compile; the alternative is either
   * swallowing exceptions from the engine or never calling the library's own
   * setters.
   */
  if (!viewer) throw new GcodeSceneUnavailableError()
  const ready = viewer

  const renderer = new LibraryGcodeRenderer(
    ready,
    canvas,
    { ...options, tier: recovered ? 1 : options.tier },
    recovered,
  )

  /*
   * Configure and seed the scene, tolerating a throw.
   *
   * Almost every setter this library exposes ends in a synchronous
   * `scene.render()` — the background, the bed colour, the bed size, the axes,
   * the clip planes all do — and some of the geometry they draw carries
   * material and shader state the library keeps in module-level variables,
   * shared between instances and stale as soon as a second viewer has existed
   * in the page. One of those premature draws then throws from inside Babylon
   * with an effect that has no attributes.
   *
   * It is a real bug in the library, but it is not this device's problem, and
   * reporting it as "hardware rendering is unavailable" is what the page used
   * to do on every second visit. Every value below is recorded on the adapter
   * as well as pushed at the library, all of them are re-applied after the
   * first load, and the render loop draws the scene correctly on its next
   * tick — so the honest handling is to log it and carry on.
   */
  try {
    ready.engine.getCaps().parallelShaderCompile = undefined
    const processor = ready.gcodeProcessor
    processor.useHighQualityExtrusion(false)
    processor.updateForceWireMode(false)
    processor.setVoxelMode(false)
    processor.useSpecularColor(false)
    processor.setAlpha(false)
    processor.lookAheadLength = 0
    ready.setCameraInertia(false)
    /*
     * The camera's pointer input stays; its keyboard input goes.
     *
     * Babylon focuses the canvas on every press so that its keyboard input
     * can hear the arrow keys, and the stage's own keyboard map — the one the
     * help text documents — hears them too, because a focused canvas bubbles
     * its keys up to the stage. Left attached, one arrow key would orbit
     * twice at two different speeds. Detaching the input rather than removing
     * it keeps the library's own inertia setter, which writes to it by name,
     * working.
     *
     * The tab stop Babylon gives the canvas goes for the same reason: the
     * canvas is hidden from assistive technology, so a keyboard user must
     * reach the stage, not the canvas. Babylon's own focus() call still works
     * on a -1, and its input system needs that focus for nothing but keys.
     */
    const inputs = ready.scene.activeCamera?.inputs.attached
    inputs?.keyboard?.detachControl()
    /*
     * Zoom by a share of the distance rather than by a fixed step.
     *
     * The library's wheel step is one millimetre per notch, so a bed-sized view
     * took a hundred notches to approach and a close-up leapt through the
     * model. A percentage of the radius is the same gesture at every distance,
     * and matches the keyboard's own zoom, which has always been a ratio.
     */
    if (inputs?.mousewheel) inputs.mousewheel.wheelDeltaPercentage = zoomStepShare
    if (inputs?.pointers) inputs.pointers.pinchDeltaPercentage = zoomStepShare
    // Both, because Babylon re-applies the engine's value to a -1 whenever it
    // re-attaches its events.
    ready.engine.canvasTabIndex = -1
    canvas.tabIndex = -1
    // The library draws 3D axis labels at the origin; Alabaster's own heads-up
    // gizmo is on the overlay canvas, where it cannot be occluded by the model.
    ready.axes.show(false)
    /*
     * Stop the library building its own toolhead cursor.
     *
     * Every `processFile` ends by calling `setCursorVisiblity`, and every
     * `clearScene` calls the builder outright — which loads an OBJ nozzle
     * model through Babylon's scene loader and parents it into the scene.
     * Alabaster draws its own toolhead on the overlay canvas, on its own
     * clock, which is what ADR 0007 requires; the library's would be loaded
     * and kept purely to stay invisible.
     *
     * Replacing the builder rather than pre-seeding the cursor is what makes
     * this hold: `clearScene` disposes the cursor, sets it to `undefined`, and
     * *then* calls the builder again, so a stand-in object survives exactly
     * one load. A no-op builder plus a stub mesh leaves every call site — the
     * visibility setter included — working and inert.
     */
    ready.buildtoolCursor = () => {}
    ready.toolCursorMesh = { isVisible: false }
    /*
     * Turn off the library's orientation cube.
     *
     * It is a second Babylon scene rendered into a viewport fixed at the
     * top-right 15% of the canvas — exactly where the stage's view tools sit,
     * and large enough at any stage size to sit on top of them. The library
     * does expose a `showViewBox` toggle, but its package entry does not
     * re-export it, so the only reachable switch is the per-frame hook the
     * cube is drawn from. Alabaster's own orientation gizmo is on the overlay
     * canvas in the opposite corner, at a size the page chooses.
     */
    ready.scene.afterRender = null

    renderer.applyColors(options.colors)
    renderer.setBedBounds(options.bedBounds, options.delta)
    renderer.setResolutionScale(options.resolutionScale)
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[gcode viewer] the library threw while drawing its own setup', error)
    }
  }

  liveRenderer = renderer
  return renderer
}
