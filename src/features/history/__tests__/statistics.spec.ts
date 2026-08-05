import { describe, expect, it } from 'vitest'

import {
  bucketGranularityFor,
  historyTrend,
  lengthDistribution,
  outcomeBreakdown,
  outcomeMeasureValue,
  periodSince,
  type HistoryStatsJob,
} from '@/features/history/statistics'

function job(overrides: Partial<HistoryStatsJob> = {}): HistoryStatsJob {
  return {
    outcome: 'completed',
    startedAt: 1_700_000_000,
    printDuration: 3600,
    totalDuration: 4000,
    filamentUsed: 1000,
    ...overrides,
  }
}

describe('periodSince', () => {
  it('returns the boundary for a bounded period', () => {
    const now = 1_700_000_000
    expect(periodSince('30d', now)).toBe(now - 30 * 86400)
    expect(periodSince('90d', now)).toBe(now - 90 * 86400)
    expect(periodSince('12m', now)).toBe(now - 365 * 86400)
  })

  it('has no boundary for all time, rather than a synthetic epoch', () => {
    expect(periodSince('all', 1_700_000_000)).toBeNull()
  })
})

describe('outcomeBreakdown', () => {
  it('sums every measure per outcome and drops outcomes that never occurred', () => {
    const jobs = [
      job({ outcome: 'completed', filamentUsed: 1000, printDuration: 100 }),
      job({ outcome: 'completed', filamentUsed: 2000, printDuration: 200 }),
      job({ outcome: 'cancelled', filamentUsed: 500, printDuration: 50 }),
    ]

    const breakdown = outcomeBreakdown(jobs)

    expect(breakdown.map((entry) => entry.outcome)).toEqual(['completed', 'cancelled'])
    const completed = breakdown.find((entry) => entry.outcome === 'completed')
    expect(completed).toMatchObject({ jobs: 2, filamentUsed: 3000, printTime: 300 })
  })

  it('returns nothing for an empty population', () => {
    expect(outcomeBreakdown([])).toEqual([])
  })

  it('keeps a fixed outcome order regardless of arrival order', () => {
    const jobs = [
      job({ outcome: 'error' }),
      job({ outcome: 'completed' }),
      job({ outcome: 'cancelled' }),
    ]

    expect(outcomeBreakdown(jobs).map((entry) => entry.outcome)).toEqual([
      'completed',
      'cancelled',
      'error',
    ])
  })
})

describe('outcomeMeasureValue', () => {
  it('reads the field the measure names', () => {
    const entry = { outcome: 'completed' as const, jobs: 4, filamentUsed: 5000, printTime: 900 }
    expect(outcomeMeasureValue(entry, 'jobs')).toBe(4)
    expect(outcomeMeasureValue(entry, 'filament')).toBe(5000)
    expect(outcomeMeasureValue(entry, 'time')).toBe(900)
  })
})

describe('bucketGranularityFor', () => {
  it('gets finer as the period gets shorter', () => {
    expect(bucketGranularityFor('30d')).toBe('day')
    expect(bucketGranularityFor('90d')).toBe('week')
    expect(bucketGranularityFor('12m')).toBe('month')
    expect(bucketGranularityFor('all')).toBe('month')
  })
})

describe('historyTrend', () => {
  it('produces buckets for an empty period rather than an empty array', () => {
    const now = Math.floor(new Date(2026, 6, 15, 12, 0, 0).getTime() / 1000)
    const buckets = historyTrend([], { period: '30d', now })
    expect(buckets.length).toBeGreaterThan(0)
    expect(
      buckets.every((bucket) => bucket.completedJobs === 0 && bucket.notCompletedJobs === 0),
    ).toBe(true)
  })

  it('leaves a gap the printer sat idle as empty buckets, not skipped', () => {
    const now = Math.floor(new Date(2026, 6, 15, 12, 0, 0).getTime() / 1000)
    const longAgo = Math.floor(new Date(2026, 5, 20, 9, 0, 0).getTime() / 1000)
    const recent = Math.floor(new Date(2026, 6, 14, 9, 0, 0).getTime() / 1000)
    const buckets = historyTrend([job({ startedAt: longAgo }), job({ startedAt: recent })], {
      period: '30d',
      now,
    })

    const withJobs = buckets.filter((bucket) => bucket.completedJobs > 0)
    expect(withJobs).toHaveLength(2)
    // At least one bucket between the two job dates has nothing in it.
    const emptyBetween = buckets.filter(
      (bucket) => bucket.start > longAgo && bucket.end <= recent && bucket.completedJobs === 0,
    )
    expect(emptyBetween.length).toBeGreaterThan(0)
  })

  it('puts a job just before local midnight in that day, not the next', () => {
    const now = Math.floor(new Date(2026, 6, 15, 12, 0, 0).getTime() / 1000)
    const lateInDay = new Date(2026, 6, 10, 23, 59, 0)
    const startedAt = Math.floor(lateInDay.getTime() / 1000)
    const buckets = historyTrend([job({ startedAt })], { period: '30d', now })

    const containing = buckets.find((bucket) => startedAt >= bucket.start && startedAt < bucket.end)
    expect(containing).toBeDefined()
    const bucketStartDate = new Date((containing as (typeof buckets)[number]).start * 1000)
    expect(bucketStartDate.getDate()).toBe(lateInDay.getDate())
    expect(bucketStartDate.getHours()).toBe(0)
  })

  it('splits completed from everything else, and sums measures separately', () => {
    const now = Math.floor(new Date(2026, 6, 15, 12, 0, 0).getTime() / 1000)
    const today = Math.floor(new Date(2026, 6, 15, 9, 0, 0).getTime() / 1000)
    const buckets = historyTrend(
      [
        job({ startedAt: today, outcome: 'completed', filamentUsed: 100, printDuration: 10 }),
        job({ startedAt: today, outcome: 'cancelled', filamentUsed: 20, printDuration: 5 }),
      ],
      { period: '30d', now },
    )

    const bucket = buckets.find((candidate) => today >= candidate.start && today < candidate.end)
    expect(bucket).toMatchObject({
      completedJobs: 1,
      notCompletedJobs: 1,
      completedFilament: 100,
      notCompletedFilament: 20,
      completedTime: 10,
      notCompletedTime: 5,
    })
  })

  it('never produces a runaway bucket count from a corrupt zero timestamp', () => {
    const now = Math.floor(new Date(2026, 6, 15, 12, 0, 0).getTime() / 1000)
    const buckets = historyTrend([job({ startedAt: 0 }), job({ startedAt: now })], {
      period: 'all',
      now,
    })

    expect(buckets.length).toBeLessThanOrEqual(500)
  })
})

describe('lengthDistribution', () => {
  it('excludes cancelled jobs from the length distribution', () => {
    const bins = lengthDistribution([
      job({ outcome: 'completed', printDuration: 100 }),
      job({ outcome: 'cancelled', printDuration: 99999 }),
    ])

    const totalJobs = bins.reduce((sum, bin) => sum + bin.jobs, 0)
    expect(totalJobs).toBe(1)
  })

  it('returns nothing for no completed jobs', () => {
    expect(lengthDistribution([job({ outcome: 'cancelled' })])).toEqual([])
  })

  it('collapses to one bin when every job is the same length, without a zero-width bin', () => {
    const bins = lengthDistribution([
      job({ printDuration: 3600 }),
      job({ printDuration: 3600 }),
      job({ printDuration: 3600 }),
    ])

    expect(bins).toHaveLength(1)
    expect(bins[0]).toMatchObject({ jobs: 3, upperBound: null })
  })

  it('covers every job across contiguous, non-overlapping bins', () => {
    const durations = [100, 400, 900, 1600, 2500, 3600, 4900, 6400, 8100, 10000]
    const bins = lengthDistribution(durations.map((printDuration) => job({ printDuration })))

    const totalJobs = bins.reduce((sum, bin) => sum + bin.jobs, 0)
    expect(totalJobs).toBe(durations.length)
    expect(bins[0]?.lowerBound).toBe(100)
    expect(bins[bins.length - 1]?.upperBound).toBeNull()
    for (let index = 1; index < bins.length; index += 1) {
      expect(bins[index]?.lowerBound).toBe(bins[index - 1]?.upperBound)
    }
  })
})
