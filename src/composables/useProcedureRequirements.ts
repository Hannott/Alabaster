import { computed, type ComputedRef } from 'vue'

import { useProcedureContext } from '@/composables/useProcedureContext'
import { probeBedPosition } from '@/features/bedMesh/probeRun'
import {
  initialProcedureValues,
  procedureById,
  type ProcedureRequirement,
} from '@/features/calibration/procedures'
import { probeReferencePoint } from '@/features/calibration/screws'
import { useBedMeshStore } from '@/stores/bedMesh'
import { useCalibrationStore } from '@/stores/calibration'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'

export type RequirementFixId = 'home' | 'moveOverBed' | 'checkAccelerometer' | 'zeroForZ'

/** The one action that meets a requirement, and whether it is under way. */
export interface RequirementFix {
  id: RequirementFixId
  pending: boolean
  run: () => Promise<boolean>
}

export interface RequirementState {
  requirement: ProcedureRequirement
  met: boolean
  /** The one action that meets it, where there is one to offer. */
  fix: RequirementFix | null
}

/** Clearance for a move over the bed, so a nozzle parked low is lifted before it travels. */
const referenceClearanceZ = 10

/**
 * Whether each thing a procedure can require is true right now, and the
 * action that makes it so. One place, so the readiness band and a
 * procedure's own checklist can never disagree about whether the printer is
 * homed — and one place for every fix, so a fix runs the same command from
 * whichever row offered it.
 */
export function useProcedureRequirements(): ComputedRef<
  Record<ProcedureRequirement, RequirementState>
> {
  const bedMesh = useBedMeshStore()
  const calibration = useCalibrationStore()
  const context = useProcedureContext()
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

  /**
   * The printer's own reference point: the mesh's zero reference, else the
   * safe-Z home, else the bed's centre. Nowhere to send the toolhead is no
   * fix rather than a fix that does nothing.
   */
  const referencePoint = computed(() =>
    probeReferencePoint(context.value.settings, printer.buildVolume),
  )

  async function moveOverBed(): Promise<boolean> {
    const target = referencePoint.value
    if (target === null) return false
    const z = printer.toolheadPosition[2]
    return printer.moveTo({
      x: target.x,
      y: target.y,
      z: z === null ? referenceClearanceZ : Math.max(z, referenceClearanceZ),
    })
  }

  /*
   * Answered once this session, and answered well: a query that failed is
   * the evidence this requirement exists to surface. Before any query, a
   * configured `[resonance_tester]` is taken at its word, since the printer
   * was set up around the chip and asking every reader to prove it first
   * would be a step nobody asked for.
   */
  const accelerometer = computed(() => {
    const query = calibration.runFor('accelerometerQuery')
    if (query && !query.running && query.succeeded !== null) return query.succeeded
    return context.value.hasSection('resonance_tester')
  })

  async function checkAccelerometer(): Promise<boolean> {
    const procedure = procedureById('accelerometerQuery')
    if (!procedure) return false
    return calibration.run(
      procedure,
      initialProcedureValues(procedure, context.value),
      context.value,
    )
  }

  /*
   * What a Z calibration should measure from: no mesh applied and no Z
   * offset, so the number it finds is the probe's alone. Both are Klipper's
   * own state, read from `bed_mesh` and `gcode_move`.
   */
  const zeroedForZ = computed(
    () => bedMesh.profileName === '' && (printer.motion.homingOrigin[2] ?? 0) === 0,
  )

  function zeroForZ(): Promise<boolean> {
    return printer.sendGcode('SET_GCODE_OFFSET Z=0\nBED_MESH_CLEAR', 'calibration')
  }

  return computed(() => ({
    homed: {
      requirement: 'homed',
      met: homed.value,
      fix: { id: 'home', pending: printer.pendingCommands.home, run: () => printer.homeAxes() },
    },
    notPrinting: { requirement: 'notPrinting', met: !printer.hasActivePrint, fix: null },
    probeInBed: {
      requirement: 'probeInBed',
      met: probeInBed.value,
      fix:
        referencePoint.value === null
          ? null
          : { id: 'moveOverBed', pending: printer.pendingCommands.move, run: moveOverBed },
    },
    accelerometer: {
      requirement: 'accelerometer',
      met: accelerometer.value,
      fix: {
        id: 'checkAccelerometer',
        pending: calibration.activeRun?.procedureId === 'accelerometerQuery',
        run: checkAccelerometer,
      },
    },
    zeroedForZ: {
      requirement: 'zeroedForZ',
      met: zeroedForZ.value,
      fix: { id: 'zeroForZ', pending: printer.pendingCommands.calibration, run: zeroForZ },
    },
  }))
}
