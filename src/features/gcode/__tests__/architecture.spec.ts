import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { defaultGcodeNozzleDiameter } from '@/features/gcode/types'
import { navigationDestinations } from '@/navigation/destinations'

const sourceRoot = join(process.cwd(), 'src')
const loader = readFileSync(join(sourceRoot, 'features', 'gcode', 'loader.ts'), 'utf8')
const renderer = readFileSync(join(sourceRoot, 'features', 'gcode', 'renderer.ts'), 'utf8')
const decimate = readFileSync(join(sourceRoot, 'features', 'gcode', 'decimate.ts'), 'utf8')
const viewer = readFileSync(join(sourceRoot, 'views', 'GcodeViewerView.vue'), 'utf8')
const app = readFileSync(join(sourceRoot, 'App.vue'), 'utf8')

/**
 * These are architectural invariants, not implementation pins. Each one names
 * the failure it prevents, and each is written to survive the viewer being
 * restructured — asserting relationships (every X also does Y) rather than
 * exact source lines, so the redesign can move code without tripping guards
 * that only ever described the old shape.
 */

/** Every template-literal shader source assigned to a `...FragmentShaderSource` const. */
function fragmentShaderSources(source: string): Array<{ name: string; body: string }> {
  return [...source.matchAll(/const (\w+FragmentShaderSource) = `([^`]*)`/g)].map((match) => ({
    name: match[1] ?? '',
    body: match[2] ?? '',
  }))
}

describe('G-code viewer performance architecture', () => {
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
   * The renderer draws every bead by instancing a procedural pill profile over
   * the raw parse buffers. Building per-segment geometry on the CPU instead is
   * how a viewer ends up rebuilding megabytes of vertices on every state
   * change; the endpoint offsets are what keep a move one width from start to
   * finish instead of tapering into its neighbors.
   */
  it('renders instanced pill geometry straight from the parse buffers', () => {
    expect(renderer).toContain('drawArraysInstanced')
    expect(renderer).toContain('pill_profile')
    expect(renderer).toContain('a_endpoint_offset')
    expect(renderer).toContain('a_extrusion_height')
  })

  /**
   * In follow mode, geometry ahead of the playback cursor on the active layer
   * must be absent, not dimmed — and identically so in every program that
   * knows about print progress, or zooming (which switches programs via LOD)
   * would change what "printed so far" means. Every fragment shader that
   * reads the progress uniform must therefore also implement the reveal rule
   * and be able to discard.
   */
  it('applies the reveal rule in every program that knows print progress', () => {
    const sources = fragmentShaderSources(renderer)
    expect(sources.length).toBeGreaterThanOrEqual(3)
    const progressAware = sources.filter((shader) => shader.body.includes('u_print_progress'))
    expect(progressAware.length).toBeGreaterThanOrEqual(2)
    for (const shader of progressAware) {
      expect(shader.body, `${shader.name} reads progress without the reveal rule`).toContain(
        'u_reveal_current_layer',
      )
      expect(shader.body, `${shader.name} cannot hide unprinted geometry`).toContain('discard')
    }
  })

  /**
   * Far-zoom detail is reduced by drawing fewer beads of the same procedural
   * geometry — never by substituting a different kind of object. A voxel or
   * box-column mode is what this replaced, and reintroducing one would undo
   * the visual reason the ladder exists. Note that this is about aggregating
   * many moves into one substitute object: a bead may still change its own
   * cross-section, which is what the rendering-quality setting does below.
   */
  it('reduces far detail with fewer beads, not a substitute shape', () => {
    // Every tier renders through the one instanced toolpath program.
    expect(renderer).not.toMatch(/surfaceProgram|drawSurfaceLod|surfaceColumn/)
    expect(renderer).toContain("type GcodeLod = 'full' | 'reduced' | 'decimated' | 'coarse'")
    // Detail follows projected bead size alone: travel and seam toggles must
    // never gate a tier again, which is what once made those two settings
    // silently disable the far LOD on exactly the largest files.
    const lodFor = renderer.slice(renderer.indexOf('private lodFor('))
    const lodBody = lodFor.slice(0, lodFor.indexOf('\n  }'))
    expect(lodBody).toContain('extrusionPixels')
    expect(lodBody).not.toContain('showTravels')
    expect(lodBody).not.toContain('highlightSeams')
  })

  /**
   * The bead's cross-section answers to the rendering-quality setting and to
   * nothing else. Every other quality lever is invisible enough to move under
   * load — a tier engages, pixels soften, a shadow drops — but a bead changing
   * shape mid-orbit because a few frames ran long reads as a rendering fault.
   * So the tier selector must not see the profile, and the profile must not be
   * derived from the camera.
   */
  it('takes bead shape from the quality mode, never from the camera', () => {
    expect(viewer).toContain('beadProfile: gcodeBeadProfileFor(qualityMode.value)')

    const profileFor = renderer.slice(renderer.indexOf('private profilePointsFor('))
    const profileBody = profileFor.slice(0, profileFor.indexOf('\n  }'))
    expect(profileBody).toContain("options.beadProfile === 'square'")
    expect(profileBody).not.toContain('camera')

    const lodFor = renderer.slice(renderer.indexOf('private lodFor('))
    expect(lodFor.slice(0, lodFor.indexOf('\n  }'))).not.toContain('beadProfile')
  })

  /**
   * Distance averages the bead *normal*; it never fades the lit result.
   *
   * A bead only a pixel or two wide is high-frequency normal detail sampled once
   * per pixel, and a model of it reads as speckle. The first remedy shipped for
   * that faded the lighting toward a constant, which removed the speckle by
   * removing the shading with it — a flat, washed-out silhouette with no sense
   * of form. Snapping the normal toward the one a square bead would have fixes
   * the aliasing while leaving the lighting model fully engaged, so tops still
   * separate from sides at every distance.
   */
  it('averages the bead normal at distance instead of fading the light', () => {
    expect(renderer).toContain('flatten_profile_normal')
    expect(renderer).not.toMatch(/mix\(1\.0, graded_lighting/)

    // Whatever shades a bead shades it from the flattened normal, body and cap
    // alike: one of the two keeping the raw profile normal would crease at
    // every path end.
    const lightingWrites = renderer.match(/v_lighting = graded_lighting\(surface_normal\)/g) ?? []
    expect(lightingWrites.length).toBeGreaterThanOrEqual(2)
    const flattenReads = renderer.match(/flatten_profile_normal\(profile\.normal/g) ?? []
    expect(flattenReads.length).toBeGreaterThanOrEqual(2)
  })

  /**
   * Widening beads past their real width is the one thing here that draws
   * something the file does not say, so it must never happen except where the
   * mode asked for it. A viewer that quietly fattened geometry to look tidier
   * would be hiding a print's interior from someone inspecting it.
   */
  it('only widens beads where the mode traded truth for a closed surface', () => {
    expect(viewer).toContain('subPixelStrategy: gcodeSubPixelStrategyFor(qualityMode.value)')
    const widthScale = renderer.slice(renderer.indexOf('private closedSurfaceWidthScale('))
    const body = widthScale.slice(0, widthScale.indexOf('\n  }'))
    expect(body).toContain("options.subPixelStrategy !== 'widen'")
    // Bounded, so a model shrunk to a few pixels cannot inflate into a blob.
    expect(body).toMatch(/Math\.min\(/)
  })

  /**
   * Supersampling must never reach the tier ladder.
   *
   * A device pixel ratio and a sample scale both multiply the pixels a bead
   * covers, but they mean different things: a dense screen really does show a
   * bead bigger, and may fairly earn finer geometry, while supersampling only
   * samples the same picture better. Letting the second argue for finer geometry
   * charges twice — more fragments and more instances — and measured as 74 fps
   * falling to 31 rather than to 72.
   */
  it('keeps supersampling out of the tier decision', () => {
    const lodFor = renderer.slice(renderer.indexOf('private lodFor('))
    const lodBody = lodFor.slice(0, lodFor.indexOf('\n  }'))
    expect(lodBody).toContain('this.sampleScale')

    // The flattening is the opposite case and must keep counting real samples:
    // more of them genuinely do resolve a bead's curvature better.
    const flatten = renderer.slice(renderer.indexOf('private normalFlattenFor('))
    expect(flatten.slice(0, flatten.indexOf('\n  }'))).not.toContain('this.sampleScale')
  })

  /**
   * A merge may only join moves the path builder would have joined anyway, so
   * decimation shares that one predicate rather than reimplementing adjacency.
   * A second, drifting copy would put end caps in the middle of walls.
   */
  it('decimates only along connected paths, using the shared predicate', () => {
    expect(decimate).toContain(
      "import { gcodeMovesConnected } from '@/features/gcode/pathGeometry'",
    )
    expect(decimate).toContain('gcodeMovesConnected(')
    // The merged run inherits its last member's progress, so the reveal
    // frontier can never run ahead of what the printer has actually done.
    expect(decimate).toContain('field(segments, end, gcodeSegment.progress)')
  })

  /**
   * A download only streams into the scene if a total size is known, so every
   * caller that knows one must hand it over. Moonraker sends G-code with no
   * `Content-Length`, and reading the size from the header alone left the most
   * used path of all — pick a file off the printer — blank for the whole
   * download before appearing at once. The two paths that happened to be tested
   * both knew their size, which is why it went unnoticed.
   */
  it('gives the parser a size even when the response withholds one', () => {
    expect(loader).toContain('export function gcodeStreamTotalBytes')
    expect(loader).toContain('declaredTotalBytes')
    // The printer path is the one that has to declare it; its size comes from
    // Moonraker's own file listing, already fetched for the size confirmation.
    expect(viewer).toContain('declaredTotalBytes: size')
  })

  /**
   * Whatever tier surrounds it, the layer a moving frontier is crossing draws
   * from the full-resolution stream. Without this, zooming out during a print
   * would coarsen the very geometry whose reveal the user is watching.
   */
  it('keeps the active layer segment-exact while a frontier crosses it', () => {
    expect(renderer).toContain('options.exactActiveLayer')
    expect(viewer).toContain(
      'exactActiveLayer: plannedFollowActive.value || simulationEnabled.value',
    )
  })

  /**
   * A reduced tier and the full-resolution active layer are drawn as two passes
   * with different layer bands, so "which band may this draw paint" and "which
   * layer is the active one" are different questions. They were once the same
   * uniform, and the tier pass then painted its own top layer in the active
   * layer's color — two blue layers instead of one, at any zoom where a tier
   * engaged. Every layer-aware fragment shader must therefore bound its draw
   * with the pass band and decide the active layer from the visible range.
   */
  it('separates the band a pass may draw from which layer is active', () => {
    const layerAware = fragmentShaderSources(renderer).filter((shader) =>
      shader.body.includes('v_layer'),
    )
    expect(layerAware.length).toBeGreaterThanOrEqual(3)
    for (const shader of layerAware) {
      expect(shader.body, `${shader.name} bounds its draw with the visible range`).toContain(
        'v_layer < u_pass_min',
      )
      expect(shader.body, `${shader.name} takes the active layer from its pass band`).toContain(
        'abs(v_layer - u_layer_max)',
      )
    }
    // The visible range is uploaded once per program, outside the per-pass loop,
    // so both passes agree on which layer is active and on the depth ramp.
    const perPass = renderer.match(/u_pass_(?:min|max)'/g) ?? []
    expect(perPass.length).toBeGreaterThanOrEqual(6)
  })

  /**
   * The pick pass packs a depth texture into bytes to find the orbit pivot.
   * A plain 16-bit depth attachment or an unclamped pack quietly breaks
   * zoom-to-cursor at distance: rounding the largest depth lands on 2^24,
   * which a 32-bit float cannot represent oddly enough to survive the split.
   */
  it('picks against a full-precision depth texture with the 2^24 clamp', () => {
    expect(renderer).toContain('DEPTH_COMPONENT24')
    expect(renderer).toContain('16777215.0')
  })

  /**
   * The nozzle overlay animates at full frame rate on its own 2D canvas while
   * the WebGL scene renders on a separate, throttled clock. Merging them —
   * one canvas, or one clock — either drops the marker to the scene's
   * throttled rate or forces full scene renders at overlay rate.
   */
  it('keeps the overlay and the scene on separate canvases and clocks', () => {
    expect(viewer).toContain('ref="sceneCanvas"')
    expect(viewer).toContain('ref="overlayCanvas"')
    const throttledSceneWrites = viewer.match(/timestamp - last\w*SceneRender >= 50/g) ?? []
    expect(throttledSceneWrites.length).toBeGreaterThanOrEqual(2)
  })

  /**
   * Planned follow may only start through the shared eligibility gate and the
   * validated playback controller — never by feeding telemetry or progress
   * percentages straight into the scene. The `live-layer` progress style is
   * what selects the reveal semantics, so it must remain tied to planned
   * follow being active.
   */
  it('starts follow mode only through the centralized eligibility gate', () => {
    expect(viewer).toContain('plannedFollowCanStart({')
    expect(viewer).toContain('new PlannedToolheadPlayback(')
    expect(viewer).toContain("progressStyle: plannedFollowActive.value ? 'live-layer' : 'standard'")
    // Byte positions, not the metadata-adjusted percentage, locate the frontier.
    expect(viewer).toContain('printer.virtualSdcard.filePosition')
  })

  /**
   * A move that declares its own bead width (derived from filament volume)
   * renders at that width; the configured nozzle diameter is only the
   * fallback for moves that declare none. A global width override would
   * falsify files that carry real widths.
   */
  it('treats the nozzle diameter as the fallback bead width only', () => {
    expect(defaultGcodeNozzleDiameter).toBeCloseTo(0.4)
    // Every shader prefers the width the move itself declared and reaches for
    // the uniform only when there is none. A global width would otherwise
    // falsify every file that states its own — which most files do.
    for (const shader of ['a_path_width.x > 0.0', 'a_extrusion_width > 0.0']) {
      expect(renderer).toContain(`${shader} ? `)
    }
    expect(renderer).toContain('u_extrusion_width')
    // The fallback is the machine's nozzle, not a constant: the printer already
    // reports it, and a stored override exists only for files inspected with no
    // printer connected.
    expect(viewer).toContain('extrusionWidth: effectiveNozzleDiameter.value')
    expect(viewer).toContain('printerConfig.extruderGeometry.nozzleDiameter')
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
    const parser = readFileSync(join(sourceRoot, 'features', 'gcode', 'parser.ts'), 'utf8')
    expect(parser).toContain('filamentCrossSection')
    // Not a module constant computed once from the default.
    expect(parser).not.toMatch(/^const filamentCrossSection/m)
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
