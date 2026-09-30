import { ref } from 'vue'

import type { ProcedureId } from '@/features/calibration/procedures'
import type { CalibrationStageId } from '@/features/calibration/stages'

/**
 * The Calibration stage and, per stage, the procedure last chosen.
 *
 * Module-level rather than component state, so leaving the page and coming
 * back lands on the calibration that was open instead of the first tab and
 * whatever is due. Held in memory, not storage: it is where the reader was a
 * moment ago, not a preference, and a fresh load choosing what is due is the
 * better start. Both values are resolved against the live lists where they are
 * read, so one naming hardware that has since gone falls back on its own.
 */
const stage = ref<CalibrationStageId>('axes')
const procedures = ref<Partial<Record<CalibrationStageId, ProcedureId>>>({})
/**
 * What the open workspace's values are about, per procedure — the stepper a
 * buzz test moves — so the live column can draw that one. Written by the
 * workspace, which owns the values.
 */
const subjects = ref<Partial<Record<ProcedureId, string>>>({})

/** Back to a first visit's selection; for tests, which share this module's state. */
export function resetCalibrationSelection(): void {
  stage.value = 'axes'
  procedures.value = {}
  subjects.value = {}
}

export function useCalibrationSelection() {
  function procedureFor(id: CalibrationStageId): ProcedureId | null {
    return procedures.value[id] ?? null
  }

  function selectProcedure(id: CalibrationStageId, procedure: ProcedureId): void {
    procedures.value = { ...procedures.value, [id]: procedure }
  }

  function subjectFor(id: ProcedureId): string {
    return subjects.value[id] ?? ''
  }

  function setSubject(id: ProcedureId, subject: string): void {
    if (subjects.value[id] === subject) return
    subjects.value = { ...subjects.value, [id]: subject }
  }

  return { stage, procedureFor, selectProcedure, subjectFor, setSubject }
}
