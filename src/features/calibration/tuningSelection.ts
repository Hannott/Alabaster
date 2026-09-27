/**
 * Which Shake&Tune graph the reading pane shows, and which one it is compared
 * against.
 *
 * Both are resolved against the live result list rather than trusted, for the
 * same reason `resolveCalibrationStage` is: the list is a directory listing and
 * the directory changes under the page — a run writes a new graph, somebody
 * deletes an old one over SSH, a different printer is selected. A pane pointing
 * at a path that no longer exists would render a broken image; falling back to
 * the newest result keeps something worth reading on screen instead.
 *
 * Kept free of Vue so the rules are testable against plain arrays.
 */

export interface TuningResultRef {
  path: string
  /** Seconds since the epoch, as Moonraker reports a file's `modified`. */
  modified: number
}

export function newestTuningResult<T extends TuningResultRef>(results: readonly T[]): T | null {
  let newest: T | null = null
  for (const result of results) {
    if (newest === null || result.modified > newest.modified) newest = result
  }
  return newest
}

/** The requested graph while it still exists, otherwise the newest one. */
export function resolveTuningSelection<T extends TuningResultRef>(
  requested: string | null,
  results: readonly T[],
): T | null {
  return results.find((result) => result.path === requested) ?? newestTuningResult(results)
}

/**
 * The comparison graph, or nothing.
 *
 * Unlike the primary selection it never falls back: a comparison is a choice
 * the reader made, and silently substituting another graph for one that
 * disappeared would put two graphs side by side that nobody chose to compare.
 * A graph is never compared against itself either — that renders the same
 * image twice and reads as a layout fault.
 */
export function resolveTuningComparison<T extends TuningResultRef>(
  requested: string | null,
  results: readonly T[],
  primary: T | null,
): T | null {
  if (requested === null || requested === primary?.path) return null
  return results.find((result) => result.path === requested) ?? null
}
