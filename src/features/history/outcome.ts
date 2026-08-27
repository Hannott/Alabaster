/**
 * Which icon states an outcome, in one place.
 *
 * Three surfaces make this claim about the same data — the aggregate outcome
 * table, a row in the job list, and the detail pane a row opens — and the
 * History contract in `docs/design/interface-standards.md` requires them to
 * visibly agree rather than merely happen to match. They share the mapping
 * rather than the markup: the pill itself is a handful of elements repeated
 * per surface on purpose, because the job list renders one per row and a
 * component instance per row is a cost the list cannot afford, while the
 * icon-per-outcome decision is a single fact that must not drift.
 */

import type { HistoryOutcome } from '@/features/history/statistics'

export type HistoryOutcomeIcon = 'check' | 'close' | 'help' | 'warning'

export function historyOutcomeIcon(outcome: HistoryOutcome): HistoryOutcomeIcon {
  switch (outcome) {
    case 'completed':
      return 'check'
    case 'cancelled':
      return 'close'
    case 'unknown':
      return 'help'
    default:
      return 'warning'
  }
}
