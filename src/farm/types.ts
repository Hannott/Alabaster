import type { Camera } from '@/features/camera/camera'

/**
 * One printer's whole appearance on the farm rail, as plain data.
 *
 * The column component renders this and nothing else. That is the point: two
 * very different producers fill it — a page-scoped `MoonrakerClient` for every
 * printer the user is not driving (`farm/connection.ts`), and an adapter over
 * the live domain stores for the one they are (`stores/farm.ts`) — and the
 * column cannot tell them apart. Without a shape in the middle, the active
 * printer's column would either need a second socket to its own machine or a
 * second component, and both were rejected in the farm plan for the same
 * reason: two sources of the same numbers disagree by a tick and the reader
 * cannot tell which is lying.
 */

/** Where the connection to this printer stands. Not the same as Klipper's state. */
export type FarmConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline'
  /** Reachable over HTTP, but this page's origin is not in `cors_domains`. */
  | 'originRefused'
  /** Moonraker enforces login and this browser has no usable token for it. */
  | 'unauthorized'

/** Klipper's own lifecycle, plus the answer for a printer nobody has reached. */
export type FarmKlipperState =
  'unknown' | 'disconnected' | 'startup' | 'ready' | 'error' | 'shutdown'

/** `print_stats.state`, narrowed, plus `unknown` for a printer that has not said. */
export type FarmPrintState =
  'unknown' | 'standby' | 'printing' | 'paused' | 'complete' | 'cancelled' | 'error'

export type FarmQueueState = 'ready' | 'loading' | 'starting' | 'paused'

export interface FarmQueuedJob {
  jobId: string
  filename: string
}

export interface FarmQueue {
  state: FarmQueueState
  jobs: FarmQueuedJob[]
}

export interface FarmHeater {
  temperature: number | null
  target: number | null
}

export interface FarmSpool {
  material: string
  /** `#rrggbb`, or an empty string where Spoolman holds no colour for it. */
  color: string
  /** Grams left on the spool, when Spoolman has enough to compute it. */
  remainingWeight: number | null
}

export interface FarmPowerDevice {
  device: string
  on: boolean
}

export interface FarmJob {
  filename: string
  /** 0–1, or null when nothing is loaded. */
  progress: number | null
  printDuration: number
  totalDuration: number
  /** Seconds, from the slicer estimate where there is one and the file position otherwise. */
  remainingSeconds: number | null
  currentLayer: number | null
  totalLayer: number | null
  /** Absolute URL of the slicer's largest thumbnail, resolved against this printer's host. */
  thumbnailUrl: string | null
}

export interface FarmPrinterSnapshot {
  connection: FarmConnectionState
  /** Whether this browser has ever completed a connection to this printer. */
  hasConnected: boolean
  klipper: FarmKlipperState
  /** Klipper's own sentence about why it is not ready. Empty when it is. */
  klipperMessage: string
  state: FarmPrintState
  /** Lower-case axis letters Klipper reports as homed, e.g. `xyz`. */
  homedAxes: string
  job: FarmJob | null
  extruder: FarmHeater
  bed: FarmHeater
  spool: FarmSpool | null
  /** Null where Moonraker has no `job_queue` answer for this printer yet. */
  queue: FarmQueue | null
  cameras: Camera[]
  /** The printer's own power switch, where `[power]` is configured. */
  power: FarmPowerDevice | null
  /** Epoch milliseconds of the last update, or null for a printer never reached. */
  updatedAt: number | null
}

export function emptyFarmSnapshot(): FarmPrinterSnapshot {
  return {
    connection: 'idle',
    hasConnected: false,
    klipper: 'unknown',
    klipperMessage: '',
    state: 'unknown',
    homedAxes: '',
    job: null,
    extruder: { temperature: null, target: null },
    bed: { temperature: null, target: null },
    spool: null,
    queue: null,
    cameras: [],
    power: null,
    updatedAt: null,
  }
}

/**
 * Whether the column should dim what it is showing.
 *
 * Last-known content stays mounted through a disconnection (ADR 0002), so the
 * column needs a way to say "this was true, a while ago" without emptying
 * itself. A printer that has never answered is not stale — it has nothing to
 * be stale about, and its column says so in words instead.
 */
export function isFarmSnapshotStale(snapshot: FarmPrinterSnapshot): boolean {
  if (!snapshot.hasConnected) return false
  return snapshot.connection !== 'connected'
}

/**
 * The three column controls whose consequence earns a dialog. Named here
 * rather than in the column component because the view owns the one
 * `ConfirmDialog` the page has — N columns must not mean N dialogs.
 */
export type FarmConfirmableAction = 'cancel' | 'emergencyStop' | 'power'
