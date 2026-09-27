/**
 * The corrected `rotation_distance` from one measurement: filament marked
 * `marked` mm above the extruder, `requested` mm extruded, `remaining` mm left
 * between the mark and the extruder afterwards.
 *
 * Klipper's documented formula, `rotation_distance * actual / requested`: a
 * larger rotation distance moves more filament per revolution, so an extruder
 * that under-extruded — moved less than asked — needs a smaller one.
 *
 * Null for a measurement that cannot be right: no movement at all, or more
 * movement than the mark allowed for.
 */
export function rotationDistanceFrom(
  current: number,
  requested: number,
  marked: number,
  remaining: number,
): number | null {
  if (![current, requested, marked, remaining].every(Number.isFinite)) return null
  if (current <= 0 || requested <= 0 || remaining < 0 || remaining >= marked) return null
  const actual = marked - remaining
  if (actual <= 0 || actual > marked) return null
  return (current * actual) / requested
}
