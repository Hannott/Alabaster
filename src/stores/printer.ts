import { defineStore } from 'pinia'
import { computed, reactive, ref, watch, type WatchStopHandle } from 'vue'

import type {
  JsonRpcNotification,
  MoonrakerFileInfo,
  MoonrakerGcodeMetadata,
  ObjectSnapshotHandler,
  PrinterObjectSelection,
  PrinterObjectSnapshot,
} from '@/services/moonraker'
import {
  isPrintableGcodeFilename,
  moonrakerThumbnailUrl,
  uploadMoonrakerFile,
} from '@/services/moonraker'
import { configBoolean } from '@/dashboard/context'
import { useAvailabilityStore } from '@/stores/availability'
import { createCommandRunner } from '@/stores/commandRunner'
import { useBedMeshStore } from '@/stores/bedMesh'
import { useConsoleStore } from '@/stores/console'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrintersStore } from '@/stores/printers'
import { useTelemetryStore } from '@/stores/telemetry'
// Discovery owns which methods exist; this store owns the command each one sends.
import { usePrinterConfigStore, type LevelingMethod } from '@/stores/printerConfig'
import { isRecord } from '@/utils/records'

const printerSubscriptionKey = 'alabaster.printer'
const maximumActivities = 12
/**
 * Extrapolating a total from elapsed time needs the print to have produced a
 * signal first; below this the projection swings by hours between updates.
 */
const minimumExtrapolationSeconds = 60

const printerSelection: PrinterObjectSelection = {
  print_stats: [
    'state',
    'filename',
    'print_duration',
    'total_duration',
    'filament_used',
    'message',
    // Slicers that call SET_PRINT_STATS_INFO report the layer counters here.
    // Files sliced without it leave them absent, so the layer readout falls
    // back to deriving the layer from Z height and the metadata layer heights.
    'info',
  ],
  virtual_sdcard: ['progress', 'is_active', 'file_position'],
  display_status: ['progress', 'message'],
  gcode_move: [
    'gcode_position',
    'homing_origin',
    'speed_factor',
    'extrude_factor',
    'absolute_coordinates',
    'absolute_extrude',
  ],
  /*
   * `live_extruder_velocity` is millimetres of filament per second at the
   * extruder, reported on the same object at the same rate as the toolhead's
   * own velocity. Without it a slow purge and a silently refused extrude look
   * identical, which is the distinction Movement already draws for the
   * toolhead and this leaves undrawn for the extruder.
   */
  motion_report: ['live_position', 'live_velocity', 'live_extruder_velocity'],
  toolhead: [
    'position',
    'homed_axes',
    'axis_minimum',
    'axis_maximum',
    'max_velocity',
    'max_accel',
    'square_corner_velocity',
    'minimum_cruise_ratio',
  ],
  extruder: ['pressure_advance', 'smooth_time', 'can_extrude'],
  /*
   * Present only on a printer whose config declares `[firmware_retraction]`, so
   * asking for it costs nothing where it does not exist — an absent object is
   * simply absent rather than an error. Requested as the superset the two
   * firmwares between them report: mainline has four settings, Kalico adds
   * `z_hop_height`, and whichever is missing never arrives.
   *
   * `unretract_length` is deliberately not requested — it is derived from the
   * retract length plus the extra, so subscribing to it would invite a field
   * that looks settable and is not.
   */
  firmware_retraction: [
    'retract_length',
    'retract_speed',
    'unretract_extra_length',
    'unretract_speed',
    'z_hop_height',
    'retract_state',
  ],
  /**
   * Whether Klipper is holding config changes that `SAVE_CONFIG` has not
   * written yet — `Z_OFFSET_APPLY_PROBE` and a PID calibration both stage one —
   * and, beside it, exactly what those changes are. Subscribed rather than
   * inferred from having just issued the command, because both are cleared by
   * anything that saves: another card, the console, or a second browser. A card
   * that inferred it would keep offering a save that had already happened.
   *
   * `save_config_pending_items` is what makes the save dialog able to say which
   * values move rather than only that some do. It arrives as
   * `{section: {option: value}}` with every value a string, because these are
   * the lines `SAVE_CONFIG` would write; `configfile.settings` holds the loaded
   * values it replaces. See `features/config/pendingConfig.ts`, which reads the
   * two together.
   */
  configfile: ['save_config_pending', 'save_config_pending_items'],
  /*
   * Whether the gantry or the Z steppers have actually been aligned since the
   * motors were last off. Both objects share Klipper's own `ZAdjustStatus`,
   * which latches `applied` when a run completes and resets it on the
   * `stepper_enable:motor_off` event — so this is a per-session fact, not a
   * stored one, and it is exactly what nothing else can answer: a machine that
   * has been homed reports every axis homed whether or not the gantry under it
   * is square. Present only where the config declares the section, like
   * `firmware_retraction` above.
   */
  quad_gantry_level: ['applied'],
  z_tilt: ['applied'],
}

export type PrintState = 'standby' | 'printing' | 'paused' | 'complete' | 'cancelled' | 'error'

export const printerCommandKeys = [
  'emergencyStop',
  'pause',
  'resume',
  'cancel',
  'startPrint',
  'home',
  'move',
  'temperature',
  'fan',
  'speed',
  'extrusion',
  'console',
  'files',
  'zOffset',
  'pin',
  'limits',
  'extrude',
  'pressureAdvance',
  'retraction',
  'bedMesh',
  'probeAccuracy',
  'measureAxesNoise',
  'clearPrint',
  'uploadFile',
  'restartKlipper',
  'firmwareRestart',
  'restartMoonraker',
  'rebootHost',
  'shutdownHost',
  'calibrateHeater',
  'saveConfig',
  'motorsOff',
  'leveling',
  'excludeObject',
  /*
   * Two keys, not one, because the step ladder and the two ways out of a
   * manual probe are different actions with different consequences. Sharing a
   * key would make `runCommand`'s one-pending-per-key gate silently swallow an
   * Abort pressed while a TESTZ move was still in flight — the one press in
   * this dialog that must never look ignored.
   */
  'manualProbe',
  'manualProbeFinish',
  /*
   * One key for all three answers to a bed-screw prompt. Unlike a manual probe
   * there is no ladder here — Accept, Adjusted and Abort are mutually
   * exclusive, each ends the wait at the screw the machine is standing at, and
   * each moves the toolhead before the next prompt arrives. Sharing the key is
   * what stops a second press landing on a screw the machine has already left.
   */
  'bedScrews',
] as const

export type PrinterCommandKey = (typeof printerCommandKeys)[number]

/**
 * A manual probe step: a relative distance in millimetres, or one of Klipper's
 * four bisection words. `'+'`/`'-'` halve the gap to the nearest height already
 * visited in that direction; `'++'`/`'--'` go all the way to it.
 */
export type ManualProbeStep = number | '+' | '-' | '++' | '--'

export interface PrinterActivity {
  id: number
  kind: 'print' | 'command' | 'connection'
  titleKey: string
  detail?: string
  createdAt: number
}

interface PrintStats {
  state: PrintState
  filename: string
  printDuration: number
  totalDuration: number
  filamentUsed: number
  message: string
  currentLayer: number | null
  totalLayer: number | null
}

interface VirtualSdcard {
  progress: number
  isActive: boolean
  filePosition: number
}

interface MotionState {
  position: [number | null, number | null, number | null]
  livePosition: [number | null, number | null, number | null]
  /** Klipper monotonic eventtime for the accepted live-position sample. */
  livePositionEventtime: number | null
  homingOrigin: [number | null, number | null, number | null]
  liveVelocity: number
  /** Millimetres of filament per second, signed: negative while retracting. */
  liveExtruderVelocity: number
  homedAxes: string
  speedFactor: number
  extrusionFactor: number
  absoluteCoordinates: boolean
  absoluteExtrude: boolean
  maxVelocity: number | null
  maxAccel: number | null
  squareCornerVelocity: number | null
  minimumCruiseRatio: number | null
}

interface ExtruderState {
  pressureAdvance: number | null
  smoothTime: number | null
  canExtrude: boolean
}

/**
 * Firmware retraction as the machine reports it. A map rather than named fields
 * because which settings exist depends on the firmware — mainline reports four,
 * Kalico five — and a named field per setting would have to be edited every
 * time that set changed. `hasSettings` separates "this printer has no
 * `[firmware_retraction]`" from "it has one and nothing has arrived yet".
 */
interface RetractionState {
  settings: Record<string, number>
  hasSettings: boolean
  isRetracted: boolean
}

interface BuildVolumeState {
  minimum: [number | null, number | null, number | null]
  maximum: [number | null, number | null, number | null]
}

/**
 * Whether each gantry alignment has been run since the motors were last off.
 * `null` where the machine has never reported the object at all, which is how a
 * printer that has no `[quad_gantry_level]` is told apart from one that has it
 * and has not levelled yet — the distinction the whole reading exists for,
 * since only the second is worth saying anything about.
 */
interface LevelingState {
  quadGantryApplied: boolean | null
  zTiltApplied: boolean | null
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function finitePosition(value: unknown): [number | null, number | null, number | null] | undefined {
  if (!Array.isArray(value)) return undefined
  return [0, 1, 2].map((index) => finiteNumber(value[index]) ?? null) as [
    number | null,
    number | null,
    number | null,
  ]
}

function positionsEqual(a: readonly (number | null)[], b: readonly (number | null)[]): boolean {
  return a.length === b.length && a.every((coordinate, index) => coordinate === b[index])
}

/**
 * `motion_report`'s own "nothing queued right now" answer: when Klipper is
 * asked for the live position and its move queue holds nothing at that
 * instant — the gap right as a jog is sent, after the previous move has
 * already aged out of the queue's short history — it reports a bare zero
 * position at zero velocity rather than the toolhead's actual last position.
 * That is indistinguishable from a real reading only if the toolhead is
 * genuinely parked at its most negative corner with nothing moving, which a
 * jog does not produce, so this combination is treated as no data yet and the
 * previous live position is kept instead of drawing the toolhead at the
 * origin for one sample and back.
 */
function isEmptyMotionQueueReading(
  position: readonly (number | null)[],
  velocity: number,
): boolean {
  return velocity === 0 && position.every((coordinate) => coordinate === 0)
}

function isPrintState(value: unknown): value is PrintState {
  return ['standby', 'printing', 'paused', 'complete', 'cancelled', 'error'].includes(String(value))
}

type PrintEndState = 'complete' | 'cancelled' | 'error'

function isPrintEndState(value: PrintState): value is PrintEndState {
  return value === 'complete' || value === 'cancelled' || value === 'error'
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

const levelingCommands: Record<LevelingMethod, string> = {
  quadGantryLevel: 'QUAD_GANTRY_LEVEL',
  zTilt: 'Z_TILT_ADJUST',
  screwsTiltAdjust: 'SCREWS_TILT_CALCULATE',
  bedScrews: 'BED_SCREWS_ADJUST',
  deltaCalibrate: 'DELTA_CALIBRATE',
}

/** One screw from SCREWS_TILT_CALCULATE; the base screw is measured, not adjusted. */
export interface ScrewAdjustment {
  name: string
  isBase: boolean
  direction: 'CW' | 'CCW' | null
  /** Full turns and clock-face minutes, exactly as Klipper reports them. */
  turns: number
  minutes: number
}

/*
 * Klipper reports screw adjustments only as console text, in the shape
 *
 *   // front left screw (base) : x=-5.0, y=30.0, z=2.48750
 *   // front right screw : x=155.0, y=30.0, z=2.36000 : adjust CW 01:15
 *
 * so reading them off the card means parsing that text. Splitting on " : "
 * rather than matching the coordinates keeps this working against the
 * malformed coordinate list Klipper's own documented sample contains
 * ("y=155.0, y=190.0"), since the coordinates are not what is being read —
 * the screw's name and its adjustment are.
 */
export function parseScrewsTiltResults(lines: readonly string[]): ScrewAdjustment[] {
  const screws: ScrewAdjustment[] = []
  for (const line of lines) {
    const parts = line
      .replace(/^\/\/\s*/, '')
      .split(' : ')
      .map((part) => part.trim())
    const [name, coordinates, adjustment] = parts
    if (!name || !coordinates?.includes('z=')) continue

    const match = adjustment?.match(/^adjust\s+(CW|CCW)\s+(\d+):(\d+)$/i)
    screws.push({
      name: name.replace(/\s*\(base\)\s*$/i, '').trim(),
      isBase: /\(base\)/i.test(name),
      direction: match ? (match[1]!.toUpperCase() as 'CW' | 'CCW') : null,
      turns: match ? Number(match[2]) : 0,
      minutes: match ? Number(match[3]) : 0,
    })
  }
  return screws
}

/*
 * The reactive blocks below are seeded and re-seeded from these, so switching
 * printers cannot drift from a fresh load: a field added to one is a field the
 * reset clears too, because they are the same literal.
 */
function initialPrintStats(): PrintStats {
  return {
    state: 'standby',
    filename: '',
    printDuration: 0,
    totalDuration: 0,
    filamentUsed: 0,
    message: '',
    currentLayer: null,
    totalLayer: null,
  }
}

function initialVirtualSdcard(): VirtualSdcard {
  return { progress: 0, isActive: false, filePosition: 0 }
}

function initialMotion(): MotionState {
  return {
    position: [null, null, null],
    livePosition: [null, null, null],
    livePositionEventtime: null,
    homingOrigin: [0, 0, 0],
    liveVelocity: 0,
    liveExtruderVelocity: 0,
    homedAxes: '',
    speedFactor: 1,
    extrusionFactor: 1,
    absoluteCoordinates: true,
    absoluteExtrude: false,
    maxVelocity: null,
    maxAccel: null,
    squareCornerVelocity: null,
    minimumCruiseRatio: null,
  }
}

function initialExtruder(): ExtruderState {
  return { pressureAdvance: null, smoothTime: null, canExtrude: false }
}

function initialRetraction(): RetractionState {
  return { settings: {}, hasSettings: false, isRetracted: false }
}

function initialBuildVolume(): BuildVolumeState {
  return { minimum: [null, null, null], maximum: [null, null, null] }
}

function initialLeveling(): LevelingState {
  return { quadGantryApplied: null, zTiltApplied: null }
}

export const usePrinterStore = defineStore('printer', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()
  const bedMesh = useBedMeshStore()
  const telemetry = useTelemetryStore()
  const printers = usePrintersStore()
  /**
   * The console owns the transcript, but every script this store dispatches has
   * to land in it — see `sendGcode`. Resolved here, once: the console store's
   * setup deliberately does not resolve this store back, so the pair cannot
   * recurse while either is constructing.
   */
  const gcodeConsole = useConsoleStore()
  const detectedPrinterName = ref<string | null>(null)
  /**
   * The name the user chose, which belongs to the printer rather than to this
   * browser: it lives on the entry in the printers store, so it no longer
   * follows the user from one machine to the next.
   */
  const customPrinterName = computed<string | null>(() => printers.activeEntry?.label || null)
  const printStats = reactive<PrintStats>(initialPrintStats())
  const metadataByFilename = new Map<string, MoonrakerGcodeMetadata>()
  const currentMetadata = ref<MoonrakerGcodeMetadata | null>(null)
  const virtualSdcard = reactive<VirtualSdcard>(initialVirtualSdcard())
  const motion = reactive<MotionState>(initialMotion())
  const extruder = reactive<ExtruderState>(initialExtruder())
  const retraction = reactive<RetractionState>(initialRetraction())
  const leveling = reactive<LevelingState>(initialLeveling())
  /** See `configfile` in the subscription list above. */
  const saveConfigPending = ref(false)
  /**
   * The staged changes themselves, `{section: {option: value}}`, so the save
   * gate can list what a write would do instead of only that it would do
   * something. Read through `features/config/pendingConfig.ts`, which pairs it
   * with the loaded values from `printerConfig.settings`.
   */
  const saveConfigPendingItems = ref<Record<string, Record<string, string | undefined>>>({})
  const buildVolume = reactive<BuildVolumeState>(initialBuildVolume())
  /**
   * `display_status.progress`, which the slicer drives with `M73`. Null until the
   * printer reports it at all, so a card can tell "no M73 in this file" apart
   * from "M73 says zero".
   */
  const displayProgress = ref<number | null>(null)
  const displayMessage = ref('')
  const files = ref<MoonrakerFileInfo[]>([])
  const activities = ref<PrinterActivity[]>([])
  const commands = createCommandRunner<PrinterCommandKey>(printerCommandKeys)
  const { pendingCommands, lastCommandError, lastCommandErrorMessage } = commands
  const disposers: Array<() => void> = []
  let stopAvailabilityWatch: WatchStopHandle | null = null
  let stopPrinterChangeReset: (() => void) | null = null
  let started = false
  let activityId = 0
  let previousPrintState: PrintState | null = null

  const printerName = computed(() => customPrinterName.value || detectedPrinterName.value)

  /*
   * Progress measured against the printable G-code, not against the file.
   *
   * `virtual_sdcard.progress` is file_position / file_size, and a sliced file
   * does not start with G-code: the base64 thumbnails and the slicer's comment
   * and configuration blocks sit at its head and tail, and Klipper streams past
   * those in milliseconds. On a small file that is a third of its bytes, so the
   * raw ratio reported nearly 30% before the first move — and every reading
   * derived from progress, the remaining time and the drift against the slicer
   * estimate, inherited the same inflation.
   *
   * The metadata's byte range brackets the real G-code, so the same file
   * position answers honestly. Without metadata there is nothing better to use
   * than the raw ratio.
   */
  const progress = computed(() => {
    const start = currentMetadata.value?.gcode_start_byte
    const end = currentMetadata.value?.gcode_end_byte
    const position = virtualSdcard.filePosition

    if (start !== undefined && end !== undefined && end > start) {
      if (position <= start) return 0
      if (position >= end) return 1
      return clamp((position - start) / (end - start), 0, 1)
    }
    return clamp(virtualSdcard.progress || displayProgress.value || 0, 0, 1)
  })

  /**
   * The slicer's own progress, available only when the file carries `M73`. It is
   * time-based rather than byte-based, so it is the better reading where it
   * exists — but it exists only if the slicer was configured to emit it.
   */
  const slicerProgress = computed(() =>
    displayProgress.value === null ? null : clamp(displayProgress.value, 0, 1),
  )
  const isPrinting = computed(() => printStats.state === 'printing')
  const isPaused = computed(() => printStats.state === 'paused')
  const hasActivePrint = computed(() => isPrinting.value || isPaused.value)
  const toolheadPosition = computed<[number | null, number | null, number | null]>(
    () =>
      motion.livePosition.map((position, index) =>
        position === null
          ? (motion.position[index] ?? null)
          : position - (motion.homingOrigin[index] ?? 0),
      ) as [number | null, number | null, number | null],
  )

  /**
   * The Z the slicer actually commanded. `gcode_position` is the only correct
   * frame for anything compared against slicer metadata: `motion_report`'s live
   * position is sampled after the transform chain, so it carries the bed mesh
   * correction — up to a third of a millimetre, faded by `fade_end`, and
   * therefore an error that changes as the print rises — on top of the G-code
   * offset. Layer heights and object height come from the file, so they have to
   * be measured against the file's own coordinate system.
   */
  const gcodeHeight = computed(() => motion.position[2])

  /**
   * Height progress, which needs no assumption about layer uniformity and so
   * stays correct for adaptive-layer files.
   */
  const heightProgress = computed<{ current: number; total: number; fraction: number } | null>(
    () => {
      const height = gcodeHeight.value
      const objectHeight = currentMetadata.value?.object_height
      if (height === null || !objectHeight || objectHeight <= 0 || !hasActivePrint.value) {
        return null
      }
      return {
        current: height,
        total: objectHeight,
        fraction: clamp(height / objectHeight, 0, 1),
      }
    },
  )

  /*
   * Only the counters the slicer itself reported. Nothing here is arithmetic on
   * `layer_height`, because that is a nominal setting: an adaptive-layer file
   * reports 0.2 while printing anywhere from 0.08 to 0.25, and a Z-derived layer
   * would be both wrong on such a file and unstable on any file, since the
   * slicer's own Z-hop lifts the nozzle a layer or two on every travel move.
   * When the slicer says nothing, `heightProgress` answers the same question
   * exactly instead of guessing at this one.
   */
  const layer = computed<{ current: number | null; total: number | null }>(() => ({
    current: printStats.currentLayer,
    total: printStats.totalLayer ?? currentMetadata.value?.layer_count ?? null,
  }))

  /** Fraction of filament consumed, the progress basis a filament-based estimate implies. */
  const filamentProgress = computed(() => {
    const total = currentMetadata.value?.filament_total
    return total && total > 0 ? clamp(printStats.filamentUsed / total, 0, 1) : 0
  })

  /**
   * Remaining seconds from each source that can answer, so the reading is not
   * hostage to one method: the slicer's own estimate, extrapolation from file
   * position, and extrapolation from filament consumed. Extrapolation is
   * meaningless before the print has produced a signal, hence the elapsed floor.
   */
  const timeEstimates = computed<{
    slicer: number | null
    file: number | null
    filament: number | null
  }>(() => {
    const elapsed = printStats.printDuration

    const sliced = currentMetadata.value?.estimated_time

    return {
      slicer: sliced && sliced > 0 ? Math.max(0, sliced - elapsed) : null,
      file: progress.value > 0 ? Math.max(0, elapsed / progress.value - elapsed) : null,
      filament:
        filamentProgress.value > 0 && elapsed >= minimumExtrapolationSeconds
          ? Math.max(0, elapsed / filamentProgress.value - elapsed)
          : null,
    }
  })

  const remainingSeconds = computed(() => {
    if (!hasActivePrint.value) return null
    const estimates = timeEstimates.value
    return estimates.slicer ?? estimates.file ?? estimates.filament
  })

  /** Wall-clock finish, which is the form the question is usually asked in. */
  const finishTimestamp = computed(() => {
    const remaining = remainingSeconds.value
    if (remaining === null || !isPrinting.value) return null
    return Date.now() + remaining * 1000
  })

  /**
   * How far the print's actual pace has drifted from what the slicer promised,
   * as a signed ratio, measured against whichever progress fraction the caller
   * is displaying — the card's percentage, bar and drift figure need to agree
   * with each other, not each pick its own idea of "done". Suppressed early in
   * a print, where a tiny progress value makes the projection swing wildly.
   */
  function driftFor(fraction: number | null): number | null {
    const sliced = currentMetadata.value?.estimated_time
    const elapsed = printStats.printDuration
    if (!sliced || sliced <= 0 || fraction === null || fraction <= 0) return null
    if (elapsed < minimumExtrapolationSeconds) return null
    return elapsed / fraction / sliced - 1
  }

  const estimateDrift = computed(() => driftFor(progress.value))

  /**
   * Shared by the active print's thumbnail and any other card that needs a
   * preview for a filename/metadata pair it already has in hand — the queue's
   * "Up next" job, for one — so the `relative_path` resolution and largest-size
   * pick live in one place rather than being copied per caller.
   */
  function thumbnailUrlFor(
    filename: string | null | undefined,
    metadata: MoonrakerGcodeMetadata | null | undefined,
  ): string | null {
    const thumbnails = metadata?.thumbnails
    if (!thumbnails?.length || !filename || !moonraker.endpoint) return null
    const largest = thumbnails.reduce((best, candidate) =>
      candidate.width > best.width ? candidate : best,
    )
    try {
      return moonrakerThumbnailUrl(filename, largest.relative_path, moonraker.endpoint)
    } catch {
      return null
    }
  }

  const thumbnailUrl = computed(() => thumbnailUrlFor(printStats.filename, currentMetadata.value))

  /**
   * Speed and flow factors are Klipper session state, not job state: nothing
   * about ending a print clears them, so a value left away from 100% silently
   * carries into whatever prints next. The card that offers this as an opt-in
   * per state is the Print module, but the module unmounts while its card is
   * collapsed — so the reaction lives here, reading the card's own config
   * directly, rather than in a watcher that would stop firing exactly when the
   * card is out of sight.
   */
  const resetConfigKeyByEndState: Record<PrintEndState, string> = {
    complete: 'resetOnComplete',
    cancelled: 'resetOnCancelled',
    error: 'resetOnError',
  }

  function maybeResetJobAdjustments(endState: PrintEndState): void {
    const config =
      useDashboardLayoutStore().profile.instances.find((instance) => instance.moduleId === 'print')
        ?.config ?? {}
    if (!configBoolean(config, resetConfigKeyByEndState[endState], false)) return
    if (motion.speedFactor !== 1) void setSpeedFactor(100)
    if (motion.extrusionFactor !== 1) void setExtrusionFactor(100)
  }

  /**
   * Machine's own reset-on-finish, the same shape as the one above and for the
   * same reason: `SET_VELOCITY_LIMIT` is Klipper session state, so a limit
   * raised to fix one job carries silently into the next one unless something
   * puts it back. The module reads and writes to Machine's own instance
   * config, not Print's, and lives here rather than in a `watch()` for the
   * same reason the one above does — the card is unmounted whenever its
   * collapsed, and the reaction has to survive that.
   */
  const machineResetConfigKeyByEndState: Record<PrintEndState, string> = {
    complete: 'resetOnComplete',
    cancelled: 'resetOnCancelled',
    error: 'resetOnError',
  }

  function maybeResetMachineLimits(endState: PrintEndState): void {
    const config =
      useDashboardLayoutStore().profile.instances.find(
        (instance) => instance.moduleId === 'machine',
      )?.config ?? {}
    if (!configBoolean(config, machineResetConfigKeyByEndState[endState], false)) return

    const configured = usePrinterConfigStore().motionLimits
    const limits: Parameters<typeof setVelocityLimits>[0] = {}
    if (configured.maxVelocity !== null && motion.maxVelocity !== configured.maxVelocity) {
      limits.velocity = configured.maxVelocity
    }
    if (configured.maxAccel !== null && motion.maxAccel !== configured.maxAccel) {
      limits.accel = configured.maxAccel
    }
    if (
      configured.squareCornerVelocity !== null &&
      motion.squareCornerVelocity !== configured.squareCornerVelocity
    ) {
      limits.squareCornerVelocity = configured.squareCornerVelocity
    }
    if (
      configured.minimumCruiseRatio !== null &&
      motion.minimumCruiseRatio !== configured.minimumCruiseRatio
    ) {
      limits.minimumCruiseRatio = configured.minimumCruiseRatio
    }
    if (Object.keys(limits).length > 0) void setVelocityLimits(limits)
  }

  /**
   * Exposed on the store because the console prompt reports a sent command
   * here: the activity feed is printer-domain state, and giving the console a
   * feed of its own would split "what happened recently" across two lists.
   */
  function addActivity(kind: PrinterActivity['kind'], titleKey: string, detail?: string): void {
    activities.value = [
      { id: ++activityId, kind, titleKey, ...(detail ? { detail } : {}), createdAt: Date.now() },
      ...activities.value,
    ].slice(0, maximumActivities)
  }

  function mergePrintStats(update: unknown): void {
    if (!isRecord(update)) return
    const nextState = isPrintState(update.state) ? update.state : printStats.state
    const previousFilename = printStats.filename
    if (typeof update.filename === 'string') printStats.filename = update.filename
    if (typeof update.message === 'string') printStats.message = update.message
    printStats.printDuration = finiteNumber(update.print_duration) ?? printStats.printDuration
    printStats.totalDuration = finiteNumber(update.total_duration) ?? printStats.totalDuration
    printStats.filamentUsed = finiteNumber(update.filament_used) ?? printStats.filamentUsed
    printStats.state = nextState

    if (isRecord(update.info)) {
      // A slicer that reports the counters once then stops sending them must not
      // have the last value overwritten, but an explicit null means "unknown".
      if ('current_layer' in update.info) {
        printStats.currentLayer = finiteNumber(update.info.current_layer) ?? null
      }
      if ('total_layer' in update.info) {
        printStats.totalLayer = finiteNumber(update.info.total_layer) ?? null
      }
    }

    if (printStats.filename !== previousFilename) {
      currentMetadata.value = null
      if (printStats.filename) void loadMetadata(printStats.filename)
    }

    if (previousPrintState !== null && previousPrintState !== nextState) {
      addActivity('print', `dashboard.activity.printState.${nextState}`, printStats.filename)
      if (isPrintEndState(nextState)) {
        maybeResetJobAdjustments(nextState)
        maybeResetMachineLimits(nextState)
      }
    }
    previousPrintState = nextState
  }

  function mergeVirtualSdcard(update: unknown): void {
    if (!isRecord(update)) return
    virtualSdcard.progress = finiteNumber(update.progress) ?? virtualSdcard.progress
    virtualSdcard.filePosition = finiteNumber(update.file_position) ?? virtualSdcard.filePosition
    if (typeof update.is_active === 'boolean') virtualSdcard.isActive = update.is_active
  }

  function mergeDisplayStatus(update: unknown): void {
    if (!isRecord(update)) return
    displayProgress.value = finiteNumber(update.progress) ?? displayProgress.value
    if (typeof update.message === 'string') displayMessage.value = update.message
  }

  function mergeMotion(status: Record<string, unknown>, eventtime?: number): void {
    const gcodeMove = status.gcode_move
    if (isRecord(gcodeMove)) {
      const position = finitePosition(gcodeMove.gcode_position)
      if (position) motion.position = position
      const homingOrigin = finitePosition(gcodeMove.homing_origin)
      if (homingOrigin) motion.homingOrigin = homingOrigin
      motion.speedFactor = finiteNumber(gcodeMove.speed_factor) ?? motion.speedFactor
      motion.extrusionFactor = finiteNumber(gcodeMove.extrude_factor) ?? motion.extrusionFactor
      if (typeof gcodeMove.absolute_coordinates === 'boolean') {
        motion.absoluteCoordinates = gcodeMove.absolute_coordinates
      }
      if (typeof gcodeMove.absolute_extrude === 'boolean') {
        motion.absoluteExtrude = gcodeMove.absolute_extrude
      }
    }

    const retractionStatus = status.firmware_retraction
    if (isRecord(retractionStatus)) {
      /*
       * Merged rather than replaced: Moonraker sends only what changed, so a
       * notification carrying one altered setting would otherwise erase the
       * other four. `hasSettings` latches on the first reading that contains an
       * actual setting, which is what tells the card the difference between a
       * printer without `[firmware_retraction]` and one whose values have not
       * arrived yet.
       */
      for (const [key, value] of Object.entries(retractionStatus)) {
        const numeric = finiteNumber(value)
        if (numeric === undefined) continue
        retraction.settings[key] = numeric
        retraction.hasSettings = true
      }
      if (typeof retractionStatus.retract_state === 'boolean') {
        retraction.isRetracted = retractionStatus.retract_state
      }
    }

    const extruderStatus = status.extruder
    if (isRecord(extruderStatus)) {
      const pressureAdvance = finiteNumber(extruderStatus.pressure_advance)
      if (pressureAdvance !== undefined) extruder.pressureAdvance = pressureAdvance
      const smoothTime = finiteNumber(extruderStatus.smooth_time)
      if (smoothTime !== undefined) extruder.smoothTime = smoothTime
      if (typeof extruderStatus.can_extrude === 'boolean') {
        extruder.canExtrude = extruderStatus.can_extrude
      }
    }

    const configfile = status.configfile
    if (isRecord(configfile)) {
      if (typeof configfile.save_config_pending === 'boolean') {
        saveConfigPending.value = configfile.save_config_pending
      }
      // Replaced wholesale rather than merged: this is the complete set of what
      // is staged, so a section that stopped being pending has to disappear
      // from it. Merging would leave a saved change listed forever.
      const pendingItems = configfile.save_config_pending_items
      if (isRecord(pendingItems)) {
        saveConfigPendingItems.value = pendingItems as Record<
          string,
          Record<string, string | undefined>
        >
      } else if (pendingItems === null) {
        saveConfigPendingItems.value = {}
      }
    }

    const motionReport = status.motion_report
    if (isRecord(motionReport)) {
      motion.liveVelocity = finiteNumber(motionReport.live_velocity) ?? motion.liveVelocity
      motion.liveExtruderVelocity =
        finiteNumber(motionReport.live_extruder_velocity) ?? motion.liveExtruderVelocity
      const livePosition = finitePosition(motionReport.live_position)
      if (livePosition && !isEmptyMotionQueueReading(livePosition, motion.liveVelocity)) {
        motion.livePosition = livePosition
        if (eventtime !== undefined && Number.isFinite(eventtime)) {
          motion.livePositionEventtime = eventtime
        }
      }
    }

    const toolhead = status.toolhead
    if (!isRecord(toolhead)) return
    if (!status.gcode_move) {
      const position = finitePosition(toolhead.position)
      if (position) motion.position = position
    }
    if (typeof toolhead.homed_axes === 'string') motion.homedAxes = toolhead.homed_axes
    motion.maxVelocity = finiteNumber(toolhead.max_velocity) ?? motion.maxVelocity
    motion.maxAccel = finiteNumber(toolhead.max_accel) ?? motion.maxAccel
    motion.squareCornerVelocity =
      finiteNumber(toolhead.square_corner_velocity) ?? motion.squareCornerVelocity
    motion.minimumCruiseRatio =
      finiteNumber(toolhead.minimum_cruise_ratio) ?? motion.minimumCruiseRatio
    const axisMinimum = finitePosition(toolhead.axis_minimum)
    if (axisMinimum && !positionsEqual(buildVolume.minimum, axisMinimum)) {
      buildVolume.minimum = axisMinimum
    }
    const axisMaximum = finitePosition(toolhead.axis_maximum)
    if (axisMaximum && !positionsEqual(buildVolume.maximum, axisMaximum)) {
      buildVolume.maximum = axisMaximum
    }
  }

  /**
   * Klipper reports `applied` on whichever of the two alignment objects the
   * config declares, and Moonraker sends only what changed — so an update that
   * carries neither must leave both readings alone rather than resetting them
   * to "never reported". The reset back to `null` belongs to a printer switch
   * and to Klipper going away, both of which go through `printerChanged` and the
   * availability watcher instead.
   */
  function mergeLeveling(status: Record<string, unknown>): void {
    const quadGantry = status.quad_gantry_level
    if (isRecord(quadGantry) && typeof quadGantry.applied === 'boolean') {
      leveling.quadGantryApplied = quadGantry.applied
    }
    const zTilt = status.z_tilt
    if (isRecord(zTilt) && typeof zTilt.applied === 'boolean') {
      leveling.zTiltApplied = zTilt.applied
    }
  }

  function mergeStatus(status: Record<string, unknown>, eventtime?: number): void {
    mergePrintStats(status.print_stats)
    mergeVirtualSdcard(status.virtual_sdcard)
    mergeDisplayStatus(status.display_status)
    mergeLeveling(status)
    mergeMotion(status, eventtime)
  }

  function handleSnapshot(snapshot: PrinterObjectSnapshot): void {
    mergeStatus(snapshot.status, snapshot.eventtime)
  }

  function handleStatusUpdate(notification: JsonRpcNotification): void {
    const status = notification.params[0]
    const eventtime = notification.params[1]
    if (isRecord(status)) {
      mergeStatus(status, typeof eventtime === 'number' ? eventtime : undefined)
    }
  }

  async function refreshPrinterInfo(): Promise<void> {
    try {
      const info = await moonraker.rpcCall('printer.info')
      detectedPrinterName.value = info.hostname || detectedPrinterName.value
    } catch {
      // The availability watcher retries after the next successful synchronization.
    }
  }

  /**
   * Renames the printer in front. Without one selected there is nothing to name,
   * which is the case only before the first connection registers an entry.
   */
  function setPrinterName(name: string): boolean {
    const id = printers.activeId
    if (id === '') return false
    return printers.setLabel(id, name)
  }

  const runCommand = commands.run

  async function emergencyStop(): Promise<boolean> {
    return runCommand('emergencyStop', () => moonraker.rpcCall('printer.emergency_stop'))
  }

  async function restartKlipper(): Promise<boolean> {
    return runCommand('restartKlipper', () => moonraker.rpcCall('printer.restart'))
  }

  async function firmwareRestart(): Promise<boolean> {
    return runCommand('firmwareRestart', () => moonraker.rpcCall('printer.firmware_restart'))
  }

  async function restartMoonraker(): Promise<boolean> {
    return runCommand('restartMoonraker', () =>
      moonraker.rpcCall('machine.services.restart', { service: 'moonraker' }),
    )
  }

  async function rebootHost(): Promise<boolean> {
    return runCommand('rebootHost', () => moonraker.rpcCall('machine.reboot'))
  }

  async function shutdownHost(): Promise<boolean> {
    return runCommand('shutdownHost', () => moonraker.rpcCall('machine.shutdown'))
  }

  async function pausePrint(): Promise<boolean> {
    return runCommand('pause', () => moonraker.rpcCall('printer.print.pause'))
  }

  async function resumePrint(): Promise<boolean> {
    return runCommand('resume', () => moonraker.rpcCall('printer.print.resume'))
  }

  async function cancelPrint(): Promise<boolean> {
    return runCommand('cancel', () => moonraker.rpcCall('printer.print.cancel'))
  }

  async function startPrint(filename: string): Promise<boolean> {
    const knownFile = files.value.find((file) => file.path === filename)
    if (!knownFile) return false
    return runCommand('startPrint', async () => {
      await moonraker.rpcCall('printer.print.start', { filename: knownFile.path })
      addActivity('command', 'dashboard.activity.printStarted', knownFile.path)
    })
  }

  /**
   * Reads a file's slicer metadata, cached per filename for the session. It is
   * deliberately not a tracked command: a missing or unparsed metadata entry is
   * normal for a hand-written file and must not surface as a failed action.
   */
  async function loadMetadata(filename: string): Promise<MoonrakerGcodeMetadata | null> {
    const cached = metadataByFilename.get(filename)
    if (cached) {
      if (printStats.filename === filename) currentMetadata.value = cached
      return cached
    }
    try {
      const metadata = await moonraker.rpcCall('server.files.metadata', { filename })
      metadataByFilename.set(filename, metadata)
      if (printStats.filename === filename) currentMetadata.value = metadata
      return metadata
    } catch {
      return null
    }
  }

  /**
   * Drops one file's cached metadata, for the one case the cache cannot see
   * itself: `server.analysis.process` rewrites the file's own time estimate
   * and M73 commands on disk without touching its name or its listing, so the
   * cache would otherwise keep answering with the pre-processed numbers for
   * the rest of the session.
   */
  function invalidateMetadata(filename: string): void {
    metadataByFilename.delete(filename)
  }

  /**
   * A re-sliced file keeps its name, so the cache above would otherwise answer
   * with the previous version's slicer data for the rest of the session.
   * Moonraker has no dedicated metadata notification — `notify_filelist_changed`
   * reporting a `create_file` or `modify_file` action against a cached path is
   * the only signal a rewrite happened.
   */
  function handleFilelistChanged(notification: JsonRpcNotification): void {
    const change = notification.params[0]
    if (!isRecord(change)) return
    if (change.action !== 'create_file' && change.action !== 'modify_file') return
    const item = change.item
    if (!isRecord(item) || item.root !== 'gcodes' || typeof item.path !== 'string') return
    invalidateMetadata(item.path)
    if (printStats.filename === item.path) void loadMetadata(item.path)
  }

  /**
   * Unloads the finished job, which is what clears `print_stats` — the filename,
   * the durations, and the filament total — and returns the printer to standby.
   * Klipper refuses it while a print is running, so it is only offered once one
   * has ended.
   */
  function clearPrintStats(): Promise<boolean> {
    return sendGcode('SDCARD_RESET_FILE', 'clearPrint')
  }

  async function refreshFiles(): Promise<boolean> {
    return runCommand('files', async () => {
      const result = await moonraker.rpcCall('server.files.list', { root: 'gcodes' })
      files.value = result
        .filter((file) => isPrintableGcodeFilename(file.path))
        .sort((left, right) => right.modified - left.modified)
    })
  }

  /**
   * Uploads a file to the gcodes root and refreshes the list, so it is
   * immediately a candidate for `startPrint`. Filename safety is
   * `uploadMoonrakerFile`'s own concern; this does not duplicate that check.
   */
  async function uploadPrintFile(file: File): Promise<string | null> {
    let uploadedPath: string | null = null
    const succeeded = await runCommand('uploadFile', async () => {
      const result = await uploadMoonrakerFile('gcodes', '', file, file.name, moonraker.endpoint)
      uploadedPath = result.item.path
    })
    if (succeeded) await refreshFiles()
    return uploadedPath
  }

  /**
   * `G28`, in any letter case and with or without axis letters, can legitimately
   * run past the transport's default deadline — a slow probe or multiple homing
   * samples can take longer than the sixty-second default, and Klipper answers
   * `printer.gcode.script` only once the move finishes. Checked against every
   * line of the script, not just the first, so a homing command combined with
   * other G-code on one console send still gets the exemption.
   */
  function isHomingScript(script: string): boolean {
    return script.split('\n').some((line) => /^g28(\s|$)/i.test(line.trim()))
  }

  /**
   * The single place every G-code script leaves through, so it is also the
   * single place the console learns about one. The echo lands before dispatch
   * — Klipper answers while the request is still in flight, so echoing after
   * would print a command below its own output — and covers every caller, not
   * only `sendConsoleCommand`: Moonraker's own `gcode_store` already records
   * an API-submitted script the instant it arrives, so a card button that goes
   * silent until the next reload while the console prompt echoes instantly is
   * the two views disagreeing about what already happened.
   *
   * `move` is the one exception. A jog wraps the requested motion in a
   * `SAVE_GCODE_STATE`/`RESTORE_GCODE_STATE` pair nobody typed and fires on
   * every arrow click, so echoing it would read as the console flooding with
   * housekeeping rather than commands.
   *
   * Exposed on the store because the console prompt dispatches through it too
   * — its `sendConsoleCommand` lives in the console store, and giving the
   * prompt a second exit point would be the two views disagreeing all over
   * again. `isHomingScript` is checked here rather than only in `homeAxes`, so
   * `G28` typed straight into the console gets the same exemption as the
   * Movement card's own button — the deadline firing mid-home reports a false
   * failure no matter which control sent it.
   */
  async function sendGcode(
    script: string,
    key: PrinterCommandKey,
    options?: { timeoutMs: null },
  ): Promise<boolean> {
    const command = script.trim()
    if (!command) return false
    if (key !== 'move') gcodeConsole.echoCommand(command)
    const timeoutOptions = options ?? (isHomingScript(command) ? { timeoutMs: null } : undefined)
    return runCommand(key, () =>
      timeoutOptions === undefined
        ? moonraker.rpcCall('printer.gcode.script', { script: command })
        : moonraker.rpcCall('printer.gcode.script', { script: command }, timeoutOptions),
    )
  }

  /**
   * The macro path stands beside `sendGcode` rather than going through it, for
   * two reasons that are both about a macro being arbitrary user G-code. Its
   * duration belongs to the printer — a heat soak outlives any local deadline,
   * and a deadline firing mid-run reports a false failure and re-arms the
   * button against a macro that is still executing — so the request opts out
   * exactly the way calibration, leveling, and `BED_MESH_CALIBRATE` already
   * do. And more than one macro can legitimately be pending at once, which
   * `runCommand`'s one-pending-per-key gate cannot express; the macros store
   * tracks per-macro pending itself. The echo still lands before dispatch,
   * like every script, so the live console never disagrees with Moonraker's
   * own `gcode_store` about what was sent.
   */
  async function sendMacro(script: string): Promise<void> {
    const command = script.trim()
    if (!command) return
    gcodeConsole.echoCommand(command)
    await moonraker.rpcCall('printer.gcode.script', { script: command }, { timeoutMs: null })
  }

  /** `sendGcode` itself detects `G28` and skips the transport's local deadline — see `isHomingScript`. */
  function homeAxes(axes?: string): Promise<boolean> {
    const requested = (axes ?? '').toUpperCase().replace(/[^XYZ]/g, '')
    return sendGcode(requested === '' ? 'G28' : `G28 ${requested.split('').join(' ')}`, 'home')
  }

  function moveAxis(axis: 'X' | 'Y' | 'Z', distance: number): Promise<boolean> {
    if (!Number.isFinite(distance) || distance === 0 || Math.abs(distance) > 100) {
      return Promise.resolve(false)
    }
    const feedrate = axis === 'Z' ? 600 : 6000
    return sendGcode(
      `SAVE_GCODE_STATE NAME=_alabaster_movement\nG91\nG1 ${axis}${distance} F${feedrate}\nRESTORE_GCODE_STATE NAME=_alabaster_movement`,
      'move',
    )
  }

  function setHeaterTarget(heater: string, target: number): Promise<boolean> {
    if (!Number.isFinite(target) || target < 0 || target > 999) return Promise.resolve(false)
    const heaterName = heater.startsWith('heater_generic ') ? heater.slice(15) : heater
    return sendGcode(
      `SET_HEATER_TEMPERATURE HEATER=${heaterName} TARGET=${Math.round(target)}`,
      'temperature',
    )
  }

  /** Temperature fans use their own command, so the sensor kind decides the script. */
  function setTemperatureFanTarget(objectName: string, target: number): Promise<boolean> {
    if (!Number.isFinite(target) || target < 0 || target > 999) return Promise.resolve(false)
    const fanName = objectName.startsWith('temperature_fan ') ? objectName.slice(16) : objectName
    return sendGcode(
      `SET_TEMPERATURE_FAN_TARGET TEMPERATURE_FAN=${fanName} TARGET=${Math.round(target)}`,
      'temperature',
    )
  }

  function turnOffHeaters(): Promise<boolean> {
    return sendGcode('TURN_OFF_HEATERS', 'temperature')
  }

  /**
   * PID_CALIBRATE and MPC_CALIBRATE run for minutes while the heater settles,
   * and Klipper only answers `printer.gcode.script` once the macro finishes —
   * so this opts out of the transport's local deadline the same way the
   * update manager's long-running calls do, rather than failing a calibration
   * that is still legitimately running on the printer.
   */
  function calibrateHeater(kind: 'pid' | 'mpc', heater: string, target: number): Promise<boolean> {
    if (!Number.isFinite(target) || target <= 0 || target > 999) return Promise.resolve(false)
    const heaterName = heater.startsWith('heater_generic ') ? heater.slice(15) : heater
    const command = kind === 'mpc' ? 'MPC_CALIBRATE' : 'PID_CALIBRATE'
    return sendGcode(
      `${command} HEATER=${heaterName} TARGET=${Math.round(target)}`,
      'calibrateHeater',
      { timeoutMs: null },
    )
  }

  /**
   * Persists calibration results (and any other pending config change) and
   * restarts Klipper. Klipper answers the gcode script once queued and
   * restarts afterward, the same sequencing `firmware_restart` already relies
   * on, so this needs no special timeout handling.
   */
  function saveConfig(): Promise<boolean> {
    return sendGcode('SAVE_CONFIG', 'saveConfig')
  }

  function adjustZOffset(delta: number): Promise<boolean> {
    if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 1) return Promise.resolve(false)
    return sendGcode(`SET_GCODE_OFFSET Z_ADJUST=${delta} MOVE=1`, 'zOffset')
  }

  function resetZOffset(): Promise<boolean> {
    return sendGcode('SET_GCODE_OFFSET Z=0 MOVE=1', 'zOffset')
  }

  /**
   * Folds the live babystepped offset into whatever defines this machine's Z
   * zero, which is what makes a dialed-in offset outlast the session. Klipper
   * only stages the change; `saveConfig` still has to write it.
   *
   * The target is the caller's to decide, and it is not a preference — the two
   * commands are registered by different Klipper objects, so exactly one of
   * them exists on any given printer. `Z_OFFSET_APPLY_PROBE` comes from the
   * probe object; `Z_OFFSET_APPLY_ENDSTOP` comes from `manual_probe` and only
   * where `[stepper_z]` has a `position_endstop` or the kinematics are delta.
   * Sending the wrong one is an "Unknown command" error, not a refusal, which
   * is why `printerConfig` answers the question rather than this store guessing
   * — see `hasProbe` and `hasZEndstopOffset` there.
   */
  function applyZOffset(target: 'probe' | 'endstop'): Promise<boolean> {
    return sendGcode(
      target === 'probe' ? 'Z_OFFSET_APPLY_PROBE' : 'Z_OFFSET_APPLY_ENDSTOP',
      'zOffset',
    )
  }

  /**
   * One step of a manual probe, which is Klipper's `TESTZ` in both of the forms
   * it takes. A number is a relative move in millimetres; `'+'`, `'-'`, `'++'`
   * and `'--'` are the bisection words, which move relative to the heights the
   * probe has already visited rather than by a fixed distance — see
   * `stores/manualProbe.ts` for what the machine reports back.
   *
   * Klipper's own cap on a bisection into unexplored space is 0.2mm, so those
   * four words cannot be made to crash the nozzle however many times they are
   * pressed. An explicit distance has no such cap, which is why this clamps
   * one: the ladder in the dialog offers at most a millimetre, and a caller
   * asking for more than that is asking for a jog, not a probe step.
   */
  function testZ(step: ManualProbeStep): Promise<boolean> {
    if (typeof step === 'number') {
      if (!Number.isFinite(step) || step === 0 || Math.abs(step) > 1) return Promise.resolve(false)
      // Three decimals is the finest step the ladder offers and finer than the
      // paper it is measured against; a longer number would only be noise in
      // the console transcript this echoes into.
      return sendGcode(`TESTZ Z=${step > 0 ? '+' : '-'}${Math.abs(step).toFixed(3)}`, 'manualProbe')
    }
    return sendGcode(`TESTZ Z=${step}`, 'manualProbe')
  }

  /**
   * Ends the probe at the height it is standing at, which is what the whole
   * dialog exists to do — Klipper hands the position to whatever started the
   * helper, so this is where a `[probe] z_offset` or a Z endstop position comes
   * from. Both this and `abortManualProbe` opt out of the transport deadline:
   * the completion callback resumes whatever started the probe, which can be an
   * arbitrary user macro with a heat soak or a bed mesh still to run, and a
   * deadline firing mid-run would report a false failure for work that is
   * still going.
   */
  function acceptManualProbe(): Promise<boolean> {
    return sendGcode('ACCEPT', 'manualProbeFinish', { timeoutMs: null })
  }

  /** Ends the probe without recording anything. Klipper's `ABORT`. */
  function abortManualProbe(): Promise<boolean> {
    return sendGcode('ABORT', 'manualProbeFinish', { timeoutMs: null })
  }

  /**
   * One answer to a bed-screw prompt, which is `BED_SCREWS_ADJUST`'s own three
   * words. `'accept'` takes the screw as it stands, `'adjusted'` says it was
   * turned enough that the whole round has to be verified again — Klipper
   * restarts the pass rather than moving on — and `'abort'` leaves the helper.
   *
   * `ACCEPT` and `ABORT` are the same words a manual probe uses, and that is
   * safe rather than ambiguous: Klipper registers them per helper and only one
   * helper can be waiting at a time, so whichever is running is the one that
   * answers. All three opt out of the transport deadline for the reason the
   * probe's own two do — Klipper answers once it has moved the toolhead up,
   * over and down to the next screw, and on the last screw once the whole
   * procedure has finished lifting away.
   */
  function answerBedScrew(answer: 'accept' | 'adjusted' | 'abort'): Promise<boolean> {
    const command = answer === 'accept' ? 'ACCEPT' : answer === 'adjusted' ? 'ADJUSTED' : 'ABORT'
    return sendGcode(command, 'bedScrews', { timeoutMs: null })
  }

  function disableMotors(): Promise<boolean> {
    return sendGcode('M84', 'motorsOff')
  }

  /**
   * An absolute move, for parking and go-to-coordinate. Each axis is optional
   * so parking can leave Z where it is, and every coordinate is clamped to the
   * reported build volume rather than trusting the caller.
   */
  function moveTo(target: { x?: number; y?: number; z?: number }): Promise<boolean> {
    const axisCodes = ['X', 'Y', 'Z'] as const
    const requested = [target.x, target.y, target.z]
    const words: string[] = []

    for (const [index, value] of requested.entries()) {
      if (value === undefined) continue
      if (!Number.isFinite(value)) return Promise.resolve(false)
      const minimum = buildVolume.minimum[index]
      const maximum = buildVolume.maximum[index]
      const bounded =
        typeof minimum === 'number' && typeof maximum === 'number'
          ? clamp(value, minimum, maximum)
          : value
      words.push(`${axisCodes[index]}${bounded.toFixed(2)}`)
    }
    if (words.length === 0) return Promise.resolve(false)

    const feedrate = target.x === undefined && target.y === undefined ? 600 : 6000
    return sendGcode(
      `SAVE_GCODE_STATE NAME=_alabaster_movement\nG90\nG1 ${words.join(' ')} F${feedrate}\nRESTORE_GCODE_STATE NAME=_alabaster_movement`,
      'move',
    )
  }

  /**
   * Probing every point takes minutes, and Klipper answers the script only
   * once it finishes, so this opts out of the transport's local deadline the
   * same way heater calibration does.
   */
  function runLeveling(method: LevelingMethod): Promise<boolean> {
    return sendGcode(levelingCommands[method], 'leveling', { timeoutMs: null })
  }

  function setGenericFanSpeed(objectName: string, percent: number): Promise<boolean> {
    if (!Number.isFinite(percent)) return Promise.resolve(false)
    const fanName = objectName.startsWith('fan_generic ') ? objectName.slice(12) : objectName
    const speed = (clamp(percent, 0, 100) / 100).toFixed(2)
    return sendGcode(`SET_FAN_SPEED FAN=${fanName} SPEED=${speed}`, 'fan')
  }

  function setOutputPin(name: string, value: number): Promise<boolean> {
    if (!Number.isFinite(value)) return Promise.resolve(false)
    const pinName = name.startsWith('output_pin ') ? name.slice(11) : name
    return sendGcode(`SET_PIN PIN=${pinName} VALUE=${Number(value.toFixed(3))}`, 'pin')
  }

  function setVelocityLimits(limits: {
    velocity?: number
    accel?: number
    squareCornerVelocity?: number
    minimumCruiseRatio?: number
  }): Promise<boolean> {
    const parts = [
      limits.velocity !== undefined ? `VELOCITY=${Math.round(limits.velocity)}` : '',
      limits.accel !== undefined ? `ACCEL=${Math.round(limits.accel)}` : '',
      limits.squareCornerVelocity !== undefined
        ? `SQUARE_CORNER_VELOCITY=${Number(limits.squareCornerVelocity.toFixed(2))}`
        : '',
      limits.minimumCruiseRatio !== undefined
        ? `MINIMUM_CRUISE_RATIO=${Number(limits.minimumCruiseRatio.toFixed(2))}`
        : '',
    ].filter((part) => part !== '')
    if (parts.length === 0) return Promise.resolve(false)
    return sendGcode(`SET_VELOCITY_LIMIT ${parts.join(' ')}`, 'limits')
  }

  /** Relative extrusion is restored afterwards so the caller cannot leave the printer in it. */
  function extrudeFilament(length: number, feedrate: number): Promise<boolean> {
    if (!Number.isFinite(length) || length === 0) return Promise.resolve(false)
    const speed = Math.round(clamp(feedrate, 1, 60) * 60)
    return sendGcode(
      [
        'SAVE_GCODE_STATE NAME=_alabaster_extrude',
        'M83',
        `G1 E${Number(length.toFixed(2))} F${speed}`,
        'RESTORE_GCODE_STATE NAME=_alabaster_extrude',
      ].join('\n'),
      'extrude',
    )
  }

  function setPressureAdvance(advance: number, smoothTime?: number): Promise<boolean> {
    if (!Number.isFinite(advance) || advance < 0 || advance > 2) return Promise.resolve(false)
    const smoothing =
      smoothTime !== undefined && Number.isFinite(smoothTime)
        ? ` SMOOTH_TIME=${Number(clamp(smoothTime, 0, 0.2).toFixed(3))}`
        : ''
    return sendGcode(
      `SET_PRESSURE_ADVANCE ADVANCE=${Number(advance.toFixed(4))}${smoothing}`,
      'pressureAdvance',
    )
  }

  /**
   * Every retraction setting in one `SET_RETRACTION`, because that is how
   * Klipper takes them and a per-field auto-apply would fire the command once
   * per keystroke of an intended single change — the same reasoning
   * `setVelocityLimits` records. The caller passes only the parameters this
   * firmware has; nothing to send is a refusal rather than a bare command,
   * which Klipper would answer by printing the current values as if something
   * had happened.
   */
  function setRetraction(args: readonly string[]): Promise<boolean> {
    if (args.length === 0) return Promise.resolve(false)
    return sendGcode(`SET_RETRACTION ${args.join(' ')}`, 'retraction')
  }

  function loadBedMeshProfile(profile: string): Promise<boolean> {
    const name = profile.trim()
    if (name === '') return Promise.resolve(false)
    return sendGcode(`BED_MESH_PROFILE LOAD="${name}"`, 'bedMesh')
  }

  function clearBedMesh(): Promise<boolean> {
    return sendGcode('BED_MESH_CLEAR', 'bedMesh')
  }

  /**
   * Klipper names the profile at calibration time — `default` when PROFILE is
   * omitted, per its own documented behavior — so an "unnamed" calibration is
   * still saved under that name, not left pending. Committing under anything
   * less than Klipper's real name would leave that profile's temperature
   * unrecorded and the mismatch warning permanently silent for every
   * calibration run from the plain "Calibrate" button.
   *
   * Klipper itself never records what the bed was at when this ran, so the
   * bed's live reading is captured here — into Alabaster's own bookkeeping,
   * never into `printer.cfg` — for the temperature mismatch warning to read
   * later.
   */
  /**
   * Probing every point takes minutes and Klipper answers the script only once it
   * finishes, so this opts out of the transport's local deadline exactly as
   * leveling and heater calibration do. Without it the deadline fires part way
   * through a perfectly healthy calibration and reports a failed command.
   */
  async function calibrateBedMesh(profile?: string): Promise<boolean> {
    const name = profile?.trim() ?? ''
    const succeeded = await sendGcode(
      name === '' ? 'BED_MESH_CALIBRATE' : `BED_MESH_CALIBRATE PROFILE="${name}"`,
      'bedMesh',
      { timeoutMs: null },
    )
    if (succeeded) {
      bedMesh.recordCalibration(telemetry.bed.temperature)
      bedMesh.commitProfileTemperature('', name === '' ? 'default' : name)
    }
    return succeeded
  }

  /**
   * `PROBE_ACCURACY` repeats a single-point probe (ten samples by default) and
   * answers only once every sample is in, so this opts out of the transport's
   * local deadline exactly as `calibrateBedMesh` and leveling already do — a
   * deadline firing mid-run would report a failed command for a probe that was
   * never in trouble. Klipper's own result line is read separately, by
   * `useProbeAccuracyStore`, from the console transcript this dispatch echoes
   * into; the RPC's own resolution only says the machine is done, not what it
   * found.
   */
  async function probeAccuracy(): Promise<boolean> {
    return sendGcode('PROBE_ACCURACY', 'probeAccuracy', { timeoutMs: null })
  }

  /**
   * `MEASURE_AXES_NOISE` only dwells for `MEAS_TIME` (2 seconds by default)
   * and moves nothing — unlike `probeAccuracy` above, its own duration never
   * approaches the transport's default deadline, so this needs no opt-out.
   */
  async function measureAxesNoise(): Promise<boolean> {
    return sendGcode('MEASURE_AXES_NOISE', 'measureAxesNoise')
  }

  async function saveBedMeshProfile(profile: string): Promise<boolean> {
    const name = profile.trim()
    if (name === '') return false
    const previousName = bedMesh.profileName
    const succeeded = await sendGcode(`BED_MESH_PROFILE SAVE="${name}"`, 'bedMesh')
    if (succeeded) bedMesh.commitProfileTemperature(previousName, name)
    return succeeded
  }

  async function removeBedMeshProfile(profile: string): Promise<boolean> {
    const name = profile.trim()
    if (name === '') return false
    const succeeded = await sendGcode(`BED_MESH_PROFILE REMOVE="${name}"`, 'bedMesh')
    if (succeeded) bedMesh.dropProfileTemperature(name)
    return succeeded
  }

  /**
   * Klipper has no rename: the pair saves the loaded mesh under the new name
   * and drops the old entry, which is why only the active profile can be
   * renamed — `SAVE` writes whatever mesh is currently loaded, so renaming an
   * inactive profile would silently copy the active one over it.
   *
   * Both go in one script so Klipper runs them in order and abandons the
   * removal if the save fails, rather than leaving the profile deleted and
   * nothing saved in its place.
   */
  async function renameBedMeshProfile(from: string, to: string): Promise<boolean> {
    const current = from.trim()
    const next = to.trim()
    if (current === '' || next === '' || current === next) return false
    const succeeded = await sendGcode(
      `BED_MESH_PROFILE SAVE="${next}"\nBED_MESH_PROFILE REMOVE="${current}"`,
      'bedMesh',
    )
    if (succeeded) {
      bedMesh.commitProfileTemperature(current, next)
      bedMesh.dropProfileTemperature(current)
    }
    return succeeded
  }

  /**
   * Tells Klipper to stop printing one object mid-job and move on to the
   * next — a plate of six that loses one part does not have to lose the
   * other five. `EXCLUDE_OBJECT` is a no-op once the named object is already
   * excluded or already finished, so this sends the name Klipper reported
   * rather than re-deriving it.
   */
  function excludeObject(name: string): Promise<boolean> {
    const trimmed = name.trim()
    if (trimmed === '') return Promise.resolve(false)
    return sendGcode(`EXCLUDE_OBJECT NAME="${trimmed}"`, 'excludeObject')
  }

  function setFanSpeed(percent: number): Promise<boolean> {
    if (!Number.isFinite(percent)) return Promise.resolve(false)
    const pwm = Math.round((clamp(percent, 0, 100) / 100) * 255)
    return sendGcode(`M106 S${pwm}`, 'fan')
  }

  function setSpeedFactor(percent: number): Promise<boolean> {
    if (!Number.isFinite(percent)) return Promise.resolve(false)
    return sendGcode(`M220 S${Math.round(clamp(percent, 10, 300))}`, 'speed')
  }

  function setExtrusionFactor(percent: number): Promise<boolean> {
    if (!Number.isFinite(percent)) return Promise.resolve(false)
    return sendGcode(`M221 S${Math.round(clamp(percent, 50, 150))}`, 'extrusion')
  }

  const clearCommandError = commands.clearCommandError

  /**
   * Everything here describes one machine, so none of it may outlive the switch
   * to another. Until the new printer's first snapshot arrives there is nothing
   * true to show, and the previous printer's figures are worse than blanks:
   * they are plausible, so they read as this printer's.
   *
   * The chosen name is not here. It belongs to the printer's identity rather
   * than to this connection, so it is swapped by the printers store — not
   * discarded, which would throw away a preference instead of stale data. The
   * console transcript is not here either: it is the console store's domain,
   * and that store registers its own printer-change reset.
   */
  function printerChanged(): void {
    detectedPrinterName.value = null
    Object.assign(printStats, initialPrintStats())
    Object.assign(virtualSdcard, initialVirtualSdcard())
    Object.assign(motion, initialMotion())
    Object.assign(extruder, initialExtruder())
    Object.assign(retraction, initialRetraction())
    Object.assign(leveling, initialLeveling())
    Object.assign(buildVolume, initialBuildVolume())
    metadataByFilename.clear()
    currentMetadata.value = null
    saveConfigPending.value = false
    saveConfigPendingItems.value = {}
    displayProgress.value = null
    displayMessage.value = ''
    files.value = []
    activities.value = []
    // A command sent to the printer we just left can never report back here.
    commands.reset()
  }

  function start(): void {
    if (started) return
    started = true
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    disposers.push(
      moonraker.onObjectSnapshot(handleSnapshot as ObjectSnapshotHandler),
      moonraker.onNotification('notify_status_update', handleStatusUpdate),
      moonraker.onNotification('notify_filelist_changed', handleFilelistChanged),
    )
    void moonraker
      .setObjectSubscription(printerSubscriptionKey, printerSelection)
      .catch(() => undefined)
    stopAvailabilityWatch = watch(
      () => availability.isKlipperReady,
      (isReady) => {
        if (!isReady) return
        addActivity('connection', 'dashboard.activity.printerReady')
        void refreshPrinterInfo()
      },
      { immediate: true },
    )
  }

  function stop(): void {
    if (!started) return
    started = false
    stopAvailabilityWatch?.()
    stopAvailabilityWatch = null
    stopPrinterChangeReset?.()
    stopPrinterChangeReset = null
    while (disposers.length > 0) disposers.pop()?.()
    void moonraker.removeObjectSubscription(printerSubscriptionKey)
  }

  return {
    printerName,
    customPrinterName,
    setPrinterName,
    printStats,
    virtualSdcard,
    motion,
    buildVolume,
    saveConfigPending,
    saveConfigPendingItems,
    toolheadPosition,
    displayMessage,
    displayProgress,
    files,
    activities,
    addActivity,
    pendingCommands,
    lastCommandError,
    lastCommandErrorMessage,
    progress,
    slicerProgress,
    filamentProgress,
    clearPrintStats,
    uploadPrintFile,
    remainingSeconds,
    timeEstimates,
    finishTimestamp,
    estimateDrift,
    driftFor,
    layer,
    heightProgress,
    thumbnailUrl,
    thumbnailUrlFor,
    currentMetadata,
    loadMetadata,
    invalidateMetadata,
    isPrinting,
    isPaused,
    hasActivePrint,
    start,
    stop,
    emergencyStop,
    restartKlipper,
    firmwareRestart,
    restartMoonraker,
    rebootHost,
    shutdownHost,
    pausePrint,
    resumePrint,
    cancelPrint,
    startPrint,
    refreshFiles,
    homeAxes,
    moveAxis,
    setHeaterTarget,
    setTemperatureFanTarget,
    calibrateHeater,
    saveConfig,
    applyZOffset,
    testZ,
    acceptManualProbe,
    abortManualProbe,
    answerBedScrew,
    disableMotors,
    moveTo,
    runLeveling,
    turnOffHeaters,
    adjustZOffset,
    resetZOffset,
    setFanSpeed,
    setGenericFanSpeed,
    setOutputPin,
    setSpeedFactor,
    setExtrusionFactor,
    setVelocityLimits,
    extrudeFilament,
    setPressureAdvance,
    setRetraction,
    loadBedMeshProfile,
    clearBedMesh,
    calibrateBedMesh,
    probeAccuracy,
    measureAxesNoise,
    saveBedMeshProfile,
    removeBedMeshProfile,
    renameBedMeshProfile,
    excludeObject,
    sendGcode,
    sendMacro,
    clearCommandError,
    extruder,
    retraction,
    leveling,
  }
})
