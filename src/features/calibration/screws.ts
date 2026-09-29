/**
 * Bed screws as Klipper's `screws_tilt_adjust` reports them, and where each
 * one sits on the bed.
 *
 * The status object carries every screw's height, turn direction and turn
 * amount, keyed `screw1`, `screw2`, … in the order the config lists them —
 * and nothing else: the coordinates and the names live in the config
 * section, keyed the same way. Reading both together is what lets a result
 * be drawn as the bed rather than listed as text.
 *
 * Kept free of Vue so the placement can be tested against plain screws.
 */

export type ScrewTurn = 'CW' | 'CCW'

/** One screw's result, with the config's coordinates and name joined on. */
export interface ScrewReading {
  key: string
  name: string
  x: number
  y: number
  z: number
  /** Null for the base screw, which everything else is measured against. */
  sign: ScrewTurn | null
  /** Klipper's own "HH:MM" of full turns and minutes; "00:00" for the base. */
  adjust: string
  isBase: boolean
  /** The turn as minutes, for judging whether a screw is close enough. */
  minutes: number
}

/** What `screws_tilt_adjust.get_status` answers, as the store reads it. */
export interface ScrewsTiltStatus {
  error: boolean
  maxDeviation: number | null
  results: Readonly<Record<string, { z: number; sign: ScrewTurn; adjust: string; isBase: boolean }>>
}

/** A screw the config names, before any result exists for it. */
export interface ConfiguredScrew {
  key: string
  name: string
  x: number
  y: number
}

function readPair(value: unknown): [number, number] | null {
  if (typeof value === 'string') {
    const parts = value.split(',').map((part) => Number(part.trim()))
    return parts.length === 2 && parts.every(Number.isFinite) ? [parts[0]!, parts[1]!] : null
  }
  if (Array.isArray(value) && value.length === 2) {
    const [x, y] = value.map(Number)
    return Number.isFinite(x) && Number.isFinite(y) ? [x!, y!] : null
  }
  return null
}

/**
 * The screws a `[screws_tilt_adjust]` section lists, `screw1` onwards until
 * the first gap, as `screws_tilt_adjust.py` reads them. The name is the
 * config's own, or Klipper's "screw at x,y" where none was given.
 */
export function configuredScrews(settings: Record<string, unknown> | null): ConfiguredScrew[] {
  if (settings === null) return []
  const screws: ConfiguredScrew[] = []
  for (let index = 1; index < 100; index += 1) {
    const key = `screw${index}`
    const pair = readPair(settings[key])
    if (pair === null) break
    const named = settings[`${key}_name`]
    screws.push({
      key,
      name:
        typeof named === 'string' && named.trim() !== ''
          ? named.trim()
          : `screw at ${pair[0].toFixed(3)},${pair[1].toFixed(3)}`,
      x: pair[0],
      y: pair[1],
    })
  }
  return screws
}

/** "HH:MM" as minutes; anything unreadable is treated as no turn. */
export function turnMinutes(adjust: string): number {
  const match = /^(\d+):(\d+)$/.exec(adjust.trim())
  if (!match) return 0
  return Number(match[1]) * 60 + Number(match[2])
}

/** Under this many minutes of turn a screw is level for any practical purpose — Fluidd's figure. */
export const levelWithinMinutes = 6

/**
 * The results joined onto the config's screws. A screw the status reports
 * but the config no longer lists is left out: there is nowhere on the bed to
 * draw it.
 */
export function screwReadings(
  status: ScrewsTiltStatus,
  settings: Record<string, unknown> | null,
): ScrewReading[] {
  return configuredScrews(settings).flatMap((screw) => {
    const result = status.results[screw.key]
    if (!result) return []
    return [
      {
        ...screw,
        z: result.z,
        sign: result.isBase ? null : result.sign,
        adjust: result.adjust,
        isBase: result.isBase,
        minutes: result.isBase ? 0 : turnMinutes(result.adjust),
      },
    ]
  })
}

export interface PlacedScrew<T extends { x: number; y: number }> {
  screw: T
  /** 1-based CSS grid lines. */
  column: number
  row: number
}

export interface ScrewLayout<T extends { x: number; y: number }> {
  columns: number
  rows: number
  cells: PlacedScrew<T>[]
}

/** Screws within this many millimetres of each other share a column or a row. */
const alignmentTolerance = 5

function clusters(values: number[]): number[] {
  const sorted = [...values].sort((left, right) => left - right)
  const centres: number[] = []
  for (const value of sorted) {
    const last = centres[centres.length - 1]
    if (last === undefined || value - last > alignmentTolerance) centres.push(value)
  }
  return centres
}

function clusterIndex(centres: number[], value: number): number {
  let best = 0
  for (const [index, centre] of centres.entries()) {
    if (Math.abs(value - centre) < Math.abs(value - centres[best]!)) best = index
  }
  return best
}

/**
 * Lays screws out as the bed: columns from left to right by X, rows from
 * the rear down to the front by Y, so the grid reads the way the reader
 * stands in front of the machine. Three screws with one at the rear centre
 * take a third column rather than being forced into a square; a bed that
 * lists its screws in any order still draws each in its own corner.
 */
export function placeScrews<T extends { x: number; y: number }>(
  screws: readonly T[],
): ScrewLayout<T> {
  const xCentres = clusters(screws.map((screw) => screw.x))
  const yCentres = clusters(screws.map((screw) => screw.y))
  const rows = yCentres.length
  return {
    columns: xCentres.length,
    rows,
    cells: screws.map((screw) => ({
      screw,
      column: clusterIndex(xCentres, screw.x) + 1,
      row: rows - clusterIndex(yCentres, screw.y),
    })),
  }
}

/**
 * Where a probe procedure should stand: the mesh's `zero_reference_position`,
 * else `safe_z_home`'s point, else the bed's centre — the point the printer
 * itself treats as its reference, before one Alabaster would have to invent.
 * Null only when nothing is known, not even the bed's size.
 */
export function probeReferencePoint(
  settings: (section: string) => Record<string, unknown> | null,
  bed: { minimum: readonly (number | null)[]; maximum: readonly (number | null)[] },
): { x: number; y: number } | null {
  const reference =
    readPair(settings('bed_mesh')?.zero_reference_position) ??
    readPair(settings('safe_z_home')?.home_xy_position)
  if (reference) return { x: reference[0], y: reference[1] }
  const [minX, minY] = bed.minimum
  const [maxX, maxY] = bed.maximum
  if (
    typeof minX !== 'number' ||
    typeof minY !== 'number' ||
    typeof maxX !== 'number' ||
    typeof maxY !== 'number'
  ) {
    return null
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
}
