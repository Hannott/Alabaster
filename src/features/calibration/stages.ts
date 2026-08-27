/**
 * Which calibration jobs this machine can actually do, and in the order the
 * physical dependencies run.
 *
 * The page used to be a wall of panels that each gated themselves, which made
 * every printer's page a different length and none of them a sequence. A stage
 * is the unit a calibration sitting is actually organised in — you square the
 * frame before you map the bed, and you map the bed before you chase a
 * resonance peak — so the rail that lists them is what tells a first-time
 * visitor what the destination is for, without a standing description under the
 * page heading that `interface-standards.md` does not allow anyway.
 *
 * Kept free of Vue and Pinia so the gating is testable against raw capability
 * booleans rather than by mounting a page and reading its rail.
 */

/** In dependency order: this is the order the rail renders and the sitting runs. */
export const calibrationStageIds = ['axes', 'bed', 'heaters', 'resonance', 'extrusion'] as const

export type CalibrationStageId = (typeof calibrationStageIds)[number]

/**
 * What each stage needs the machine to have. Every field is a fact read from
 * `configfile.settings`, a registered macro, or an object Klipper reports —
 * never a setting, per the capability-driven interface commitment.
 */
export interface CalibrationCapabilities {
  hasBedMesh: boolean
  hasProbe: boolean
  /** Any of `quad_gantry_level`, `z_tilt`, `screws_tilt_adjust`, `bed_screws`, `delta_calibrate`. */
  hasLeveling: boolean
  /** A heater whose control algorithm has constants worth calibrating: PID or MPC, never watermark. */
  hasCalibratableHeater: boolean
  /** An accelerometer to read, a Shake&Tune macro to run, or graphs already on disk. */
  hasResonance: boolean
  hasExtruder: boolean
  hasRunoutSensors: boolean
}

/**
 * `axes` is deliberately unconditional, for the same reason the destination
 * itself is: endstops exist on any machine with steppers, so there is always
 * something here to read and something to home. Every other stage would be an
 * empty panel on a printer that cannot do the job, so it is absent instead —
 * a stage nobody can act on is worse than one rail entry fewer, because it
 * reads as a broken page rather than as a machine without that hardware.
 */
export function availableCalibrationStages(
  capabilities: CalibrationCapabilities,
): CalibrationStageId[] {
  const stages: CalibrationStageId[] = ['axes']
  if (capabilities.hasBedMesh || capabilities.hasProbe || capabilities.hasLeveling) {
    stages.push('bed')
  }
  if (capabilities.hasCalibratableHeater) stages.push('heaters')
  if (capabilities.hasResonance) stages.push('resonance')
  if (capabilities.hasExtruder || capabilities.hasRunoutSensors) stages.push('extrusion')
  return stages
}

/**
 * The stage to show, from whatever was asked for.
 *
 * The request is resolved against the live stage list rather than trusted,
 * because that list is a fact about the machine and the machine changes: a
 * Shake&Tune uninstall or a config reload without `[bed_mesh]` takes a stage
 * away mid-sitting, and the selected one has to land somewhere rather than
 * leaving an empty canvas. Unknown values fall back the same way, so a stage
 * name that arrives from outside the component — a stored value, a future link
 * — is never a reason to render nothing.
 */
export function resolveCalibrationStage(
  requested: unknown,
  available: readonly CalibrationStageId[],
): CalibrationStageId {
  const first = available[0] ?? 'axes'
  if (typeof requested !== 'string') return first
  return available.includes(requested as CalibrationStageId)
    ? (requested as CalibrationStageId)
    : first
}
