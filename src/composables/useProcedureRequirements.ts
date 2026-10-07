import { computed, type ComputedRef } from 'vue'

import { useProcedureContext } from '@/composables/useProcedureContext'
import { probeBedPosition } from '@/features/bedMesh/probeRun'
import {
  accelerometers,
  initialProcedureValues,
  procedureById,
  type ProcedureRequirement,
} from '@/features/calibration/procedures'
import { probeReferencePoint } from '@/features/calibration/screws'
import { useAvailabilityStore } from '@/stores/availability'
import { useBedMeshStore } from '@/stores/bedMesh'
import { useCalibrationStore, type CalibrationRun } from '@/stores/calibration'
import { useMachineSystemStore } from '@/stores/machineSystem'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'

export type RequirementFixId = 'home' | 'moveOverBed' | 'checkAccelerometer' | 'zeroForZ'

/** The one action that meets a requirement, and whether it is under way. */
export interface RequirementFix {
  id: RequirementFixId
  pending: boolean
  run: () => Promise<boolean>
}

/**
 * Which of the requirement's sentences describes it. `configured` is met
 * without having been shown: the config names the part, nothing has asked it
 * yet since Klipper last started.
 */
export type RequirementWording =
  'met' | 'unmet' | 'configured' | 'boardConnected' | 'boardDisconnected'

export interface RequirementState {
  requirement: ProcedureRequirement
  met: boolean
  wording: RequirementWording
  /** What the sentence names: the accelerometer board, where there is one. */
  params?: Record<string, string>
  /** The one action that meets it, where there is one to offer. */
  fix: RequirementFix | null
}

/**
 * What Klipper prints when an accelerometer is not there to answer: a chip
 * that identifies wrong or not at all, a read that returns nothing, or the
 * MCU the chip hangs off gone — which is how a USB accelerometer board
 * unplugged mid-sitting shows up.
 */
const accelerometerFaultPattern =
  /Invalid \w+ id|Unable to (?:read|query)|Lost communication with MCU|No accelerometer|accelerometer .*(?:not|no) /i

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
  const availability = useAvailabilityStore()
  const bedMesh = useBedMeshStore()
  const calibration = useCalibrationStore()
  const context = useProcedureContext()
  const machineSystem = useMachineSystemStore()
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
   * Klipper has no status object that says whether an accelerometer answers,
   * so the evidence is what the chip did when last asked — and only since
   * Klipper last came up: a restart re-enumerates the board the chip hangs
   * off, so a verdict from before it describes hardware that may have been
   * plugged in or pulled since. The newest run of this Klipper session that
   * needed the chip decides: a query that answered, or any resonance run
   * that finished, is the chip answering; a query that failed, or a run that
   * failed with a chip fault in its output, is the chip not answering. With
   * no such run yet, a configured chip is taken at its word — the printer was
   * set up around it, and asking every reader to prove it first would be a
   * step nobody asked for — but said as configured, not as answering.
   */
  function needsAccelerometer(run: CalibrationRun): boolean {
    if (run.procedureId === 'accelerometerQuery') return true
    return procedureById(run.procedureId)?.requires.includes('accelerometer') ?? false
  }

  /**
   * The MCU an accelerometer section hangs off, from the pin that names it:
   * `cs_pin: btt_lis2dw:gpio9` is a chip on a board called `btt_lis2dw`, an
   * `i2c_mcu` names it outright, and a bare pin is the main `mcu`.
   */
  function boardOf(section: string): string {
    const settings = context.value.settings(section)
    const i2c = settings?.i2c_mcu
    if (typeof i2c === 'string' && i2c.trim() !== '') return i2c.trim()
    const cs = settings?.cs_pin
    if (typeof cs === 'string' && cs.includes(':')) {
      return cs
        .trim()
        .replace(/^[!^~]+/, '')
        .split(':')[0]!
    }
    return 'mcu'
  }

  /**
   * What Klipper says about the boards the chips sit on: a USB accelerometer
   * board is its own `is_non_critical` MCU, and `non_critical_disconnected`
   * is Klipper's own word for it being unplugged while everything else runs.
   * A chip on the main board has no such signal, and says nothing here.
   */
  const boards = computed(() =>
    accelerometers(context.value).flatMap((section) => {
      const name = boardOf(section)
      if (name === 'mcu') return []
      const module = machineSystem.mcuModules.find((candidate) => candidate.id === `mcu ${name}`)
      if (!module) return []
      return [{ section, name, disconnected: module.isDisconnected === true }]
    }),
  )

  const accelerometer = computed<{
    met: boolean
    wording: RequirementWording
    params?: Record<string, string>
  }>(() => {
    const unplugged = boards.value.find((board) => board.disconnected)
    if (unplugged) {
      return { met: false, wording: 'boardDisconnected', params: { board: unplugged.name } }
    }
    const session = availability.klipperSession
    const evidence = [...calibration.runs.values()]
      .filter((run) => run.session === session && !run.running && run.succeeded !== null)
      .filter(needsAccelerometer)
      .sort((left, right) => right.startedAt - left.startedAt)
    for (const run of evidence) {
      if (run.succeeded) return { met: true, wording: 'met' }
      if (run.procedureId === 'accelerometerQuery') return { met: false, wording: 'unmet' }
      const output = calibration.linesFor(run.procedureId, run.subject).join('\n')
      if (accelerometerFaultPattern.test(output)) return { met: false, wording: 'unmet' }
    }
    const board = boards.value[0]
    if (board) return { met: true, wording: 'boardConnected', params: { board: board.name } }
    const configured =
      accelerometers(context.value).length > 0 || context.value.hasSection('resonance_tester')
    return configured ? { met: true, wording: 'configured' } : { met: false, wording: 'unmet' }
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

  const wordingOf = (met: boolean): RequirementWording => (met ? 'met' : 'unmet')

  return computed(() => ({
    homed: {
      requirement: 'homed',
      met: homed.value,
      wording: wordingOf(homed.value),
      fix: { id: 'home', pending: printer.isHoming, run: () => printer.homeAxes() },
    },
    notPrinting: {
      requirement: 'notPrinting',
      met: !printer.hasActivePrint,
      wording: wordingOf(!printer.hasActivePrint),
      fix: null,
    },
    probeInBed: {
      requirement: 'probeInBed',
      met: probeInBed.value,
      wording: wordingOf(probeInBed.value),
      fix:
        referencePoint.value === null
          ? null
          : { id: 'moveOverBed', pending: printer.lockedCommands.move, run: moveOverBed },
    },
    accelerometer: {
      requirement: 'accelerometer',
      met: accelerometer.value.met,
      wording: accelerometer.value.wording,
      ...(accelerometer.value.params ? { params: accelerometer.value.params } : {}),
      fix: {
        id: 'checkAccelerometer',
        pending: calibration.activeRun?.procedureId === 'accelerometerQuery',
        run: checkAccelerometer,
      },
    },
    zeroedForZ: {
      requirement: 'zeroedForZ',
      met: zeroedForZ.value,
      wording: wordingOf(zeroedForZ.value),
      fix: { id: 'zeroForZ', pending: printer.pendingCommands.calibration, run: zeroForZ },
    },
  }))
}
