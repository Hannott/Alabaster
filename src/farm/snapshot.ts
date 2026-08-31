import type { PrinterObjectSelection } from '@/services/moonraker'
import type {
  FarmHeater,
  FarmJob,
  FarmKlipperState,
  FarmPrintState,
  FarmQueue,
  FarmQueueState,
  FarmQueuedJob,
} from '@/farm/types'
import { isRecord } from '@/utils/records'

/**
 * What a farm connection subscribes to — **fields, never whole objects.**
 *
 * Measured against a real printer over identical 20-second idle windows:
 * subscribing to these six objects wholesale (`{print_stats: null, …}`, which
 * is what the reference implementation does) cost 32 399 bytes of
 * `notify_status_update` against 7 947 for this selection, and 1 513 bytes of
 * initial snapshot against 557. The difference is almost entirely one field
 * nobody wants here: a Kalico extruder carries its whole pressure-advance
 * `control_stats` block, and it is re-sent on every temperature tick.
 *
 * The rail holds one connection per visible printer, so the multiplier is the
 * number of columns on screen. Anything added here is added that many times.
 */
export const farmObjectSelection: PrinterObjectSelection = {
  print_stats: ['state', 'filename', 'print_duration', 'total_duration', 'filament_used', 'info'],
  virtual_sdcard: ['progress', 'is_active'],
  display_status: ['progress', 'message'],
  extruder: ['temperature', 'target'],
  heater_bed: ['temperature', 'target'],
  webhooks: ['state', 'state_message'],
  // One field, for the homing row: which axes a machine has found. Without it
  // the buttons would either lie about the machine's state or have to be
  // offered unconditionally, and `G28 Z` is not a control to offer blind.
  toolhead: ['homed_axes'],
}

const printStates: readonly FarmPrintState[] = [
  'standby',
  'printing',
  'paused',
  'complete',
  'cancelled',
  'error',
]

const queueStates: readonly FarmQueueState[] = ['ready', 'loading', 'starting', 'paused']

const klipperStates: readonly FarmKlipperState[] = [
  'disconnected',
  'startup',
  'ready',
  'error',
  'shutdown',
]

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function toPrintState(value: unknown): FarmPrintState {
  return printStates.includes(value as FarmPrintState) ? (value as FarmPrintState) : 'unknown'
}

export function toKlipperState(value: unknown): FarmKlipperState {
  return klipperStates.includes(value as FarmKlipperState) ? (value as FarmKlipperState) : 'unknown'
}

export function toQueueState(value: unknown): FarmQueueState {
  return queueStates.includes(value as FarmQueueState) ? (value as FarmQueueState) : 'ready'
}

export function readHeater(value: unknown, previous: FarmHeater): FarmHeater {
  if (!isRecord(value)) return previous
  return {
    temperature: 'temperature' in value ? numberOrNull(value.temperature) : previous.temperature,
    target: 'target' in value ? numberOrNull(value.target) : previous.target,
  }
}

/**
 * Moonraker's queue answers with the jobs in the order it will run them, and
 * the head of that list is the only entry with a consequence — it is what the
 * machine starts next, and what *Remove next* deletes. A job with neither a
 * filename nor an id is dropped rather than rendered as a blank row.
 *
 * **The two sources spell the list differently.** `server.job_queue.status`
 * answers with `queued_jobs`; `notify_job_queue_changed` carries
 * `updated_queue`. Reading only the first meant every queue change *emptied*
 * the card — the notification parsed cleanly, found no jobs under the name it
 * was looking for, and reported a queue of nothing to a machine that had just
 * gained a job. `jobQueue.ts` already accepts both, for the same reason.
 */
export function readQueue(value: unknown): FarmQueue | null {
  if (!isRecord(value)) return null
  const jobs: FarmQueuedJob[] = []
  const queued = value.updated_queue ?? value.queued_jobs
  if (Array.isArray(queued)) {
    for (const candidate of queued) {
      if (!isRecord(candidate)) continue
      const filename = typeof candidate.filename === 'string' ? candidate.filename : ''
      const jobId = typeof candidate.job_id === 'string' ? candidate.job_id : ''
      if (filename === '' || jobId === '') continue
      jobs.push({ jobId, filename })
    }
  }
  return { state: toQueueState(value.queue_state), jobs }
}

/**
 * How far through the file the print is.
 *
 * `virtual_sdcard.progress` is bytes through the file including the slicer's
 * preamble, and `display_status.progress` is whatever the slicer's own
 * `M73` said. The dashboard prefers the byte range bracketed by the metadata;
 * a farm column has the metadata only for the file it fetched, so it takes
 * `display_status` where the slicer reported one and falls back to the raw
 * file position. Both are honest at the resolution this column shows.
 */
export function readProgress(
  displayStatus: Record<string, unknown> | null,
  virtualSdcard: Record<string, unknown> | null,
): number | null {
  const display = displayStatus ? numberOrNull(displayStatus.progress) : null
  if (display !== null && display > 0) return Math.min(1, Math.max(0, display))
  const sdcard = virtualSdcard ? numberOrNull(virtualSdcard.progress) : null
  if (sdcard === null) return null
  return Math.min(1, Math.max(0, sdcard))
}

/**
 * Seconds left, by the same order of preference the Print card uses: the
 * slicer's estimate first because it accounts for what the file actually does,
 * then extrapolation from elapsed time against progress. Filament-based
 * extrapolation is deliberately not carried here — it needs the metadata's
 * total filament and a minimum elapsed time to be anything but noise, and a
 * column showing one line of job text does not earn a third estimator.
 */
export function readRemainingSeconds(
  elapsedSeconds: number,
  progress: number | null,
  slicerEstimateSeconds: number | null,
): number | null {
  if (slicerEstimateSeconds !== null && slicerEstimateSeconds > 0) {
    return Math.max(0, slicerEstimateSeconds - elapsedSeconds)
  }
  if (progress !== null && progress > 0) {
    return Math.max(0, elapsedSeconds / progress - elapsedSeconds)
  }
  return null
}

export interface FarmJobInput {
  printStats: Record<string, unknown> | null
  displayStatus: Record<string, unknown> | null
  virtualSdcard: Record<string, unknown> | null
  slicerEstimateSeconds: number | null
  metadataLayerCount: number | null
  thumbnailUrl: string | null
}

/**
 * The job row's whole content, or null when the printer has never loaded a
 * file. An idle printer that has printed keeps its last job here rather than
 * clearing it: `print_stats` holds the finished job until the next one starts,
 * and a column that blanks itself the moment a print ends is a column that
 * cannot answer "what did that machine just do".
 */
export function readJob(input: FarmJobInput): FarmJob | null {
  const stats = input.printStats
  const filename = stats && typeof stats.filename === 'string' ? stats.filename : ''
  if (filename === '') return null

  const printDuration = numberOr(stats?.print_duration, 0)
  const progress = readProgress(input.displayStatus, input.virtualSdcard)
  const info = isRecord(stats?.info) ? stats.info : null

  return {
    filename,
    progress,
    printDuration,
    totalDuration: numberOr(stats?.total_duration, 0),
    remainingSeconds: readRemainingSeconds(printDuration, progress, input.slicerEstimateSeconds),
    currentLayer: info ? numberOrNull(info.current_layer) : null,
    totalLayer: (info ? numberOrNull(info.total_layer) : null) ?? input.metadataLayerCount,
    thumbnailUrl: input.thumbnailUrl,
  }
}
