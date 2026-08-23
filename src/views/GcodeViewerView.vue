<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import AppSlider from '@/components/AppSlider.vue'
import AvailabilityRegion from '@/components/AvailabilityRegion.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import GcodeViewerSettingsDialog from '@/components/GcodeViewerSettingsDialog.vue'
import PageHeading from '@/components/PageHeading.vue'
import { useGcodeViewerSettings } from '@/composables/useGcodeViewerSettings'
import { useTouchGesture, type TouchGestureStep } from '@/composables/useTouchGesture'
import { installGcodeViewerBenchmark } from '@/features/gcode/benchmark'
import {
  cameraBasis,
  cameraPosition,
  dollyCamera,
  dollyCameraAt,
  fittedCamera,
  orbitCamera,
  orbitCameraAround,
  panCamera,
  projectGcodePoint,
  worldUnitsPerPixel,
  type GcodeProjection,
} from '@/features/gcode/camera'
import {
  GcodeFileTooLargeError,
  fetchAndParseGcode,
  parseGcodeFile,
  type GcodeLoadProgress,
} from '@/features/gcode/loader'
import { SmoothToolheadPosition } from '@/features/gcode/motion'
import { nozzleHeight, visibleNozzleFaces } from '@/features/gcode/nozzle'
import {
  bedPlaneHit,
  boundsCenter,
  reanchorCamera,
  resolvePivot,
  type GcodePoint,
} from '@/features/gcode/pick'
import {
  GcodeQualityGovernor,
  gcodeBeadProfileFor,
  gcodeQualityStepCount,
  gcodeSubPixelStrategyFor,
} from '@/features/gcode/quality'
import { GcodeRenderer, type GcodeRenderColors } from '@/features/gcode/renderer'
import {
  PlannedToolheadPlayback,
  defaultPlannedPlaybackConfiguration,
  defaultPlannedPositionMatchConfiguration,
  matchPlannedPosition,
  plannedFollowCanStart,
} from '@/features/gcode/plannedPlayback'
import {
  buildGcodeSimulationTimeline,
  sampleGcodeSimulation,
  sampleGcodeSimulationAtTime,
  simulationTimeForCursor,
  type GcodeSimulationTimeline,
} from '@/features/gcode/simulation'
import { currentGcodeLayer } from '@/features/gcode/tracking'
import {
  GcodeFeature,
  defaultGcodeBeadOverlap,
  defaultGcodeFilamentDiameter,
  defaultGcodeNozzleDiameter,
  gcodeSegment,
  gcodeSegmentStride,
  type GcodeBounds,
  type GcodeCamera,
  type GcodeGeometryBatch,
  type GcodeColorMode,
  type GcodeRenderOptions,
  type ParsedGcodeSummary,
} from '@/features/gcode/types'
import { moonrakerGcodeFileUrl } from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { useConfirmationsStore } from '@/stores/confirmations'
import { usePrinterStore } from '@/stores/printer'

interface LoadedGcode {
  name: string
  source: 'moonraker' | 'local'
  size: number
  bounds: GcodeBounds
  sceneBounds: GcodeBounds
  bedBounds: GcodeBounds
  layerHeights: Float32Array
  segmentCount: number
  extrusionCount: number
  travelCount: number
  sourceByteCount: number
  minimumFeedrate: number
  maximumFeedrate: number
}

type ViewerError = 'download' | 'empty' | 'renderer' | 'tooLarge' | null

interface GcodeLoadRequest {
  name: string
  source: LoadedGcode['source']
  size: number
  load: (
    signal: AbortSignal,
    onProgress: (progress: GcodeLoadProgress) => void,
    onBatch: (batch: GcodeGeometryBatch) => void,
  ) => Promise<ParsedGcodeSummary>
}

// Above this size, loading asks first: the segment stream of a file this large
// costs hundreds of megabytes of memory, which weaker devices pay in crashes.
const largeFileConfirmBytes = 150 * 1_048_576

const { locale, t } = useI18n({ useScope: 'global' })
const moonraker = useMoonrakerStore()
const printer = usePrinterStore()
const confirmations = useConfirmationsStore()
const printerConfig = usePrinterConfigStore()
const availability = useAvailabilityStore()
const stage = ref<HTMLElement | null>(null)
const sceneCanvas = ref<HTMLCanvasElement | null>(null)
const overlayCanvas = ref<HTMLCanvasElement | null>(null)
const localFileInput = ref<HTMLInputElement | null>(null)
const selectedRemoteFile = ref('')
const loaded = ref<LoadedGcode | null>(null)
const loading = ref(false)
const loadedBytes = ref(0)
const totalBytes = ref<number | null>(null)
const loadingName = ref('')
const viewerError = ref<ViewerError>(null)
const selectedLayer = ref(0)
const showPreviousLayers = ref(true)
const showTravels = ref(false)
const liveTracking = ref(true)
const camera = reactive<GcodeCamera>(
  fittedCamera(configuredBedBounds() ?? { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 }),
)
const simulationEnabled = ref(false)
const simulationPlaying = ref(false)
const simulationCursor = ref(0)
const simulationFileProgress = ref(0)
const simulationSpeed = ref<1 | 2 | 5 | 10 | 20>(1)
const simulationSpeeds = [1, 2, 5, 10, 20] as const
const smoothToolhead = new SmoothToolheadPosition()
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const reducedMotionEnabled = ref(reducedMotion.matches)
const plannedFollowActive = ref(false)
const plannedFileProgress = ref(0)
const streamingGeometry = ref(false)
const pendingLoad = ref<GcodeLoadRequest | null>(null)
const {
  orbitMode,
  snapToCenter,
  highlightSeams,
  qualityMode,
  nozzleDiameterOverride,
  setOrbitMode,
  setSnapToCenter,
  setHighlightSeams,
  setQualityMode,
  setNozzleDiameterOverride,
} = useGcodeViewerSettings()

/*
 * The bead width used for moves whose extruded volume cannot give one. Most
 * moves declare enough to derive their real width, so this is a fallback rather
 * than a global setting — and the machine's own configured nozzle is a better
 * fallback than a constant. The stored override wins when set, which is what
 * makes a local file inspected with no printer connected still look right.
 */
const effectiveNozzleDiameter = computed(
  () =>
    nozzleDiameterOverride.value ??
    printerConfig.extruderGeometry.nozzleDiameter ??
    defaultGcodeNozzleDiameter,
)
const machineNozzleDiameter = computed(() => printerConfig.extruderGeometry.nozzleDiameter)
const effectiveFilamentDiameter = computed(
  () => printerConfig.extruderGeometry.filamentDiameter ?? defaultGcodeFilamentDiameter,
)
const qualityModes = ['quality', 'auto', 'performance'] as const
const colorModes = ['single', 'feature', 'feedrate'] as const
const fileSearch = ref('')
const statisticsOpen = ref(false)
// The floor of the visible layer range. Zero reproduces "show previous
// layers"; raising it opens a cross-section nothing could show before.
const layerFloor = ref(0)
const colorMode = ref<GcodeColorMode>('single')
/*
 * Which feature categories this file actually contains. The legend lists only
 * these: a legend naming supports for a print with none is a legend the user
 * has to ignore, and ignoring one entry teaches them to ignore all of them.
 */
const presentFeatures = ref<GcodeFeature[]>([])
const featureLegendOrder: readonly GcodeFeature[] = [
  GcodeFeature.PerimeterOuter,
  GcodeFeature.PerimeterInner,
  GcodeFeature.InfillSolid,
  GcodeFeature.Infill,
  GcodeFeature.Bridge,
  GcodeFeature.Support,
  GcodeFeature.Skirt,
  GcodeFeature.Other,
]
const featureTokenNames: Record<GcodeFeature, string> = {
  [GcodeFeature.Other]: 'other',
  [GcodeFeature.PerimeterOuter]: 'perimeterOuter',
  [GcodeFeature.PerimeterInner]: 'perimeterInner',
  [GcodeFeature.Infill]: 'infill',
  [GcodeFeature.InfillSolid]: 'infillSolid',
  [GcodeFeature.Bridge]: 'bridge',
  [GcodeFeature.Support]: 'support',
  [GcodeFeature.Skirt]: 'skirt',
}
const qualityStep = ref(0)
const qualityStepTotal = gcodeQualityStepCount - 1
const numberFormatter = computed(() => new Intl.NumberFormat(locale.value))
const decimalFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 2 }),
)

let renderer: GcodeRenderer | null = null
const governor = new GcodeQualityGovernor(qualityMode.value)
// Only frames that actually rendered the scene are sampled: an idle frame looks
// infinitely fast and would talk the governor into a quality this machine
// cannot hold once the user starts dragging again.
let lastSceneRenderTimestamp = 0
// Samples per screen pixel the scene is drawn at right now. Above 1 while
// beads are small enough that their shading would otherwise alias.
let sampleScale = 1
let currentProjection: GcodeProjection | null = null
// Development benchmark bookkeeping; the window API itself is only installed
// behind `import.meta.env.DEV`.
let benchmarkLoadMilliseconds: number | null = null
let benchmarkGpuBytes: number | null = null
let uninstallBenchmark: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null
let loadController: AbortController | null = null
let sceneFrame = 0
let toolheadFrame = 0
let simulationFrame = 0
let simulationCursorValue = 0
let simulationElapsedValue = 0
let simulationSegments: Float32Array | null = null
let simulationTimeline: GcodeSimulationTimeline | null = null
// The parser's exact byte table, kept as Uint32 (half the memory) and widened
// to the Float64Array the playback controller validates only when a live
// print of this exact file actually starts following.
let followSourceBytesRaw: Uint32Array | null = null
let followSourceBytes: Float64Array | null = null
let followTimeline: GcodeSimulationTimeline | null = null
let lastLoadRequest: GcodeLoadRequest | null = null
let streamBounds: GcodeBounds | null = null
let streamedGpuBytes = 0
let streamedBatchCount = 0
let benchmarkLoadStartedAt = 0
let benchmarkFirstGeometryMilliseconds: number | null = null
let userAdjustedViewDuringLoad = false
let plannedPlayback: PlannedToolheadPlayback | null = null
let plannedToolheadPosition: [number, number, number] | null = null
let plannedFollowBlocked = false
let plannedFollowMismatchStarted: number | null = null
let lastPlannedFollowSceneRender = 0
let simulatedPosition: [number, number, number] | null = null
let lastSimulationTimestamp = 0
let lastSimulationSceneRender = 0
let overlayWidth = 1
let overlayHeight = 1
let overlayPixelRatio = 1
let cachedRenderColors: GcodeRenderColors | null = null
let cachedToolheadFill = ''
let cachedToolheadStroke = ''
let cachedNozzleBase: [number, number, number] = [0, 0, 0]
let cachedAxisX = ''
let cachedAxisY = ''
let cachedAxisZ = ''
let cachedAxisFont = 'ui-monospace, monospace'
const pointerDrag = ref<{
  pointerId: number
  x: number
  y: number
  mode: 'orbit' | 'pan'
  pivot: GcodePoint | null
} | null>(null)
/**
 * Two fingers pan and pinch. The one-finger drag above keeps orbiting, which is
 * the reading a touch user expects from the same gesture a mouse makes, so the
 * second finger is what switches modes rather than a toolbar toggle.
 */
const touch = useTouchGesture()
const settingsOpen = ref(false)
// Held down keys and wheel bursts would otherwise re-pick the pivot far more
// often than the view can change meaningfully.
const pivotPickThrottle = 120
const pivotSnapDuration = 180
const cameraKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_']
let lastPivotPick = 0
let snapFrame = 0
let pivotSnap: {
  fromX: number
  fromY: number
  fromZ: number
  toX: number
  toY: number
  toZ: number
  start: number
} | null = null

const feedrateRange = computed<[number, number]>(() => {
  const minimum = loaded.value?.minimumFeedrate ?? 0
  const maximum = loaded.value?.maximumFeedrate ?? 0
  // A file printed entirely at one speed has no range to map; widen it so the
  // ramp resolves to its slow end instead of dividing by nothing.
  return maximum > minimum ? [minimum, maximum] : [minimum, minimum + 1]
})
const feedrateRangeLabel = computed(() => ({
  slow: Math.round(feedrateRange.value[0] / 60),
  fast: Math.round(feedrateRange.value[1] / 60),
}))
function cssColor(components: readonly [number, number, number, number]): string {
  const channel = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255)
  return `rgb(${channel(components[0])} ${channel(components[1])} ${channel(components[2])})`
}
const legendEntries = computed(() => {
  const colors = cachedRenderColors
  if (!colors) return []
  if (colorMode.value === 'feature') {
    return presentFeatures.value
      .filter((feature) => featureLegendOrder.includes(feature))
      .sort((left, right) => featureLegendOrder.indexOf(left) - featureLegendOrder.indexOf(right))
      .map((feature) => ({
        key: `feature-${feature}`,
        color: cssColor(colors.features[feature] ?? colors.features[0]!),
        label: t(`gcodeViewer.legend.features.${featureTokenNames[feature]}`),
      }))
  }
  if (colorMode.value === 'feedrate') {
    return [
      {
        key: 'feed-slow',
        color: cssColor(colors.feedSlow),
        label: t('gcodeViewer.legend.feedSlow', { value: feedrateRangeLabel.value.slow }),
      },
      {
        key: 'feed-fast',
        color: cssColor(colors.feedFast),
        label: t('gcodeViewer.legend.feedFast', { value: feedrateRangeLabel.value.fast }),
      },
    ]
  }
  return [
    { key: 'toolpath', color: cssColor(colors.extrusion), label: t('gcodeViewer.legend.toolpath') },
    { key: 'printed', color: cssColor(colors.progress), label: t('gcodeViewer.legend.printed') },
  ]
})

const filteredFiles = computed(() => {
  const query = fileSearch.value.trim().toLowerCase()
  const files = query
    ? printer.files.filter((file) => file.path.toLowerCase().includes(query))
    : [...printer.files]
  // Newest first: the file someone wants to look at is almost always the one
  // they just sliced.
  return files.sort((left, right) => (right.modified ?? 0) - (left.modified ?? 0)).slice(0, 200)
})
const fileMatchCount = computed(() => printer.files.length)

const layerCount = computed(() => loaded.value?.layerHeights.length ?? 0)
const layerFloorHeight = computed(() => loaded.value?.layerHeights[layerFloor.value] ?? 0)
const layerHeight = computed(() => loaded.value?.layerHeights[selectedLayer.value] ?? 0)
const loadPercent = computed(() =>
  totalBytes.value && totalBytes.value > 0
    ? Math.min(100, Math.round((loadedBytes.value / totalBytes.value) * 100))
    : null,
)
const currentPrintFile = computed(() => printer.printStats.filename)
const loadedMatchesPrint = computed(
  () =>
    loaded.value?.source === 'moonraker' &&
    Boolean(currentPrintFile.value) &&
    loaded.value.name.replace(/^gcodes\//i, '') ===
      currentPrintFile.value.replace(/^gcodes\//i, ''),
)
const loadedIsCurrentPrint = computed(() => loadedMatchesPrint.value && printer.hasActivePrint)
/**
 * Whether a toolhead marker belongs on screen at all.
 *
 * A marker asserts "the machine is here, in this model". That is only ever true
 * of the file being played back or the file being printed, so the rule is that
 * the marker's position and the geometry under it must describe the same job.
 * Telemetry alone does not satisfy it: the printer always has a position, and
 * drawing it over an unrelated file someone opened to inspect puts a nozzle in
 * a model the machine is not making.
 *
 * Three sources qualify, all of them tied to the loaded file. Simulation is a
 * playback of it. Planned follow is a live print of it. Raw telemetry qualifies
 * only while the loaded file is the current print, which is the case that keeps
 * a marker when planned follow cannot start — under reduced motion, say.
 */
const toolheadVisible = computed(
  () =>
    simulationEnabled.value ||
    plannedFollowActive.value ||
    (liveTracking.value && loadedIsCurrentPrint.value),
)
const plannedFollowEligible = computed(() =>
  plannedFollowCanStart({
    loadedSource: loaded.value?.source ?? null,
    loadedFilename: loaded.value?.name ?? '',
    currentFilename: currentPrintFile.value,
    hasActivePrint: printer.hasActivePrint,
    virtualSdActive: printer.virtualSdcard.isActive,
    klipperReady: availability.isKlipperReady,
    reducedMotion: reducedMotionEnabled.value,
    followEnabled: liveTracking.value,
    simulationEnabled: simulationEnabled.value,
  }),
)
// Segment progress is measured against the complete source file. This raw
// ratio locates the dispatch frontier and provides the telemetry fallback;
// planned Follow renders from its simulation sample instead.
const livePrintProgress = computed(() =>
  loadedIsCurrentPrint.value && loaded.value
    ? Math.min(
        1,
        Math.max(
          0,
          loaded.value.sourceByteCount > 0
            ? printer.virtualSdcard.filePosition / loaded.value.sourceByteCount
            : printer.virtualSdcard.progress,
        ),
      )
    : 0,
)
const livePrintLayer = computed(() => {
  if (!loadedIsCurrentPrint.value || !loaded.value || !simulationSegments) return null
  return currentGcodeLayer(
    simulationSegments,
    loaded.value.layerHeights.length,
    printer.printStats.currentLayer,
    livePrintProgress.value,
  )
})
const renderedProgress = computed(() =>
  simulationEnabled.value
    ? simulationFileProgress.value
    : plannedFollowActive.value
      ? plannedFileProgress.value
      : livePrintProgress.value,
)
const simulationMove = computed(() =>
  Math.min(loaded.value?.segmentCount ?? 0, simulationCursor.value),
)
const errorTitle = computed(() =>
  viewerError.value ? t(`gcodeViewer.errors.${viewerError.value}.title`) : '',
)
const errorDescription = computed(() =>
  viewerError.value ? t(`gcodeViewer.errors.${viewerError.value}.description`) : '',
)

function formatFileSize(bytes: number): string {
  if (bytes < 1_024)
    return t('gcodeViewer.size.bytes', { value: numberFormatter.value.format(bytes) })
  if (bytes < 1_048_576) {
    return t('gcodeViewer.size.kilobytes', {
      value: decimalFormatter.value.format(bytes / 1_024),
    })
  }
  return t('gcodeViewer.size.megabytes', {
    value: decimalFormatter.value.format(bytes / 1_048_576),
  })
}

function resolveCssColor(variable: string): string {
  const probe = document.createElement('span')
  probe.style.color = `var(${variable})`
  probe.style.display = 'none'
  document.body.appendChild(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  return color
}

/**
 * A canvas font is not CSS: it cannot read a custom property, so the family
 * this returns is the resolved string, not a `var(...)` reference — canvas
 * would silently ignore the latter and keep whatever font was set before.
 * Reading a custom property straight off `documentElement` needs no throwaway
 * probe the way `resolveCssColor` does: it is already a literal string in the
 * cascade, not a color the browser has to compute.
 */
function resolveCssFontFamily(variable: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim()
}

function colorComponents(color: string): [number, number, number, number] {
  const values = color.match(/[-+]?\d*\.?\d+/g)?.map(Number) ?? []
  if (color.startsWith('color(')) {
    return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1]
  }
  return [(values[0] ?? 0) / 255, (values[1] ?? 0) / 255, (values[2] ?? 0) / 255, values[3] ?? 1]
}

function renderColors(): GcodeRenderColors {
  if (cachedRenderColors) return cachedRenderColors
  refreshResolvedColors()
  if (!cachedRenderColors) throw new Error('Viewer colors could not be resolved')
  return cachedRenderColors
}

function refreshResolvedColors(): void {
  cachedRenderColors = {
    extrusion: colorComponents(resolveCssColor('--viewer-extrusion')),
    travel: colorComponents(resolveCssColor('--text-muted')),
    progress: colorComponents(resolveCssColor('--viewer-progress')),
    seam: colorComponents(resolveCssColor('--viewer-seam')),
    grid: colorComponents(resolveCssColor('--viewer-grid')),
    shadow: colorComponents(resolveCssColor('--viewer-shadow')),
    originX: colorComponents(resolveCssColor('--viewer-axis-x')),
    originY: colorComponents(resolveCssColor('--viewer-axis-y')),
    origin: colorComponents(resolveCssColor('--viewer-nozzle')),
    // Index order is the GcodeFeature enum's, which is what the shader indexes
    // with; the legend reads the same array so the two cannot disagree.
    features: [
      colorComponents(resolveCssColor('--viewer-feature-other')),
      colorComponents(resolveCssColor('--viewer-feature-perimeter-outer')),
      colorComponents(resolveCssColor('--viewer-feature-perimeter-inner')),
      colorComponents(resolveCssColor('--viewer-feature-infill')),
      colorComponents(resolveCssColor('--viewer-feature-infill-solid')),
      colorComponents(resolveCssColor('--viewer-feature-bridge')),
      colorComponents(resolveCssColor('--viewer-feature-support')),
      colorComponents(resolveCssColor('--viewer-feature-skirt')),
    ],
    feedSlow: colorComponents(resolveCssColor('--viewer-feed-slow')),
    feedFast: colorComponents(resolveCssColor('--viewer-feed-fast')),
  }
  const nozzle = colorComponents(resolveCssColor('--viewer-nozzle'))
  cachedNozzleBase = [nozzle[0] * 255, nozzle[1] * 255, nozzle[2] * 255]
  cachedToolheadFill = resolveCssColor('--viewer-nozzle')
  cachedToolheadStroke = resolveCssColor('--surface-strong')
  cachedAxisX = resolveCssColor('--viewer-axis-x')
  cachedAxisY = resolveCssColor('--viewer-axis-y')
  cachedAxisZ = resolveCssColor('--viewer-axis-z')
  cachedAxisFont = resolveCssFontFamily('--font-mono')
  scheduleSceneRender()
  drawOverlay()
}

function renderOptions(): GcodeRenderOptions {
  return {
    selectedLayer: selectedLayer.value,
    showPreviousLayers: showPreviousLayers.value,
    layerMinimum: layerFloor.value,
    showTravels: showTravels.value,
    printProgress: renderedProgress.value,
    progressStyle: plannedFollowActive.value ? 'live-layer' : 'standard',
    extrusionWidth: effectiveNozzleDiameter.value,
    widthScale: defaultGcodeBeadOverlap,
    beadProfile: gcodeBeadProfileFor(qualityMode.value),
    subPixelStrategy: gcodeSubPixelStrategyFor(qualityMode.value),
    highlightSeams: highlightSeams.value,
    tierBias: governor.state().tierBias,
    contactShadow: governor.state().contactShadow,
    colorMode: colorMode.value,
    feedrateRange: feedrateRange.value,
    // A frontier is crossing the selected layer, so that layer must stay
    // segment-exact whatever tier the rest of the model is drawn at.
    exactActiveLayer: plannedFollowActive.value || simulationEnabled.value,
  }
}

function renderSceneNow(): void {
  if (!renderer) return
  const startedAt = performance.now()
  // Decided before the frame rather than during it, because acting on it
  // reallocates the drawing buffer; the renderer's hysteresis is what keeps
  // that from happening repeatedly as the user zooms across the threshold.
  const wanted = renderer.desiredSampleScale(camera, renderOptions(), sampleScale)
  if (wanted !== sampleScale) {
    sampleScale = wanted
    resizeCanvases()
  }
  currentProjection = renderer.render(camera, renderOptions(), renderColors())
  drawOverlay()
  if (lastSceneRenderTimestamp > 0) {
    const report = governor.sample(startedAt - lastSceneRenderTimestamp)
    if (report.changed) {
      qualityStep.value = report.step
      // A resolution change resizes the drawing buffer, so it has to go
      // through the same path a viewport resize does.
      resizeCanvases()
    }
  }
  lastSceneRenderTimestamp = startedAt
}

function scheduleSceneRender(): void {
  if (sceneFrame || !renderer) return
  sceneFrame = requestAnimationFrame(() => {
    sceneFrame = 0
    renderSceneNow()
  })
}

function resizeCanvases(): void {
  if (!stage.value || !renderer || !overlayCanvas.value) return
  const rectangle = stage.value.getBoundingClientRect()
  overlayWidth = Math.max(1, rectangle.width)
  overlayHeight = Math.max(1, rectangle.height)
  // The overlay keeps its own full ratio: it draws a handful of shapes, so
  // there is nothing to gain by softening the nozzle marker, and the governor's
  // savings are all in the scene.
  overlayPixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
  renderer.resize(
    overlayWidth,
    overlayHeight,
    window.devicePixelRatio || 1,
    governor.state().resolutionScale,
    sampleScale,
  )
  overlayCanvas.value.width = Math.round(overlayWidth * overlayPixelRatio)
  overlayCanvas.value.height = Math.round(overlayHeight * overlayPixelRatio)
  scheduleSceneRender()
}

// A heads-up gizmo rather than a world object, so the axis directions come
// straight from the camera basis. Projecting world points would blow up whenever
// one of them fell behind the camera.
function drawOrientationAxes(context: CanvasRenderingContext2D): void {
  if (!loaded.value && !streamingGeometry.value) return
  const { right, up } = cameraBasis(camera)
  const axes: Array<{
    label: string
    color: string
    direction: [number, number, number]
  }> = [
    { label: t('gcodeViewer.view.axisX'), color: cachedAxisX, direction: [1, 0, 0] },
    { label: t('gcodeViewer.view.axisY'), color: cachedAxisY, direction: [0, 1, 0] },
    { label: t('gcodeViewer.view.axisZ'), color: cachedAxisZ, direction: [0, 0, 1] },
  ]
  const originX = overlayWidth - 48
  const originY = 48

  context.save()
  context.font = `800 10px ${cachedAxisFont}`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  for (const axis of axes) {
    const deltaX =
      axis.direction[0] * right[0] + axis.direction[1] * right[1] + axis.direction[2] * right[2]
    const deltaY = -(
      axis.direction[0] * up[0] +
      axis.direction[1] * up[1] +
      axis.direction[2] * up[2]
    )
    const length = Math.hypot(deltaX, deltaY) || 1
    const endX = originX + (deltaX / length) * 24
    const endY = originY + (deltaY / length) * 24
    context.strokeStyle = axis.color
    context.fillStyle = axis.color
    context.lineWidth = 2
    context.beginPath()
    context.moveTo(originX, originY)
    context.lineTo(endX, endY)
    context.stroke()
    context.beginPath()
    context.arc(endX, endY, 3, 0, Math.PI * 2)
    context.fill()
    context.fillText(axis.label, endX + (deltaX / length) * 8, endY + (deltaY / length) * 8)
  }
  context.restore()
}

function activeToolheadPosition(): readonly [number, number, number] | null {
  if (!toolheadVisible.value) return null
  if (simulationEnabled.value) return simulatedPosition
  if (plannedFollowActive.value) return plannedToolheadPosition
  return smoothToolhead.value()
}

// Upper bound on the marker's on-screen extent, used to decide when it has left
// the viewport. Ignoring foreshortening only ever overestimates, which is the
// safe direction for a cull margin.
function nozzleScreenExtent(): number {
  return nozzleHeight / Math.max(0.0001, worldUnitsPerPixel(camera, overlayHeight))
}

function drawNozzle(
  context: CanvasRenderingContext2D,
  position: readonly [number, number, number],
): void {
  const projection = currentProjection
  if (!projection) return
  const visible = visibleNozzleFaces(position, cameraPosition(camera), (point) =>
    projectGcodePoint(point, projection),
  )

  context.save()
  context.lineJoin = 'round'
  for (const face of visible) {
    const [first, ...rest] = face.points
    if (!first) continue
    const red = Math.round(cachedNozzleBase[0] * face.shade)
    const green = Math.round(cachedNozzleBase[1] * face.shade)
    const blue = Math.round(cachedNozzleBase[2] * face.shade)
    const fill = `rgb(${red} ${green} ${blue})`
    context.beginPath()
    context.moveTo(first[0], first[1])
    for (const point of rest) context.lineTo(point[0], point[1])
    context.closePath()
    context.fillStyle = fill
    context.strokeStyle = fill
    // Hairline stroke closes the seams antialiasing leaves between quads.
    context.lineWidth = 0.6
    context.fill()
    context.stroke()
  }
  context.restore()
}

function drawOverlay(): void {
  const canvas = overlayCanvas.value
  if (!canvas) return
  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(overlayPixelRatio, 0, 0, overlayPixelRatio, 0, 0)
  context.clearRect(0, 0, overlayWidth, overlayHeight)
  drawOrientationAxes(context)
  const position = activeToolheadPosition()
  if (!position || !loaded.value || !currentProjection) return
  const [x, y] = projectGcodePoint(position, currentProjection)
  const margin = nozzleScreenExtent()
  if (x < -margin || y < -margin || x > overlayWidth + margin || y > overlayHeight + margin) return
  if (!cachedToolheadFill || !cachedToolheadStroke) refreshResolvedColors()
  drawNozzle(context, position)
}

function animateToolhead(timestamp: number): void {
  toolheadFrame = 0
  if (plannedFollowActive.value && plannedPlayback && simulationSegments && followTimeline) {
    const state = plannedPlayback.step({
      timestampMilliseconds: timestamp,
      speedFactor: printer.motion.speedFactor,
      liveVelocity: printer.motion.liveVelocity,
    })
    if (state.phase === 'fallback') {
      stopPlannedFollow(true)
      return
    }
    const sample = sampleGcodeSimulationAtTime(
      simulationSegments,
      followTimeline,
      state.playbackSeconds,
    )
    if (!sample) {
      stopPlannedFollow(true)
      return
    }
    plannedToolheadPosition = sample.position
    if (timestamp - lastPlannedFollowSceneRender >= 50) {
      lastPlannedFollowSceneRender = timestamp
      plannedFileProgress.value = sample.progress
      selectedLayer.value = Math.min(Math.max(0, layerCount.value - 1), sample.layer)
      scheduleSceneRender()
    }
    drawOverlay()
    if (state.phase === 'running' && liveTracking.value && !simulationEnabled.value) {
      toolheadFrame = requestAnimationFrame(animateToolhead)
    }
    return
  }
  const result = smoothToolhead.step(timestamp, reducedMotion.matches)
  drawOverlay()
  if (result.moving && liveTracking.value && !simulationEnabled.value) {
    toolheadFrame = requestAnimationFrame(animateToolhead)
  }
}

function scheduleToolheadAnimation(): void {
  if (!liveTracking.value || simulationEnabled.value || toolheadFrame) return
  toolheadFrame = requestAnimationFrame(animateToolhead)
}

function seedLiveToolhead(): void {
  // Same condition as the marker: seeding a position for a file the machine
  // is not printing would leave a nozzle sitting in an unrelated model.
  if (!liveTracking.value || !loadedIsCurrentPrint.value) return
  if (simulationEnabled.value || plannedFollowActive.value) return
  const position = printer.toolheadPosition
  if (position.some((coordinate) => coordinate === null)) return
  smoothToolhead.setTarget(position as [number, number, number], performance.now())
  scheduleToolheadAnimation()
}

function stopPlannedFollow(block = false, seedTelemetry = true): void {
  if (toolheadFrame) cancelAnimationFrame(toolheadFrame)
  toolheadFrame = 0
  plannedFollowActive.value = false
  plannedToolheadPosition = null
  plannedPlayback = null
  plannedFollowMismatchStarted = null
  if (block) plannedFollowBlocked = true
  if (seedTelemetry) seedLiveToolhead()
  else drawOverlay()
}

function reconcilePlannedFollow(): boolean {
  if (!plannedPlayback || !simulationSegments || !followTimeline) return false
  const eventtime = printer.motion.livePositionEventtime
  const position = printer.toolheadPosition
  if (eventtime === null || position.some((coordinate) => coordinate === null)) return false
  const state = plannedPlayback.snapshot(performance.now())
  const match = matchPlannedPosition(
    simulationSegments,
    followTimeline,
    state.targetSeconds,
    position as [number, number, number],
    defaultPlannedPositionMatchConfiguration,
  )
  if (!match.matched) {
    if (!plannedFollowActive.value) return false
    const now = performance.now()
    plannedFollowMismatchStarted ??= now
    // Corners, repeated walls, and coordinate transforms can make an isolated
    // sample ambiguous. Keep running the known simulation path briefly and let
    // the next unique sample re-establish phase before abandoning planned mode.
    if (now - plannedFollowMismatchStarted < 4_000) return true
    plannedPlayback.rejectLivePosition(
      match.reason === 'ambiguous' ? 'live-position-ambiguous' : 'live-position-outside-tolerance',
    )
    return false
  }
  plannedFollowMismatchStarted = null
  return (
    plannedPlayback.reconcileLivePosition(match.timelineSeconds, eventtime).phase !== 'fallback'
  )
}

function anchorPlannedFollow(): boolean {
  if (!plannedPlayback) return false
  return (
    plannedPlayback.anchor({
      filePosition: printer.virtualSdcard.filePosition,
      timestampMilliseconds: performance.now(),
      active: plannedFollowEligible.value,
      paused: printer.isPaused,
    }).phase !== 'fallback'
  )
}

function startPlannedFollow(): void {
  if (
    !plannedFollowEligible.value ||
    plannedFollowBlocked ||
    plannedFollowActive.value ||
    !loaded.value ||
    !simulationSegments ||
    !followSourceBytesRaw ||
    printer.motion.livePositionEventtime === null
  ) {
    return
  }
  followTimeline ??= buildGcodeSimulationTimeline(simulationSegments)
  // Widened once per load, only when following actually starts: the controller
  // validates a Float64 table, and holding both permanently would double the
  // byte-table cost for prints that are never followed.
  followSourceBytes ??= new Float64Array(followSourceBytesRaw)
  try {
    plannedPlayback = new PlannedToolheadPlayback(
      followSourceBytes,
      loaded.value.sourceByteCount,
      followTimeline,
      defaultPlannedPlaybackConfiguration,
    )
  } catch {
    stopPlannedFollow(true)
    return
  }
  if (!anchorPlannedFollow()) {
    stopPlannedFollow(true)
    return
  }
  if (!reconcilePlannedFollow()) {
    stopPlannedFollow(false)
    return
  }
  const state = plannedPlayback.snapshot(performance.now())
  const sample = sampleGcodeSimulationAtTime(
    simulationSegments,
    followTimeline,
    state.playbackSeconds,
  )
  if (!sample) {
    stopPlannedFollow(true)
    return
  }
  plannedToolheadPosition = sample.position
  plannedFileProgress.value = sample.progress
  selectedLayer.value = Math.min(Math.max(0, layerCount.value - 1), sample.layer)
  lastPlannedFollowSceneRender = performance.now()
  plannedFollowActive.value = true
  scheduleSceneRender()
  scheduleToolheadAnimation()
}

// Whatever the ray through this viewport position hits first, the printed
// surface or the bed, falling back to the model centre when it hits nothing.
function pivotAt(screenX: number, screenY: number): GcodePoint | null {
  const file = loaded.value
  if (!renderer || !file) return null
  const surface = renderer.pickSurfacePoint(camera, renderOptions(), screenX, screenY)
  const plane = bedPlaneHit(camera, screenX, screenY, overlayWidth, overlayHeight, file.bedBounds)
  return resolvePivot(camera, [surface, plane], boundsCenter(file.bounds))
}

// Puts the orbit pivot on the geometry in front of the camera instead of a point
// floating above it, so orbiting, panning and zooming are all measured against
// what is on screen. The pivot is projected onto the view axis, so the image
// never shifts.
function reanchorPivot(screenX: number, screenY: number, throttle = 0): void {
  const file = loaded.value
  if (!renderer || !file) return
  const now = performance.now()
  if (throttle > 0 && now - lastPivotPick < throttle) return
  lastPivotPick = now
  const pivot = pivotAt(screenX, screenY)
  if (pivot) reanchorCamera(camera, pivot)
}

function reanchorPivotAtCenter(throttle = 0): void {
  reanchorPivot(overlayWidth / 2, overlayHeight / 2, throttle)
}

function applySnapProgress(progress: number): void {
  const snap = pivotSnap
  if (!snap) return
  // Eased pan: yaw, pitch and distance are untouched, so the view slides without
  // turning and the orbit radius the pick established survives the move.
  const eased = 1 - (1 - progress) ** 3
  camera.targetX = snap.fromX + (snap.toX - snap.fromX) * eased
  camera.targetY = snap.fromY + (snap.toY - snap.fromY) * eased
  camera.targetZ = snap.fromZ + (snap.toZ - snap.fromZ) * eased
}

// Completing early rather than blending keeps the snap from fighting an orbit
// drag for the camera when the user starts dragging mid-animation.
function finishPivotSnap(): void {
  if (snapFrame) cancelAnimationFrame(snapFrame)
  snapFrame = 0
  if (!pivotSnap) return
  applySnapProgress(1)
  pivotSnap = null
  scheduleSceneRender()
}

function snapPivotToCenter(pivot: GcodePoint): void {
  finishPivotSnap()
  pivotSnap = {
    fromX: camera.targetX,
    fromY: camera.targetY,
    fromZ: camera.targetZ,
    toX: pivot[0],
    toY: pivot[1],
    toZ: pivot[2],
    start: performance.now(),
  }
  if (reducedMotion.matches) {
    finishPivotSnap()
    return
  }
  const step = (timestamp: number): void => {
    snapFrame = 0
    const snap = pivotSnap
    if (!snap) return
    const progress = Math.min(1, (timestamp - snap.start) / pivotSnapDuration)
    applySnapProgress(progress)
    if (progress < 1) snapFrame = requestAnimationFrame(step)
    else pivotSnap = null
    scheduleSceneRender()
  }
  snapFrame = requestAnimationFrame(step)
}

function resetView(): void {
  const bounds = loaded.value?.bounds ?? streamBounds
  if (!bounds) return
  Object.assign(camera, fittedCamera(bounds, overlayWidth, overlayHeight))
  reanchorPivotAtCenter()
  scheduleSceneRender()
}

function zoomBy(factor: number): void {
  dollyCamera(camera, factor)
  scheduleSceneRender()
}

function handleWheel(event: WheelEvent): void {
  if ((!loaded.value && !streamingGeometry.value) || !stage.value) return
  if (loading.value) userAdjustedViewDuringLoad = true
  const bounds = stage.value.getBoundingClientRect()
  const pointerX = event.clientX - bounds.left
  const pointerY = event.clientY - bounds.top
  // Anchored on the pointer so the wheel keeps closing in on what it is aimed
  // at, throttled because every pick costs one extra geometry pass.
  reanchorPivot(pointerX, pointerY, pivotPickThrottle)
  dollyCameraAt(
    camera,
    Math.exp(-event.deltaY * 0.0015),
    pointerX,
    pointerY,
    bounds.width,
    bounds.height,
  )
  scheduleSceneRender()
}

function handlePointerDown(event: PointerEvent): void {
  event.preventDefault()
  if ((!loaded.value && !streamingGeometry.value) || ![0, 1, 2].includes(event.button)) return
  if (loading.value) userAdjustedViewDuringLoad = true
  stage.value?.focus({ preventScroll: true })
  stage.value?.setPointerCapture(event.pointerId)
  // The second finger takes the gesture over. The orbit it started as is
  // dropped rather than left running underneath: a pinch that also rotated
  // would spin the model as the fingers moved apart.
  if (touch.begin(event)) {
    pointerDrag.value = null
    finishPivotSnap()
    reanchorPivotAtCenter()
    return
  }
  const mode = event.button === 0 ? 'orbit' : 'pan'
  // Rotating around the pointer keeps that exact point pinned under the cursor,
  // so the pivot has to be the picked point itself rather than its depth on the
  // view axis. Re-anchoring first still gives the drag a sensible orbit radius.
  const stageBounds = stage.value?.getBoundingClientRect()
  const pivot =
    mode === 'orbit' && orbitMode.value === 'pointer' && stageBounds
      ? pivotAt(event.clientX - stageBounds.left, event.clientY - stageBounds.top)
      : null
  if (pivot) reanchorCamera(camera, pivot)
  else reanchorPivotAtCenter()
  pointerDrag.value = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    mode,
    pivot,
  }
  if (pivot && snapToCenter.value) snapPivotToCenter(pivot)
}

/**
 * A two-finger step. The pan is applied before the pinch so the zoom is
 * anchored on where the fingers are now, which is the same rule the wheel
 * follows: the gesture keeps closing in on what it is aimed at.
 */
function applyTouchGesture(step: TouchGestureStep): void {
  const bounds = stage.value?.getBoundingClientRect()
  if (!bounds) return
  if (loading.value) userAdjustedViewDuringLoad = true
  finishPivotSnap()
  panCamera(camera, step.panX, step.panY, overlayHeight)
  if (step.scale !== 1) {
    dollyCameraAt(
      camera,
      step.scale,
      step.centreX - bounds.left,
      step.centreY - bounds.top,
      bounds.width,
      bounds.height,
    )
  }
  scheduleSceneRender()
}

function handlePointerMove(event: PointerEvent): void {
  const step = touch.move(event)
  if (step) {
    event.preventDefault()
    applyTouchGesture(step)
    return
  }
  const drag = pointerDrag.value
  if (!drag || drag.pointerId !== event.pointerId) return
  event.preventDefault()
  const deltaX = event.clientX - drag.x
  const deltaY = event.clientY - drag.y
  drag.x = event.clientX
  drag.y = event.clientY
  finishPivotSnap()
  if (drag.mode === 'orbit') {
    if (drag.pivot) orbitCameraAround(camera, deltaX, deltaY, drag.pivot)
    else orbitCamera(camera, deltaX, deltaY)
  } else panCamera(camera, deltaX, deltaY, overlayHeight)
  scheduleSceneRender()
}

function handlePointerEnd(event: PointerEvent): void {
  touch.end(event)
  // Released for whichever pointer lifted, not only for the one that was
  // dragging: a finger the two-finger gesture took over is still captured
  // here, and a capture never released holds every later event for that id.
  if (stage.value?.hasPointerCapture(event.pointerId)) {
    stage.value.releasePointerCapture(event.pointerId)
  }
  if (pointerDrag.value?.pointerId !== event.pointerId) return
  event.preventDefault()
  pointerDrag.value = null
}

function handleStageKeydown(event: KeyboardEvent): void {
  const panStep = 24
  let handled = true
  if (loading.value && cameraKeys.includes(event.key)) userAdjustedViewDuringLoad = true
  if (cameraKeys.includes(event.key)) reanchorPivotAtCenter(pivotPickThrottle)
  if (event.shiftKey && event.key === 'ArrowLeft') orbitCamera(camera, -12, 0)
  else if (event.shiftKey && event.key === 'ArrowRight') orbitCamera(camera, 12, 0)
  else if (event.shiftKey && event.key === 'ArrowUp') orbitCamera(camera, 0, 12)
  else if (event.shiftKey && event.key === 'ArrowDown') orbitCamera(camera, 0, -12)
  else if (event.key === 'ArrowLeft') panCamera(camera, panStep, 0, overlayHeight)
  else if (event.key === 'ArrowRight') panCamera(camera, -panStep, 0, overlayHeight)
  else if (event.key === 'ArrowUp') panCamera(camera, 0, panStep, overlayHeight)
  else if (event.key === 'ArrowDown') panCamera(camera, 0, -panStep, overlayHeight)
  else if (event.key === '+' || event.key === '=') zoomBy(1.2)
  else if (event.key === '-' || event.key === '_') zoomBy(1 / 1.2)
  else if (event.key === '0') resetView()
  else if (event.key === ' ' && simulationEnabled.value) toggleSimulationPlayback()
  else handled = false
  if (!handled) return
  event.preventDefault()
  scheduleSceneRender()
}

function stopSimulationPlayback(): void {
  simulationPlaying.value = false
  lastSimulationTimestamp = 0
  if (simulationFrame) cancelAnimationFrame(simulationFrame)
  simulationFrame = 0
}

function updateSimulation(cursor: number, renderScene = true): void {
  if (!simulationSegments || !simulationTimeline || !loaded.value) return
  const sample = sampleGcodeSimulation(simulationSegments, cursor)
  if (!sample) return
  simulationCursorValue = sample.cursor
  simulationElapsedValue = simulationTimeForCursor(simulationTimeline, sample.cursor)
  simulationCursor.value = sample.cursor
  simulationFileProgress.value = sample.progress
  simulatedPosition = sample.position
  selectedLayer.value = Math.min(Math.max(0, layerCount.value - 1), sample.layer)
  drawOverlay()
  if (renderScene) scheduleSceneRender()
}

function animateSimulation(timestamp: number): void {
  if (!simulationPlaying.value || !loaded.value || !simulationSegments || !simulationTimeline) {
    simulationFrame = 0
    return
  }
  if (lastSimulationTimestamp === 0) lastSimulationTimestamp = timestamp
  const elapsedSeconds = Math.min(0.1, (timestamp - lastSimulationTimestamp) / 1_000)
  lastSimulationTimestamp = timestamp
  simulationElapsedValue = Math.min(
    simulationTimeline.totalSeconds,
    simulationElapsedValue + elapsedSeconds * simulationSpeed.value,
  )
  const sample = sampleGcodeSimulationAtTime(
    simulationSegments,
    simulationTimeline,
    simulationElapsedValue,
  )
  if (sample) {
    simulationCursorValue = sample.cursor
    simulatedPosition = sample.position
    drawOverlay()
    if (timestamp - lastSimulationSceneRender >= 50 || sample.cursor >= loaded.value.segmentCount) {
      lastSimulationSceneRender = timestamp
      simulationCursor.value = Math.floor(sample.cursor)
      simulationFileProgress.value = sample.progress
      selectedLayer.value = Math.min(Math.max(0, layerCount.value - 1), sample.layer)
      scheduleSceneRender()
    }
  }
  if (simulationElapsedValue >= simulationTimeline.totalSeconds) {
    stopSimulationPlayback()
    return
  }
  simulationFrame = requestAnimationFrame(animateSimulation)
}

function toggleSimulationMode(): void {
  if (!loaded.value || !simulationSegments) return
  if (simulationEnabled.value) {
    stopSimulationPlayback()
    simulationEnabled.value = false
    simulatedPosition = null
    if (livePrintLayer.value !== null) selectedLayer.value = livePrintLayer.value
    scheduleSceneRender()
    startPlannedFollow()
    if (!plannedFollowActive.value) seedLiveToolhead()
    return
  }
  stopPlannedFollow(false, false)
  simulationTimeline ??= followTimeline ?? buildGcodeSimulationTimeline(simulationSegments)
  simulationEnabled.value = true
  if (toolheadFrame) cancelAnimationFrame(toolheadFrame)
  toolheadFrame = 0
  updateSimulation(0)
}

function toggleSimulationPlayback(): void {
  if (!simulationEnabled.value || !loaded.value) return
  if (simulationPlaying.value) {
    stopSimulationPlayback()
    return
  }
  if (simulationCursorValue >= loaded.value.segmentCount) updateSimulation(0)
  simulationPlaying.value = true
  lastSimulationTimestamp = 0
  simulationFrame = requestAnimationFrame(animateSimulation)
}

function restartSimulation(): void {
  stopSimulationPlayback()
  updateSimulation(0)
}

function finishSimulation(): void {
  if (!loaded.value) return
  stopSimulationPlayback()
  updateSimulation(loaded.value.segmentCount)
}

function handleSimulationInput(value: number): void {
  stopSimulationPlayback()
  updateSimulation(value || 0)
}

function handleLayerInput(value: number): void {
  selectedLayer.value = Math.min(Math.max(0, layerCount.value - 1), Math.max(0, Math.trunc(value)))
  // The two thumbs share one range and must not cross.
  if (layerFloor.value > selectedLayer.value) layerFloor.value = selectedLayer.value
}

function handleLayerFloorInput(value: number): void {
  layerFloor.value = Math.min(selectedLayer.value, Math.max(0, Math.trunc(value)))
}

/**
 * One full-quality frame, composited with the overlay so the nozzle and axis
 * gizmo appear as they do on screen. Rendered on demand rather than read back
 * from the last frame: the drawing buffer is not preserved between frames.
 *
 * `region`, in CSS pixels, crops to part of the stage. Only the benchmark
 * harness passes one — a question about per-pixel shading cannot be answered
 * from a scaled screenshot, and a full 4K frame is too large to move through a
 * console as a data URL.
 */
function composeFrame(region?: {
  x: number
  y: number
  width: number
  height: number
}): HTMLCanvasElement | null {
  const canvas = sceneCanvas.value
  const overlay = overlayCanvas.value
  if (!canvas || !overlay) return null
  const scale = canvas.width / Math.max(1, overlayWidth)
  const crop = region
    ? {
        x: Math.round(region.x * scale),
        y: Math.round(region.y * scale),
        width: Math.max(1, Math.round(region.width * scale)),
        height: Math.max(1, Math.round(region.height * scale)),
      }
    : { x: 0, y: 0, width: canvas.width, height: canvas.height }
  const capture = document.createElement('canvas')
  capture.width = crop.width
  capture.height = crop.height
  const context = capture.getContext('2d')
  if (!context) return null
  renderSceneNow()
  context.drawImage(canvas, -crop.x, -crop.y)
  context.drawImage(
    overlay,
    0,
    0,
    overlay.width,
    overlay.height,
    -crop.x,
    -crop.y,
    canvas.width,
    canvas.height,
  )
  return capture
}

function captureScreenshot(): void {
  if (!loaded.value) return
  const capture = composeFrame()
  if (!capture) return
  const link = document.createElement('a')
  link.download = `${loaded.value.name.replace(/[\\/]/g, '-')}.png`
  link.href = capture.toDataURL('image/png')
  link.click()
}

function configuredBedBounds(): GcodeBounds | undefined {
  const minimum = printer.buildVolume.minimum
  const maximum = printer.buildVolume.maximum
  if (
    minimum.some((coordinate) => coordinate === null) ||
    maximum.some((coordinate) => coordinate === null)
  ) {
    return undefined
  }
  const [minX, minY, minZ] = minimum as [number, number, number]
  const [maxX, maxY, maxZ] = maximum as [number, number, number]
  if (maxX <= minX || maxY <= minY || maxZ <= minZ) return undefined
  return { minX, maxX, minY, maxY, minZ, maxZ }
}

function installSummary(
  summary: ParsedGcodeSummary,
  name: string,
  source: LoadedGcode['source'],
  size: number,
): void {
  if (summary.segmentCount === 0) {
    viewerError.value = 'empty'
    return
  }
  if (import.meta.env.DEV) {
    benchmarkGpuBytes =
      streamedGpuBytes +
      Object.values(summary.tiers).reduce(
        (total, tier) => total + tier.segments.byteLength + tier.pathDetails.byteLength,
        0,
      )
  }
  simulationSegments = summary.segments
  simulationTimeline = null
  followSourceBytesRaw = summary.sourceBytes
  followSourceBytes = null
  followTimeline = null
  plannedFollowBlocked = false
  plannedFollowMismatchStarted = null
  plannedFileProgress.value = 0
  renderer?.finishStreamedLoad(summary)
  const sceneBounds = renderer?.sceneBounds() ?? summary.bounds
  const bedBounds = renderer?.bedBounds() ?? summary.bounds
  loaded.value = {
    name,
    source,
    size,
    bounds: summary.extrusionBounds,
    sceneBounds,
    bedBounds,
    layerHeights: summary.layerHeights,
    segmentCount: summary.segmentCount,
    extrusionCount: summary.extrusionCount,
    travelCount: summary.travelCount,
    sourceByteCount: summary.sourceByteCount,
    minimumFeedrate: summary.minimumFeedrate,
    maximumFeedrate: summary.maximumFeedrate,
  }
  presentFeatures.value = collectFeatures(summary.segments)
  streamingGeometry.value = false
  selectedLayer.value = livePrintLayer.value ?? Math.max(0, summary.layerHeights.length - 1)
  viewerError.value = null
  // A framing the user chose while the model streamed in is a decision, not a
  // transient — completing the parse must not snap it away.
  if (!userAdjustedViewDuringLoad) resetView()
  else scheduleSceneRender()
  startPlannedFollow()
}

/** One pass over the finished stream; the file's own feature inventory. */
function collectFeatures(segments: Float32Array): GcodeFeature[] {
  const seen = new Set<GcodeFeature>()
  for (let offset = 0; offset < segments.length; offset += gcodeSegmentStride) {
    if ((segments[offset + gcodeSegment.kind] ?? 0) !== 1) continue
    seen.add((segments[offset + gcodeSegment.feature] ?? 0) as GcodeFeature)
  }
  return [...seen]
}

function handleGeometryBatch(batch: GcodeGeometryBatch): void {
  if (!renderer) return
  renderer.appendGeometryBatch(batch)
  streamedBatchCount += 1
  if (import.meta.env.DEV) {
    benchmarkFirstGeometryMilliseconds ??= performance.now() - benchmarkLoadStartedAt
  }
  streamingGeometry.value = true
  streamBounds = batch.extrusionBounds
  streamedGpuBytes +=
    batch.segments.byteLength + batch.pathDetails.byteLength + batch.caps.byteLength
  // Keep every layer parsed so far visible while the model grows in.
  selectedLayer.value = Math.max(selectedLayer.value, batch.layerCount - 1)
  if (!userAdjustedViewDuringLoad) {
    Object.assign(camera, fittedCamera(batch.extrusionBounds, overlayWidth, overlayHeight))
  }
  scheduleSceneRender()
}

async function runLoad(request: GcodeLoadRequest): Promise<void> {
  loadController?.abort()
  stopPlannedFollow(false, false)
  stopSimulationPlayback()
  simulationEnabled.value = false
  simulationCursorValue = 0
  simulationElapsedValue = 0
  simulationCursor.value = 0
  simulationFileProgress.value = 0
  simulatedPosition = null
  const controller = new AbortController()
  loadController = controller
  lastLoadRequest = request
  const loadStartedAt = performance.now()
  benchmarkLoadStartedAt = loadStartedAt
  benchmarkFirstGeometryMilliseconds = null
  loading.value = true
  loadingName.value = request.name
  loadedBytes.value = 0
  totalBytes.value = request.size > 0 ? request.size : null
  viewerError.value = null
  // The previous model leaves now rather than at the end: the streamed batches
  // need the buffers, and a stage growing the new file is continuity enough.
  loaded.value = null
  streamingGeometry.value = false
  streamBounds = null
  streamedGpuBytes = 0
  streamedBatchCount = 0
  layerFloor.value = 0
  statisticsOpen.value = false
  userAdjustedViewDuringLoad = false
  selectedLayer.value = 0
  const bedBounds = configuredBedBounds()
  renderer?.beginStreamedLoad(bedBounds)
  // The model has not streamed in yet, so frame the bed itself rather than
  // leaving whatever camera state the previous file (or the initial
  // placeholder) left behind — the load should never visibly start from a
  // stale, unrelated framing.
  if (bedBounds) Object.assign(camera, fittedCamera(bedBounds, overlayWidth, overlayHeight))
  scheduleSceneRender()
  try {
    const summary = await request.load(
      controller.signal,
      (progress) => {
        if (loadController !== controller) return
        loadedBytes.value = progress.loaded
        totalBytes.value = progress.total ?? totalBytes.value
      },
      (batch) => {
        if (loadController !== controller || controller.signal.aborted) return
        handleGeometryBatch(batch)
      },
    )
    if (controller.signal.aborted) return
    installSummary(summary, request.name, request.source, request.size || loadedBytes.value)
    benchmarkLoadMilliseconds = performance.now() - loadStartedAt
  } catch (error) {
    if (error instanceof GcodeFileTooLargeError) viewerError.value = 'tooLarge'
    else if (!(error instanceof DOMException && error.name === 'AbortError'))
      viewerError.value = 'download'
    renderer?.clear()
  } finally {
    if (loadController === controller) {
      loadController = null
      loading.value = false
      if (!loaded.value) {
        streamingGeometry.value = false
        streamBounds = null
      }
    }
  }
}

/**
 * Every load funnels through here so oversized files get one confirmation
 * before hundreds of megabytes are committed. The threshold gates on declared
 * size; a stream that never declared one proceeds and relies on the 4 GiB
 * hard refusal instead.
 */
function requestLoad(request: GcodeLoadRequest): void {
  // Skippable like every other binary confirm. This one is a warning about
  // time and memory rather than about consequence, so it carries no tier
  // livery -- but a reader who loads 300 MB files routinely should be able to
  // stop being asked, and could not before.
  if (request.size > largeFileConfirmBytes && confirmations.shouldConfirm('openLargeGcodeFile')) {
    pendingLoad.value = request
    return
  }
  void runLoad(request)
}

function confirmPendingLoad(): void {
  const request = pendingLoad.value
  pendingLoad.value = null
  if (request) void runLoad(request)
}

function cancelPendingLoad(): void {
  pendingLoad.value = null
}

function loadRemoteFile(path: string): void {
  if (!path) return
  const file = printer.files.find((candidate) => candidate.path === path)
  const size = file?.size ?? 0
  let url: string
  try {
    url = moonrakerGcodeFileUrl(path, moonraker.endpoint)
  } catch {
    viewerError.value = 'download'
    return
  }
  requestLoad({
    name: path,
    source: 'moonraker',
    size,
    load: (signal, onProgress, onBatch) =>
      fetchAndParseGcode(url, {
        signal,
        onProgress,
        onBatch,
        // Moonraker sends no Content-Length, and without a total the parser
        // cannot stream batches into the scene at all.
        declaredTotalBytes: size,
        filamentDiameter: effectiveFilamentDiameter.value,
      }),
  })
}

function loadSelectedRemoteFile(): void {
  loadRemoteFile(selectedRemoteFile.value)
}

function loadCurrentPrint(): void {
  if (!currentPrintFile.value) return
  selectedRemoteFile.value = currentPrintFile.value
  loadRemoteFile(currentPrintFile.value)
}

function chooseLocalFile(): void {
  localFileInput.value?.click()
}

function handleLocalFile(event: Event): void {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  requestLoad({
    name: file.name,
    source: 'local',
    size: file.size,
    load: (signal, onProgress, onBatch) =>
      parseGcodeFile(file, {
        signal,
        onProgress,
        onBatch,
        filamentDiameter: effectiveFilamentDiameter.value,
      }),
  })
}

function cancelLoad(): void {
  loadController?.abort()
}

async function refreshFiles(): Promise<void> {
  await printer.refreshFiles()
  selectedRemoteFile.value ||= currentPrintFile.value || printer.files[0]?.path || ''
}

watch(
  () => printer.toolheadPosition,
  (position) => {
    if (!liveTracking.value || !loadedIsCurrentPrint.value) return
    if (simulationEnabled.value || plannedFollowActive.value) return
    if (position.some((coordinate) => coordinate === null)) return
    smoothToolhead.setTarget(position as [number, number, number], performance.now())
    scheduleToolheadAnimation()
  },
  { deep: true, immediate: true },
)
watch(
  [selectedLayer, layerFloor, showPreviousLayers, showTravels, renderedProgress, colorMode],
  scheduleSceneRender,
)
watch(livePrintLayer, (layer) => {
  if (layer === null || simulationEnabled.value || plannedFollowActive.value) return
  selectedLayer.value = layer
})
watch(
  () => [...printer.buildVolume.minimum, ...printer.buildVolume.maximum],
  () => {
    const bedBounds = configuredBedBounds()
    if (!renderer || !loaded.value || !bedBounds) return
    renderer.setBedBounds(bedBounds)
    loaded.value.sceneBounds = renderer.sceneBounds()
    loaded.value.bedBounds = renderer.bedBounds()
    resetView()
  },
)
watch(effectiveNozzleDiameter, scheduleSceneRender)
watch(qualityMode, (mode) => {
  governor.setMode(mode)
  qualityStep.value = governor.currentStep()
  lastSceneRenderTimestamp = 0
  resizeCanvases()
})
watch(liveTracking, (enabled) => {
  if (enabled && !simulationEnabled.value) {
    startPlannedFollow()
    if (!plannedFollowActive.value) seedLiveToolhead()
  } else drawOverlay()
})
watch(plannedFollowEligible, (eligible) => {
  if (eligible) startPlannedFollow()
  else if (plannedFollowActive.value) stopPlannedFollow(false)
})
watch(
  () => [printer.virtualSdcard.filePosition, printer.isPaused] as const,
  () => {
    if (!plannedFollowActive.value) {
      startPlannedFollow()
      return
    }
    if (!anchorPlannedFollow()) {
      stopPlannedFollow(true)
      return
    }
    scheduleToolheadAnimation()
  },
)
watch(
  () => printer.motion.livePositionEventtime,
  () => {
    if (!plannedFollowActive.value) {
      startPlannedFollow()
      return
    }
    if (!anchorPlannedFollow()) {
      stopPlannedFollow(true)
      return
    }
    if (!reconcilePlannedFollow()) {
      stopPlannedFollow(false)
      return
    }
    scheduleToolheadAnimation()
  },
)

function handleReducedMotionChange(event: MediaQueryListEvent): void {
  reducedMotionEnabled.value = event.matches
}

// preventDefault is what makes the browser attempt a restore at all; without
// it a driver reset leaves a permanently dead canvas behind the page.
function handleContextLost(event: Event): void {
  event.preventDefault()
}

function handleContextRestored(): void {
  if (!sceneCanvas.value) return
  renderer?.dispose()
  renderer = null
  try {
    renderer = new GcodeRenderer(sceneCanvas.value)
  } catch (error) {
    // The user-facing message is the same however this failed, but a shader
    // that stopped compiling is a bug rather than a weak GPU, and swallowing
    // its info log leaves nothing to debug from.
    if (import.meta.env.DEV) console.error('[gcode viewer] renderer unavailable', error)
    viewerError.value = 'renderer'
    return
  }
  resizeCanvases()
  // GPU buffers died with the context and the CPU keeps no copy of the
  // upload-only arrays, so recovery is a fresh run of the last load request.
  const request = lastLoadRequest
  if (request) void runLoad(request)
}

onMounted(async () => {
  await nextTick()
  if (!sceneCanvas.value || !stage.value) return
  try {
    renderer = new GcodeRenderer(sceneCanvas.value)
  } catch (error) {
    // The user-facing message is the same however this failed, but a shader
    // that stopped compiling is a bug rather than a weak GPU, and swallowing
    // its info log leaves nothing to debug from.
    if (import.meta.env.DEV) console.error('[gcode viewer] renderer unavailable', error)
    viewerError.value = 'renderer'
    return
  }
  resizeObserver = new ResizeObserver(resizeCanvases)
  resizeObserver.observe(stage.value)
  refreshResolvedColors()
  themeObserver = new MutationObserver(refreshResolvedColors)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-theme-pack', 'data-font'],
  })
  resizeCanvases()
  reducedMotion.addEventListener('change', handleReducedMotionChange)
  sceneCanvas.value.addEventListener('webglcontextlost', handleContextLost)
  sceneCanvas.value.addEventListener('webglcontextrestored', handleContextRestored)
  if (import.meta.env.DEV) {
    uninstallBenchmark = installGcodeViewerBenchmark({
      fileSummary: () =>
        loaded.value
          ? {
              name: loaded.value.name,
              bytes: loaded.value.size,
              segments: loaded.value.segmentCount,
              extrusions: loaded.value.extrusionCount,
              travels: loaded.value.travelCount,
              layers: layerCount.value,
            }
          : null,
      loadMilliseconds: () => benchmarkLoadMilliseconds,
      qualityStep: () => governor.currentStep(),
      frameDiagnostics: () => renderer?.lastFrameDiagnostics() ?? null,
      firstGeometryMilliseconds: () => benchmarkFirstGeometryMilliseconds,
      streamedBatches: () => streamedBatchCount,
      gpuUploadBytes: () => benchmarkGpuBytes,
      modelBounds: () => loaded.value?.bounds ?? null,
      viewportSize: () => ({ width: overlayWidth, height: overlayHeight }),
      applyCamera: (pose) => Object.assign(camera, pose),
      renderScene: renderSceneNow,
      resetView,
      captureRegion: (region) => composeFrame(region)?.toDataURL('image/png') ?? null,
      loadUrl: (url) =>
        runLoad({
          name: url,
          source: 'local',
          size: 0,
          load: (signal, onProgress, onBatch) =>
            fetchAndParseGcode(url, {
              signal,
              onProgress,
              onBatch,
              filamentDiameter: effectiveFilamentDiameter.value,
            }),
        }),
    })
  }
  if (currentPrintFile.value) selectedRemoteFile.value = currentPrintFile.value
  await refreshFiles()
})

onBeforeUnmount(() => {
  uninstallBenchmark?.()
  uninstallBenchmark = null
  loadController?.abort()
  resizeObserver?.disconnect()
  themeObserver?.disconnect()
  reducedMotion.removeEventListener('change', handleReducedMotionChange)
  sceneCanvas.value?.removeEventListener('webglcontextlost', handleContextLost)
  sceneCanvas.value?.removeEventListener('webglcontextrestored', handleContextRestored)
  if (sceneFrame) cancelAnimationFrame(sceneFrame)
  if (toolheadFrame) cancelAnimationFrame(toolheadFrame)
  if (snapFrame) cancelAnimationFrame(snapFrame)
  stopSimulationPlayback()
  simulationSegments = null
  simulationTimeline = null
  followSourceBytesRaw = null
  followSourceBytes = null
  followTimeline = null
  lastLoadRequest = null
  stopPlannedFollow(false, false)
  renderer?.dispose()
  renderer = null
})
</script>

<template>
  <section class="workspace-page gcode-viewer-page">
    <PageHeading :title="t('gcodeViewer.title')" />

    <div class="gcode-viewer-layout">
      <aside class="gcode-viewer-controls">
        <section class="gcode-control-card">
          <h2>{{ t('gcodeViewer.files.title') }}</h2>
          <div v-if="loaded" class="gcode-viewer-loaded-file">
            <span>{{ t('gcodeViewer.loadedFile') }}</span>
            <strong :title="loaded.name">{{ loaded.name }}</strong>
          </div>
          <AvailabilityRegion requires="moonraker" disable-interaction>
            <label class="gcode-field" for="gcode-file-search">
              <span>{{ t('gcodeViewer.files.search') }}</span>
              <input
                id="gcode-file-search"
                v-model="fileSearch"
                type="search"
                class="field field--block"
                :placeholder="t('gcodeViewer.files.searchPlaceholder', { count: fileMatchCount })"
                :disabled="loading"
              />
            </label>
            <label class="gcode-field" for="gcode-remote-file">
              <span>{{ t('gcodeViewer.files.printerFile') }}</span>
              <select
                id="gcode-remote-file"
                v-model="selectedRemoteFile"
                class="field field--block"
                :disabled="loading"
                :size="1"
              >
                <option value="" disabled>{{ t('gcodeViewer.files.select') }}</option>
                <option v-for="file in filteredFiles" :key="file.path" :value="file.path">
                  {{ file.path }}
                </option>
              </select>
            </label>
            <div class="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                class="button button--primary"
                :disabled="!selectedRemoteFile || loading"
                @click="loadSelectedRemoteFile"
              >
                <AppIcon name="download" class="size-5" aria-hidden="true" />
                {{ t('gcodeViewer.files.load') }}
              </button>
              <button type="button" class="button" :disabled="loading" @click="refreshFiles">
                <AppIcon name="refresh" class="size-5" aria-hidden="true" />
                {{ t('gcodeViewer.files.refresh') }}
              </button>
            </div>
            <button
              v-if="currentPrintFile"
              type="button"
              class="button button--block mt-2"
              :disabled="loading"
              @click="loadCurrentPrint"
            >
              <AppIcon name="print" class="size-5" aria-hidden="true" />
              {{ t('gcodeViewer.files.loadCurrent') }}
            </button>
          </AvailabilityRegion>
          <div class="gcode-file-divider">
            <span>{{ t('gcodeViewer.files.or') }}</span>
          </div>
          <input
            ref="localFileInput"
            hidden
            type="file"
            accept=".gcode,.g,.gco,.nc,text/plain"
            @change="handleLocalFile"
          />
          <button
            type="button"
            class="button button--block"
            :disabled="loading"
            @click="chooseLocalFile"
          >
            <AppIcon name="fileText" class="size-5" aria-hidden="true" />
            {{ t('gcodeViewer.files.openLocal') }}
          </button>
        </section>

        <section class="gcode-control-card">
          <h2>{{ t('gcodeViewer.layers.title') }}</h2>
          <AppSlider
            :label="t('gcodeViewer.layers.layer')"
            :model-value="selectedLayer"
            :min="0"
            :max="Math.max(0, layerCount - 1)"
            :step="1"
            :steppers="false"
            commit-on-drag
            :disabled="!loaded || simulationEnabled"
            @commit="handleLayerInput"
          >
            <template v-if="loaded" #reading>
              {{
                t('gcodeViewer.layers.value', {
                  current: selectedLayer + 1,
                  total: layerCount,
                  height: decimalFormatter.format(layerHeight),
                })
              }}
            </template>
          </AppSlider>
          <!--
            The floor of the same range. At zero this is exactly the old "show
            previous layers" behaviour; raised, it cuts a cross-section that no
            single-thumb slider could express.
          -->
          <AppSlider
            v-if="showPreviousLayers"
            :label="t('gcodeViewer.layers.floor')"
            :model-value="layerFloor"
            :min="0"
            :max="Math.max(0, layerCount - 1)"
            :step="1"
            :steppers="false"
            commit-on-drag
            :disabled="!loaded || simulationEnabled"
            @commit="handleLayerFloorInput"
          >
            <template v-if="loaded" #reading>
              {{
                t('gcodeViewer.layers.value', {
                  current: layerFloor + 1,
                  total: layerCount,
                  height: decimalFormatter.format(layerFloorHeight),
                })
              }}
            </template>
          </AppSlider>
          <label class="check-row gcode-check-row">
            <input v-model="showPreviousLayers" type="checkbox" />
            <span>{{ t('gcodeViewer.layers.previous') }}</span>
          </label>
          <label class="check-row gcode-check-row">
            <input v-model="showTravels" type="checkbox" />
            <span>{{ t('gcodeViewer.layers.travels') }}</span>
          </label>
          <AvailabilityRegion requires="klipper" disable-interaction>
            <label class="check-row gcode-check-row">
              <input v-model="liveTracking" type="checkbox" :disabled="simulationEnabled" />
              <span>{{ t('gcodeViewer.layers.toolhead') }}</span>
            </label>
          </AvailabilityRegion>
        </section>

        <section class="gcode-control-card">
          <h2>{{ t('gcodeViewer.color.title') }}</h2>
          <div class="segmented" role="group" :aria-label="t('gcodeViewer.color.title')">
            <button
              v-for="mode in colorModes"
              :key="mode"
              type="button"
              class="button button--sm button--value"
              :aria-pressed="colorMode === mode"
              @click="colorMode = mode"
            >
              {{ t(`gcodeViewer.color.modes.${mode}`) }}
            </button>
          </div>
          <p v-if="colorMode === 'feedrate'" class="gcode-quality-state">
            {{
              t('gcodeViewer.color.feedRange', {
                slow: feedrateRangeLabel.slow,
                fast: feedrateRangeLabel.fast,
              })
            }}
          </p>
          <label class="check-row gcode-check-row">
            <input
              type="checkbox"
              :checked="highlightSeams"
              @change="setHighlightSeams(($event.target as HTMLInputElement).checked)"
            />
            <span>{{ t('gcodeViewer.color.seams') }}</span>
          </label>
        </section>

        <section class="gcode-control-card">
          <h2>{{ t('gcodeViewer.quality.title') }}</h2>
          <p class="gcode-view-description">{{ t('gcodeViewer.quality.description') }}</p>
          <div class="segmented" role="group" :aria-label="t('gcodeViewer.quality.title')">
            <button
              v-for="mode in qualityModes"
              :key="mode"
              type="button"
              class="button button--sm button--value"
              :aria-pressed="qualityMode === mode"
              @click="setQualityMode(mode)"
            >
              {{ t(`gcodeViewer.quality.modes.${mode}`) }}
            </button>
          </div>
          <p v-if="qualityMode === 'auto'" class="gcode-quality-state">
            {{
              qualityStep === 0
                ? t('gcodeViewer.quality.stateFull')
                : t('gcodeViewer.quality.stateReduced', {
                    step: qualityStep,
                    total: qualityStepTotal,
                  })
            }}
          </p>
          <p v-else-if="qualityMode === 'performance'" class="gcode-quality-state">
            {{ t('gcodeViewer.quality.stateSquareBeads') }}
          </p>
        </section>

        <section v-if="loaded" class="gcode-control-card">
          <button
            type="button"
            class="gcode-statistics-toggle"
            :aria-expanded="statisticsOpen"
            @click="statisticsOpen = !statisticsOpen"
          >
            <h2>{{ t('gcodeViewer.statistics.title') }}</h2>
            <AppIcon :name="statisticsOpen ? 'up' : 'down'" class="size-4" aria-hidden="true" />
          </button>
          <dl v-if="statisticsOpen" class="gcode-statistics">
            <div>
              <dt>{{ t('gcodeViewer.statistics.layers') }}</dt>
              <dd>{{ numberFormatter.format(layerCount) }}</dd>
            </div>
            <div>
              <dt>{{ t('gcodeViewer.statistics.moves') }}</dt>
              <dd>{{ numberFormatter.format(loaded.segmentCount) }}</dd>
            </div>
            <div>
              <dt>{{ t('gcodeViewer.statistics.extrusions') }}</dt>
              <dd>{{ numberFormatter.format(loaded.extrusionCount) }}</dd>
            </div>
            <div>
              <dt>{{ t('gcodeViewer.statistics.travels') }}</dt>
              <dd>{{ numberFormatter.format(loaded.travelCount) }}</dd>
            </div>
            <div>
              <dt>{{ t('gcodeViewer.statistics.fileSize') }}</dt>
              <dd>{{ formatFileSize(loaded.size) }}</dd>
            </div>
          </dl>
        </section>
      </aside>

      <div class="gcode-viewer-workspace">
        <div class="gcode-viewer-panel">
          <div
            ref="stage"
            class="gcode-viewer-stage"
            :data-pending="loading || undefined"
            :data-drag-mode="pointerDrag?.mode"
            :data-toolhead-mode="
              simulationEnabled
                ? 'simulation'
                : plannedFollowActive
                  ? 'planned'
                  : toolheadVisible
                    ? 'telemetry'
                    : undefined
            "
            tabindex="0"
            role="img"
            :aria-label="t('gcodeViewer.stageLabel')"
            :aria-describedby="loaded ? 'gcode-viewer-help' : undefined"
            @wheel.prevent="handleWheel"
            @pointerdown.prevent="handlePointerDown"
            @pointermove="handlePointerMove"
            @pointerup="handlePointerEnd"
            @pointercancel="handlePointerEnd"
            @auxclick.prevent
            @dragstart.prevent
            @contextmenu.prevent
            @dblclick="resetView"
            @keydown="handleStageKeydown"
          >
            <canvas ref="sceneCanvas" class="gcode-viewer-canvas" aria-hidden="true"></canvas>
            <canvas ref="overlayCanvas" class="gcode-viewer-canvas" aria-hidden="true"></canvas>

            <div v-if="!loaded && !loading && !viewerError" class="gcode-viewer-empty">
              <span class="gcode-viewer-empty__mark" aria-hidden="true">
                <AppIcon name="viewer" class="size-10" />
              </span>
              <h2>{{ t('gcodeViewer.empty.title') }}</h2>
              <p>{{ t('gcodeViewer.empty.description') }}</p>
            </div>

            <div v-if="viewerError" class="gcode-viewer-empty" role="alert">
              <span class="gcode-viewer-empty__mark" aria-hidden="true">
                <AppIcon name="emergency" class="size-9" />
              </span>
              <h2>{{ errorTitle }}</h2>
              <p>{{ errorDescription }}</p>
            </div>

            <div v-if="loading" class="gcode-loading-card" role="status" aria-live="polite">
              <div class="min-w-0">
                <p>{{ t('gcodeViewer.loading.title') }}</p>
                <strong :title="loadingName">{{ loadingName }}</strong>
              </div>
              <span v-if="loadPercent !== null" class="font-mono font-black tabular-nums"
                >{{ loadPercent }}{{ t('dashboard.percentUnit') }}</span
              >
              <div class="gcode-loading-track" aria-hidden="true">
                <span v-if="loadPercent !== null" :style="{ width: `${loadPercent}%` }"></span>
              </div>
              <button type="button" class="button button--sm button--on-strong" @click="cancelLoad">
                {{ t('gcodeViewer.loading.cancel') }}
              </button>
              <p class="gcode-loading-note">{{ t('gcodeViewer.loading.followGate') }}</p>
            </div>

            <!--
              Swatches are painted from the same resolved tokens the renderer
              uploads. They used to be Tailwind palette utilities that only
              coincidentally matched, so a theme pack changing a viewer colour
              made the legend quietly wrong.
            -->
            <div v-if="loaded" class="gcode-viewer-legend" aria-hidden="true">
              <span v-for="entry in legendEntries" :key="entry.key"
                ><i :style="{ background: entry.color }"></i>{{ entry.label }}</span
              >
              <span v-if="showTravels"
                ><i class="gcode-legend-travel"></i>{{ t('gcodeViewer.legend.travel') }}</span
              >
              <span v-if="toolheadVisible"
                ><i class="gcode-legend-toolhead"></i
                >{{
                  simulationEnabled
                    ? t('gcodeViewer.legend.simulationToolhead')
                    : t('gcodeViewer.legend.toolhead')
                }}</span
              >
            </div>

            <!--
              Over-canvas controls take their own stacking layer: the canvas
              raises itself to claim the drag, so a positioned sibling left on
              the default z-index paints underneath it and every click lands on
              transparent canvas instead.
            -->
            <div class="gcode-viewer-chips" @pointerdown.stop>
              <button
                v-if="loaded"
                type="button"
                class="button button--on-strong button--icon"
                :aria-label="t('gcodeViewer.view.zoomOut')"
                :title="t('gcodeViewer.view.zoomOut')"
                @click.stop="zoomBy(1 / 1.2)"
              >
                <AppIcon name="zoomOut" class="size-5" aria-hidden="true" />
              </button>
              <button
                v-if="loaded"
                type="button"
                class="button button--on-strong button--icon"
                :aria-label="t('gcodeViewer.view.zoomIn')"
                :title="t('gcodeViewer.view.zoomIn')"
                @click.stop="zoomBy(1.2)"
              >
                <AppIcon name="zoomIn" class="size-5" aria-hidden="true" />
              </button>
              <button
                v-if="loaded"
                type="button"
                class="button button--on-strong button--icon"
                :aria-label="t('gcodeViewer.view.reset')"
                :title="t('gcodeViewer.view.reset')"
                @click.stop="resetView"
              >
                <AppIcon name="refresh" class="size-5" aria-hidden="true" />
              </button>
              <button
                v-if="loaded"
                type="button"
                class="button button--on-strong button--icon"
                :aria-label="t('gcodeViewer.view.screenshot')"
                :title="t('gcodeViewer.view.screenshot')"
                @click.stop="captureScreenshot"
              >
                <AppIcon name="snapshot" class="size-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="button button--on-strong button--icon"
                :aria-label="t('gcodeViewer.settings.open')"
                :title="t('gcodeViewer.settings.open')"
                @click.stop="settingsOpen = true"
              >
                <AppIcon name="settings" class="size-5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <!-- Outside the stage so dialog pointer events never start a camera drag. -->
          <ConfirmDialog
            :open="pendingLoad !== null"
            :title="t('gcodeViewer.confirmLoad.title')"
            :description="
              pendingLoad
                ? t('gcodeViewer.confirmLoad.description', {
                    name: pendingLoad.name,
                    size: formatFileSize(pendingLoad.size),
                  })
                : undefined
            "
            :confirm-label="t('gcodeViewer.confirmLoad.confirm')"
            @confirm="confirmPendingLoad"
            @cancel="cancelPendingLoad"
          />
          <GcodeViewerSettingsDialog
            :open="settingsOpen"
            :orbit-mode="orbitMode"
            :snap-to-center="snapToCenter"
            :highlight-seams="highlightSeams"
            :nozzle-diameter="nozzleDiameterOverride"
            :machine-nozzle-diameter="machineNozzleDiameter"
            @select="setOrbitMode"
            @update:snap-to-center="setSnapToCenter"
            @update:highlight-seams="setHighlightSeams"
            @update:nozzle-diameter="setNozzleDiameterOverride"
            @close="settingsOpen = false"
          />

          <section v-if="loaded" class="gcode-simulation-panel" :data-active="simulationEnabled">
            <header>
              <div>
                <h2>{{ t('gcodeViewer.simulation.title') }}</h2>
                <p>{{ t('gcodeViewer.simulation.description') }}</p>
              </div>
              <button
                type="button"
                class="button"
                :aria-pressed="simulationEnabled"
                @click="toggleSimulationMode"
              >
                {{
                  simulationEnabled
                    ? t('gcodeViewer.simulation.exit')
                    : t('gcodeViewer.simulation.enter')
                }}
              </button>
            </header>
            <div v-if="simulationEnabled" class="gcode-simulation-controls">
              <AppSlider
                class="gcode-simulation-scrubber"
                :label="t('gcodeViewer.simulation.position')"
                :model-value="simulationCursor"
                :min="0"
                :max="loaded.segmentCount"
                :step="1"
                :steppers="false"
                commit-on-drag
                @commit="handleSimulationInput"
              >
                <template #reading>
                  {{
                    t('gcodeViewer.simulation.moveValue', {
                      current: numberFormatter.format(Math.floor(simulationMove)),
                      total: numberFormatter.format(loaded.segmentCount),
                    })
                  }}
                </template>
              </AppSlider>
              <div class="gcode-simulation-transport">
                <button
                  type="button"
                  class="button button--icon"
                  :aria-label="t('gcodeViewer.simulation.restart')"
                  :title="t('gcodeViewer.simulation.restart')"
                  @click="restartSimulation"
                >
                  <AppIcon name="refresh" class="size-5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="button button--primary button--icon"
                  :aria-label="
                    simulationPlaying
                      ? t('gcodeViewer.simulation.pause')
                      : t('gcodeViewer.simulation.play')
                  "
                  :title="
                    simulationPlaying
                      ? t('gcodeViewer.simulation.pause')
                      : t('gcodeViewer.simulation.play')
                  "
                  @click="toggleSimulationPlayback"
                >
                  <AppIcon
                    :name="simulationPlaying ? 'pause' : 'play'"
                    class="size-5"
                    aria-hidden="true"
                  />
                </button>
                <button
                  type="button"
                  class="button button--icon"
                  :aria-label="t('gcodeViewer.simulation.finish')"
                  :title="t('gcodeViewer.simulation.finish')"
                  @click="finishSimulation"
                >
                  <AppIcon name="skipForward" class="size-5" aria-hidden="true" />
                </button>
                <div
                  class="segmented gcode-simulation-speeds"
                  :aria-label="t('gcodeViewer.simulation.speedLabel')"
                  role="group"
                >
                  <button
                    v-for="speed in simulationSpeeds"
                    :key="speed"
                    type="button"
                    class="button button--sm button--value"
                    :aria-pressed="simulationSpeed === speed"
                    @click="simulationSpeed = speed"
                  >
                    {{ t('gcodeViewer.simulation.speedValue', { speed }) }}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
        <p id="gcode-viewer-help" class="mt-3 text-xs leading-5 text-muted">
          {{ t('gcodeViewer.help') }}
        </p>
      </div>
    </div>
  </section>
</template>
