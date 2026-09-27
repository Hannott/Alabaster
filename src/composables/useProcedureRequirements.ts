import { computed, type ComputedRef } from 'vue'

import { probeBedPosition } from '@/features/bedMesh/probeRun'
import type { ProcedureRequirement } from '@/features/calibration/procedures'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'

export type RequirementFix = 'home'

export interface RequirementState {
  requirement: ProcedureRequirement
  met: boolean
  /** The one action that meets it, where there is one to offer. */
  fix: RequirementFix | null
}

/**
 * Whether each thing a procedure can require is true right now. One place, so
 * the readiness band and a procedure's own checklist can never disagree about
 * whether the printer is homed.
 */
export function useProcedureRequirements(): ComputedRef<
  Record<ProcedureRequirement, RequirementState>
> {
  const printer = usePrinterStore()
  const printerConfig = usePrinterConfigStore()

  const homed = computed(() => {
    const axes = printer.motion.homedAxes.toLowerCase()
    return ['x', 'y', 'z'].every((axis) => axes.includes(axis))
  })

  /*
   * `PROBE_ACCURACY` probes wherever the toolhead stands, and the probe tip is
   * not the nozzle: a probe with a real offset can sit past the bed's edge
   * while the nozzle is comfortably inside it. Unknown position or bounds do
   * not block — there is nothing to warn about yet, not evidence of a problem.
   */
  const probeInBed = computed(() => {
    const position = probeBedPosition(printer.toolheadPosition, printerConfig.probeOffset)
    if (!position) return true
    const [minX, minY] = printer.buildVolume.minimum
    const [maxX, maxY] = printer.buildVolume.maximum
    if (
      typeof minX !== 'number' ||
      typeof minY !== 'number' ||
      typeof maxX !== 'number' ||
      typeof maxY !== 'number'
    ) {
      return true
    }
    return position.x >= minX && position.x <= maxX && position.y >= minY && position.y <= maxY
  })

  return computed(() => ({
    homed: { requirement: 'homed', met: homed.value, fix: 'home' },
    notPrinting: { requirement: 'notPrinting', met: !printer.hasActivePrint, fix: null },
    probeInBed: { requirement: 'probeInBed', met: probeInBed.value, fix: null },
  }))
}
