<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import AppSelect from '@/components/AppSelect.vue'
import AppDashboardModule from '@/components/dashboard/AppDashboardModule.vue'
import BedMeshQuickSettings from '@/components/dashboard/modules/BedMeshQuickSettings.vue'
import { readBedMeshViewSetting } from '@/components/dashboard/modules/bedMeshViewSettings'
import { configBoolean, configNumber, configString, useDashboardModule } from '@/dashboard/context'
import {
  buildMeshScene,
  nearestMeshProbe,
  paintMeshOverlay,
  type MeshPalette,
  type MeshProbeMarker,
  type MeshRgb,
} from '@/features/bedMesh/painter'
import { MeshGlRenderer, type MeshGlDraw, type MeshGlLayer } from '@/features/bedMesh/glRenderer'
import type { MeshRenderStyle } from '@/features/bedMesh/geometry'
import { liveMeshGrid } from '@/features/bedMesh/probeRun'
import { readSavedMeshProfile } from '@/features/bedMesh/savedProfile'
import { buildVoyageFrame } from '@/features/bedMesh/voyage'
import { meshColourRange, meshHeightLimits, type MeshScale } from '@/features/bedMesh/scale'
import {
  meshOrientationAt,
  meshOrientationFor,
  meshHeightAgainstBed,
  meshOrientationPresets,
  meshProjectionFixesAngle,
  meshTickStep,
  type MeshArea,
  type MeshOrientation,
  type MeshOrientationName,
  type MeshProjection,
} from '@/features/bedMesh/scene'
import { useBedMeshStore } from '@/stores/bedMesh'
import { useMeshProbeRunStore } from '@/stores/meshProbeRun'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { usePrinterStore } from '@/stores/printer'
import { useTelemetryStore } from '@/stores/telemetry'

/** Kept in step with `--motion-duration-viewpoint`; see ADR 0004. */
const viewpointDuration = 500
/** How far a pointer may sit from a probed point and still be reading it. */
const probeReach = 14
/** How far the wheel may zoom the map out and in. */
const zoomMin = 0.5
const zoomMax = 4

/**
 * `liveProbing` opts this card into following a calibration as it runs,
 * `compareProfile` opts it into overlaying a second, saved-but-not-loaded
 * profile against the live one, and `forceProbeLabels` skips the 2D map's
 * narrow-card fallback to dots — see `MeshPaintOptions.forceProbeLabels`'s own
 * comment. All three are off by default and passed only by the Calibration
 * page: a dashboard card is a glance surface, following a run or judging one
 * mesh against another are both things you sit and watch, and the dashboard
 * card is exactly the narrow context the dot fallback exists for.
 */
const props = defineProps<{
  liveProbing?: boolean
  compareProfile?: string | null
  forceProbeLabels?: boolean
}>()

const { locale, t } = useI18n({ useScope: 'global' })
const bedMesh = useBedMeshStore()
const probeRun = useMeshProbeRunStore()
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()

/*
 * `hasActivePrint`, not `isPrinting`. This card gated its three print-sensitive
 * controls on `isPrinting` alone, so the moment a print *paused* it offered all
 * three, enabled: calibrating probes across the half-built part, clearing
 * removes bed compensation from the job about to resume, and loading another
 * profile swaps in a mesh measured for a different setup. It is the same line
 * MovementModule draws for homing and motors-off and TemperaturesModule draws
 * for cooling down, each with a comment saying so, and the module plan states
 * it outright -- a paused print is a loaded print. This was the third module,
 * and the only one that never got it.
 */
const hasJobLoaded = computed(() => printer.hasActivePrint)

/*
 * All three of this card's print-sensitive controls are tier 4 -- refused while
 * a job is loaded, not confirmed.
 *
 * There is no useful answer to a dialog offering to probe across a part
 * standing on the plate, or to strip bed compensation out of a job halfway
 * through it: only a fast no and a slow no. A skippable dialog would be worse
 * still, since the checkbox's only function would be to re-enable a two-click
 * way to ruin the print.
 *
 * None of the three states a reason beside it, and that is deliberate. A
 * refusal earns explanatory text when the reader would otherwise be left
 * guessing -- not when the control's own label already implies it. Nobody needs
 * to be told why a printer will not re-probe its bed mid-print, and a line of
 * caution text under every obvious refusal is noise that trains the reader to
 * skip the ones that are not obvious.
 *
 * Load has a second reason on top of that one. It is an AppSelect, and a
 * confirmation on a select can only ask *after* the value has changed -- either
 * the control lies about its state until the dialog is answered, or it reverts
 * itself on cancel. A guard belongs in front of a control that commits on
 * click.
 */
const telemetry = useTelemetryStore()
const { config, isSettingsOpen, updateConfig } = useDashboardModule('bedMesh')

const surface = ref<HTMLCanvasElement | null>(null)
const overlay = ref<HTMLCanvasElement | null>(null)
const stage = ref<HTMLElement | null>(null)
/** Where the camera stands: 0 looks straight down, 1 is the resting 3D view. */
const viewpoint = ref(0)
const viewportSize = ref({ width: 0, height: 0 })
const reading = ref<MeshProbeMarker | null>(null)
/** An orbit in progress, which overrides the saved orientation until released. */
const dragged = ref<MeshOrientation | null>(null)
/** Magnification about the mesh's own centre. Ephemeral, like the orbit. */
const zoom = ref(1)
/**
 * The easter egg, while it runs. Held here and nowhere else: it writes nothing
 * to the module's saved configuration, so there is no "before" to restore and
 * no way for it to survive a reload. Dropping this ref ends it completely.
 */
const voyage = ref<{ startedAt: number } | null>(null)
let voyageFrame: number | null = null
let palette: MeshPalette | null = null
let fontFamily = 'ui-monospace, monospace'
let renderer: MeshGlRenderer | null = null
const uploadedLayers = new Set<string>()
let resizeObserver: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null
let frame: number | null = null
let animationStart = 0
let animationFrom = 0
let animationTo = 0
let dragPointer: number | null = null
let dragFrom: { x: number; y: number; alpha: number; beta: number } | null = null

const showSurface = computed(() => configBoolean(config.value, 'showSurface', true))
/**
 * Whether the level plane is allowed to draw right now, independent of the
 * "Level" checkbox. Leaving 2D drops it at once, the instant the toggle is
 * pressed, because a plane spanning the whole bed is exactly the wrong thing
 * to have fading in behind a camera that is still mid-swing. Returning to 3D
 * only lifts this once that swing has actually finished — see
 * `moveViewpointTo` and `step` — so it never reappears mid-animation either.
 */
const levelReveal = ref(showSurface.value)
const scaleToMesh = computed(() => configBoolean(config.value, 'scaleToMesh', false))
// What the height map draws; keys and defaults live in
// `bedMeshViewSettings.ts`, shared with the settings rows so the two cannot
// drift.
const showProbes = computed(() => readBedMeshViewSetting(config.value, 'showProbes'))
/**
 * The flat map is read one number per cell, so its markers are not the
 * decoration this switch can turn off — it still governs the 3D view, but
 * the flat map shows probes regardless of it.
 */
const showProbesEffective = computed(() => showProbes.value || !showSurface.value)
const showProbedLayer = computed(() => readBedMeshViewSetting(config.value, 'showProbedLayer'))
const showMeshLayer = computed(() => readBedMeshViewSetting(config.value, 'showMeshLayer'))
const showFlatLayer = computed(() => readBedMeshViewSetting(config.value, 'showFlatLayer'))
const wireframe = computed(() => readBedMeshViewSetting(config.value, 'wireframe'))
const fixedLimit = computed(() => configNumber(config.value, 'fixedLimit', 0.1))
const rangeWarning = computed(() => configNumber(config.value, 'rangeWarning', 0.2))
const temperatureWarning = computed(() => configNumber(config.value, 'temperatureWarning', 5))
const orientationName = computed(
  () => configString(config.value, 'orientation', 'rightFront') as MeshOrientationName,
)
/**
 * Saved for the 3D view only — the 2D map is always orthographic by
 * definition, a plan view with no lens in it. `paintOptions` fades this in
 * over the same transition that rotates the camera, rather than cutting to it,
 * so switching views moves smoothly between the two rather than snapping.
 */
const projection = computed(
  () => configString(config.value, 'projection', 'perspective') as MeshProjection,
)
const renderStyle = computed(
  () => configString(config.value, 'renderStyle', 'surface') as MeshRenderStyle,
)

const deviationFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
)
const positionFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }),
)
const temperatureFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
)

/**
 * The range the gradient covers, and nothing else. Fixed by default so two
 * meshes read against the same ruler can be compared; scaled to the mesh it
 * answers the other question, what shape this particular bed is.
 *
 * The surface's height is a separate scale on purpose — see `meshHeightLimits`.
 * Changing the gradient must not change how far the bed appears to stray.
 */
const scale = computed<MeshScale>(() => {
  if (scaleToMesh.value) return meshColourRange(bedMesh.values)
  const limit = Math.max(0.005, fixedLimit.value)
  return { low: -limit, high: limit }
})

const heightLimits = computed(() => meshHeightLimits(bedMesh.lowest, bedMesh.highest))
const zMax = computed(() => {
  const chosen = configNumber(config.value, 'zMax', 0.5)
  return Math.min(heightLimits.value.max, Math.max(heightLimits.value.min, chosen))
})

/** The whole bed, so the probed area is seen in its place on it. */
const bed = computed<MeshArea>(() => {
  const [minX, minY] = printer.buildVolume.minimum
  const [maxX, maxY] = printer.buildVolume.maximum
  const probed = probedArea.value
  // Before the printer reports its axis limits there is still a mesh to draw,
  // so the probed area stands in rather than the card showing nothing.
  if (
    typeof minX !== 'number' ||
    typeof minY !== 'number' ||
    typeof maxX !== 'number' ||
    typeof maxY !== 'number' ||
    maxX <= minX ||
    maxY <= minY
  ) {
    return probed
  }
  return { minX, minY, maxX, maxY }
})

/** Whether a run is being followed right now, which only the page ever asks for. */
const isFollowingRun = computed(() => props.liveProbing === true && probeRun.isRunning)

/*
 * Live points, plotted against the mean of the run so far.
 *
 * Klipper reports each probe as an absolute trigger height, not as a deviation,
 * and the surface is drawn as deviation around zero — so a zero has to be chosen
 * to plot against. The running mean is that choice: it needs no knowledge of the
 * reference point Klipper will use, and it converges on the real thing as points
 * arrive. The cost is that early points shift as the mean moves, which is honest
 * about how much is known and is why the panel calls the view provisional.
 */
/** The zero every live reading is plotted against — the mean, per the note above. */
const liveMean = computed(() => {
  const collected = probeRun.points
  if (collected.length === 0) return 0
  return collected.reduce((total, point) => total + point.z, 0) / collected.length
})

const liveMarkers = computed<MeshProbeMarker[]>(() => {
  const collected = probeRun.points
  if (!isFollowingRun.value || collected.length === 0) return []
  const mean = liveMean.value
  return collected.map((point) => ({
    x: point.x,
    y: point.y,
    deviation: point.z - mean,
    label: deviationFormatter.value.format(point.z - mean),
  }))
})

/*
 * The colour-filled surface between probed points, appearing once there is
 * something to interpolate between: two finished rows. `liveMeshGrid` does the
 * actual grouping into rows — see `features/bedMesh/probeRun.ts` for why rows
 * rather than a running triangulation — so this only converts its absolute
 * heights to the same deviation-from-the-mean the markers already plot, which
 * is what the shared renderer expects a surface's values to be.
 */
const liveGrid = computed<{ matrix: number[][]; area: MeshArea } | null>(() => {
  if (!isFollowingRun.value) return null
  const grid = liveMeshGrid(probeRun.points)
  if (!grid) return null
  const mean = liveMean.value
  return { matrix: grid.matrix.map((row) => row.map((z) => z - mean)), area: grid.area }
})

const probedArea = computed<MeshArea>(() => {
  const minimum = bedMesh.meshMin
  const maximum = bedMesh.meshMax
  /*
   * Gated on `isActive`, not on `minimum && maximum` being truthy — Klipper
   * reports mesh_min/mesh_max as (0, 0), not null, the instant a calibration
   * clears the previous mesh, on any printer that has ever calibrated one
   * before. Checking only truthiness meant this branch was taken during every
   * run on a printer with mesh history, not only a first-ever one, and the
   * live fallback below was silently unreachable.
   */
  if (bedMesh.isActive && minimum && maximum) {
    return { minX: minimum[0], minY: minimum[1], maxX: maximum[0], maxY: maximum[1] }
  }
  /*
   * No mesh to take an area from — a first-ever calibration, or any run in
   * progress on a printer that has calibrated before — and the 200 mm fallback
   * below would plot a 350 mm bed's points off the edge of it. The points
   * being probed describe their own area perfectly well, so during a run they
   * are what the stage is fitted to.
   */
  const live = liveMarkers.value
  if (live.length > 1) {
    const xs = live.map((point) => point.x)
    const ys = live.map((point) => point.y)
    const area = {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    }
    // Two points in a line give a zero-width area, which would divide by zero
    // when the scene is placed. The bed stands in until the grid has spread.
    if (area.maxX > area.minX && area.maxY > area.minY) return area
  }
  return { minX: 0, minY: 0, maxX: 200, maxY: 200 }
})

/**
 * The interval the terraces snap to and the contour lines are drawn at, taken
 * from the same ladder the height axis is numbered with — one division finer,
 * so every axis number is also a band edge. Two ladders in one picture would
 * mean a step you can see and cannot find a number for.
 */
const bandStep = computed(() => meshTickStep(zMax.value * 2, 8))

/**
 * The comparison profile's own probed points and area, read straight out of
 * `configfile.settings` — never loaded onto the printer, so judging one mesh
 * against another costs no command and changes nothing about which profile is
 * actually active. `readSavedMeshProfile` documents the config shape this
 * relies on; `null` covers a name that does not exist and a section that
 * fails to parse identically; either way there is simply nothing to overlay.
 */
const compareMesh = computed(() => {
  const name = props.compareProfile
  if (!name) return null
  return readSavedMeshProfile(printerConfig.section(`bed_mesh ${name}`))
})

/**
 * Divisions on a side for the level plane's own grid — fine enough that the
 * perspective lens's warp is negligible across any one quad, cheap enough
 * that the extra geometry costs nothing measurable. See the `flat` layer's
 * own comment in `layers` for why a flat plane needs this at all.
 */
const flatPlaneDivisions = 24
/** Never changes shape, so a plain constant rather than a computed. */
const flatPlaneGrid: number[][] = Array.from({ length: flatPlaneDivisions }, () =>
  Array.from({ length: flatPlaneDivisions }, () => 0),
)

// Typed for the renderer rather than for the scene: the GPU builds the layers
// now, and the scene only needs the subset it always did — every field it reads
// is still here.
const layers = computed<MeshGlLayer[]>(() => {
  const built: MeshGlLayer[] = []
  if (showFlatLayer.value) {
    built.push({
      key: 'flat',
      // Subdivided, not the two points it takes to describe a flat plane's
      // corners. Screen position is a *nonlinear* function of bed position
      // under any lens but orthographic — `projectWithCamera`'s `lens` factor
      // scales x and y by an amount that itself depends on depth — and the
      // rasterizer only ever interpolates a triangle's corners affinely in
      // screen space. `mesh` and `probed` already carry enough quads that
      // each one's share of that curve is negligible; one giant quad here
      // does not, and the gap between the straight line the rasterizer draws
      // and the true curve is exactly where this plane depth-tested wrong
      // against a finely subdivided mesh — a patch that read as the level
      // crossing into the mesh, in the wrong place at the wrong angle,
      // because there was no error at the four corners to see, only in
      // between them.
      matrix: flatPlaneGrid,
      // The whole bed, not the probed patch: this is what the entire plate
      // would look like if it needed no correction at all, and that question
      // still makes sense over bed the mesh never reached.
      area: bed.value,
      // Translucent, and left to the depth test rather than shaped around
      // the mesh: a plain surface sharing the scene with the mesh's own, the
      // way established Klipper web interfaces already draw this exact
      // reference — three independent surfaces in one 3D scene, with nothing
      // clipped or masked between them.
      opacity: 0.5,
      neutral: true,
      // Always a plain skin, whatever the data is drawn as. This is the level
      // the bed is being judged against, not a second reading of it, and a
      // reference drawn as a field of columns is no longer a reference.
      style: 'surface',
      bandStep: bandStep.value,
    })
  }
  if (showMeshLayer.value && bedMesh.surfaceMatrix.length > 0) {
    built.push({
      key: 'mesh',
      matrix: bedMesh.surfaceMatrix,
      area: probedArea.value,
      opacity: 1,
      style: renderStyle.value,
      bandStep: bandStep.value,
    })
  }
  if (showProbedLayer.value && bedMesh.probedMatrix.length > 0) {
    built.push({
      key: 'probed',
      matrix: bedMesh.probedMatrix,
      area: probedArea.value,
      opacity: showMeshLayer.value ? 0.75 : 1,
      style: renderStyle.value,
      bandStep: bandStep.value,
      // Opposite end of the same ramp, not a shared one: a probed point and
      // the interpolated cell under it sit at nearly the same spot in space,
      // so drawing both from the one ramp made the probed layer read as a
      // slightly darker copy of the mesh rather than a distinct layer. This
      // reads at a glance regardless of what either value actually is —
      // it does not depend on the two disagreeing.
      invertRamp: showMeshLayer.value,
    })
  }
  // The flat map's own reading, uploaded once alongside whichever style the
  // resting 3D view draws rather than swapped in when the toggle is pressed.
  // `draw` crossfades between this and `mesh`/`probed` by opacity alone, so
  // the switch rides the same camera transition rather than cutting to it.
  // Built regardless of `renderStyle` — including when it is already
  // `'mosaic'` and a `mesh`/`probed` layer would look identical — because this
  // is what `frameLayerDraws` crossfades *to* in 2D: without it, `hasFlatMosaic`
  // is false, `mesh`/`probed` never fade out at `t = 0`, and the flat view
  // shows both layers at once instead of forcing the one below.
  //
  // Probed, not mesh: the flat map is read like a spreadsheet, one number per
  // cell, and the number an overlay label prints has always been the probed
  // reading (see `probeMarkers`) — so the tile under it has to be coloured for
  // that same reading. Mesh is Klipper's interpolation between probed points,
  // so colouring the flat map from it would show a tile disagreeing with the
  // very number sitting on top of it. Mesh stands in only when a profile
  // carries no probed points to fall back on.
  if (showMeshLayer.value || showProbedLayer.value) {
    const flatMatrix =
      bedMesh.probedMatrix.length > 0 ? bedMesh.probedMatrix : bedMesh.surfaceMatrix
    if (flatMatrix.length > 0) {
      built.push({
        key: 'flatMosaic',
        matrix: flatMatrix,
        area: probedArea.value,
        opacity: 1,
        style: 'mosaic',
        bandStep: bandStep.value,
      })
    }
  }
  if (compareMesh.value) {
    built.push({
      key: 'compare',
      matrix: compareMesh.value.matrix,
      area: compareMesh.value.area,
      // Neutral and translucent, the same technique the `flat` reference plane
      // above already uses — not the deviation ramp, and deliberately never
      // wireframed (`frameLayerDraws` already suppresses wireframe on every
      // `neutral` layer): a second solid, fully-opaque surface competing for
      // the same colours as the live mesh would make it hard to tell which
      // reading belongs to which profile. A ghost the live surface still
      // shows through is read as "the other one", not as a second answer to
      // the same question.
      opacity: 0.4,
      neutral: true,
      style: 'surface',
      bandStep: bandStep.value,
    })
  }
  if (isFollowingRun.value && liveGrid.value) {
    built.push({
      key: 'live',
      matrix: liveGrid.value.matrix,
      area: liveGrid.value.area,
      opacity: 1,
      // The finished mesh's own default rather than whatever `renderStyle` is
      // set to: a run in progress has nowhere near enough points yet to read as
      // bars, terraces, or contours, and a plain skin is the one style that
      // still looks correct with as few as two rows.
      style: 'surface',
      bandStep: bandStep.value,
    })
  }
  return built
})

const preset = computed<MeshOrientation>(
  () => meshOrientationPresets[orientationName.value] ?? meshOrientationPresets.rightFront,
)

/**
 * Whether the projection has taken the angle out of the user's hands. The
 * axonometric projections and the oblique pair are each *defined* by a viewing
 * angle, so the preset has nothing to do while one is chosen, and neither does
 * a drag — a surface that turns under the pointer and springs straight back is
 * worse than one that declines to turn.
 */
const angleIsFixed = computed(() => meshProjectionFixesAngle(projection.value))

/**
 * The saved resting angle, as the projection will actually draw it. One-point
 * perspective is the interesting case: it only requires being square-on, so the
 * preset still chooses which face — and so does an orbit, which snaps from one
 * face to the next as it passes.
 */
const restingOrientation = computed<MeshOrientation>(() =>
  meshOrientationFor(projection.value, preset.value),
)
/**
 * Locking freezes the framing the user arrived at and hands the wheel back to
 * the page. An orbit and a zoom are otherwise deliberately ephemeral — a look
 * around, not a decision — so the angle a lock is taken at is written to the
 * module's own configuration rather than left in the ephemeral refs, which is
 * what makes it survive a reload the way the preset does.
 */
const locked = computed(() => configBoolean(config.value, 'locked', false))
const lockedOrientation = computed<MeshOrientation>(() => ({
  alpha: configNumber(config.value, 'lockedAlpha', restingOrientation.value.alpha),
  beta: configNumber(config.value, 'lockedBeta', restingOrientation.value.beta),
}))
const lockedZoom = computed(() => configNumber(config.value, 'lockedZoom', 1))

const orientation = computed<MeshOrientation>(() => {
  // The voyage takes the camera as well as the geometry: it is composed for one
  // angle, and a bed left in plan view would show a flat blue rectangle.
  if (voyage.value) return meshOrientationPresets.rightFront
  return locked.value
    ? lockedOrientation.value
    : meshOrientationFor(projection.value, dragged.value ?? preset.value)
})
const magnification = computed(() => (locked.value ? lockedZoom.value : zoom.value))

const profileOptions = computed(() =>
  bedMesh.profiles.map((name) => ({ value: name, label: name })),
)

const probeMarkers = computed<MeshProbeMarker[]>(() => {
  const rows = bedMesh.rowCount
  const columns = bedMesh.columnCount
  if (rows < 2 || columns < 2) return []
  const area = probedArea.value
  const stepX = (area.maxX - area.minX) / (columns - 1)
  const stepY = (area.maxY - area.minY) / (rows - 1)
  return bedMesh.cells.map((cell) => ({
    x: area.minX + cell.column * stepX,
    y: area.minY + cell.row * stepY,
    deviation: cell.deviation,
    label: deviationFormatter.value.format(cell.deviation),
  }))
})

const isOutOfTolerance = computed(
  () => bedMesh.range !== null && rangeWarning.value > 0 && bedMesh.range > rangeWarning.value,
)

/**
 * Klipper never records what the bed was probed at, so this is null whenever
 * the active profile predates this feature or was saved from elsewhere — no
 * warning fires for those, rather than a guessed one. `target` (not the live
 * reading) answers the question that matters: what the bed is about to run
 * this print at.
 */
const temperatureMismatch = computed(() => {
  const probed = bedMesh.activeProbeTemperature
  const target = telemetry.bed.target
  if (probed === null || target === null || target <= 0 || temperatureWarning.value <= 0) {
    return null
  }
  const delta = Math.abs(probed - target)
  return delta > temperatureWarning.value ? { probed, target, delta } : null
})

const mapLabel = computed(() =>
  t(showSurface.value ? 'dashboard.bedMesh.surfaceLabel' : 'dashboard.bedMesh.mapLabel', {
    range: deviation(bedMesh.range),
    profile: bedMesh.profileName,
  }),
)

/**
 * Three states, not two: a printer that has never been probed and one that has
 * a mesh saved but not currently loaded look identical if both just say
 * "no mesh" — the second is a bed running unlevelled that used to know better,
 * which is worth a warning the first case does not deserve.
 */
const headerStatus = computed<'none' | 'unloaded' | 'loaded'>(() => {
  if (bedMesh.isActive) return 'loaded'
  return bedMesh.profiles.length > 0 ? 'unloaded' : 'none'
})

function deviation(value: number | null): string {
  return value === null ? t('dashboard.unavailableValue') : deviationFormatter.value.format(value)
}

function formatTick(value: number, axis: 'x' | 'y' | 'z'): string {
  return axis === 'z'
    ? deviationFormatter.value.format(value)
    : positionFormatter.value.format(value)
}

function resolveRgb(variable: string): MeshRgb {
  const probe = document.createElement('span')
  probe.style.color = `var(${variable})`
  probe.style.display = 'none'
  document.body.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  const values = resolved.match(/[-+]?\d*\.?\d+/g)?.map(Number) ?? []
  if (resolved.startsWith('color(')) {
    return [(values[0] ?? 0) * 255, (values[1] ?? 0) * 255, (values[2] ?? 0) * 255]
  }
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0]
}

function refreshPalette(): void {
  palette = {
    lowDeep: resolveRgb('--mesh-low-deep'),
    low: resolveRgb('--mesh-low'),
    middle: resolveRgb('--mesh-middle'),
    high: resolveRgb('--mesh-high'),
    highDeep: resolveRgb('--mesh-high-deep'),
    plane: resolveRgb('--mesh-plane'),
    line: resolveRgb('--text-primary'),
    guide: resolveRgb('--text-muted'),
  }
  // Canvas font strings cannot read a custom property, so painter.ts needs the
  // resolved family, not `var(--font-mono)` — see its own file header.
  fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
  draw()
}

/**
 * The camera the scale is worked out from: the resting angle carried through
 * the flat-to-3D transition, never the angle the user has dragged to. Fitting
 * to the dragged angle rescaled the whole scene on every frame of an orbit,
 * which read as the mesh pulsing under the pointer instead of turning.
 */
const fitOrientation = computed(() =>
  meshOrientationAt(
    voyage.value ? meshOrientationPresets.rightFront : restingOrientation.value,
    viewpoint.value,
  ),
)

/** Room for the axis numbers, which are written outside the box. */
const padding = computed(() => {
  const shown = viewpoint.value
  return {
    left: 32 * shown,
    right: 6 * shown,
    top: 8 * shown,
    bottom: 22 * shown,
  }
})

function paintOptions() {
  return {
    bed: bed.value,
    layers: layers.value,
    zMax: zMax.value,
    orientation: meshOrientationAt(orientation.value, viewpoint.value),
    fitOrientation: fitOrientation.value,
    padding: padding.value,
    projection: projection.value,
    // The lens fades in with the same t that rotates the camera, so the 2D map
    // is exactly orthographic at rest and the chosen projection is exactly
    // itself once the 3D view settles, with nothing but a cut in between.
    projectionAmount: viewpoint.value,
    zoom: magnification.value,
    viewport: viewportSize.value,
    t: viewpoint.value,
    scale: scale.value,
    palette: palette as MeshPalette,
    fontFamily,
    // No probe numbers over the sea: they annotate a mesh that is not being
    // drawn, and they would be read as depths.
    probes: isFollowingRun.value
      ? liveMarkers.value
      : showProbesEffective.value && !voyage.value
        ? probeMarkers.value
        : [],
    // Live points are the only thing on the map during a run, so they show
    // whether or not the card's own probe markers are switched on.
    showProbes: isFollowingRun.value || (showProbesEffective.value && !voyage.value),
    forceProbeLabels: props.forceProbeLabels === true,
    wireframe: wireframe.value && viewpoint.value > 0.01,
    axisLabels: {
      x: t('dashboard.bedMesh.axisX'),
      y: t('dashboard.bedMesh.axisY'),
      z: t('dashboard.bedMesh.axisZ'),
    },
    formatTick,
  }
}

/**
 * Uploads each visible layer's geometry to the GPU, and drops the buffers of
 * any layer the user has switched off. Called when the mesh or the layer
 * selection changes — never per frame, because the camera lives entirely in
 * the vertex shader and an orbit re-transforms these same buffers.
 */
function syncLayers(): void {
  if (!renderer) return
  const wanted = new Set(layers.value.map((layer) => layer.key))
  for (const key of uploadedLayers) {
    if (!wanted.has(key)) {
      renderer.removeLayer(key)
      uploadedLayers.delete(key)
    }
  }
  for (const layer of layers.value) {
    renderer.setLayer({ ...layer, wireframe: false })
    uploadedLayers.add(layer.key)
  }
}

/**
 * The easter egg, in three parts: build this instant's geometry, upload it, and
 * say what to draw. Rebuilt every frame rather than transformed in the shader —
 * the sea changes shape rather than merely moving, so there is no camera trick
 * that would save the work, and at forty voxels across it is a millisecond.
 */
const voyageDraws = ref<MeshGlDraw[] | null>(null)

function paintVoyage(now: number): void {
  const state = voyage.value
  if (!state || !renderer) return
  const boxHeight =
    (Math.min(bed.value.maxX - bed.value.minX, bed.value.maxY - bed.value.minY) /
      Math.max(bed.value.maxX - bed.value.minX, bed.value.maxY - bed.value.minY)) *
    meshHeightAgainstBed
  const built = buildVoyageFrame({
    area: probedArea.value,
    zMax: zMax.value,
    boxHeight,
    elapsed: now - state.startedAt,
    stillness: prefersReducedMotion(),
    // The cool half of the ramp and nothing else, so the swell runs deep blue
    // to white without ever reaching the warm end the ramp keeps for a bed
    // that is high where it should be level.
    colour: { trough: scale.value.low, crest: 0 },
  })

  renderer.setGeometry('voyage-sea', built.sea)
  renderer.setGeometry('voyage-boat', built.boat)
  voyageDraws.value = [
    // The sea takes the deviation ramp, so crests run warm and troughs cool and
    // the swell is legible as colour as well as as shape.
    { key: 'voyage-sea', opacity: 1, wireframe: false },
    // The boat does not: on a pale sea a hull coloured by its own height would
    // vanish into it. One flat colour nothing else in the card uses, with every
    // voxel outlined so the shape reads as a shape rather than a silhouette.
    { key: 'voyage-boat', opacity: built.boatOpacity, neutral: true, wireframe: true },
  ]
  draw()

  if (built.finished) {
    endVoyage()
    return
  }
  voyageFrame = requestAnimationFrame(paintVoyage)
}

function startVoyage(): void {
  if (voyage.value || !bedMesh.isActive) return
  voyage.value = { startedAt: performance.now() }
  // The sea is a 3D scene; a card left in plan view would show a blue
  // rectangle. The camera swings up over the usual transition rather than
  // cutting, which is also the entrance.
  if (viewpoint.value < 1) moveViewpointTo(1, true)
  voyageFrame = requestAnimationFrame(paintVoyage)
}

function endVoyage(): void {
  if (voyageFrame !== null) cancelAnimationFrame(voyageFrame)
  voyageFrame = null
  voyage.value = null
  voyageDraws.value = null
  renderer?.removeLayer('voyage-sea')
  renderer?.removeLayer('voyage-boat')
  // The card was never reconfigured, so there is nothing to put back: its own
  // layers are re-uploaded and it draws exactly what it drew before.
  syncLayers()
  if (viewpoint.value !== (showSurface.value ? 1 : 0)) {
    moveViewpointTo(showSurface.value ? 1 : 0, true)
  } else {
    draw()
  }
}

/**
 * The per-frame opacity that crossfades `mesh`/`probed` into `flatMosaic` as
 * the camera settles to top-down, and back as it lifts into the resting 3D
 * view. Geometry for both sides is uploaded once, by `syncLayers`, whenever
 * the data or the chosen style changes — never here — so this is the one
 * place `viewpoint` is allowed to touch what a frame draws, the same way an
 * orbit or a zoom already only ever moves the camera the buffers are already
 * sitting in.
 */
function frameLayerDraws(): MeshGlDraw[] {
  const hasFlatMosaic = layers.value.some((layer) => layer.key === 'flatMosaic')
  const flatAmount = 1 - viewpoint.value
  return layers.value.map((layer) => {
    const isFlatMosaic = layer.key === 'flatMosaic'
    const isCrossfaded =
      hasFlatMosaic && (isFlatMosaic || layer.key === 'mesh' || layer.key === 'probed')
    // The level plane is not part of that crossfade: it is a hard cut, timed
    // by `levelReveal` rather than by `viewpoint` — see the ref's own comment.
    const blend =
      layer.key === 'flat'
        ? levelReveal.value
          ? 1
          : 0
        : isCrossfaded
          ? isFlatMosaic
            ? flatAmount
            : viewpoint.value
          : 1
    return {
      ...layer,
      opacity: layer.opacity * blend,
      wireframe: wireframe.value && viewpoint.value > 0.01 && !layer.neutral && !isFlatMosaic,
    }
  })
}

function draw(): void {
  const { width: stageWidth, height: stageHeight } = viewportSize.value
  if (stageWidth <= 0 || stageHeight <= 0) return
  if (!palette) refreshPalette()
  if (!palette) return
  const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
  const options = paintOptions()
  const scene = buildMeshScene({ ...options, layers: [] })

  if (renderer && scene) {
    renderer.setGuides(scene.guides)
    renderer.render(
      {
        camera: scene.camera,
        palette,
        scale: scale.value,
        guides: scene.guides,
        guideAlpha: Math.max(0, (viewpoint.value - 0.3) / 0.7),
        width: stageWidth,
        height: stageHeight,
        pixelRatio: ratio,
      },
      voyageDraws.value ?? frameLayerDraws(),
    )
  }

  const element = overlay.value
  if (!element) return
  const deviceWidth = Math.round(stageWidth * ratio)
  const deviceHeight = Math.round(stageHeight * ratio)
  if (element.width !== deviceWidth) element.width = deviceWidth
  if (element.height !== deviceHeight) element.height = deviceHeight
  // jsdom and any browser refusing the context return null; the card still
  // renders its numbers, which are the reading that has to survive.
  const context = element.getContext('2d')
  if (!context) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  paintMeshOverlay(context, options)
}

function prefersReducedMotion(): boolean {
  // Optional, so an environment without matchMedia still animates rather than
  // silently losing the transition everywhere the API is missing.
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function step(now: number): void {
  const elapsed = Math.min(1, (now - animationStart) / viewpointDuration)
  // The emphasized curve from ADR 0004, so the surface leaves and settles the
  // way every other large movement in the application does.
  const eased = 1 - Math.pow(1 - elapsed, 3)
  viewpoint.value = animationFrom + (animationTo - animationFrom) * eased
  draw()
  if (elapsed < 1) {
    frame = requestAnimationFrame(step)
    return
  }
  frame = null
  // The level plane only comes back once the swing into 3D has actually
  // finished — see `levelReveal` — which is here, not at the point the
  // animation was started, and needs its own draw: the frame just painted
  // above still belongs to the plane being hidden.
  if (animationTo === 1 && !levelReveal.value) {
    levelReveal.value = true
    draw()
  }
}

function moveViewpointTo(target: number, animate: boolean): void {
  if (frame !== null) cancelAnimationFrame(frame)
  frame = null
  // Dropped at once, on the call that starts heading to 2D, rather than
  // faded with the camera — a plane spanning the whole bed fading in behind a
  // swing that is not even finished yet would be more distracting than the
  // haze it replaces.
  if (target === 0) levelReveal.value = false
  if (!animate || prefersReducedMotion()) {
    viewpoint.value = target
    if (target === 1) levelReveal.value = true
    draw()
    return
  }
  animationFrom = viewpoint.value
  animationTo = target
  animationStart = performance.now()
  frame = requestAnimationFrame(step)
}

function toggleView(): void {
  updateConfig({ showSurface: !showSurface.value })
}

function stagePoint(event: PointerEvent): [number, number] {
  const box = overlay.value?.getBoundingClientRect()
  if (!box) return [0, 0]
  return [event.clientX - box.left, event.clientY - box.top]
}

function readAt(event: PointerEvent): void {
  if (dragFrom || !palette) return
  const scene = buildMeshScene(paintOptions())
  if (!scene) return
  const [x, y] = stagePoint(event)
  reading.value = nearestMeshProbe(scene, probeMarkers.value, x, y, probeReach)
}

/**
 * Orbiting is only offered in the 3D view: dragging a map seen from directly
 * above would spin it under the pointer with nothing to indicate why, and the
 * flat view's whole purpose is to be the one fixed orientation.
 */
function startOrbit(event: PointerEvent): void {
  if (locked.value || angleIsFixed.value || !showSurface.value || event.button !== 0) return
  dragPointer = event.pointerId
  dragFrom = { x: event.clientX, y: event.clientY, ...orientation.value }
  overlay.value?.setPointerCapture(event.pointerId)
}

function orbit(event: PointerEvent): void {
  if (!dragFrom || event.pointerId !== dragPointer) {
    readAt(event)
    return
  }
  event.preventDefault()
  dragged.value = {
    // The full orbit: on past level and down to looking up from underneath
    // the bed, not only the hemisphere above it — see `trigFor`.
    alpha: Math.min(90, Math.max(-90, dragFrom.alpha + (event.clientY - dragFrom.y) * 0.4)),
    beta: dragFrom.beta - (event.clientX - dragFrom.x) * 0.4,
  }
  draw()
}

function endOrbit(event: PointerEvent): void {
  if (event.pointerId !== dragPointer) return
  dragPointer = null
  dragFrom = null
  overlay.value?.releasePointerCapture?.(event.pointerId)
}

/**
 * The presets are the saved orientations, so a card returns to the angle its
 * owner chose rather than to wherever it was last dragged, and to its saved
 * magnification rather than wherever the wheel left it. An orbit and a zoom
 * are both a look around, not a decision.
 */
function resetView(): void {
  dragged.value = null
  zoom.value = 1
  draw()
}

/**
 * Unlocking hands the view back exactly as it was framed rather than snapping
 * to the saved preset — the lock was taken at an angle the user chose, and
 * throwing it away the moment they re-enable the controls would punish them for
 * looking. The reset chip reappears alongside, which is how they get back.
 */
function toggleLock(): void {
  if (locked.value) {
    dragged.value = { ...lockedOrientation.value }
    zoom.value = lockedZoom.value
    updateConfig({ locked: false })
    return
  }
  updateConfig({
    locked: true,
    lockedAlpha: orientation.value.alpha,
    lockedBeta: orientation.value.beta,
    lockedZoom: zoom.value,
  })
}

/**
 * Scrolling over the card is instinctive, and a `<canvas>` has no native scroll
 * behaviour of its own to claim the gesture — so without this the page behind
 * it scrolls instead, which reads as the card flying off under the pointer.
 * Zooming works in both views: unlike the orbit, magnifying the flat map to
 * see a value more closely is still a meaningful thing to want.
 */
function onWheel(event: WheelEvent): void {
  // Locked, the card stops claiming the gesture at all: the wheel belongs to
  // the page again, which is the point of locking a viewer that sits in the
  // middle of a scrolling dashboard.
  if (locked.value) return
  event.preventDefault()
  const factor = Math.exp(-event.deltaY * 0.0015)
  zoom.value = Math.min(zoomMax, Math.max(zoomMin, zoom.value * factor))
  draw()
}

function measure(): void {
  const element = stage.value
  if (!element) return
  viewportSize.value = { width: element.clientWidth, height: element.clientHeight }
  draw()
}

// The toggle is the only thing that animates. Everything else — a fresh mesh, a
// changed scale, a resize — is redrawn where the camera already stands, so a
// status update arriving mid-flight does not restart the movement.
watch(showSurface, (surface) => moveViewpointTo(surface ? 1 : 0, true))
// Choosing a preset is choosing an angle, so it takes effect over whatever the
// view was dragged to. Choosing a projection is not: a lens change answers a
// different question, and throwing away the angle the user had lined up in
// order to apply it made the projection select feel like it also spun the
// model.
watch(orientationName, resetView)

// The projections that name their own angle are the exception, because for them
// the angle is not a lens: equal foreshortening on all three axes is an angle,
// and it is the whole of what "isometric" means. Left under a drag they would
// appear to do nothing at all. Only the drag is released, not the zoom —
// magnification is no part of what any of them names, and taking it as well
// would be the same overreach as resetting the angle for a lens.
watch(projection, (next) => {
  if (meshProjectionFixesAngle(next)) dragged.value = null
})

watch(
  () => bedMesh.voyageRequests,
  (requests) => {
    if (requests > 0) startVoyage()
  },
)
// Everything `paintOptions` reads that is not driven by the animation itself.
// A setting left out of this list still reaches the canvas — on the next
// unrelated redraw — which reads as a control that does nothing, so anything
// added to `paintOptions` is added here too. `BedMeshModule.spec.ts` fails if
// one is forgotten.
//
// `liveMarkers` and `isFollowingRun` are here for the same reason even though
// `layers` already recomputes on every new probed point once it depends on
// `liveGrid`, which makes the two technically redundant today: a card that
// only redrew when the *count* of finished rows changed, and otherwise waited
// for whatever unrelated setting a user next touched, is the exact bug this
// list exists to catch, and the file already documents it happening once
// (the projection dropdown, see the guard test below). Declaring the
// dependency here rather than relying on `layers`' internals keeps that true
// even if a later change decides `layers` no longer needs to look at the run.
watch(
  [
    layers,
    scale,
    zMax,
    probeMarkers,
    liveMarkers,
    isFollowingRun,
    bed,
    wireframe,
    showProbes,
    orientation,
    projection,
    magnification,
  ],
  draw,
)

// Geometry goes to the GPU only when the geometry itself changes. Camera moves
// — orbit, zoom, the flat-to-3D transition — never reach this.
watch(layers, () => {
  syncLayers()
  draw()
})

// The stage only exists once a mesh is loaded, so it is not there to observe at
// mount, and neither is the canvas the renderer needs. Attaching on mount alone
// left the canvas at its intrinsic 300x150 and nothing drawn on a printer whose
// mesh arrived a moment after the card did.
watch(stage, (element) => {
  if (!resizeObserver) return
  resizeObserver.disconnect()
  if (!element) {
    // The canvas goes with the stage — clearing the mesh unmounts both, and
    // the renderer's WebGL context dies with the canvas it was created from.
    // Leaving `renderer` set here made `attachRenderer` a no-op against the
    // next canvas, so a mesh loaded back in never drew: the guard saw a
    // renderer that still existed and skipped rebuilding it.
    renderer?.dispose()
    renderer = null
    uploadedLayers.clear()
    return
  }
  resizeObserver.observe(element)
  attachRenderer()
  measure()
})

/**
 * Creates the WebGL renderer once its canvas exists. A browser that refuses a
 * WebGL 2 context leaves `renderer` null: the card then still draws its axes,
 * its probed numbers and every figure below the map, because those live on the
 * 2D overlay. The map goes missing; the reading does not.
 */
function attachRenderer(): void {
  if (renderer || !surface.value) return
  try {
    renderer = new MeshGlRenderer(surface.value)
  } catch {
    renderer = null
    return
  }
  uploadedLayers.clear()
  syncLayers()
}

onMounted(() => {
  viewpoint.value = showSurface.value ? 1 : 0
  refreshPalette()
  resizeObserver = new ResizeObserver(measure)
  if (stage.value) resizeObserver.observe(stage.value)
  attachRenderer()
  themeObserver = new MutationObserver(refreshPalette)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-theme-pack', 'data-font'],
  })
  measure()
})

onBeforeUnmount(() => {
  if (frame !== null) cancelAnimationFrame(frame)
  if (voyageFrame !== null) cancelAnimationFrame(voyageFrame)
  resizeObserver?.disconnect()
  themeObserver?.disconnect()
  renderer?.dispose()
  renderer = null
})
</script>

<template>
  <AppDashboardModule :open="isSettingsOpen">
    <template #quick-settings>
      <BedMeshQuickSettings />
    </template>

    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="min-w-0">
        <p class="text-eyebrow text-data-sky">
          {{ t('dashboard.bedMesh.profile') }}
        </p>
        <p
          class="mesh-status mt-1 text-card-title"
          :class="{ 'text-caution-text': headerStatus === 'unloaded' }"
        >
          <AppIcon
            v-if="headerStatus === 'unloaded'"
            name="warning"
            class="size-3.5 shrink-0"
            aria-hidden="true"
          />
          <span class="truncate">
            {{
              headerStatus === 'loaded'
                ? t('dashboard.bedMesh.statusLoaded', { name: bedMesh.profileName })
                : headerStatus === 'unloaded'
                  ? t('dashboard.bedMesh.statusUnloaded')
                  : t('dashboard.bedMesh.statusNone')
            }}
          </span>
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <AppSelect
          v-if="bedMesh.profiles.length > 0"
          :model-value="bedMesh.profileName"
          :options="profileOptions"
          :label="t('dashboard.bedMesh.loadProfile')"
          :disabled="printer.pendingCommands.bedMesh || hasJobLoaded"
          @update:model-value="(value) => printer.loadBedMeshProfile(value)"
        />
        <button
          v-if="bedMesh.isActive"
          type="button"
          class="button button--sm"
          :title="t('dashboard.bedMesh.toggleView')"
          @click="toggleView()"
        >
          <AppIcon :name="showSurface ? 'mesh' : 'viewer'" class="size-4" aria-hidden="true" />
          {{ showSurface ? t('dashboard.bedMesh.view2d') : t('dashboard.bedMesh.view3d') }}
        </button>
        <button
          type="button"
          class="button"
          :disabled="printer.pendingCommands.bedMesh || !bedMesh.isActive || hasJobLoaded"
          @click="printer.clearBedMesh()"
        >
          {{ t('dashboard.bedMesh.clear') }}
        </button>
      </div>
    </div>

    <div v-if="bedMesh.isActive || (isFollowingRun && liveMarkers.length > 0)" class="grid gap-3">
      <div ref="stage" class="mesh-stage">
        <!--
          Two stacked canvases: the surfaces and their grid on the GPU
          underneath, the axis numbers and probed markers on a 2D canvas over
          it. WebGL has no text without shipping a glyph atlas, and the
          markers are annotations over the picture rather than part of it.
          The overlay carries the pointer handlers, so there is one surface to
          orbit rather than two to keep in step; the map underneath is inert.

          The context menu is suppressed because this is a viewport, not a
          document: a right-click here is an aimed gesture that lands on the
          model, and a browser menu over it interrupts the drag rather than
          offering anything about what was clicked. Orbit already ignores any
          button but the primary one, so nothing moves either.
        -->
        <canvas ref="surface" class="mesh-canvas" aria-hidden="true"></canvas>
        <canvas
          ref="overlay"
          class="mesh-canvas mesh-canvas--overlay"
          role="img"
          :aria-label="mapLabel"
          :class="{
            'mesh-canvas--orbitable': showSurface && !locked && !angleIsFixed,
            'mesh-canvas--locked': locked,
          }"
          @pointerdown="startOrbit"
          @pointermove="orbit"
          @pointerup="endOrbit"
          @pointercancel="endOrbit"
          @pointerleave="reading = null"
          @wheel="onWheel"
          @contextmenu.prevent
        ></canvas>
        <!--
          A true toggle, unlike the 2D/3D switch beside it: the state persists,
          so it keeps the pressed treatment and says so through `aria-pressed`
          as well as through the shackle. Its name stays put while the state
          changes, which is what `aria-pressed` is for.
        -->
        <button
          type="button"
          class="button button--sm button--icon mesh-stage__lock"
          :aria-pressed="locked"
          :aria-label="t('dashboard.bedMesh.lockView')"
          :title="t('dashboard.bedMesh.lockView')"
          @click="toggleLock()"
        >
          <AppIcon :name="locked ? 'lock' : 'unlock'" class="size-4" aria-hidden="true" />
        </button>
        <button
          v-if="!locked && (dragged || zoom !== 1)"
          type="button"
          class="button button--sm mesh-stage__reset"
          @click="resetView()"
        >
          {{ t('dashboard.bedMesh.resetView') }}
        </button>
      </div>

      <p class="mesh-readout" aria-live="polite">
        <template v-if="reading">
          {{
            t('dashboard.bedMesh.readout', {
              x: positionFormatter.format(reading.x),
              y: positionFormatter.format(reading.y),
              z: reading.label,
            })
          }}
        </template>
      </p>

      <div class="mesh-legend">
        <span class="mesh-legend__value">{{ deviation(scale.low) }}</span>
        <span class="mesh-legend__bar" aria-hidden="true"></span>
        <span class="mesh-legend__value">{{ deviation(scale.high) }}</span>
      </div>

      <dl class="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt class="text-muted">{{ t('dashboard.bedMesh.lowest') }}</dt>
          <dd class="mt-1 font-mono font-black tabular-nums">{{ deviation(bedMesh.lowest) }}</dd>
        </div>
        <div>
          <dt class="text-muted">{{ t('dashboard.bedMesh.highest') }}</dt>
          <dd class="mt-1 font-mono font-black tabular-nums">{{ deviation(bedMesh.highest) }}</dd>
        </div>
        <div>
          <dt class="text-muted">{{ t('dashboard.bedMesh.range') }}</dt>
          <dd class="mt-1 font-mono font-black tabular-nums">{{ deviation(bedMesh.range) }}</dd>
        </div>
      </dl>

      <p v-if="isOutOfTolerance" class="text-xs font-bold text-caution-text">
        {{
          t('dashboard.bedMesh.outOfTolerance', {
            range: deviation(bedMesh.range),
            limit: deviation(rangeWarning),
          })
        }}
      </p>

      <p v-if="temperatureMismatch" class="text-xs font-bold text-caution-text">
        {{
          t('dashboard.bedMesh.temperatureMismatch', {
            probed: temperatureFormatter.format(temperatureMismatch.probed),
            target: temperatureFormatter.format(temperatureMismatch.target),
          })
        }}
      </p>
    </div>

    <div v-else class="grid gap-3">
      <p class="text-xs text-muted">{{ t('dashboard.bedMesh.empty') }}</p>
      <button
        type="button"
        class="button"
        :disabled="printer.pendingCommands.bedMesh || hasJobLoaded"
        @click="printer.calibrateBedMesh()"
      >
        <AppIcon name="mesh" class="size-5" aria-hidden="true" />
        {{ t('dashboard.bedMesh.calibrate') }}
      </button>
    </div>
  </AppDashboardModule>
</template>
