/**
 * The geometry behind Movement's Z axis slider: where a height falls on a
 * vertical picture of the Z travel. The one-axis sibling of `bedPlan.ts`, and
 * for the same reason kept pure and free of Vue — a flipped axis here draws
 * the gantry rising as the nozzle descends, which looks plausible right up
 * until someone reads it.
 */

export interface ZExtents {
  minimum: number
  maximum: number
  /** Travel span, so callers never repeat `maximum - minimum`. */
  span: number
}

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * The travel the printer has actually reported, or null.
 *
 * Null rather than a default, for the same reason `bedExtents` is: a track
 * drawn to a guessed travel height would put the nozzle marker somewhere
 * plausible and wrong, and a drag on it would command a move to a height that
 * was never on this machine.
 */
export function zExtents(minimum: number | null, maximum: number | null): ZExtents | null {
  const min = finite(minimum)
  const max = finite(maximum)
  if (min === null || max === null) return null
  const span = max - min
  if (span <= 0) return null
  return { minimum: min, maximum: max, span }
}

/**
 * Where a height falls on the track, as a fraction from the top.
 *
 * The top is the axis's own maximum, mirroring the gantry rather than the
 * arbitrary top-left a screen coordinate defaults to: Z grows as the nozzle
 * rises away from the bed, and so does the marker.
 *
 * Deliberately not clamped, for the same reason `planPoint` is not: the
 * toolhead can genuinely sit outside the reported travel, and pinning the
 * marker to the end of the track would report it as being somewhere it is
 * not.
 */
export function zFraction(value: number, extents: ZExtents): number {
  return 1 - (value - extents.minimum) / extents.span
}

/**
 * The height a point on the track stands for — the inverse of `zFraction`,
 * and clamped where that one is not, for the same reason `planCoordinate` is:
 * this is read back out of a hover or a drag, and a pointer a pixel past the
 * end of the track must not ask for a height past the travel limits.
 */
export function zValue(fraction: number, extents: ZExtents): number {
  const bounded = Math.min(1, Math.max(0, fraction))
  return extents.maximum - bounded * extents.span
}
