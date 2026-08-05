/**
 * The arithmetic behind a maintenance interval's due/overdue state, with no
 * Vue and no DOM — kept apart from the store and the card for the same reason
 * `statistics.ts` is kept apart from `HistoryView.vue`.
 */

export type MaintenanceIntervalKind = 'printtime' | 'filament' | 'date'

export interface MaintenanceIntervalBaseline {
  kind: MaintenanceIntervalKind
  /** Hours for `printtime`, metres for `filament`, days for `date` — the unit the value was entered in. */
  value: number
  /** Lifetime print-time seconds at the moment this interval was last performed. */
  baselinePrintTime: number
  /** Lifetime filament millimetres at the moment this interval was last performed. */
  baselineFilament: number
  /** Unix seconds at the moment this interval was last performed. */
  baselineDate: number
}

export interface MaintenanceTotals {
  printTime: number
  filamentUsed: number
}

export type MaintenanceStatus = 'ok' | 'due' | 'overdue' | 'needsBaseline'

export interface MaintenanceIntervalResult {
  status: MaintenanceStatus
  /** Fraction of the interval elapsed; keeps climbing past 1 once overdue. */
  progress: number
}

/** How close to the interval's edge counts as "due soon" rather than merely "ok". */
const dueSoonThreshold = 0.85

/**
 * Whether the printer's lifetime totals have fallen below this interval's own
 * baseline — the one signal `server.history.reset_totals` leaves behind, since
 * nothing else marks that it ran. A regressed interval reports `needsBaseline`
 * rather than a number of hours until due, because there is no honest number
 * to report: the baseline it would be measured against no longer describes
 * this printer's history.
 */
function hasRegressed(interval: MaintenanceIntervalBaseline, totals: MaintenanceTotals): boolean {
  if (interval.kind === 'printtime') return totals.printTime < interval.baselinePrintTime
  if (interval.kind === 'filament') return totals.filamentUsed < interval.baselineFilament
  return false
}

export function maintenanceIntervalState(
  interval: MaintenanceIntervalBaseline,
  totals: MaintenanceTotals,
  now: number,
): MaintenanceIntervalResult {
  if (hasRegressed(interval, totals)) return { status: 'needsBaseline', progress: 0 }

  let elapsed: number
  let span: number
  if (interval.kind === 'printtime') {
    elapsed = totals.printTime - interval.baselinePrintTime
    span = interval.value * 3600
  } else if (interval.kind === 'filament') {
    elapsed = totals.filamentUsed - interval.baselineFilament
    span = interval.value * 1000
  } else {
    elapsed = now - interval.baselineDate
    span = interval.value * 86400
  }

  if (span <= 0) return { status: 'ok', progress: 0 }
  const progress = elapsed / span
  if (progress >= 1) return { status: 'overdue', progress }
  if (progress >= dueSoonThreshold) return { status: 'due', progress }
  return { status: 'ok', progress }
}
