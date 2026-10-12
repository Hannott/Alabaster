import { computed, type ComputedRef } from 'vue'

import { useProcedureContext } from '@/composables/useProcedureContext'
import {
  initialProcedureValues,
  procedureById,
  type ProcedureId,
} from '@/features/calibration/procedures'
import { useCalibrationStore } from '@/stores/calibration'
import type { LevelingMethod } from '@/stores/printerConfig'

/** The registry entry each of the Movement card's levelling methods is. */
export const levelingProcedureIds: Record<LevelingMethod, ProcedureId> = {
  quadGantryLevel: 'quadGantryLevel',
  zTilt: 'zTilt',
  screwsTiltAdjust: 'screwsTilt',
  bedScrews: 'bedScrews',
  deltaCalibrate: 'deltaCalibrate',
}

/**
 * A dashboard shortcut's way into the calibration store: Level bed,
 * Calibrate Z, Calibrate mesh and a heater model all run the registry entry
 * the bench runs, so a run started from a card is logged, parsed and gated
 * exactly as one started from Calibration — and the one `activeRun` is what
 * both surfaces refuse a second run on. A shortcut that sent its own G-code
 * was a run the bench could neither see nor record, and a second one the
 * bench could start over it.
 */
export function useCalibrationRun(): {
  /** A procedure is running, from whichever surface started it. */
  busy: ComputedRef<boolean>
  isRunning: (id: ProcedureId) => boolean
  run: (id: ProcedureId, values?: Record<string, string>) => Promise<boolean>
} {
  const calibration = useCalibrationStore()
  const context = useProcedureContext()

  const busy = computed(() => calibration.activeRun !== null)

  function isRunning(id: ProcedureId): boolean {
    return calibration.activeRun?.procedureId === id
  }

  function run(id: ProcedureId, values: Record<string, string> = {}): Promise<boolean> {
    const procedure = procedureById(id)
    if (!procedure) return Promise.resolve(false)
    return calibration.run(
      procedure,
      { ...initialProcedureValues(procedure, context.value), ...values },
      context.value,
    )
  }

  return { busy, isRunning, run }
}
