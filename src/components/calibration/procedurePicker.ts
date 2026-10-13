import type { ComputedRef, InjectionKey } from 'vue'

import type { ProcedureId } from '@/features/calibration/procedures'

/**
 * The stage's procedure choice, handed by `CalibrationBench` to whichever
 * workspace it renders, so the workspace's title can be the picker below the
 * bench's middle width. Injected rather than passed: the workspace is the
 * generic one or any of the guided panels, and none of them has a reason to
 * know the stage's list beyond showing it there.
 */
export interface ProcedurePicker {
  options: ComputedRef<readonly { value: ProcedureId; label: string }[]>
  selected: ComputedRef<ProcedureId | null>
  select: (id: ProcedureId) => void
}

export const procedurePickerKey: InjectionKey<ProcedurePicker> = Symbol('procedurePicker')
