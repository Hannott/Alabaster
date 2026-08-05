/**
 * "Will this file actually work with what is loaded right now" — asked once,
 * shared by every card that answers it: Spool for the weight a job needs
 * against what is left on the reel, Print Files and Print's own "up next"
 * preview for the same question about whichever file is being looked at or
 * queued next. One set of facts, so the answer never disagrees between cards
 * — see the dashboard module skill's rule against presenting a derived value
 * as fact when the derivation can be wrong, applied here to keep the
 * derivation itself in one place.
 *
 * Kept pure and Vue-free so it can be tested without mounting anything.
 */

/**
 * How much filament finishing the current print still needs: the job's
 * whole-job total, discounted by how much of it printing has already consumed
 * via extrusion progress. Comparing the unadjusted whole-job total against an
 * already-reduced spool weight would flag a print that started with plenty
 * and is proceeding exactly as expected as short — see `filamentProgress` on
 * `printer.ts`, whose extrusion-based fraction is 0 whenever the metadata
 * never reported `filament_total`, safely falling back to the full total
 * rather than reading as "nothing left to print."
 */
export function remainingFilamentNeeded(
  totalWeight: number | null | undefined,
  filamentProgress: number,
): number | null {
  if (typeof totalWeight !== 'number' || !Number.isFinite(totalWeight)) return null
  return totalWeight * (1 - filamentProgress)
}

export type FilamentFitStatus = 'fits' | 'short' | 'unknown'

/**
 * Whether the filament left on a spool covers what a file needs.
 * `'unknown'` rather than assuming a fit whenever either side is unreported —
 * a slicer that never wrote `filament_weight_total`, or a spool Spoolman
 * cannot derive a remaining weight for, must not be read as "enough".
 */
export function filamentFitStatus(
  neededWeight: number | null | undefined,
  remainingWeight: number | null | undefined,
): FilamentFitStatus {
  if (typeof neededWeight !== 'number' || !Number.isFinite(neededWeight)) return 'unknown'
  if (typeof remainingWeight !== 'number' || !Number.isFinite(remainingWeight)) return 'unknown'
  return neededWeight <= remainingWeight ? 'fits' : 'short'
}

/** Past this many degrees apart, a loaded filament and a file disagree enough to say so. */
export const filamentTemperatureMismatchThreshold = 15

export interface FilamentTemperatureMismatch {
  /** What Spoolman recorded for this filament — its own recommendation, not a live reading. */
  filamentExtruderTemp: number
  /** What the file's first layer actually asks Klipper to heat to. */
  fileExtruderTemp: number
}

/**
 * Only the extruder temperature is compared, not the bed: a mismatched bed
 * temperature costs a worse first layer, but a mismatched hotend temperature
 * can under-melt filament into a grind or jam, or scorch a material rated
 * far cooler than the file asks for — the one worth interrupting the reader
 * for.
 */
export function filamentTemperatureMismatch(
  filamentExtruderTemp: number | null | undefined,
  fileExtruderTemp: number | null | undefined,
): FilamentTemperatureMismatch | null {
  if (typeof filamentExtruderTemp !== 'number' || !Number.isFinite(filamentExtruderTemp)) {
    return null
  }
  if (typeof fileExtruderTemp !== 'number' || !Number.isFinite(fileExtruderTemp)) return null
  const delta = Math.abs(filamentExtruderTemp - fileExtruderTemp)
  return delta > filamentTemperatureMismatchThreshold
    ? { filamentExtruderTemp, fileExtruderTemp }
    : null
}
