import type { BedPoint } from '@/features/calibration/bedContext'

/**
 * Coordinates the config holds, recorded by standing the toolhead where they
 * belong rather than by measuring the bed with a ruler: the probe's X and Y
 * offset, and the bed screws the two screw procedures visit.
 *
 * Every recording is the toolhead's position, which is the nozzle's. What the
 * config wants is sometimes the nozzle's and sometimes the probe's, and which
 * one the reader lined up over the mark is theirs to choose — a nozzle tip is
 * easy to sight, an eddy coil inside a shroud is not — so the conversion
 * between the two lives here, in one place, with the probe offset:
 *
 *   probe position = toolhead position + (x_offset, y_offset)
 *
 * Kept free of Vue so the arithmetic is testable on its own.
 */

/** What the reader stood over the mark or the screw. */
export type Reference = 'nozzle' | 'probe'

/** The screw sections, as their procedures name them. */
export type ScrewTarget = 'screwsTilt' | 'bedScrews'

export const screwSections: Readonly<Record<ScrewTarget, string>> = {
  screwsTilt: 'screws_tilt_adjust',
  bedScrews: 'bed_screws',
}

/** Both sections refuse to load with fewer. */
export const minimumScrews = 3

/**
 * Klipper's probe calibration guide: the nozzle stood on a mark, then the probe
 * stood on the same mark. `x_offset = nozzle_x - probe_x`, and the same for Y.
 */
export function probeOffsetFrom(nozzleAt: BedPoint, probeAt: BedPoint): BedPoint {
  return { x: nozzleAt.x - probeAt.x, y: nozzleAt.y - probeAt.y }
}

/**
 * The coordinate a screw section wants for a screw the reader stood `reference`
 * over. `screws_tilt_adjust` wants where to send the nozzle so the probe lands
 * on the screw; `bed_screws` is a paper test, and wants the nozzle over it.
 */
export function screwCoordinate(
  target: ScrewTarget,
  reference: Reference,
  toolhead: BedPoint,
  offset: BedPoint,
): BedPoint {
  const screw =
    reference === 'nozzle' ? toolhead : { x: toolhead.x + offset.x, y: toolhead.y + offset.y }
  return target === 'bedScrews' ? screw : { x: screw.x - offset.x, y: screw.y - offset.y }
}

/**
 * Where on the bed the screw a section coordinate names actually is — the
 * inverse of `screwCoordinate` with the nozzle as the reference.
 * `screws_tilt_adjust` stores where the nozzle goes so the probe lands on the
 * screw, so its screw sits one probe offset away from the stored point.
 */
export function screwOnBed(target: ScrewTarget, coordinate: BedPoint, offset: BedPoint): BedPoint {
  return target === 'bedScrews'
    ? coordinate
    : { x: coordinate.x + offset.x, y: coordinate.y + offset.y }
}

/** Where to send the toolhead so `reference` stands over a point on the bed. */
export function toolheadOver(reference: Reference, point: BedPoint, offset: BedPoint): BedPoint {
  return reference === 'nozzle' ? point : { x: point.x - offset.x, y: point.y - offset.y }
}

/** The point on the bed `reference` is over while the toolhead stands at `toolhead`. */
export function standingOver(reference: Reference, toolhead: BedPoint, offset: BedPoint): BedPoint {
  return reference === 'nozzle' ? toolhead : { x: toolhead.x + offset.x, y: toolhead.y + offset.y }
}

/** The index of the point closest to `at`, or null for an empty list. */
export function nearestIndex(points: readonly BedPoint[], at: BedPoint): number | null {
  let best: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  points.forEach((point, index) => {
    const distance = Math.hypot(point.x - at.x, point.y - at.y)
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  })
  return best
}

export interface Travel {
  minimum: readonly (number | null)[]
  maximum: readonly (number | null)[]
}

/**
 * Whether the nozzle can be sent to a point. A screw coordinate outside the
 * travel is one Klipper refuses with "Move out of range" in the middle of the
 * run — typically a screw near an edge with the probe on the far side.
 */
export function isReachable(point: BedPoint, travel: Travel): boolean {
  const [minX, minY] = travel.minimum
  const [maxX, maxY] = travel.maximum
  if (typeof minX === 'number' && point.x < minX) return false
  if (typeof minY === 'number' && point.y < minY) return false
  if (typeof maxX === 'number' && point.x > maxX) return false
  if (typeof maxY === 'number' && point.y > maxY) return false
  return true
}

/** The nearest point the nozzle can reach, which Klipper's reference says to use instead. */
export function nearestReachable(point: BedPoint, travel: Travel): BedPoint {
  const clamp = (value: number, low: number | null | undefined, high: number | null | undefined) =>
    Math.min(
      Math.max(value, typeof low === 'number' ? low : value),
      typeof high === 'number' ? high : value,
    )
  return {
    x: clamp(point.x, travel.minimum[0], travel.maximum[0]),
    y: clamp(point.y, travel.minimum[1], travel.maximum[1]),
  }
}

/** A coordinate as the config writes it: at most one decimal, the precision a toolhead is jogged to. */
export function coordinateText(value: number): string {
  return String(Number(value.toFixed(1)))
}

export function pointText(point: BedPoint): string {
  return `${coordinateText(point.x)}, ${coordinateText(point.y)}`
}

export interface RecordedScrew {
  point: BedPoint
  name: string
}

export interface ScrewWrite {
  changes: { option: string; value: string }[]
  removes: string[]
}

/**
 * The lines a set of recorded screws writes, in order: `screw1` is the base
 * screw `SCREWS_TILT_CALCULATE` measures the others against. Every option of
 * a screw past the new count goes, since Klipper stops reading at the first
 * missing `screwN` and refuses to start on an option nothing reads. A name
 * left empty removes the old one rather than keeping a name for a different
 * screw.
 */
export function screwWrite(
  target: ScrewTarget,
  screws: readonly RecordedScrew[],
  existing: Record<string, unknown> | null,
): ScrewWrite {
  const changes: { option: string; value: string }[] = []
  const removes: string[] = []
  screws.forEach((screw, index) => {
    const number = index + 1
    changes.push({ option: `screw${number}`, value: pointText(screw.point) })
    const name = screw.name.trim()
    if (name !== '') changes.push({ option: `screw${number}_name`, value: name })
    else if (existing?.[`screw${number}_name`] !== undefined) removes.push(`screw${number}_name`)
  })
  const suffixes = target === 'bedScrews' ? ['', '_name', '_fine_adjust'] : ['', '_name']
  for (let number = screws.length + 1; number < 100; number += 1) {
    const present = suffixes.filter((suffix) => existing?.[`screw${number}${suffix}`] !== undefined)
    if (present.length === 0 && existing?.[`screw${number}`] === undefined) break
    removes.push(...present.map((suffix) => `screw${number}${suffix}`))
  }
  return { changes, removes }
}
