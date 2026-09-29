import type {
  ProcedureId,
  ProcedureResultRow,
  ProcedureText,
} from '@/features/calibration/procedures'

/**
 * What a procedure's log can be drawn as: the few results whose movement
 * across runs answers a question the single number cannot — a probe's range
 * creeping up, a mesh's range following the seasons, PID constants drifting
 * since the last tune. Pure over log entries, so it can be tested against
 * the entries a failed run or an older log format leaves without rows.
 */

/** The part of a log entry a trend reads; the store's entries satisfy it. */
export interface TrendEntry {
  values: Record<string, string>
  rows: readonly ProcedureResultRow[]
  outcome: string
}

export interface TrendSeries {
  label: ProcedureText
  /** One per run that reported the value, oldest first. */
  values: number[]
}

interface TrendDefinition {
  rows: readonly ProcedureText[]
  /**
   * The run value that has to match the newest run's for an entry to count:
   * a PID series is one heater's, and the log holds every heater's runs.
   */
  sameAs?: string
}

const trends: Partial<Record<ProcedureId, TrendDefinition>> = {
  probeAccuracy: {
    rows: [{ key: 'calibration.probe.range' }, { key: 'calibration.probe.standardDeviation' }],
  },
  bedMesh: { rows: [{ key: 'calibration.result.range' }] },
  heaterModel: {
    rows: [{ literal: 'pid_Kp' }, { literal: 'pid_Ki' }, { literal: 'pid_Kd' }],
    sameAs: 'HEATER',
  },
}

/** Below this many runs a line says nothing a reader should take from it. */
export const minimumTrendRuns = 3

function sameText(a: ProcedureText, b: ProcedureText): boolean {
  if ('literal' in a) return 'literal' in b && a.literal === b.literal
  return 'key' in b && a.key === b.key
}

/** The number a result row starts with; units and the like follow it. */
function numberOf(value: string): number | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)/.exec(value)
  return match ? Number(match[1]) : null
}

export function trendSeries(id: ProcedureId, entries: readonly TrendEntry[]): TrendSeries[] {
  const definition = trends[id]
  if (!definition) return []
  const newest = entries.at(-1)
  const counted = entries.filter((entry) => {
    if (entry.outcome === 'failed') return false
    if (definition.sameAs === undefined || newest === undefined) return true
    return entry.values[definition.sameAs] === newest.values[definition.sameAs]
  })
  return definition.rows
    .map((label) => ({
      label,
      values: counted.flatMap((entry) => {
        const row = entry.rows.find((candidate) => sameText(candidate.label, label))
        const value = row === undefined ? null : numberOf(row.after)
        return value === null ? [] : [value]
      }),
    }))
    .filter((series) => series.values.length >= minimumTrendRuns)
}

/**
 * The polyline for a series, spread across the box with the first run at the
 * left; a flat series draws through the middle rather than dividing by zero.
 */
export function sparklinePoints(
  values: readonly number[],
  width: number,
  height: number,
  inset: number,
): { x: number; y: number }[] {
  if (values.length === 0) return []
  const low = Math.min(...values)
  const high = Math.max(...values)
  const span = high - low
  const step = values.length === 1 ? 0 : (width - inset * 2) / (values.length - 1)
  return values.map((value, index) => ({
    x: round(inset + step * index),
    y: round(
      span === 0 ? height / 2 : height - inset - ((value - low) / span) * (height - inset * 2),
    ),
  }))
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}
