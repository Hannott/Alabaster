/**
 * The arithmetic behind the History destination's statistics, with no Vue and
 * no DOM — kept apart from drawing it for the same reason `chartGeometry.ts`
 * is: what a chart claims is a different job from rendering it, and the
 * claims are what can be wrong.
 *
 * Every function here takes the jobs it aggregates over as a plain array and
 * states in its own name which population that array is expected to be —
 * this module never decides that for itself. A statistic computed from
 * whatever a caller happened to have loaded, with no label saying so, is the
 * fault this surface exists to fix; see `docs/design/interface-standards.md`'s
 * History contract.
 */

export type HistoryOutcome = 'completed' | 'cancelled' | 'error' | 'interrupted' | 'unknown'

/** The fields this module reads off a completed-job record. */
export interface HistoryStatsJob {
  outcome: HistoryOutcome
  /** Unix seconds. */
  startedAt: number
  /** Seconds actually spent printing, excluding heat-up and pauses. */
  printDuration: number
  /** Seconds the job occupied the printer for. */
  totalDuration: number
  /** Millimetres of filament. */
  filamentUsed: number
}

export const historyPeriods = ['30d', '90d', '12m', 'all'] as const
export type HistoryPeriod = (typeof historyPeriods)[number]

const secondsPerDay = 86400

/**
 * The `since` boundary a period asks Moonraker for. `null` for "all time" —
 * deliberately no synthetic epoch stood in for it, because the honest
 * boundary for "all" is "whatever the printer's history actually holds", not
 * a guess at how old a printer could be.
 */
export function periodSince(period: HistoryPeriod, now: number): number | null {
  switch (period) {
    case '30d':
      return now - 30 * secondsPerDay
    case '90d':
      return now - 90 * secondsPerDay
    case '12m':
      return now - 365 * secondsPerDay
    case 'all':
      return null
  }
}

export type HistoryStatsMeasure = 'jobs' | 'filament' | 'time'

export interface OutcomeBreakdown {
  outcome: HistoryOutcome
  jobs: number
  filamentUsed: number
  printTime: number
}

/**
 * Fixed rather than sorted by count, so the same outcome always lands in the
 * same slot of a proportion bar between one render and the next — a bar that
 * reorders itself as jobs come in is unreadable at a glance in a way a table
 * is not.
 */
const outcomeOrder: readonly HistoryOutcome[] = [
  'completed',
  'cancelled',
  'interrupted',
  'error',
  'unknown',
]

/**
 * Every outcome present, in every measure at once — jobs, filament, print
 * time — so a component can switch between them without re-fetching or
 * re-aggregating, and a bar and a table driven from the same call can never
 * disagree the way two separately-toggled reference charts can.
 *
 * An outcome with zero jobs is dropped rather than kept at zero: a healthy
 * printer that has never errored should not carry a permanent zero-width
 * "Error" row.
 */
export function outcomeBreakdown(jobs: readonly HistoryStatsJob[]): OutcomeBreakdown[] {
  const totals = new Map<HistoryOutcome, OutcomeBreakdown>(
    outcomeOrder.map((outcome) => [outcome, { outcome, jobs: 0, filamentUsed: 0, printTime: 0 }]),
  )
  for (const job of jobs) {
    const entry = totals.get(job.outcome) ?? (totals.get('unknown') as OutcomeBreakdown)
    entry.jobs += 1
    entry.filamentUsed += job.filamentUsed
    entry.printTime += job.printDuration
  }
  return outcomeOrder
    .map((outcome) => totals.get(outcome) as OutcomeBreakdown)
    .filter((entry) => entry.jobs > 0)
}

/** Reads the one number a measure toggle asks an outcome row for. */
export function outcomeMeasureValue(entry: OutcomeBreakdown, measure: HistoryStatsMeasure): number {
  if (measure === 'filament') return entry.filamentUsed
  if (measure === 'time') return entry.printTime
  return entry.jobs
}

export type BucketGranularity = 'day' | 'week' | 'month'

/**
 * Chosen from the period, never fixed: a 30-day window at monthly resolution
 * is one bar, and a lifetime at daily resolution is thousands. The reference
 * implementation hardcodes 14 days at daily resolution and its charts go
 * blank the moment the selection is a period older than that.
 */
export function bucketGranularityFor(period: HistoryPeriod): BucketGranularity {
  if (period === '30d') return 'day'
  if (period === '90d') return 'week'
  return 'month'
}

function startOfDay(unixSeconds: number): number {
  const date = new Date(unixSeconds * 1000)
  date.setHours(0, 0, 0, 0)
  return Math.floor(date.getTime() / 1000)
}

/** Monday, matching the week the trend chart's own labels read against. */
function startOfWeek(unixSeconds: number): number {
  const date = new Date(startOfDay(unixSeconds) * 1000)
  const daysSinceMonday = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - daysSinceMonday)
  return Math.floor(date.getTime() / 1000)
}

function startOfMonth(unixSeconds: number): number {
  const date = new Date(startOfDay(unixSeconds) * 1000)
  date.setDate(1)
  return Math.floor(date.getTime() / 1000)
}

function alignedStart(unixSeconds: number, granularity: BucketGranularity): number {
  if (granularity === 'day') return startOfDay(unixSeconds)
  if (granularity === 'week') return startOfWeek(unixSeconds)
  return startOfMonth(unixSeconds)
}

function nextBoundary(start: number, granularity: BucketGranularity): number {
  const date = new Date(start * 1000)
  if (granularity === 'day') date.setDate(date.getDate() + 1)
  else if (granularity === 'week') date.setDate(date.getDate() + 7)
  else date.setMonth(date.getMonth() + 1)
  return Math.floor(date.getTime() / 1000)
}

export interface HistoryBucket {
  /** Unix seconds, the calendar boundary the bucket starts on. */
  start: number
  end: number
  completedJobs: number
  notCompletedJobs: number
  completedFilament: number
  notCompletedFilament: number
  completedTime: number
  notCompletedTime: number
}

/**
 * A backstop against a runaway bucket count, not a real limit any period in
 * `historyPeriods` should approach — the longest of them, "all", still
 * produces at most a few hundred monthly buckets on a printer old enough to
 * matter. It exists for the one record a bad timestamp could otherwise
 * generate: a `startedAt` of `0` on an otherwise-healthy job would anchor
 * "all time" at 1970 and try to bucket forward from there.
 */
const maximumBuckets = 500

/**
 * Jobs per calendar bucket over a period, split into completed and everything
 * else — the split the trend chart stacks. Buckets are drawn for the whole
 * period regardless of whether any job fell in them: a fortnight the printer
 * sat idle is information, and skipping the gap would claim it ran the whole
 * time.
 *
 * `now` is a parameter rather than read from the clock, so the function stays
 * a pure one — the caller supplies the moment, in unix seconds.
 */
export function historyTrend(
  jobs: readonly HistoryStatsJob[],
  options: { period: HistoryPeriod; now: number },
): HistoryBucket[] {
  const { period, now } = options
  const granularity = bucketGranularityFor(period)
  const since = periodSince(period, now)

  const earliestJobStart = jobs.reduce(
    (earliest, job) =>
      job.startedAt > 0 && (earliest === null || job.startedAt < earliest)
        ? job.startedAt
        : earliest,
    null as number | null,
  )

  let boundaryStart = alignedStart(since ?? earliestJobStart ?? now, granularity)

  // The backstop: walk the start forward, capped, rather than building a
  // bucket list nobody asked for and nothing can render at that width.
  let candidateCount = 0
  for (
    let cursor = boundaryStart;
    cursor <= now && candidateCount <= maximumBuckets;
    cursor = nextBoundary(cursor, granularity)
  ) {
    candidateCount += 1
  }
  if (candidateCount > maximumBuckets) {
    let cursor = now
    for (let stepsBack = 0; stepsBack < maximumBuckets - 1; stepsBack += 1) {
      cursor = alignedStart(cursor, granularity) - 1
    }
    boundaryStart = alignedStart(cursor, granularity)
  }

  const buckets: HistoryBucket[] = []
  let cursor = boundaryStart
  do {
    const end = nextBoundary(cursor, granularity)
    buckets.push({
      start: cursor,
      end,
      completedJobs: 0,
      notCompletedJobs: 0,
      completedFilament: 0,
      notCompletedFilament: 0,
      completedTime: 0,
      notCompletedTime: 0,
    })
    cursor = end
  } while (cursor <= now)

  for (const job of jobs) {
    const bucket = buckets.find(
      (candidate) => job.startedAt >= candidate.start && job.startedAt < candidate.end,
    )
    if (!bucket) continue
    if (job.outcome === 'completed') {
      bucket.completedJobs += 1
      bucket.completedFilament += job.filamentUsed
      bucket.completedTime += job.printDuration
    } else {
      bucket.notCompletedJobs += 1
      bucket.notCompletedFilament += job.filamentUsed
      bucket.notCompletedTime += job.printDuration
    }
  }

  return buckets
}

export interface LengthDistributionBin {
  /** Seconds, inclusive. */
  lowerBound: number
  /** Seconds, inclusive; `null` marks the open-ended final bin. */
  upperBound: number | null
  jobs: number
}

/**
 * Completed-job length in quartile-derived bins, rather than the fixed
 * 0-2h / 2-6h / 6-12h / 12-24h / >24h ladder the reference interface hardcodes
 * — measured against a real 90-day sample, that ladder put 86% of prints in
 * its first bin and left its last permanently empty. Quartiles adapt to
 * whatever this printer actually runs, whether that is miniatures or
 * 30-hour vases.
 *
 * Completed jobs only: a cancelled job's duration is not a print length.
 */
export function lengthDistribution(jobs: readonly HistoryStatsJob[]): LengthDistributionBin[] {
  const durations = jobs
    .filter((job) => job.outcome === 'completed' && job.printDuration > 0)
    .map((job) => job.printDuration)
    .sort((a, b) => a - b)

  if (durations.length === 0) return []

  const quantile = (fraction: number): number => {
    const position = fraction * (durations.length - 1)
    const lowerIndex = Math.floor(position)
    const upperIndex = Math.ceil(position)
    const weight = position - lowerIndex
    const lower = durations[lowerIndex] as number
    const upper = durations[upperIndex] as number
    return lower + (upper - lower) * weight
  }

  const edges = [
    durations[0] as number,
    quantile(0.25),
    quantile(0.5),
    quantile(0.75),
    durations[durations.length - 1] as number,
  ]
  // Every job the same length collapses every quartile onto one edge; a
  // zero-width bin between two identical edges would otherwise report zero
  // jobs while jobs indisputably exist.
  const uniqueEdges = edges.filter(
    (edge, index) => index === 0 || edge > (edges[index - 1] as number),
  )

  if (uniqueEdges.length < 2) {
    return [{ lowerBound: uniqueEdges[0] as number, upperBound: null, jobs: durations.length }]
  }

  const bins: LengthDistributionBin[] = []
  for (let index = 0; index < uniqueEdges.length - 1; index += 1) {
    const lower = uniqueEdges[index] as number
    const upper = uniqueEdges[index + 1] as number
    const isLast = index === uniqueEdges.length - 2
    const jobsInBin = durations.filter(
      (duration) => duration >= lower && (isLast ? duration <= upper : duration < upper),
    ).length
    bins.push({ lowerBound: lower, upperBound: isLast ? null : upper, jobs: jobsInBin })
  }
  return bins
}
