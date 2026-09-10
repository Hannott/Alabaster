<script setup lang="ts">
/**
 * The G-code viewer.
 *
 * The stage is the page. Every control that changes what the canvas shows sits
 * on the canvas — the file and the three modes top left, the view tools top
 * right, the layer range down the right edge, everything time-shaped along the
 * bottom — because the old sidebar put all of them a screen-width away from
 * their own effect, and the two controls that were already on the stage were
 * the ones people actually used.
 *
 * What this component owns: the loaded file, the renderer's lifecycle, the
 * overlay canvas, and the arbitration between the three things that can move a
 * cursor through a file (a live print, a simulation, a drag of the scrubber).
 * What it deliberately does not own: anything about how a toolpath is drawn.
 * That is behind `GcodeSceneRenderer`, and ADR 0011 explains why.
 *
 * Two canvases, two clocks, unchanged from the renderer this replaced and
 * still required by ADR 0007. The library owns the scene canvas and renders
 * only when something moved; the overlay canvas is ours and redraws the
 * toolhead every animation frame, so a print's marker stays smooth while the
 * scene behind it updates at a fraction of that rate.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import GcodeViewerSettingsDialog from '@/components/GcodeViewerSettingsDialog.vue'
import HeaderMenu from '@/components/HeaderMenu.vue'
import PageHeading from '@/components/PageHeading.vue'
import GcodeFilePicker from '@/components/gcode/GcodeFilePicker.vue'
import GcodeInfoPanel from '@/components/gcode/GcodeInfoPanel.vue'
import GcodeLayerRail from '@/components/gcode/GcodeLayerRail.vue'
import GcodeLegend, { type GcodeLegendEntry } from '@/components/gcode/GcodeLegend.vue'
import GcodeTransportBar from '@/components/gcode/GcodeTransportBar.vue'
import { useGcodeViewerSettings } from '@/composables/useGcodeViewerSettings'
import { installGcodeViewerBenchmark } from '@/features/gcode/benchmark'
import { gcodeFeatureLabels } from '@/features/gcode/features'
import {
  GcodeFileTooLargeError,
  fetchAndParseGcode,
  parseGcodeFile,
  type GcodeLoadProgress,
} from '@/features/gcode/loader'
import { SmoothToolheadPosition } from '@/features/gcode/motion'
import { nozzleHeight, visibleNozzleFaces } from '@/features/gcode/nozzle'
import {
  PlannedToolheadPlayback,
  defaultPlannedPlaybackConfiguration,
  defaultPlannedPositionMatchConfiguration,
  matchPlannedPosition,
  plannedFollowCanStart,
} from '@/features/gcode/plannedPlayback'
import { GcodeQualityGovernor, gcodeTierFor, gcodeQualityStepCount } from '@/features/gcode/quality'
import {
  createGcodeSceneRenderer,
  type GcodeRenderTier,
  type GcodeSceneColors,
  type GcodeSceneRenderer,
} from '@/features/gcode/scene'
import {
  buildGcodeSimulationTimeline,
  sampleGcodeSimulation,
  sampleGcodeSimulationAtTime,
  simulationTimeForCursor,
  type GcodeSimulationTimeline,
} from '@/features/gcode/simulation'
import { gcodeByteForCursor } from '@/features/gcode/timeline'
import { currentGcodeLayer } from '@/features/gcode/tracking'
import {
  GcodeFeature,
  defaultGcodeFilamentDiameter,
  defaultGcodeNozzleDiameter,
  gcodeSegment,
  gcodeSegmentStride,
  type GcodeBounds,
  type GcodeColorMode,
  type ParsedGcodeSummary,
} from '@/features/gcode/types'
import { moonrakerGcodeFileUrl, type MoonrakerGcodeMetadata } from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useConfirmationsStore } from '@/stores/confirmations'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { rgbToHex, resolveCssColor } from '@/utils/color'

interface LoadedGcode {
  name: string
  source: 'moonraker' | 'local'
  size: number
  bounds: GcodeBounds
  layerHeights: Float32Array
  segmentCount: number
  extrusionCount: number
  travelCount: number
  sourceByteCount: number
}

type ViewerError = 'download' | 'empty' | 'renderer' | 'tooLarge' | null

interface GcodeLoadRequest {
  name: string
  source: LoadedGcode['source']
  size: number
  load: (
    signal: AbortSignal,
    onProgress: (progress: GcodeLoadProgress) => void,
  ) => Promise<{ text: string; summary: ParsedGcodeSummary }>
}

/*
 * Above this size, loading asks first. The threshold follows the device rather
 * than being one number for every machine: the library keeps the whole file as
 * text plus a line array, so what is a pause on a desktop is an ended tab on
 * the hardware that made this rebuild necessary. A device that has already
 * shown it cannot hold a middling tier is asked at a quarter of the size.
 */
const largeFileConfirmBytes = 150 * 1_048_576
const weakDeviceConfirmBytes = 40 * 1_048_576
const simulationSpeeds = [1, 2, 5, 10, 20] as const
/** How often the scene's frontier is redrawn while the overlay runs at full rate. */
const sceneFollowIntervalMilliseconds = 50

const { locale, t, n } = useI18n({ useScope: 'global' })
const moonraker = useMoonrakerStore()
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()
const confirmations = useConfirmationsStore()
const availability = useAvailabilityStore()

const stage = ref<HTMLElement | null>(null)
const overlayCanvas = ref<HTMLCanvasElement | null>(null)
const localFileInput = ref<HTMLInputElement | null>(null)

const loaded = ref<LoadedGcode | null>(null)
const loading = ref(false)
const reloading = ref(false)
const loadedBytes = ref(0)
const totalBytes = ref<number | null>(null)
const loadingName = ref('')
const viewerError = ref<ViewerError>(null)
const pendingLoad = ref<GcodeLoadRequest | null>(null)
const metadata = ref<MoonrakerGcodeMetadata | null>(null)
const fileSearch = ref('')
const settingsOpen = ref(false)
const recoveredFromFailedLoad = ref(false)
const activeTier = ref<GcodeRenderTier>(4)
const travelsAvailable = ref(true)
const qualityStep = ref(0)
const qualityStepTotal = gcodeQualityStepCount - 1

const layerTop = ref(0)
const layerBottom = ref(0)
const presentFeatures = ref<GcodeFeature[]>([])
const featureColors = ref<Map<GcodeFeature, string>>(new Map())

const following = ref(true)
const plannedFollowActive = ref(false)
const simulationEnabled = ref(false)
const simulationPlaying = ref(false)
const simulationCursor = ref(0)
const simulationSpeed = ref<(typeof simulationSpeeds)[number]>(1)

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const reducedMotionEnabled = ref(reducedMotion.matches)
const smoothToolhead = new SmoothToolheadPosition()

const {
  colorMode,
  showTravels,
  qualityMode,
  followByDefault,
  nozzleDiameterOverride,
  tierCeiling,
  setColorMode,
  setShowTravels,
  setQualityMode,
  setFollowByDefault,
  setNozzleDiameterOverride,
  lowerTierCeiling,
} = useGcodeViewerSettings()

const colorModes = ['single', 'feature', 'feedrate'] as const
const qualityModes = ['quality', 'auto', 'performance'] as const
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

let renderer: GcodeSceneRenderer | null = null
/** Set on unmount, for the mount hook still awaiting its renderer. */
let unmounted = false
const governor = new GcodeQualityGovernor(qualityMode.value)
let resizeObserver: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null
let loadController: AbortController | null = null
let uninstallBenchmark: (() => void) | null = null
let sceneReparseTail = Promise.resolve()
let pendingSceneReparses = 0

let overlayWidth = 1
let overlayHeight = 1
let overlayPixelRatio = 1
let toolheadFrame = 0
let simulationFrame = 0
let simulationSegments: Float32Array | null = null
let simulationTimeline: GcodeSimulationTimeline | null = null
let simulationCursorValue = 0
let simulationElapsedValue = 0
let simulatedPosition: [number, number, number] | null = null
let lastSimulationTimestamp = 0
let lastSimulationSceneUpdate = 0
let followSourceBytesRaw: Uint32Array | null = null
let followSourceBytes: Float64Array | null = null
let followTimeline: GcodeSimulationTimeline | null = null
let plannedPlayback: PlannedToolheadPlayback | null = null
let plannedToolheadPosition: [number, number, number] | null = null
let plannedFollowBlocked = false
let plannedFollowMismatchStarted: number | null = null
let lastPlannedFollowSceneUpdate = 0
let cachedToolheadBase: [number, number, number] = [0, 0, 0]
let cachedAxisColors: [string, string, string] = ['', '', '']
let cachedAxisFont = 'ui-monospace, monospace'
let benchmarkLoadMilliseconds: number | null = null
let benchmarkLoadStartedAt = 0
/** Set by the first load of any kind, so the mount-time auto-load stands down. */
let loadRequested = false

const numberFormatter = computed(() => new Intl.NumberFormat(locale.value))
const decimalFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 2 }),
)

/* -------------------------------------------------------------------------- */
/* Derived state                                                              */
/* -------------------------------------------------------------------------- */

const layerCount = computed(() => loaded.value?.layerHeights.length ?? 0)
const layerMaximum = computed(() => Math.max(0, layerCount.value - 1))
const currentPrintFile = computed(() => printer.printStats.filename)
const normalizedPrintFile = computed(() =>
  currentPrintFile.value ? currentPrintFile.value.replace(/^gcodes\//i, '') : null,
)
const loadedMatchesPrint = computed(
  () =>
    loaded.value?.source === 'moonraker' &&
    Boolean(normalizedPrintFile.value) &&
    loaded.value.name.replace(/^gcodes\//i, '') === normalizedPrintFile.value,
)
const loadedIsCurrentPrint = computed(() => loadedMatchesPrint.value && printer.hasActivePrint)

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

const feedrateRange = computed<[number, number]>(() => {
  const minimum = loadedFeedrates.value[0]
  const maximum = loadedFeedrates.value[1]
  // A file printed entirely at one speed has no range to map; widen it so the
  // ramp resolves to its slow end instead of dividing by nothing.
  return maximum > minimum ? [minimum, maximum] : [minimum, minimum + 1]
})
const loadedFeedrates = ref<[number, number]>([0, 1])
const feedrateLabels = computed(() => ({
  slow: Math.round(feedrateRange.value[0] / 60),
  fast: Math.round(feedrateRange.value[1] / 60),
}))

const plannedFollowEligible = computed(() =>
  plannedFollowCanStart({
    loadedSource: loaded.value?.source ?? null,
    loadedFilename: loaded.value?.name ?? '',
    currentFilename: currentPrintFile.value,
    hasActivePrint: printer.hasActivePrint,
    virtualSdActive: printer.virtualSdcard.isActive,
    klipperReady: availability.isKlipperReady,
    reducedMotion: reducedMotionEnabled.value,
    followEnabled: following.value,
    simulationEnabled: simulationEnabled.value,
  }),
)

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

/**
 * A toolhead marker asserts "the machine is here, in this model", which is
 * only ever true of the file being printed or the file being played back.
 * Telemetry alone does not qualify: the printer always has a position, and
 * drawing it over an unrelated file someone opened to inspect puts a nozzle in
 * a model the machine is not making.
 */
const toolheadVisible = computed(
  () =>
    simulationEnabled.value ||
    plannedFollowActive.value ||
    (following.value && loadedIsCurrentPrint.value),
)

/** Which of the three things the transport bar is showing. */
const transportState = computed<'loading' | 'live' | 'idle'>(() => {
  if (loading.value) return 'loading'
  return loadedIsCurrentPrint.value && following.value ? 'live' : 'idle'
})
const followUnavailableReason = computed(() => {
  if (loadedIsCurrentPrint.value) return undefined
  if (!currentPrintFile.value) return t('gcodeViewer.transport.followNoPrint')
  return t('gcodeViewer.transport.followOtherFile')
})
const layerRailDisabledReason = computed(() => {
  if (simulationEnabled.value) return t('gcodeViewer.layers.lockedSimulation')
  if (plannedFollowActive.value || transportState.value === 'live') {
    return t('gcodeViewer.layers.lockedFollow')
  }
  return undefined
})

const loadPercent = computed(() =>
  totalBytes.value && totalBytes.value > 0
    ? Math.min(100, Math.round((loadedBytes.value / totalBytes.value) * 100))
    : null,
)

const legendEntries = computed<GcodeLegendEntry[]>(() => {
  if (!loaded.value) return []
  if (colorMode.value === 'feature') {
    return presentFeatures.value
      .filter((feature) => featureColors.value.has(feature))
      .sort((left, right) => featureLegendOrder.indexOf(left) - featureLegendOrder.indexOf(right))
      .map((feature) => ({
        key: `feature-${feature}`,
        color: featureColors.value.get(feature) ?? '',
        label: t(`gcodeViewer.legend.features.${featureTokenNames[feature]}`),
      }))
  }
  if (colorMode.value === 'feedrate') {
    return [
      {
        key: 'feed-slow',
        color: token('--viewer-feed-slow'),
        label: t('gcodeViewer.legend.feedSlow', { value: n(feedrateLabels.value.slow) }),
      },
      {
        key: 'feed-fast',
        color: token('--viewer-feed-fast'),
        label: t('gcodeViewer.legend.feedFast', { value: n(feedrateLabels.value.fast) }),
      },
    ]
  }
  const entries: GcodeLegendEntry[] = [
    {
      key: 'toolpath',
      color: token('--viewer-extrusion'),
      label: t('gcodeViewer.legend.toolpath'),
    },
  ]
  if (toolheadVisible.value) {
    entries.push({
      key: 'printed',
      color: token('--viewer-progress'),
      label: t('gcodeViewer.legend.printed'),
    })
  }
  return entries
})

const errorTitle = computed(() =>
  viewerError.value ? t(`gcodeViewer.errors.${viewerError.value}.title`) : '',
)
const errorDescription = computed(() =>
  viewerError.value ? t(`gcodeViewer.errors.${viewerError.value}.description`) : '',
)

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

function formatFileSize(bytes: number): string {
  if (bytes < 1_024)
    return t('gcodeViewer.size.bytes', { value: numberFormatter.value.format(bytes) })
  if (bytes < 1_048_576) {
    return t('gcodeViewer.size.kilobytes', { value: decimalFormatter.value.format(bytes / 1_024) })
  }
  return t('gcodeViewer.size.megabytes', {
    value: decimalFormatter.value.format(bytes / 1_048_576),
  })
}

function formatModified(modified: number | null): string {
  if (!modified) return ''
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(modified * 1_000)
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3_600)
  const minutes = Math.round((total % 3_600) / 60)
  return hours > 0
    ? t('dashboard.duration.hoursMinutes', { hours, minutes })
    : t('dashboard.duration.minutes', { minutes })
}

/* -------------------------------------------------------------------------- */
/* Theme colors                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A semantic token as `#rrggbb`, which is the only colour syntax the library
 * accepts — it truncates anything longer and parses hex itself. Resolved
 * through the document rather than guessed, so a theme pack's own value is
 * what reaches the canvas.
 */
function token(name: string): string {
  const rgb = resolveCssColor(`var(${name})`)
  return rgb ? rgbToHex(rgb) : rgbToHex({ r: 0, g: 0, b: 0 })
}

function sceneColors(): GcodeSceneColors {
  return {
    background: token('--viewer-surface'),
    bed: token('--viewer-grid'),
    progress: token('--viewer-progress'),
    feedSlow: token('--viewer-feed-slow'),
    feedFast: token('--viewer-feed-fast'),
    /*
     * Tool colours. The first is the toolpath token every single-colour print
     * is drawn in; the rest exist because the library indexes tools by the
     * file's own `T` number and would fail on a multi-material file that
     * selects a tool it has no colour for. They reuse the feature palette,
     * which is already contrast-checked in every pack, rather than inventing
     * four more tokens for a case most printers never hit.
     */
    tools: [
      token('--viewer-extrusion'),
      token('--viewer-feature-perimeter-outer'),
      token('--viewer-feature-infill'),
      token('--viewer-feature-support'),
      token('--viewer-feature-bridge'),
    ],
  }
}

function refreshResolvedColors(): void {
  cachedToolheadBase = (() => {
    const rgb = resolveCssColor('var(--viewer-nozzle)')
    return rgb ? [rgb.r, rgb.g, rgb.b] : [255, 255, 255]
  })()
  cachedAxisColors = [token('--viewer-axis-x'), token('--viewer-axis-y'), token('--viewer-axis-z')]
  cachedAxisFont = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
  renderer?.applyColors(sceneColors())
  refreshFeatureColors()
  drawOverlay()
}

/**
 * The colour the renderer painted each feature this file contains.
 *
 * Read back from the library rather than chosen here: it decides feature
 * colour while parsing, from its own per-slicer palette, so a legend that
 * named theme tokens would disagree with the canvas the moment the two
 * differed. ADR 0011 records that trade.
 */
function refreshFeatureColors(): void {
  const next = new Map<GcodeFeature, string>()
  if (renderer && colorMode.value === 'feature') {
    for (const feature of presentFeatures.value) {
      const color = renderer.featureColor(gcodeFeatureLabels(feature))
      if (color) next.set(feature, color)
    }
  }
  featureColors.value = next
}

/* -------------------------------------------------------------------------- */
/* Overlay                                                                    */
/* -------------------------------------------------------------------------- */

function resizeSurfaces(): void {
  if (!stage.value || !overlayCanvas.value) return
  const rectangle = stage.value.getBoundingClientRect()
  overlayWidth = Math.max(1, rectangle.width)
  overlayHeight = Math.max(1, rectangle.height)
  // The overlay keeps its own full ratio: it draws a handful of shapes, so
  // there is nothing to gain by softening the toolhead, and the governor's
  // savings are all in the scene.
  overlayPixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
  overlayCanvas.value.width = Math.round(overlayWidth * overlayPixelRatio)
  overlayCanvas.value.height = Math.round(overlayHeight * overlayPixelRatio)
  renderer?.resize()
  drawOverlay()
}

// A heads-up gizmo rather than a world object, so the axis directions come
// from projecting three short vectors from the model's own center. Anything
// anchored in the scene would be occluded by the print it is describing.
function drawOrientationAxes(context: CanvasRenderingContext2D): void {
  const scene = renderer
  const file = loaded.value
  if (!scene || !file) return
  const center = [
    (file.bounds.minX + file.bounds.maxX) / 2,
    (file.bounds.minY + file.bounds.maxY) / 2,
    (file.bounds.minZ + file.bounds.maxZ) / 2,
  ] as [number, number, number]
  const origin = scene.project(center)
  if (!origin) return
  const span = Math.max(10, file.bounds.maxX - file.bounds.minX)
  const axes: Array<{ label: string; color: string; offset: [number, number, number] }> = [
    { label: t('gcodeViewer.view.axisX'), color: cachedAxisColors[0], offset: [span, 0, 0] },
    { label: t('gcodeViewer.view.axisY'), color: cachedAxisColors[1], offset: [0, span, 0] },
    { label: t('gcodeViewer.view.axisZ'), color: cachedAxisColors[2], offset: [0, 0, span] },
  ]
  /*
   * Vertically centred on the left edge, which is the one part of the stage
   * nothing else claims: the chips are along the top, the transport bar and
   * the legend along the bottom, and the layer rail down the right.
   */
  const gizmoX = 44
  const gizmoY = overlayHeight / 2

  context.save()
  context.font = `800 10px ${cachedAxisFont}`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  for (const axis of axes) {
    const tip = scene.project([
      center[0] + axis.offset[0],
      center[1] + axis.offset[1],
      center[2] + axis.offset[2],
    ])
    if (!tip) continue
    const deltaX = tip[0] - origin[0]
    const deltaY = tip[1] - origin[1]
    const length = Math.hypot(deltaX, deltaY) || 1
    const endX = gizmoX + (deltaX / length) * 22
    const endY = gizmoY + (deltaY / length) * 22
    context.strokeStyle = axis.color
    context.fillStyle = axis.color
    context.lineWidth = 2
    context.beginPath()
    context.moveTo(gizmoX, gizmoY)
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

function drawNozzle(
  context: CanvasRenderingContext2D,
  position: readonly [number, number, number],
): void {
  const scene = renderer
  if (!scene) return
  const visible = visibleNozzleFaces(
    position as [number, number, number],
    scene.cameraPosition(),
    (point) => scene.project(point) ?? [Number.NaN, Number.NaN],
  )

  context.save()
  context.lineJoin = 'round'
  for (const face of visible) {
    const [first, ...rest] = face.points
    if (!first || !Number.isFinite(first[0])) continue
    const red = Math.round(cachedToolheadBase[0] * face.shade)
    const green = Math.round(cachedToolheadBase[1] * face.shade)
    const blue = Math.round(cachedToolheadBase[2] * face.shade)
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
  if (!position || !renderer) return
  const projected = renderer.project(position)
  if (!projected) return
  const margin = nozzleHeight * 4
  if (
    projected[0] < -margin ||
    projected[1] < -margin ||
    projected[0] > overlayWidth + margin ||
    projected[1] > overlayHeight + margin
  ) {
    return
  }
  drawNozzle(context, position)
}

/* -------------------------------------------------------------------------- */
/* The scene's frontier                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Pushes the current cursor to the renderer as a byte offset.
 *
 * Every source of motion ends here — a live print, the simulation clock, a
 * drag of the scrubber — so "printed so far" has one definition regardless of
 * which of them is driving. `null` releases the frontier and shows the whole
 * file, which is also when geometry ahead of it may be drawn again.
 */
function applyFrontier(cursor: number | null): void {
  if (!renderer) return
  if (cursor === null || !loaded.value || !followSourceBytesRaw) {
    renderer.setRevealAhead(true)
    renderer.setProgressBytes(null)
    return
  }
  renderer.setRevealAhead(false)
  renderer.setProgressBytes(
    gcodeByteForCursor(followSourceBytesRaw, loaded.value.segmentCount, cursor),
  )
}

function applyLayerRange(): void {
  if (!renderer || !loaded.value) return
  // While a frontier is moving it is the only thing that decides what is
  // drawn: clipping to the active layer as well would hide the completed model
  // below it, which is the opposite of what watching a print wants.
  if (plannedFollowActive.value || simulationEnabled.value) {
    renderer.setLayerRange(null, null)
    return
  }
  const heights = loaded.value.layerHeights
  const bottom = layerBottom.value > 0 ? boundaryBelow(heights, layerBottom.value) : null
  const top = layerTop.value < layerMaximum.value ? boundaryAbove(heights, layerTop.value) : null
  renderer.setLayerRange(bottom, top)
}

/*
 * The top and bottom of a layer's geometry.
 *
 * The renderer draws every extrusion as a slab as thick as the layer, centred
 * on the height the nozzle was at, so a layer's geometry runs from half its
 * thickness below that height to half above. Clipping at the height itself
 * takes the top half of every slab off and shows the hollow insides — which is
 * how "show the first layer" came to draw walls with no roofs.
 *
 * The thickness is the layer's own — its height minus the previous layer's —
 * rather than half the distance to the neighbour above, because a first layer
 * is routinely thicker than the rest: at 0.3 mm over 0.2 mm layers its slabs
 * reach 0.05 mm into the second layer's band, and a plane halfway between the
 * two cut the first layer's roof off again. What that costs is a sliver of the
 * neighbouring layer's walls where the two overlap, which is invisible at any
 * distance a person looks at a layer from.
 */
function layerThickness(heights: Float32Array, layer: number): number {
  const height = heights[layer] ?? 0
  const previous = layer > 0 ? (heights[layer - 1] ?? 0) : 0
  const thickness = height - previous
  return thickness > 0 ? thickness : defaultLayerThicknessMillimetres
}

/** For a layer table that reports no rise, which a broken file can do. */
const defaultLayerThicknessMillimetres = 0.2

function boundaryAbove(heights: Float32Array, layer: number): number | null {
  const height = heights[layer]
  if (height === undefined) return null
  return height + layerThickness(heights, layer) / 2
}

function boundaryBelow(heights: Float32Array, layer: number): number | null {
  const height = heights[layer]
  if (height === undefined) return null
  return height - layerThickness(heights, layer) / 2
}

/* -------------------------------------------------------------------------- */
/* Planned follow (ADR 0007)                                                  */
/* -------------------------------------------------------------------------- */

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

function seedLiveToolhead(): void {
  if (!following.value || !loadedIsCurrentPrint.value) return
  if (simulationEnabled.value || plannedFollowActive.value) return
  const position = printer.toolheadPosition
  if (position.some((coordinate) => coordinate === null)) return
  smoothToolhead.setTarget(position as [number, number, number], performance.now())
  scheduleToolheadAnimation()
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
  plannedFollowActive.value = true
  lastPlannedFollowSceneUpdate = performance.now()
  applyFrontier(sample.cursor)
  applyLayerRange()
  scheduleToolheadAnimation()
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
    // The overlay marker runs every frame; the scene's frontier is a rebuild
    // of vertex colours, so it advances on its own slower clock.
    if (timestamp - lastPlannedFollowSceneUpdate >= sceneFollowIntervalMilliseconds) {
      lastPlannedFollowSceneUpdate = timestamp
      applyFrontier(sample.cursor)
    }
    drawOverlay()
    if (state.phase === 'running' && following.value && !simulationEnabled.value) {
      toolheadFrame = requestAnimationFrame(animateToolhead)
    }
    return
  }
  const result = smoothToolhead.step(timestamp, reducedMotion.matches)
  drawOverlay()
  if (result.moving && following.value && !simulationEnabled.value) {
    toolheadFrame = requestAnimationFrame(animateToolhead)
  }
}

function scheduleToolheadAnimation(): void {
  if (!following.value || simulationEnabled.value || toolheadFrame) return
  toolheadFrame = requestAnimationFrame(animateToolhead)
}

/* -------------------------------------------------------------------------- */
/* Simulation                                                                 */
/* -------------------------------------------------------------------------- */

function stopSimulationPlayback(): void {
  simulationPlaying.value = false
  lastSimulationTimestamp = 0
  if (simulationFrame) cancelAnimationFrame(simulationFrame)
  simulationFrame = 0
}

function enterSimulation(): void {
  if (simulationEnabled.value || !loaded.value || !simulationSegments) return
  stopPlannedFollow(false, false)
  simulationTimeline ??= followTimeline ?? buildGcodeSimulationTimeline(simulationSegments)
  simulationEnabled.value = true
  if (toolheadFrame) cancelAnimationFrame(toolheadFrame)
  toolheadFrame = 0
  applyLayerRange()
}

function exitSimulation(): void {
  if (!simulationEnabled.value) return
  stopSimulationPlayback()
  simulationEnabled.value = false
  simulatedPosition = null
  applyFrontier(null)
  applyLayerRange()
  startPlannedFollow()
  if (!plannedFollowActive.value) seedLiveToolhead()
}

function updateSimulation(cursor: number, updateScene = true): void {
  if (!simulationSegments || !simulationTimeline || !loaded.value) return
  const sample = sampleGcodeSimulation(simulationSegments, cursor)
  if (!sample) return
  simulationCursorValue = sample.cursor
  simulationElapsedValue = simulationTimeForCursor(simulationTimeline, sample.cursor)
  simulationCursor.value = Math.floor(sample.cursor)
  simulatedPosition = sample.position
  if (updateScene) applyFrontier(sample.cursor)
  drawOverlay()
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
    if (
      timestamp - lastSimulationSceneUpdate >= sceneFollowIntervalMilliseconds ||
      sample.cursor >= loaded.value.segmentCount
    ) {
      lastSimulationSceneUpdate = timestamp
      simulationCursor.value = Math.floor(sample.cursor)
      applyFrontier(sample.cursor)
    }
  }
  if (simulationElapsedValue >= simulationTimeline.totalSeconds) {
    stopSimulationPlayback()
    return
  }
  simulationFrame = requestAnimationFrame(animateSimulation)
}

/** Dragging the scrubber is what enters simulation; there is no separate button. */
function handleSeek(cursor: number): void {
  if (!loaded.value) return
  enterSimulation()
  stopSimulationPlayback()
  updateSimulation(cursor)
}

function handlePlay(): void {
  if (!loaded.value || !simulationSegments) return
  enterSimulation()
  if (simulationCursorValue >= loaded.value.segmentCount) updateSimulation(0)
  simulationPlaying.value = true
  lastSimulationTimestamp = 0
  simulationFrame = requestAnimationFrame(animateSimulation)
}

function handleRestart(): void {
  enterSimulation()
  stopSimulationPlayback()
  updateSimulation(0)
}

/** Jumping to the end is how a simulation is left: the whole file is shown again. */
function handleFinish(): void {
  exitSimulation()
}

/* -------------------------------------------------------------------------- */
/* Camera and keyboard                                                        */
/* -------------------------------------------------------------------------- */

function resetView(): void {
  renderer?.resetCamera()
  drawOverlay()
}

function handleStageKeydown(event: KeyboardEvent): void {
  const scene = renderer
  if (!scene) return
  const panStep = 40
  const orbitStep = 120
  let handled = true
  if (event.shiftKey && event.key === 'ArrowLeft') scene.orbitBy(-orbitStep, 0)
  else if (event.shiftKey && event.key === 'ArrowRight') scene.orbitBy(orbitStep, 0)
  else if (event.shiftKey && event.key === 'ArrowUp') scene.orbitBy(0, orbitStep)
  else if (event.shiftKey && event.key === 'ArrowDown') scene.orbitBy(0, -orbitStep)
  else if (event.key === 'ArrowLeft') scene.panBy(panStep, 0)
  else if (event.key === 'ArrowRight') scene.panBy(-panStep, 0)
  else if (event.key === 'ArrowUp') scene.panBy(0, panStep)
  else if (event.key === 'ArrowDown') scene.panBy(0, -panStep)
  else if (event.key === '+' || event.key === '=') scene.zoomBy(1.2)
  else if (event.key === '-' || event.key === '_') scene.zoomBy(1 / 1.2)
  else if (event.key === '0') resetView()
  else if (event.key === ' ' && loaded.value) {
    if (simulationPlaying.value) stopSimulationPlayback()
    else handlePlay()
  } else handled = false
  if (!handled) return
  event.preventDefault()
}

function captureScreenshot(): void {
  const file = loaded.value
  const url = renderer?.screenshot()
  if (!file || !url) return
  const link = document.createElement('a')
  link.download = `${file.name.replace(/[\\/]/g, '-')}.png`
  link.href = url
  link.click()
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                    */
/* -------------------------------------------------------------------------- */

function configuredBedBounds(): GcodeBounds | null {
  const minimum = printer.buildVolume.minimum
  const maximum = printer.buildVolume.maximum
  if (
    minimum.some((coordinate) => coordinate === null) ||
    maximum.some((coordinate) => coordinate === null)
  ) {
    return null
  }
  const [minX, minY, minZ] = minimum as [number, number, number]
  const [maxX, maxY, maxZ] = maximum as [number, number, number]
  if (maxX <= minX || maxY <= minY || maxZ <= minZ) return null
  return { minX, maxX, minY, maxY, minZ, maxZ }
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

async function runLoad(request: GcodeLoadRequest): Promise<void> {
  loadController?.abort()
  stopPlannedFollow(false, false)
  stopSimulationPlayback()
  simulationEnabled.value = false
  simulationCursorValue = 0
  simulationElapsedValue = 0
  simulationCursor.value = 0
  simulatedPosition = null
  const controller = new AbortController()
  loadController = controller
  benchmarkLoadStartedAt = performance.now()
  loading.value = true
  loadingName.value = request.name
  loadedBytes.value = 0
  totalBytes.value = request.size > 0 ? request.size : null
  viewerError.value = null
  loaded.value = null
  metadata.value = null
  layerTop.value = 0
  layerBottom.value = 0
  presentFeatures.value = []
  featureColors.value = new Map()
  governor.reset()

  try {
    const { text, summary } = await request.load(controller.signal, (progress) => {
      if (loadController !== controller) return
      loadedBytes.value = progress.loaded
      totalBytes.value = progress.total ?? totalBytes.value
    })
    if (controller.signal.aborted) return
    if (summary.segmentCount === 0) {
      viewerError.value = 'empty'
      return
    }

    const scene = renderer
    if (!scene) return
    // The tier is chosen once, here: it is a vertex budget the library meets
    // by rebuilding every mesh, so it cannot be a slider the user drags.
    const tier = gcodeTierFor(qualityMode.value, tierCeiling.value, request.size)
    await scene.setTier(tier)
    scene.setBedBounds(configuredBedBounds(), printerConfig.bedShape === 'circular')
    scene.setFeedrateRange(summary.minimumFeedrate, summary.maximumFeedrate)
    await scene.load(text, {
      onProgress: (fraction) => {
        if (loadController !== controller) return
        // The library reports its parse as a fraction; the download reported
        // bytes. Both are the same bar, so the second half of it is the parse.
        if (totalBytes.value) loadedBytes.value = totalBytes.value * fraction
      },
    })
    if (controller.signal.aborted) return

    simulationSegments = summary.segments
    simulationTimeline = null
    followSourceBytesRaw = summary.sourceBytes
    followSourceBytes = null
    followTimeline = null
    plannedFollowBlocked = false
    plannedFollowMismatchStarted = null
    loadedFeedrates.value = [summary.minimumFeedrate, summary.maximumFeedrate]
    loaded.value = {
      name: request.name,
      source: request.source,
      size: request.size || loadedBytes.value,
      bounds: summary.extrusionBounds,
      layerHeights: summary.layerHeights,
      segmentCount: summary.segmentCount,
      extrusionCount: summary.extrusionCount,
      travelCount: summary.travelCount,
      sourceByteCount: summary.sourceByteCount,
    }
    presentFeatures.value = collectFeatures(summary.segments)
    activeTier.value = scene.tier
    travelsAvailable.value = scene.travelsAvailable
    recoveredFromFailedLoad.value = scene.recoveredFromFailedLoad
    layerTop.value = layerMaximum.value
    layerBottom.value = 0
    scene.setTravels(showTravels.value)
    applyFrontier(null)
    applyLayerRange()
    refreshFeatureColors()
    scene.resetCamera()
    benchmarkLoadMilliseconds = performance.now() - benchmarkLoadStartedAt
    if (request.source === 'moonraker') void loadFileMetadata(request.name)
    startPlannedFollow()
    if (!plannedFollowActive.value) seedLiveToolhead()
  } catch (error) {
    if (error instanceof GcodeFileTooLargeError) viewerError.value = 'tooLarge'
    else if (!(error instanceof DOMException && error.name === 'AbortError')) {
      viewerError.value = 'download'
      if (import.meta.env.DEV) console.error('[gcode viewer] load failed', error)
    }
    renderer?.clear()
  } finally {
    if (loadController === controller) {
      loadController = null
      loading.value = false
    }
  }
}

async function loadFileMetadata(path: string): Promise<void> {
  metadata.value = await printer.loadMetadata(path.replace(/^gcodes\//i, ''))
}

/**
 * Every load funnels through here so an oversized file gets one confirmation
 * before the library commits the whole thing to memory as text.
 */
function requestLoad(request: GcodeLoadRequest): void {
  loadRequested = true
  const threshold = tierCeiling.value <= 3 ? weakDeviceConfirmBytes : largeFileConfirmBytes
  if (request.size > threshold && confirmations.shouldConfirm('openLargeGcodeFile')) {
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
    load: (signal, onProgress) =>
      fetchAndParseGcode(url, {
        signal,
        onProgress,
        // Moonraker sends no Content-Length, so the file listing's size is
        // what gives the progress bar a denominator.
        declaredTotalBytes: size,
        filamentDiameter: effectiveFilamentDiameter.value,
      }),
  })
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
    load: (signal, onProgress) =>
      parseGcodeFile(file, {
        signal,
        onProgress,
        filamentDiameter: effectiveFilamentDiameter.value,
      }),
  })
}

function cancelLoad(): void {
  renderer?.cancelLoad()
  loadController?.abort()
}

/* -------------------------------------------------------------------------- */
/* Mode changes                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The rendering library cannot rebuild two copies of a file at once: both
 * reparses write into the same processor and scene. Mode rows remain usable
 * while a large file is rebuilding, so every colour and tier change shares
 * one queue. Reading the selected setting inside the queued callback also
 * coalesces choices made before that callback starts into the latest choice.
 */
async function serializeSceneReparse(
  scene: GcodeSceneRenderer,
  reparse: () => Promise<void>,
): Promise<void> {
  pendingSceneReparses += 1
  reloading.value = true
  const operation = sceneReparseTail
    .catch(() => undefined)
    .then(async () => {
      if (unmounted || renderer !== scene || !loaded.value) return
      await reparse()
    })
  sceneReparseTail = operation
  try {
    await operation
  } finally {
    pendingSceneReparses -= 1
    reloading.value = pendingSceneReparses > 0
  }
}

async function chooseColorMode(mode: GcodeColorMode): Promise<void> {
  if (mode === colorMode.value) return
  setColorMode(mode)
  const scene = renderer
  if (!scene || !loaded.value) return
  // Colour is built into the geometry, so this is a reparse. The pending
  // treatment is on the stage for as long as it takes, because a file large
  // enough to matter takes long enough that silence would read as a hang.
  await serializeSceneReparse(scene, async () => {
    await scene.setColorMode(colorMode.value)
    refreshFeatureColors()
  })
}

async function chooseQualityMode(mode: (typeof qualityModes)[number]): Promise<void> {
  if (mode === qualityMode.value) return
  setQualityMode(mode)
  governor.setMode(mode)
  qualityStep.value = governor.currentStep()
  const scene = renderer
  if (!scene) return
  scene.setResolutionScale(governor.state().resolutionScale)
  if (!loaded.value) return
  await serializeSceneReparse(scene, async () => {
    const file = loaded.value
    if (!file) return
    const tier = gcodeTierFor(qualityMode.value, tierCeiling.value, file.size)
    if (tier === scene.tier) return
    await scene.setTier(tier)
    activeTier.value = scene.tier
    travelsAvailable.value = scene.travelsAvailable
    scene.setTravels(showTravels.value)
    applyFrontier(simulationEnabled.value ? simulationCursorValue : null)
    applyLayerRange()
    refreshFeatureColors()
  })
}

/*
 * A popover row's handler has to be a single expression.
 *
 * Vue compiles an inline handler as one expression unless it can see a
 * statement, so two calls on two lines are a parse error at build time — and
 * the formatter rewrites a semicolon-joined pair back onto separate lines, so
 * the working form cannot be kept by punctuation. These wrappers are what
 * makes each row's handler one call.
 *
 * Closing first is deliberate: the popover leaves immediately and the stage's
 * pending treatment is what shows the reparse taking place behind it.
 */
function pickColorMode(mode: GcodeColorMode, close: () => void): void {
  close()
  void chooseColorMode(mode)
}

function pickQualityMode(mode: (typeof qualityModes)[number], close: () => void): void {
  close()
  void chooseQualityMode(mode)
}

function toggleTravels(): void {
  setShowTravels(!showTravels.value)
  renderer?.setTravels(showTravels.value)
}

function chooseFollowing(enabled: boolean): void {
  following.value = enabled
  setFollowByDefault(enabled)
  if (enabled) {
    if (simulationEnabled.value) exitSimulation()
    startPlannedFollow()
    if (!plannedFollowActive.value) seedLiveToolhead()
  } else {
    stopPlannedFollow(false, false)
    applyFrontier(null)
    applyLayerRange()
  }
}

/* -------------------------------------------------------------------------- */
/* Watchers                                                                   */
/* -------------------------------------------------------------------------- */

watch([layerTop, layerBottom], applyLayerRange)

watch(
  () => printer.toolheadPosition,
  (position) => {
    if (!following.value || !loadedIsCurrentPrint.value) return
    if (simulationEnabled.value || plannedFollowActive.value) return
    if (position.some((coordinate) => coordinate === null)) return
    smoothToolhead.setTarget(position as [number, number, number], performance.now())
    scheduleToolheadAnimation()
  },
  { deep: true, immediate: true },
)

watch(livePrintProgress, (progress) => {
  // The telemetry fallback: no planned playback, but the loaded file is the
  // one printing, so the frontier still follows the reported byte position.
  if (plannedFollowActive.value || simulationEnabled.value) return
  if (!following.value || !loadedIsCurrentPrint.value || !loaded.value) return
  if (!renderer) return
  renderer.setRevealAhead(false)
  renderer.setProgressBytes(Math.round(progress * loaded.value.sourceByteCount))
})

watch(livePrintLayer, () => {
  if (plannedFollowActive.value || simulationEnabled.value) return
  applyLayerRange()
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

watch(
  () => [...printer.buildVolume.minimum, ...printer.buildVolume.maximum],
  () => {
    renderer?.setBedBounds(configuredBedBounds(), printerConfig.bedShape === 'circular')
  },
)

function handleReducedMotionChange(event: MediaQueryListEvent): void {
  reducedMotionEnabled.value = event.matches
}

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One measured frame. The governor spends it on resolution, which is free to
 * change between frames; when it has run out of ladder and frames are still
 * long, the device's tier ceiling drops so the *next* load starts cheaper.
 * Reloading the current file mid-session would be a worse cure than the
 * stutter it treats.
 */
function handleFrame(intervalMilliseconds: number): void {
  const report = governor.sample(intervalMilliseconds)
  if (report.changed) {
    qualityStep.value = report.step
    renderer?.setResolutionScale(report.state.resolutionScale)
  }
  if (report.tierExhausted && qualityMode.value !== 'quality') lowerTierCeiling()
  // Camera motion is what makes the library render, so this is also the exact
  // moment the overlay's projection has gone stale.
  drawOverlay()
}

onMounted(async () => {
  await nextTick()
  following.value = followByDefault.value
  if (!stage.value) return
  let created: GcodeSceneRenderer
  try {
    created = await createGcodeSceneRenderer(stage.value, {
      colors: sceneColors(),
      tier: gcodeTierFor(qualityMode.value, tierCeiling.value, 0),
      resolutionScale: governor.state().resolutionScale,
      nozzleDiameter: effectiveNozzleDiameter.value,
      bedBounds: configuredBedBounds(),
      delta: printerConfig.bedShape === 'circular',
      onFrame: handleFrame,
    })
  } catch (error) {
    if (import.meta.env.DEV) console.error('[gcode viewer] renderer unavailable', error)
    viewerError.value = 'renderer'
    return
  }
  // The page can be left while the renderer is still being built. Its
  // unmount hook found nothing to dispose, so this is where the engine goes.
  if (unmounted || !stage.value) {
    created.dispose()
    return
  }
  renderer = created
  recoveredFromFailedLoad.value = renderer.recoveredFromFailedLoad
  activeTier.value = renderer.tier
  travelsAvailable.value = renderer.travelsAvailable
  resizeObserver = new ResizeObserver(resizeSurfaces)
  resizeObserver.observe(stage.value)
  refreshResolvedColors()
  themeObserver = new MutationObserver(refreshResolvedColors)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-theme-pack', 'data-font'],
  })
  resizeSurfaces()
  reducedMotion.addEventListener('change', handleReducedMotionChange)
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
      tier: () => activeTier.value,
      resolutionScale: () => governor.state().resolutionScale,
      viewportSize: () => ({ width: overlayWidth, height: overlayHeight }),
      resetView,
      orbitBy: (deltaX, deltaY) => renderer?.orbitBy(deltaX, deltaY),
      zoomBy: (factor) => renderer?.zoomBy(factor),
      screenshot: () => renderer?.screenshot() ?? null,
      loadUrl: (url) =>
        runLoad({
          name: url,
          source: 'local',
          size: 0,
          load: (signal, onProgress) =>
            fetchAndParseGcode(url, {
              signal,
              onProgress,
              filamentDiameter: effectiveFilamentDiameter.value,
            }),
        }),
    })
  }
  await printer.refreshFiles()
  /*
   * Opening the viewer while a print is running almost always means wanting to
   * watch that print, so it is loaded without being asked for.
   *
   * Two guards, both of which cost a real bug to find. It waits on the file
   * list, so by the time it runs the user may already have picked something —
   * and this starting then would abort their choice and load a different file
   * under them. And it gates on a print actually running rather than on a
   * filename being known: `print_stats` keeps the last file's name long after
   * it finished, so the looser test downloaded a stale job on every visit.
   */
  if (!loadRequested && printer.hasActivePrint && currentPrintFile.value && followByDefault.value) {
    loadRemoteFile(currentPrintFile.value)
  }
})

onBeforeUnmount(() => {
  unmounted = true
  uninstallBenchmark?.()
  uninstallBenchmark = null
  loadController?.abort()
  resizeObserver?.disconnect()
  themeObserver?.disconnect()
  reducedMotion.removeEventListener('change', handleReducedMotionChange)
  if (toolheadFrame) cancelAnimationFrame(toolheadFrame)
  stopSimulationPlayback()
  simulationSegments = null
  simulationTimeline = null
  followSourceBytesRaw = null
  followSourceBytes = null
  followTimeline = null
  stopPlannedFollow(false, false)
  // The library keeps its engine, scene, meshes and the whole file text alive
  // for as long as nobody disposes them, and it has no disposer of its own.
  renderer?.dispose()
  renderer = null
})
</script>

<template>
  <section class="workspace-page gcode-viewer-page">
    <PageHeading :title="t('gcodeViewer.title')" />

    <div class="gcode-viewer-panel">
      <div
        ref="stage"
        class="gcode-viewer-stage"
        tabindex="0"
        role="img"
        :aria-label="t('gcodeViewer.stageLabel')"
        aria-describedby="gcode-viewer-help"
        :data-pending="loading || reloading ? 'true' : undefined"
        @keydown="handleStageKeydown"
        @contextmenu.prevent
      >
        <!--
          The scene canvas is not here: the renderer creates and owns it, one
          fresh element per engine, because an engine is bound to its canvas
          for life. The overlay below is ours.
        -->
        <canvas
          ref="overlayCanvas"
          class="gcode-viewer-canvas gcode-viewer-canvas--overlay"
          aria-hidden="true"
        ></canvas>

        <!--
          The pointer, touch and keyboard instructions the stage used to print
          under itself. Kept for the accessible description and for the gear
          dialog's Controls section, which is where a person now reads them.
        -->
        <p id="gcode-viewer-help" class="sr-only">{{ t('gcodeViewer.help') }}</p>

        <div v-if="viewerError" class="gcode-viewer-empty" role="alert">
          <AppIcon name="emergency" class="gcode-viewer-empty__mark" aria-hidden="true" />
          <h2>{{ errorTitle }}</h2>
          <p>{{ errorDescription }}</p>
        </div>

        <div v-else-if="!loaded && !loading" class="gcode-viewer-empty">
          <AppIcon name="viewer" class="gcode-viewer-empty__mark" aria-hidden="true" />
          <h2>{{ t('gcodeViewer.empty.title') }}</h2>
          <p>{{ t('gcodeViewer.empty.description') }}</p>
        </div>

        <!-- Top left: what is loaded, and how it is drawn. -->
        <div class="gcode-chips gcode-chips--start">
          <HeaderMenu
            :label="t('gcodeViewer.files.open')"
            align="start"
            panel-class="gcode-popover gcode-popover--files"
            trigger-variant="quiet"
            trigger-size="xs"
            trigger-class="gcode-chip gcode-chip--file"
            trigger-on-strong
          >
            <template #trigger>
              <AppIcon
                :name="loading ? 'refresh' : 'fileText'"
                class="size-4 shrink-0"
                aria-hidden="true"
              />
              <span class="gcode-chip__label">{{
                loaded?.name ?? loadingName ?? t('gcodeViewer.files.open')
              }}</span>
            </template>
            <template #default="{ close }">
              <GcodeFilePicker
                v-model:search="fileSearch"
                :files="printer.files"
                :printing-path="currentPrintFile || null"
                :loaded-path="loaded?.name ?? null"
                :format-size="formatFileSize"
                :format-modified="formatModified"
                @select="loadRemoteFile"
                @local="localFileInput?.click()"
                @close="close"
              />
            </template>
          </HeaderMenu>

          <HeaderMenu
            v-if="loaded"
            :label="t('gcodeViewer.color.title')"
            align="start"
            panel-class="gcode-popover gcode-popover--narrow"
            trigger-variant="quiet"
            trigger-size="xs"
            trigger-class="gcode-chip"
            trigger-on-strong
          >
            <template #trigger>
              {{ t(`gcodeViewer.color.modes.${colorMode}`) }}
            </template>
            <template #default="{ close }">
              <AppButton
                v-for="mode in colorModes"
                :key="mode"
                variant="quiet"
                size="sm"
                block
                :aria-pressed="mode === colorMode ? 'true' : 'false'"
                @click="pickColorMode(mode, close)"
              >
                {{ t(`gcodeViewer.color.modes.${mode}`) }}
              </AppButton>
              <p v-if="colorMode === 'feedrate'" class="gcode-popover__note">
                {{
                  t('gcodeViewer.color.feedRange', {
                    slow: n(feedrateLabels.slow),
                    fast: n(feedrateLabels.fast),
                  })
                }}
              </p>
            </template>
          </HeaderMenu>

          <AppButton
            v-if="loaded"
            class="gcode-chip"
            variant="quiet"
            size="xs"
            on-strong
            :disabled="!travelsAvailable"
            :title="travelsAvailable ? undefined : t('gcodeViewer.layers.travelsUnavailable')"
            :aria-pressed="showTravels && travelsAvailable ? 'true' : 'false'"
            @click="toggleTravels"
          >
            {{ t('gcodeViewer.layers.travels') }}
          </AppButton>

          <HeaderMenu
            v-if="loaded"
            :label="t('gcodeViewer.quality.title')"
            align="start"
            panel-class="gcode-popover gcode-popover--narrow"
            trigger-variant="quiet"
            trigger-size="xs"
            trigger-class="gcode-chip"
            trigger-on-strong
          >
            <template #trigger>
              {{ t(`gcodeViewer.quality.modes.${qualityMode}`) }}
            </template>
            <template #default="{ close }">
              <AppButton
                v-for="mode in qualityModes"
                :key="mode"
                variant="quiet"
                size="sm"
                block
                :aria-pressed="mode === qualityMode ? 'true' : 'false'"
                @click="pickQualityMode(mode, close)"
              >
                {{ t(`gcodeViewer.quality.modes.${mode}`) }}
              </AppButton>
              <p class="gcode-popover__note">
                {{
                  t('gcodeViewer.quality.state', {
                    tier: t(`gcodeViewer.statistics.tier.${activeTier}`),
                    step: n(qualityStep + 1),
                    total: n(qualityStepTotal + 1),
                  })
                }}
              </p>
            </template>
          </HeaderMenu>
        </div>

        <!-- Top right: the view's own tools. -->
        <div class="gcode-chips gcode-chips--end">
          <HeaderMenu
            v-if="loaded"
            :label="t('gcodeViewer.statistics.title')"
            align="end"
            panel-class="gcode-popover"
            trigger-variant="quiet"
            trigger-size="xs"
            trigger-class="gcode-chip"
            trigger-on-strong
            trigger-icon-only
          >
            <template #trigger>
              <AppIcon name="info" class="size-4 shrink-0" aria-hidden="true" />
            </template>
            <template #default>
              <GcodeInfoPanel
                :layers="layerCount"
                :moves="loaded.segmentCount"
                :extrusions="loaded.extrusionCount"
                :travels="loaded.travelCount"
                :size="loaded.size"
                :tier="activeTier"
                :recovered="recoveredFromFailedLoad"
                :metadata="metadata"
                :format-size="formatFileSize"
                :format-duration="formatDuration"
              />
            </template>
          </HeaderMenu>
          <AppButton
            v-if="loaded"
            class="gcode-chip"
            variant="quiet"
            size="xs"
            icon-only
            on-strong
            icon="refresh"
            :aria-label="t('gcodeViewer.view.reset')"
            @click="resetView"
          />
          <AppButton
            v-if="loaded"
            class="gcode-chip"
            variant="quiet"
            size="xs"
            icon-only
            on-strong
            icon="snapshot"
            :aria-label="t('gcodeViewer.view.screenshot')"
            @click="captureScreenshot"
          />
          <AppButton
            class="gcode-chip"
            variant="quiet"
            size="xs"
            icon-only
            on-strong
            icon="settings"
            :aria-label="t('gcodeViewer.settings.open')"
            @click="settingsOpen = true"
          />
        </div>

        <GcodeLayerRail
          v-if="loaded && layerMaximum > 0"
          :maximum="layerMaximum"
          :top="layerTop"
          :bottom="layerBottom"
          :heights="loaded.layerHeights"
          :disabled-reason="layerRailDisabledReason"
          @update:top="layerTop = $event"
          @update:bottom="layerBottom = $event"
        />

        <GcodeLegend :entries="legendEntries" />

        <GcodeTransportBar
          v-if="loaded || loading"
          :state="transportState"
          :loading-name="loadingName"
          :loading-percent="loadPercent"
          :following="following"
          :follow-available="loadedIsCurrentPrint"
          :follow-unavailable-reason="followUnavailableReason"
          :live-progress="livePrintProgress"
          :cursor="simulationCursor"
          :total-moves="loaded?.segmentCount ?? 0"
          :playing="simulationPlaying"
          :speed="simulationSpeed"
          :speeds="simulationSpeeds"
          @cancel="cancelLoad"
          @update:following="chooseFollowing"
          @seek="handleSeek"
          @play="handlePlay"
          @pause="stopSimulationPlayback"
          @restart="handleRestart"
          @finish="handleFinish"
          @update:speed="simulationSpeed = $event as (typeof simulationSpeeds)[number]"
        />
      </div>
    </div>

    <input
      ref="localFileInput"
      class="sr-only"
      type="file"
      accept=".gcode,.g,.gco,.nc,text/plain"
      @change="handleLocalFile"
    />

    <GcodeViewerSettingsDialog
      :open="settingsOpen"
      :machine-nozzle-diameter="machineNozzleDiameter"
      :nozzle-diameter="nozzleDiameterOverride"
      @update:nozzle-diameter="setNozzleDiameterOverride"
      @close="settingsOpen = false"
    />

    <!--
      Deliberately outside the stage: a dialog's pointer events landing on the
      canvas would start a camera drag behind it.
    -->
    <ConfirmDialog
      :open="pendingLoad !== null"
      :title="t('gcodeViewer.confirmLoad.title')"
      :description="
        t('gcodeViewer.confirmLoad.description', {
          name: pendingLoad?.name ?? '',
          size: formatFileSize(pendingLoad?.size ?? 0),
        })
      "
      :confirm-label="t('gcodeViewer.confirmLoad.confirm')"
      @confirm="confirmPendingLoad"
      @cancel="pendingLoad = null"
    />
  </section>
</template>
