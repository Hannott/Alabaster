import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import { historyPeriods, periodSince, type HistoryPeriod } from '@/features/history/statistics'
import type {
  JsonRpcNotification,
  MoonrakerHistoryAuxiliaryData,
  MoonrakerHistoryAuxiliaryTotal,
  MoonrakerHistoryJob,
  MoonrakerHistoryTotals,
} from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { createGuardedLoad } from '@/stores/guardedLoad'
import { useMoonrakerStore } from '@/stores/moonraker'
import { readScoped, writeScoped } from '@/stores/printerScope'
import { usePrintersStore } from '@/stores/printers'
import { isRecord } from '@/utils/records'

/**
 * Completed jobs and the lifetime counters Moonraker keeps beside them.
 *
 * Kept current by `notify_history_changed`, which Moonraker emits when a job is
 * added or finished — so the list does not need reloading to show the print that
 * just ended, and a page left open overnight is not showing yesterday's totals.
 */

export type HistoryOutcome = 'completed' | 'cancelled' | 'error' | 'interrupted' | 'unknown'

/**
 * One value a Moonraker component recorded against this specific job — see
 * `MoonrakerHistoryAuxiliaryData`. `value` is an array for a component that
 * records more than one reading per job, such as Spoolman's spool ids on a
 * multi-material print.
 */
export interface HistoryJobAuxiliaryValue {
  provider: string
  field: string
  description: string
  units: string | null
  value: number | number[]
}

export interface HistoryJob {
  id: string
  filename: string
  outcome: HistoryOutcome
  /** Unix seconds. */
  startedAt: number
  endedAt: number | null
  /** Seconds actually spent printing, excluding heat-up and pauses. */
  printDuration: number
  /** Seconds the job occupied the printer for. */
  totalDuration: number
  /** Millimetres of filament. */
  filamentUsed: number
  /** Whether the file is still on the printer, so a reprint can be offered. */
  fileExists: boolean
  auxiliaryData: HistoryJobAuxiliaryValue[]
}

/** One auxiliary field's lifetime aggregate, alongside the job totals. */
export interface HistoryAuxiliaryTotal {
  provider: string
  field: string
  maximum: number
  total: number
}

export interface HistoryTotals {
  jobs: number
  totalTime: number
  printTime: number
  filamentUsed: number
  longestJob: number
  longestPrint: number
  auxiliaryTotals: HistoryAuxiliaryTotal[]
}

const emptyTotals: HistoryTotals = {
  jobs: 0,
  totalTime: 0,
  printTime: 0,
  filamentUsed: 0,
  longestJob: 0,
  longestPrint: 0,
  auxiliaryTotals: [],
}

/** How many jobs one page of history holds. */
export const historyPageSize = 50

/**
 * One page of the windowed statistics fetch — generous enough that a real
 * printer's period completes in a single request (measured: 270 jobs over 90
 * days, 263 KB, 125 ms), and paged the rest of the way when it does not, so
 * "complete for the period" stays true rather than becoming a claim about a
 * silently truncated fetch.
 */
export const windowPageSize = 2000
/** A backstop against an unbounded loop, not a real limit any period should approach. */
const maximumWindowPages = 25

function readOutcome(status: unknown): HistoryOutcome {
  if (typeof status !== 'string') return 'unknown'
  const normalized = status.trim().toLowerCase()
  if (normalized === 'completed') return 'completed'
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled'
  if (normalized === 'error' || normalized === 'server_exit') return 'error'
  if (normalized === 'interrupted' || normalized === 'klippy_shutdown') return 'interrupted'
  return 'unknown'
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Filament consumed and time spent cannot be negative, but Moonraker's own
 * history has been observed to report one anyway on a job a `klippy_disconnect`
 * cut off mid-write (verified against a real printer's history: a
 * `filament_used` of `-10` on such a job). Left alone, a negative magnitude
 * subtracts from an aggregate meant to only ever grow, and turns a share
 * percentage into a nonsensical negative or `-0%` — worse than the reading
 * simply being wrong by clamping it, since the sign is not data, it is corruption.
 */
function nonNegative(value: unknown): number {
  const parsed = finite(value)
  return parsed > 0 ? parsed : 0
}

/**
 * A value may be a magnitude (energy) or an id list (which spools printed
 * this), so only the shape decides which — never the field name, which is
 * user-declared and unbounded. Non-numeric entries in an array are dropped
 * rather than turning the whole reading into `NaN`.
 */
function readAuxiliaryValue(value: unknown): number | number[] {
  if (Array.isArray(value)) {
    return value.filter(
      (entry): entry is number => typeof entry === 'number' && Number.isFinite(entry),
    )
  }
  return finite(value)
}

function readJobAuxiliaryData(data: unknown): HistoryJobAuxiliaryValue[] {
  if (!Array.isArray(data)) return []
  const output: HistoryJobAuxiliaryValue[] = []
  for (const entry of data as MoonrakerHistoryAuxiliaryData[]) {
    if (!isRecord(entry)) continue
    output.push({
      provider: typeof entry.provider === 'string' ? entry.provider : '',
      field: typeof entry.name === 'string' ? entry.name : '',
      description: typeof entry.description === 'string' ? entry.description : '',
      units: typeof entry.units === 'string' ? entry.units : null,
      value: readAuxiliaryValue(entry.value),
    })
  }
  return output
}

function readJob(job: MoonrakerHistoryJob): HistoryJob {
  return {
    id: String(job.job_id ?? ''),
    filename: typeof job.filename === 'string' ? job.filename : '',
    outcome: readOutcome(job.status),
    startedAt: finite(job.start_time),
    endedAt:
      typeof job.end_time === 'number' && Number.isFinite(job.end_time) ? job.end_time : null,
    printDuration: nonNegative(job.print_duration),
    totalDuration: nonNegative(job.total_duration),
    filamentUsed: nonNegative(job.filament_used),
    fileExists: job.exists !== false,
    auxiliaryData: readJobAuxiliaryData(job.auxiliary_data),
  }
}

/**
 * A field a `[sensor]` no longer declares still has a lifetime total on
 * record; it degrades to its own name with no unit rather than the value
 * disappearing or rendering `undefined`.
 */
function readAuxiliaryTotals(
  totals: MoonrakerHistoryAuxiliaryTotal[] | undefined,
): HistoryAuxiliaryTotal[] {
  if (!Array.isArray(totals)) return []
  return totals
    .filter((entry): entry is MoonrakerHistoryAuxiliaryTotal => isRecord(entry))
    .map((entry) => ({
      provider: typeof entry.provider === 'string' ? entry.provider : '',
      field: typeof entry.field === 'string' ? entry.field : '',
      maximum: finite(entry.maximum),
      total: finite(entry.total),
    }))
}

function readTotals(
  jobTotals: MoonrakerHistoryTotals | undefined,
  auxiliaryTotals: MoonrakerHistoryAuxiliaryTotal[] | undefined,
): HistoryTotals {
  if (!jobTotals) return emptyTotals
  return {
    jobs: finite(jobTotals.total_jobs),
    totalTime: finite(jobTotals.total_time),
    printTime: finite(jobTotals.total_print_time),
    filamentUsed: finite(jobTotals.total_filament_used),
    longestJob: finite(jobTotals.longest_job),
    longestPrint: finite(jobTotals.longest_print),
    auxiliaryTotals: readAuxiliaryTotals(auxiliaryTotals),
  }
}

/**
 * The job `notify_history_changed` is about, when it is about one this store
 * can apply directly. Moonraker sends `{action, job}`: `added` when a print
 * starts and `finished` when it ends, both carrying the same record shape
 * `server.history.list` returns. Anything else — an unknown action, a missing
 * job, a record with no id — returns `null`, and the caller re-reads the
 * server instead of guessing.
 */
function readHistoryChange(
  notification: JsonRpcNotification,
): { action: 'added' | 'finished'; job: HistoryJob } | null {
  const payload = notification?.params?.[0]
  if (!isRecord(payload)) return null
  const action = payload.action
  if (action !== 'added' && action !== 'finished') return null
  if (!isRecord(payload.job)) return null
  const job = readJob(payload.job as unknown as MoonrakerHistoryJob)
  return job.id === '' ? null : { action, job }
}

/**
 * Replaces the record with this id, or puts the job at the front.
 *
 * Front is right for a job Moonraker has just added: both arrays are
 * descending by time and a newly started print is the newest record that
 * exists, so prepending keeps the order and keeps `jobs.length` equal to the
 * number of records the server holds ahead of the next page — which is what
 * `loadMore` passes as its `start` offset. A `finished` notification arrives
 * for a job `added` already put there, so it lands on the replace path and the
 * length does not move.
 */
function upsertJob(list: readonly HistoryJob[], job: HistoryJob): HistoryJob[] {
  const index = list.findIndex((entry) => entry.id === job.id)
  if (index < 0) return [job, ...list]
  const next = [...list]
  next[index] = job
  return next
}

const periodStorageKey = 'alabaster.history.period.v1'
const defaultPeriod: HistoryPeriod = '90d'

function parsedStorage(key: string): unknown {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

/**
 * Scoped per printer, like every other view preference tied to one machine's
 * identity: a farm printer with years of history and a printer bought last
 * week have no reason to share how far back "the" period looks.
 */
function savedPeriod(scopeKeys: readonly string[]): HistoryPeriod {
  const stored = parsedStorage(periodStorageKey)
  const scoped = isRecord(stored) ? readScoped(stored, scopeKeys) : null
  return typeof scoped === 'string' && (historyPeriods as readonly string[]).includes(scoped)
    ? (scoped as HistoryPeriod)
    : defaultPeriod
}

function persistPeriod(scopeKeys: readonly string[], period: HistoryPeriod): void {
  const stored = parsedStorage(periodStorageKey)
  const table = isRecord(stored) ? stored : {}
  window.localStorage.setItem(
    periodStorageKey,
    JSON.stringify(writeScoped(table, scopeKeys, period)),
  )
}

export const useHistoryStore = defineStore('history', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()
  const printers = usePrintersStore()

  const jobs = ref<HistoryJob[]>([])
  const totals = ref<HistoryTotals>(emptyTotals)
  const isLoading = ref(false)
  const failed = ref(false)
  /** Whether Moonraker reports more jobs than have been fetched. */
  const hasMore = ref(false)

  const load = createGuardedLoad({ isLoading, failed })
  let started = false
  let stopAvailabilityWatch: WatchStopHandle | null = null
  let stopHistoryNotifications: (() => void) | null = null
  let stopPrinterChangeReset: (() => void) | null = null

  const hasJobs = computed(() => jobs.value.length > 0)

  /**
   * The statistics surface's own population — see
   * `docs/design/interface-standards.md`'s History contract. Separate from
   * `jobs` above, which is the job list's own paginated cursor: sharing one
   * array is how a reference statistics panel ends up computing "totals" from
   * whatever the list happens to have scrolled to.
   */
  const period = ref<HistoryPeriod>(savedPeriod(printers.activeScopeKeys))
  const windowJobs = ref<HistoryJob[]>([])
  const windowLoading = ref(false)
  const windowFailed = ref(false)
  const windowLoad = createGuardedLoad({ isLoading: windowLoading, failed: windowFailed })

  const windowSuccessRate = computed(() => {
    if (windowJobs.value.length === 0) return null
    const completed = windowJobs.value.filter((job) => job.outcome === 'completed').length
    return completed / windowJobs.value.length
  })

  async function fetchWindowJobs(forPeriod: HistoryPeriod): Promise<HistoryJob[]> {
    const since = periodSince(forPeriod, Math.floor(Date.now() / 1000))
    const collected: HistoryJob[] = []
    for (let page = 0; page < maximumWindowPages; page += 1) {
      const params =
        since === null
          ? { limit: windowPageSize, start: collected.length, order: 'desc' as const }
          : { limit: windowPageSize, start: collected.length, order: 'desc' as const, since }
      const result = await moonraker.rpcCall('server.history.list', params)
      const loaded = Array.isArray(result?.jobs) ? result.jobs.map(readJob) : []
      collected.push(...loaded)
      if (loaded.length < windowPageSize) break
    }
    return collected
  }

  function refreshWindow(): Promise<boolean> {
    if (!availability.isMoonrakerConnected) return Promise.resolve(false)
    return windowLoad.run(
      () => fetchWindowJobs(period.value),
      (loaded) => {
        windowJobs.value = loaded
      },
    )
  }

  function setPeriod(next: HistoryPeriod): void {
    if (period.value === next) return
    period.value = next
    persistPeriod(printers.activeScopeKeys, next)
    void refreshWindow()
  }

  function refresh(): Promise<boolean> {
    if (!availability.isMoonrakerConnected) return Promise.resolve(false)
    return load.run(
      () =>
        Promise.all([
          moonraker.rpcCall('server.history.list', { limit: historyPageSize, order: 'desc' }),
          moonraker.rpcCall('server.history.totals'),
        ]),
      ([list, totalsResult]) => {
        const loaded = Array.isArray(list?.jobs) ? list.jobs.map(readJob) : []
        jobs.value = loaded
        // Moonraker's `count` is the length of `jobs` in *this* response, never
        // a total — requesting 5 jobs back returns `count: 5` regardless of how
        // many exist. A full page may mean more exist; a short one means it does
        // not.
        hasMore.value = loaded.length === historyPageSize
        totals.value = readTotals(totalsResult?.job_totals, totalsResult?.auxiliary_totals)
      },
    )
  }

  /** Fetches the next page and appends it, so scrolling back does not reload the top. */
  function loadMore(): Promise<boolean> {
    if (!availability.isMoonrakerConnected || !hasMore.value || isLoading.value) {
      return Promise.resolve(false)
    }
    return load.run(
      () =>
        moonraker.rpcCall('server.history.list', {
          limit: historyPageSize,
          start: jobs.value.length,
          order: 'desc',
        }),
      (list) => {
        const loaded = Array.isArray(list?.jobs) ? list.jobs.map(readJob) : []
        jobs.value = [...jobs.value, ...loaded]
        hasMore.value = loaded.length === historyPageSize
      },
    )
  }

  /**
   * The lifetime counters on their own. Small, and the only part of this store
   * that cannot be derived from a job record — `longestJob` and `longestPrint`
   * are aggregates over history the client never holds all of.
   */
  async function refreshTotals(): Promise<void> {
    if (!availability.isMoonrakerConnected) return
    try {
      const totalsResult = await moonraker.rpcCall('server.history.totals')
      totals.value = readTotals(totalsResult?.job_totals, totalsResult?.auxiliary_totals)
    } catch {
      // Leaves the last known totals in place: a counter one print behind is
      // worth more than a card that has gone blank.
    }
  }

  /**
   * Removes one job from the history. Deliberately not offered for "all": the
   * totals are the only record of a printer's working life, and one mis-aimed
   * click should not be able to end it.
   *
   * `notify_history_changed` is Moonraker's signal for a job being added or
   * finished, not for one being deleted, so the statistics surface cannot
   * rely on that notification to catch this — it has to update itself here,
   * the same way `jobs` does. The window is filtered locally, like `jobs`,
   * since the deleted job is known; the lifetime totals are re-fetched
   * instead, since a deletion can change `longestJob`/`longestPrint` to a
   * value only the server can recompute.
   */
  async function deleteJob(id: string): Promise<boolean> {
    if (!availability.isMoonrakerConnected) return false
    try {
      await moonraker.rpcCall('server.history.delete_job', { uid: id })
      jobs.value = jobs.value.filter((job) => job.id !== id)
      windowJobs.value = windowJobs.value.filter((job) => job.id !== id)
      const totalsResult = await moonraker.rpcCall('server.history.totals')
      totals.value = readTotals(totalsResult?.job_totals, totalsResult?.auxiliary_totals)
      return true
    } catch {
      failed.value = true
      return false
    }
  }

  /**
   * Applies the notification rather than re-reading the server for it.
   *
   * Re-reading meant two requests per print event, one of them the entire
   * statistics window — measured against a real printer at 270 jobs, 263 KB
   * and 125 ms for a 90-day period, and proportionally worse for a farm
   * printer on "all time". It also replaced `jobs` with a fresh first page,
   * which threw away every extra page the user had pressed "Load more" for and
   * re-rendered the whole list, twice per print. None of that bought anything:
   * the notification carries the changed job itself.
   *
   * Lifetime totals are still re-read, because they are aggregates only the
   * server can recompute — the same reason `deleteJob` re-reads them — and
   * they are two hundred bytes rather than a window. A payload this cannot
   * read falls back to the full pair of reads, so an unexpected Moonraker
   * shape degrades to the old behaviour instead of to a stale page.
   */
  function handleHistoryChanged(notification: JsonRpcNotification): void {
    const change = readHistoryChange(notification)
    if (!change) {
      void refresh()
      void refreshWindow()
      return
    }
    jobs.value = upsertJob(jobs.value, change.job)
    windowJobs.value = upsertJob(windowJobs.value, change.job)
    void refreshTotals()
  }

  /** Another printer's job log misattributes every print on it; it goes too. */
  function printerChanged(): void {
    load.invalidate()
    jobs.value = []
    totals.value = emptyTotals
    hasMore.value = false
    failed.value = false
    windowLoad.invalidate()
    windowJobs.value = []
    windowFailed.value = false
    period.value = savedPeriod(printers.activeScopeKeys)
  }

  function start(): void {
    if (started) return
    started = true
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    stopAvailabilityWatch = watch(
      () => availability.isMoonrakerConnected,
      (connected) => {
        if (connected) {
          void refresh()
          void refreshWindow()
        }
      },
      { immediate: true },
    )
    // A print that just ended has to appear without the user reloading; this is
    // the notification that says so — for the job list and for the statistics
    // window both.
    try {
      stopHistoryNotifications = moonraker.onNotification(
        'notify_history_changed',
        handleHistoryChanged,
      )
    } catch {
      stopHistoryNotifications = null
    }
  }

  function stop(): void {
    if (!started) return
    started = false
    load.invalidate()
    windowLoad.invalidate()
    stopAvailabilityWatch?.()
    stopAvailabilityWatch = null
    stopHistoryNotifications?.()
    stopHistoryNotifications = null
    stopPrinterChangeReset?.()
    stopPrinterChangeReset = null
  }

  return {
    jobs,
    totals,
    hasJobs,
    hasMore,
    isLoading,
    failed,
    period,
    windowJobs,
    windowLoading,
    windowFailed,
    windowSuccessRate,
    setPeriod,
    refreshWindow,
    refresh,
    loadMore,
    deleteJob,
    start,
    stop,
  }
})
