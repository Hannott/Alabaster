import { readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { gcodeSourceByteStride, defaultGcodeNozzleDiameter } from '@/features/gcode/types'
import { navigationDestinations } from '@/navigation/destinations'

const sourceRoot = join(process.cwd(), 'src')
const gcodeRoot = join(sourceRoot, 'features', 'gcode')
const loader = readFileSync(join(gcodeRoot, 'loader.ts'), 'utf8')
const parser = readFileSync(join(gcodeRoot, 'parser.ts'), 'utf8')
const scene = readFileSync(join(gcodeRoot, 'scene.ts'), 'utf8')
const adapter = readFileSync(join(gcodeRoot, 'vendor', 'libraryRenderer.ts'), 'utf8')
const quality = readFileSync(join(gcodeRoot, 'quality.ts'), 'utf8')
const viewer = readFileSync(join(sourceRoot, 'views', 'GcodeViewerView.vue'), 'utf8')
const app = readFileSync(join(sourceRoot, 'App.vue'), 'utf8')

const libraryName = '@sindarius/gcodeviewer'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return ['.ts', '.vue'].includes(extname(entry.name)) ? [path] : []
  })
}

/**
 * These are architectural invariants, not implementation pins. Each one names
 * the failure it prevents, and each is written to survive the viewer being
 * restructured — asserting relationships rather than exact source lines.
 *
 * The set changed shape when the hand-written WebGL renderer was replaced by a
 * library (ADR 0011). The invariants that described shader internals are gone
 * with the shaders; what replaced them are the rules that keep the *seam*
 * real, because a seam nothing enforces is a seam that leaks one call at a
 * time until the next renderer swap is a rewrite again.
 */
describe('G-code viewer architecture', () => {
  /**
   * Parsing a large file on the main thread freezes the whole interface for
   * its duration. The parser must stay in a module worker created from the
   * bundler-visible URL form, or Vite silently stops splitting it out.
   */
  it('parses G-code in a worker, off the main thread', () => {
    expect(loader).toContain("new Worker(new URL('./parser.worker.ts', import.meta.url)")
    expect(loader).toContain("{ type: 'module' }")
  })

  /**
   * The seam's first rule. Every renderer call goes through the interface in
   * `scene.ts`, implemented once in `vendor/`; nothing else in the
   * application may name the library at all.
   *
   * Two failures this prevents. A component reaching past the interface for
   * one more method makes the next renderer swap a rewrite of the page — the
   * exact cost ADR 0011 was paying off. And a static import anywhere outside
   * the lazily-imported adapter drags roughly half a megabyte of Babylon.js
   * into whatever chunk did the importing, which is how a route-local
   * dependency becomes an application-wide one.
   */
  it('names the rendering library only inside its vendor folder', () => {
    const offenders = sourceFiles(sourceRoot)
      .filter((file) => !file.includes(join('features', 'gcode', 'vendor')))
      // This spec names the library in order to forbid it elsewhere.
      .filter((file) => !file.endsWith('architecture.spec.ts'))
      .filter((file) => readFileSync(file, 'utf8').includes(libraryName))

    expect(offenders).toEqual([])
  })

  /**
   * And the adapter itself is only ever reached through a dynamic import, so
   * the library lands in the viewer route's chunk. ADR 0001 measures a
   * dependency's weight against the route that needs it, which is only true
   * while nothing else can pull it in.
   */
  it('reaches the adapter only through the async factory', () => {
    expect(scene).toContain("await import('@/features/gcode/vendor/libraryRenderer')")
    expect(scene).toContain('export async function createGcodeSceneRenderer')

    const staticImporters = sourceFiles(sourceRoot)
      .filter((file) => !file.includes(join('features', 'gcode', 'vendor')))
      .filter((file) => /^\s*import .*vendor\/libraryRenderer/m.test(readFileSync(file, 'utf8')))

    expect(staticImporters).toEqual([])
    // The view holds the interface's type, never the implementation.
    expect(viewer).toContain('createGcodeSceneRenderer(')
  })

  /**
   * The library reads its own settings out of `localStorage` — render quality,
   * camera inertia, background, bed and progress colours, the build volume,
   * and seven processor keys — in its constructor and again in getters it
   * calls while initialising. Alabaster owns its settings, so the containment
   * is to write every one of them explicitly at creation and never read those
   * keys: the library cannot then be decided by whatever a previous session,
   * or another Klipper interface on the same origin, happened to leave there.
   */
  it('writes the library every setting rather than letting storage decide', () => {
    for (const explicit of [
      'viewer.updateRenderQuality(',
      'ready.setCameraInertia(false)',
      'processor.useHighQualityExtrusion(false)',
      'processor.updateForceWireMode(false)',
      'processor.setVoxelMode(false)',
      'renderer.applyColors(',
      'renderer.setBedBounds(',
      'renderer.setResolutionScale(',
    ]) {
      expect(adapter, `${explicit} must be set at creation`).toContain(explicit)
    }

    // None of the library's own keys may be read anywhere in the application.
    const libraryKeys = [
      'renderQuality',
      'cameraInertia',
      'sceneBackgroundColor',
      'progressColor',
      'bedLineColor',
      'buildVolume',
      'renderBedMode',
      'processorColorMode',
      'lastLoadFailed',
    ]
    const readers = sourceFiles(sourceRoot).filter((file) => {
      const contents = readFileSync(file, 'utf8')
      return libraryKeys.some((key) => contents.includes(`localStorage.getItem('${key}')`))
    })

    expect(readers).toEqual([])
  })

  /**
   * ADR 0007's reveal rule: while a frontier is moving, geometry ahead of it
   * is absent rather than dimmed. The library expresses that as its
   * "live tracking" mode, and defaults to revealing a 500-byte look-ahead
   * window on top of it — a few moves the printer has not made yet, which is
   * exactly what the rule forbids. Both halves must stay.
   */
  it('draws nothing ahead of the frontier, with no look-ahead window', () => {
    expect(adapter).toContain('setLiveTracking(!this.revealAhead)')
    expect(adapter).toContain('lookAheadLength = 0')
    // Releasing the frontier and revealing ahead are the same decision, so
    // they cannot drift apart into two flags with two meanings.
    expect(viewer).toContain('renderer.setRevealAhead(true)')
    expect(viewer).toContain('renderer.setProgressBytes(null)')
  })

  /**
   * Three things can move a cursor through a file — a live print, the
   * simulation clock, and a drag of the scrubber — and all three must end in
   * the same call, converted through the same byte table. When each source
   * had its own path into the renderer, "printed so far" meant something
   * slightly different depending on which one was driving.
   */
  it('funnels every cursor through one byte frontier', () => {
    expect(viewer).toContain('function applyFrontier(')
    expect(viewer).toContain('gcodeByteForCursor(')
    // The byte table is per segment and exact; the parser keeps it whatever
    // else it stops emitting.
    expect(gcodeSourceByteStride).toBe(2)
    expect(parser).toContain('sourceBytes')

    const directWrites = [...viewer.matchAll(/renderer\??\.setProgressBytes\(/g)]
    /*
     * Three, and no more. Two are the two halves of `applyFrontier` — release
     * the frontier, or convert a segment cursor to a byte — and the third is
     * the telemetry fallback, which has a reported byte position and no
     * segment cursor to convert. A fourth would be a second definition of
     * "printed so far" somewhere in the file.
     */
    expect(directWrites.length).toBeLessThanOrEqual(3)
  })

  /**
   * The overlay's toolhead runs at full frame rate on its own canvas while
   * the scene's frontier advances on a slower clock, because rebuilding the
   * scene's vertex colours is far more expensive than drawing one marker.
   * Collapsing them would either stutter the marker or melt the frame rate.
   */
  it('keeps the overlay and the scene on separate canvases and clocks', () => {
    // The scene canvas is the adapter's: it creates one per engine and owns
    // its lifetime, so the view's template carries only the overlay.
    expect(viewer).not.toContain('ref="sceneCanvas"')
    expect(adapter).toContain("document.createElement('canvas')")
    expect(adapter).toContain("canvas.className = 'gcode-viewer-canvas'")
    expect(viewer).toContain('ref="overlayCanvas"')
    expect(viewer).toContain('sceneFollowIntervalMilliseconds')
    const throttled = viewer.match(/>= sceneFollowIntervalMilliseconds/g) ?? []
    expect(throttled.length).toBeGreaterThanOrEqual(2)
    // The overlay must not take pointer events, or it would swallow the drags
    // the renderer's camera controls are listening for on the canvas below.
    const styles = readFileSync(join(sourceRoot, 'styles', 'components.css'), 'utf8')
    expect(styles).toMatch(/\.gcode-viewer-canvas--overlay \{[^}]*pointer-events: none/)
  })

  /**
   * Planned follow may only start through the shared eligibility gate and the
   * validated playback controller — never by feeding telemetry or a progress
   * percentage straight into the scene.
   */
  it('starts follow mode only through the centralized eligibility gate', () => {
    expect(viewer).toContain('plannedFollowCanStart({')
    expect(viewer).toContain('new PlannedToolheadPlayback(')
    // Byte positions, not the metadata-adjusted percentage, locate the frontier.
    expect(viewer).toContain('printer.virtualSdcard.filePosition')
  })

  /**
   * The lever the governor is allowed to move, and the one it is not.
   *
   * A tier is a vertex budget the library meets by rebuilding every mesh, so
   * moving it mid-orbit would stall the view for seconds — it is chosen once
   * per load. Resolution changes between two frames for nothing, and on the
   * fragment-bound hardware that motivated ADR 0011 it is the lever that
   * actually shifts frame time.
   */
  it('chooses the tier once per load and spends only resolution per frame', () => {
    expect(quality).toContain('export function gcodeTierFor')
    expect(quality).toContain('resolutionScale')
    // The governor's own report offers no tier at all, only resolution.
    expect(quality).not.toMatch(/tierBias/)
    // Per frame the view may only touch resolution.
    expect(viewer).toContain('renderer?.setResolutionScale(report.state.resolutionScale)')
    expect(viewer).not.toMatch(/handleFrame[\s\S]{0,400}setTier\(/)
    // A tier change is a load-time decision, or an explicit mode change.
    expect(viewer).toContain('const tier = gcodeTierFor(')
  })

  /**
   * A device that cannot hold its tier writes that down, and the *next* load
   * starts cheaper. Reloading the file the moment it is discovered would cure
   * a stutter with a multi-second stall, which is worse than the symptom.
   */
  it('records a device that cannot hold its tier instead of reloading at once', () => {
    expect(quality).toContain('tierExhausted')
    expect(viewer).toContain('lowerTierCeiling()')
    expect(viewer).not.toMatch(/tierExhausted[\s\S]{0,200}setTier\(/)
  })

  /**
   * Colour reaches the library as resolved theme tokens. The library takes
   * hex, which is the one syntax it parses, so the conversion happens at
   * runtime from the document's own computed value — never from a literal in
   * a component, which `palette.spec.ts` also forbids and which would freeze
   * one theme pack's answer into every other.
   */
  it('drives every library colour from a resolved theme token', () => {
    expect(viewer).toContain('function token(')
    expect(viewer).toContain('resolveCssColor(`var(${name})`)')
    expect(viewer).toContain('rgbToHex(')
    for (const role of ['--viewer-surface', '--viewer-grid', '--viewer-progress']) {
      expect(viewer, `${role} must reach the renderer`).toContain(role)
    }
    // Re-applied when the theme changes, or a pack switch would leave the
    // canvas painted in the previous pack's colours until the next load.
    expect(viewer).toContain('themeObserver')
    expect(viewer).toContain('renderer?.applyColors(sceneColors())')
  })

  /**
   * Feature colours are the library's, read back rather than guessed.
   *
   * It decides a bead's colour while parsing, from its own per-slicer
   * palette, so a legend built from theme tokens would disagree with the
   * canvas as soon as the two differed — and a legend that disagrees with the
   * picture is worse than none.
   */
  it('reads feature colours back from the renderer for the legend', () => {
    expect(scene).toContain('featureColor(labels: readonly string[])')
    expect(adapter).toContain('slicer?.featureList')
    expect(viewer).toContain('renderer.featureColor(gcodeFeatureLabels(feature))')
  })

  /**
   * The library has no `dispose()` of its own: its engine, scene, meshes and
   * the whole file text would live for as long as the tab does. Disposal is
   * the adapter's job, and the view must call it on every unmount.
   */
  it('disposes the renderer and the file text on unmount', () => {
    expect(adapter).toContain('this.viewer.scene.dispose()')
    expect(adapter).toContain('this.viewer.engine.dispose()')
    // `true` is what drops the retained file text, not just the meshes.
    expect(adapter).toContain('clearScene(true)')
    expect(viewer).toMatch(/onBeforeUnmount\([\s\S]*renderer\?\.dispose\(\)/)
  })

  /**
   * Moonraker serves G-code with no `Content-Length`, so the response cannot
   * say how large the file is. Without a declared size the progress readout
   * has no denominator — which is the one path most people use.
   */
  it('gives the loader a size even when the response withholds one', () => {
    expect(loader).toContain('export function gcodeStreamTotalBytes')
    expect(loader).toContain('declaredTotalBytes')
    expect(viewer).toContain('declaredTotalBytes: size')
  })

  /**
   * Bead width is derived per move from the filament volume the move consumed,
   * and the filament's cross-section is squared into that arithmetic. Assuming
   * a diameter understates every bead on a machine that does not use it — by
   * about two and a half times for 2.85 mm filament — so the value travels from
   * the machine's config into the parser rather than being a constant there.
   */
  it("derives bead width from the machine's own filament diameter", () => {
    expect(loader).toContain('filamentDiameter')
    expect(viewer).toContain('printerConfig.extruderGeometry.filamentDiameter')
    expect(parser).toContain('filamentCrossSection')
    // Not a module constant computed once from the default.
    expect(parser).not.toMatch(/^const filamentCrossSection/m)
  })

  /**
   * The nozzle diameter is a fallback for moves that declare no extruded
   * volume, and it comes from the machine rather than from a constant. The
   * stored override exists for a file inspected with no printer connected.
   */
  it('treats the nozzle diameter as the fallback bead width only', () => {
    expect(defaultGcodeNozzleDiameter).toBeCloseTo(0.4)
    expect(viewer).toContain('nozzleDiameterOverride.value ??')
    expect(viewer).toContain('printerConfig.extruderGeometry.nozzleDiameter')
    expect(viewer).toContain('nozzleDiameter: effectiveNozzleDiameter.value')
  })

  /**
   * This once asserted the viewer was in the desktop sidebar and nowhere else,
   * which is how it came to have no mobile entry point at all — reachable only by
   * typing its hash. The rule it now guards is the one in
   * `docs/design/navigation-plan.md`: a heavy route need not hold a permanent cell
   * in the mobile bar, but it must never be unreachable.
   */
  it('keeps the viewer out of the mobile bar while leaving it reachable', () => {
    const destination = navigationDestinations.find((entry) => entry.name === 'gcodeViewer')

    expect(destination?.mobile).toBe('overflow')
    expect(app).toContain('v-for="item in supportedDestinations"')
    expect(app).toContain('v-for="item in mobileBarDestinations"')
    expect(app).toContain('v-for="item in mobileOverflowDestinations"')
  })
})
