/**
 * What the bed stage's live column draws for the procedure that is open: the
 * probe's samples seen side on, where the probe sits against the nozzle, and
 * the bed from above with the screws, steppers or probe points a levelling
 * procedure works with.
 *
 * Kept free of Vue so the reading and the geometry can be tested against
 * plain lines and plain settings.
 */

import type { ProcedureResultRow } from '@/features/calibration/procedures'

/** A logged run, as far as a summary needs it. */
type LoggedRows = { rows: readonly ProcedureResultRow[] }

/**
 * `probe.py`'s line for every sample. Klipper printed "probe at X,Y is z=Z"
 * for years and now prints "probe: at X,Y bed will contact at z=Z"; both are
 * still in the field.
 */
const samplePattern = /probe:? at ([-\d.]+),([-\d.]+) (?:is|bed will contact at) z=([-\d.]+)/

/** Each probe sample the lines report, in the order they were taken. */
export function probeSamples(lines: readonly string[]): number[] {
  const samples: number[] = []
  for (const line of lines) {
    for (const part of line.split('\n')) {
      const match = samplePattern.exec(part)
      if (!match) continue
      const z = Number(match[3])
      if (Number.isFinite(z)) samples.push(z)
    }
  }
  return samples
}

/** The heights a probe accuracy result reports, where a run's own samples are not at hand. */
export interface ProbeSummary {
  maximum: number
  minimum: number
  average: number | null
  median: number | null
  standardDeviation: number | null
}

function rowNumber(entry: LoggedRows, name: string): number | null {
  const row = entry.rows.find(
    (candidate) => 'key' in candidate.label && candidate.label.key === `calibration.probe.${name}`,
  )
  const value = row === undefined ? NaN : Number(row.after)
  return Number.isFinite(value) ? value : null
}

/** A logged probe accuracy run as its heights, or null for one that found none. */
export function probeSummaryOf(entry: LoggedRows | undefined): ProbeSummary | null {
  if (!entry) return null
  const maximum = rowNumber(entry, 'maximum')
  const minimum = rowNumber(entry, 'minimum')
  if (maximum === null || minimum === null) return null
  return {
    maximum,
    minimum,
    average: rowNumber(entry, 'average'),
    median: rowNumber(entry, 'median'),
    standardDeviation: rowNumber(entry, 'standardDeviation'),
  }
}

/** Samples reduced to what the summary carries, so both draw on one scale. */
export function summarize(samples: readonly number[]): ProbeSummary | null {
  if (samples.length === 0) return null
  const sorted = [...samples].sort((left, right) => left - right)
  const average = samples.reduce((sum, value) => sum + value, 0) / samples.length
  const middle = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
  const variance = samples.reduce((sum, value) => sum + (value - average) ** 2, 0) / samples.length
  return {
    maximum: sorted[sorted.length - 1]!,
    minimum: sorted[0]!,
    average,
    median,
    standardDeviation: Math.sqrt(variance),
  }
}

/**
 * The vertical scale a side view of the samples is drawn on, as a function
 * from a height to a fraction from the top. The spread is stretched to fill
 * the plot — it is a few microns, and drawn at bed scale every sample would
 * be the same line — but never below `floor` millimetres, so a probe that
 * repeats to the micron reads as a tight band rather than as noise blown up
 * to fill the height.
 */
export function sampleScale(
  summary: ProbeSummary,
  floor = 0.01,
): { top: number; bottom: number; at: (z: number) => number } {
  const spread = Math.max(summary.maximum - summary.minimum, floor)
  const centre = (summary.maximum + summary.minimum) / 2
  const top = centre + spread * 0.6
  const bottom = centre - spread * 0.6
  return { top, bottom, at: (z) => (top - z) / (top - bottom) }
}

/** The procedures whose live column is the bed from above. */
export const layoutProcedures = ['screwsTilt', 'bedScrews', 'zTilt', 'quadGantryLevel'] as const

export type LayoutProcedure = (typeof layoutProcedures)[number]

export interface BedPoint {
  x: number
  y: number
}

function readPoint(value: unknown): BedPoint | null {
  if (typeof value === 'string') {
    const parts = value.split(',').map((part) => Number(part.trim()))
    return parts.length === 2 && parts.every(Number.isFinite)
      ? { x: parts[0]!, y: parts[1]! }
      : null
  }
  if (Array.isArray(value) && value.length === 2) {
    const [x, y] = value.map(Number)
    return Number.isFinite(x) && Number.isFinite(y) ? { x: x!, y: y! } : null
  }
  return null
}

/**
 * Where the probe is while the nozzle stands at `nozzle`. `screws_tilt_adjust`
 * screws and `z_tilt` and `quad_gantry_level` points are nozzle coordinates,
 * chosen so the probe lands on the thing measured, so a picture of what is
 * measured draws them here. Drawn at the coordinate itself, a screw sits one
 * probe offset away from the screw on the bed.
 */
export function atProbe(nozzle: BedPoint, offset: BedPoint): BedPoint {
  return { x: nozzle.x + offset.x, y: nozzle.y + offset.y }
}

/** A multi-line list of X, Y pairs as Klipper's config parses it, or as the raw text. */
export function readPoints(value: unknown): BedPoint[] {
  if (Array.isArray(value)) {
    const single = readPoint(value)
    if (single && !Array.isArray(value[0])) return [single]
    return value.flatMap((entry) => {
      const point = readPoint(entry)
      return point ? [point] : []
    })
  }
  if (typeof value === 'string') {
    return value.split('\n').flatMap((line) => {
      const point = readPoint(line)
      return point ? [point] : []
    })
  }
  return []
}

/** What a levelling procedure moves and where it probes, from its section. */
export interface LevelingLayout {
  /** Where each Z stepper lifts the bed or gantry, in the order the config lists them. */
  steppers: BedPoint[]
  /** Where the probe is sent, in the order it is sent there. */
  points: BedPoint[]
}

/**
 * `z_tilt`'s `z_positions` are the pivots themselves. `quad_gantry_level`
 * names only two opposite gantry corners, and its four steppers are the
 * corners of that rectangle in Klipper's own order: front left, rear left,
 * rear right, front right.
 */
export function levelingLayout(
  method: 'zTilt' | 'quadGantryLevel',
  settings: Record<string, unknown> | null,
): LevelingLayout | null {
  if (settings === null) return null
  const points = readPoints(settings.points)
  if (method === 'zTilt') return { steppers: readPoints(settings.z_positions), points }
  const corners = readPoints(settings.gantry_corners)
  if (corners.length !== 2) return { steppers: [], points }
  const [first, second] = corners as [BedPoint, BedPoint]
  const left = Math.min(first.x, second.x)
  const right = Math.max(first.x, second.x)
  const front = Math.min(first.y, second.y)
  const rear = Math.max(first.y, second.y)
  return {
    steppers: [
      { x: left, y: front },
      { x: left, y: rear },
      { x: right, y: rear },
      { x: right, y: front },
    ],
    points,
  }
}

export interface PlanBox {
  minimumX: number
  minimumY: number
  width: number
  depth: number
}

/**
 * The area a top-down picture spans: the bed's travel, grown to take in
 * anything drawn outside it — a `z_tilt` pivot sits off the bed on most
 * machines — plus a margin so a marker on the edge is not cut in half.
 */
export function planBox(
  bed: { minimum: readonly (number | null)[]; maximum: readonly (number | null)[] },
  points: readonly BedPoint[],
): PlanBox | null {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const [minX, minY] = bed.minimum
  const [maxX, maxY] = bed.maximum
  if (typeof minX === 'number' && typeof maxX === 'number') xs.push(minX, maxX)
  if (typeof minY === 'number' && typeof maxY === 'number') ys.push(minY, maxY)
  if (xs.length === 0 || ys.length === 0) return null
  const left = Math.min(...xs)
  const right = Math.max(...xs)
  const front = Math.min(...ys)
  const rear = Math.max(...ys)
  const margin = Math.max(right - left, rear - front, 1) * 0.06
  return {
    minimumX: left - margin,
    minimumY: front - margin,
    width: right - left + margin * 2,
    depth: rear - front + margin * 2,
  }
}

/** A bed coordinate on the plan, in the plan's own units, rear at the top. */
export function onPlan(point: BedPoint, box: PlanBox): BedPoint {
  return { x: point.x - box.minimumX, y: box.depth - (point.y - box.minimumY) }
}
