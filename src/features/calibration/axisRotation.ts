/**
 * Rotation distance from the hardware, and from a measured move, for any
 * stepper: an axis, a Z motor, or an extruder.
 *
 * Klipper splits what Marlin folds into one steps-per-mm figure into separate
 * options, and the calculator follows that split rather than hiding it:
 *
 * - `rotation_distance` is how far the axis travels per turn of whatever the
 *   motor finally drives — the pulley, the lead screw, the drive gear. It is
 *   mechanics alone: belt pitch × pulley teeth, or screw pitch × starts.
 * - `gear_ratio` is a reduction between the motor and that part. With one set,
 *   `rotation_distance` is the driven part's, not the motor's.
 * - `full_steps_per_rotation` is the motor itself: 200 for a 1.8° motor, 400
 *   for a 0.9° one. It changes steps per mm and resolution, never
 *   `rotation_distance`, which is why a 0.9° motor fitted without it moves
 *   exactly half as far as asked.
 */

export type DriveKind = 'belt' | 'leadScrew' | 'driveGear'

export interface DrivePreset {
  id: string
  /** Belt pitch, or screw thread pitch, in mm. */
  pitch: number
  /** Thread starts; one for a belt. */
  starts: number
}

/** Belt profiles by tooth pitch. */
export const beltPresets: readonly DrivePreset[] = [
  { id: '2gt', pitch: 2, starts: 1 },
  { id: '3gt', pitch: 3, starts: 1 },
  { id: 'htd5m', pitch: 5, starts: 1 },
]

/**
 * Lead screws by their stated form. A T8's "lead" — travel per turn — is pitch
 * × starts, and the common ones share a 2 mm pitch with one, two or four
 * starts; a ball screw's name states its lead directly.
 */
export const leadScrewPresets: readonly DrivePreset[] = [
  { id: 't8l8', pitch: 2, starts: 4 },
  { id: 't8l4', pitch: 2, starts: 2 },
  { id: 't8l2', pitch: 2, starts: 1 },
  { id: 'sfu1204', pitch: 4, starts: 1 },
  { id: 'sfu1605', pitch: 5, starts: 1 },
]

export type StepAngle = '1.8' | '0.9'

export const fullStepsByAngle: Readonly<Record<StepAngle, number>> = { '1.8': 200, '0.9': 400 }

/** The step angle a `full_steps_per_rotation` names, or null for any other motor. */
export function stepAngleFor(fullSteps: number): StepAngle | null {
  if (fullSteps === 200) return '1.8'
  if (fullSteps === 400) return '0.9'
  return null
}

function positive(...values: number[]): boolean {
  return values.every((value) => Number.isFinite(value) && value > 0)
}

export function beltRotationDistance(pitch: number, teeth: number): number | null {
  if (!positive(pitch, teeth) || !Number.isInteger(teeth)) return null
  return pitch * teeth
}

export function leadScrewRotationDistance(pitch: number, starts: number): number | null {
  if (!positive(pitch, starts) || !Number.isInteger(starts)) return null
  return pitch * starts
}

/**
 * A drive gear moves filament by its circumference at the depth its teeth
 * bite, which is smaller than the gear's outside diameter — so this is a
 * starting value for a measured correction, not a replacement for one.
 */
export function driveGearRotationDistance(effectiveDiameter: number): number | null {
  if (!positive(effectiveDiameter)) return null
  return Math.PI * effectiveDiameter
}

/**
 * The factor a `gear_ratio` multiplies steps by: `80:20` is 4, and a chain
 * `57:11, 2:1` is the product of its stages. Accepts the option as written
 * (`"50:17"`) and as `configfile.settings` reports it (`[[50, 17]]`). An
 * absent or empty ratio is 1; one that cannot be read is null.
 */
export function gearRatioFactor(value: unknown): number | null {
  if (value === undefined || value === null) return 1
  const pairs = Array.isArray(value) ? value : typeof value === 'string' ? parsePairs(value) : null
  if (pairs === null) return null
  if (pairs.length === 0) return 1
  let factor = 1
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length !== 2) return null
    const [driven, driving] = pair.map(Number) as [number, number]
    if (!positive(driven, driving)) return null
    factor *= driven / driving
  }
  return factor
}

function parsePairs(text: string): number[][] | null {
  const trimmed = text.trim()
  if (trimmed === '') return []
  const pairs = trimmed.split(',').map((stage) => stage.split(':').map((part) => part.trim()))
  if (pairs.some((pair) => pair.length !== 2 || pair.some((part) => !/^\d+(\.\d+)?$/.test(part))))
    return null
  return pairs.map((pair) => pair.map(Number))
}

/** A gear ratio as the config file spells it, from either form. '' for none. */
export function gearRatioText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!Array.isArray(value)) return ''
  return value
    .filter((pair): pair is unknown[] => Array.isArray(pair) && pair.length === 2)
    .map((pair) => pair.map((part) => formatNumber(Number(part))).join(':'))
    .join(', ')
}

export interface StepperDrive {
  rotationDistance: number | null
  /** As the file spells it, '' for none. */
  gearRatio: string
  fullSteps: number
  microsteps: number | null
}

/** What a stepper section says about its drive, with Klipper's defaults where it says nothing. */
export function stepperDrive(settings: Record<string, unknown> | null): StepperDrive {
  const number = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null
  return {
    rotationDistance: number(settings?.rotation_distance),
    gearRatio: gearRatioText(settings?.gear_ratio),
    fullSteps: number(settings?.full_steps_per_rotation) ?? 200,
    microsteps: number(settings?.microsteps),
  }
}

export interface MotionResolution {
  /** Null while microsteps are unknown. */
  stepsPerMm: number | null
  fullStepMm: number
  microstepMm: number | null
}

/**
 * The figures a Marlin user knows the drive by. `microsteps` is required in
 * every stepper section, so it is missing only while the config has not been
 * read, and the full-step figure stands on its own until then.
 */
export function motionResolution(drive: {
  rotationDistance: number
  gearRatio: string
  fullSteps: number
  microsteps: number | null
}): MotionResolution | null {
  const factor = gearRatioFactor(drive.gearRatio)
  if (factor === null || !positive(drive.rotationDistance, drive.fullSteps)) return null
  const fullStepMm = drive.rotationDistance / (drive.fullSteps * factor)
  const microsteps = drive.microsteps !== null && drive.microsteps > 0 ? drive.microsteps : null
  return {
    stepsPerMm: microsteps === null ? null : microsteps / fullStepMm,
    fullStepMm,
    microstepMm: microsteps === null ? null : fullStepMm / microsteps,
  }
}

/**
 * Klipper's documented correction, `rotation_distance × actual / commanded`: an
 * axis that travelled further than asked turned too far per millimetre, so its
 * distance per turn has to grow.
 */
export function measuredRotationDistance(
  current: number,
  commanded: number,
  actual: number,
): number | null {
  if (!positive(current, commanded, actual)) return null
  return (current * actual) / commanded
}

/**
 * The `full_steps_per_rotation` a measured move points at, when it is off by a
 * factor of two either way: that is a 0.9° motor configured as 1.8°, or the
 * reverse, never a pulley or screw that is 50% out. Correcting it through
 * `rotation_distance` instead would hide the wrong motor setting behind a
 * wrong-looking mechanical value. Null for a move that is not off by that much,
 * and for any count other than the two motors a printer is built with.
 */
export function suggestedFullSteps(
  configuredFullSteps: number,
  commanded: number,
  actual: number,
): number | null {
  if (!positive(configuredFullSteps, commanded, actual)) return null
  const ratio = actual / commanded
  const tolerance = 0.06
  if (configuredFullSteps === 200 && Math.abs(ratio - 0.5) <= 0.5 * tolerance) return 400
  if (configuredFullSteps === 400 && Math.abs(ratio - 2) <= 2 * tolerance) return 200
  return null
}

/** A value for the config file: at most three decimals, and no trailing zeros. */
export function formatNumber(value: number, decimals = 3): string {
  return String(Number(value.toFixed(decimals)))
}

/** The axis stepper sections, in config order: `stepper_x`, `stepper_z1`, `stepper_a`. */
export function axisSteppers(sections: readonly string[]): string[] {
  return sections.filter((section) => /^stepper_[a-z]\d*$/.test(section))
}

/**
 * The move command for an axis stepper, or null for one that is not a
 * Cartesian axis of its own — a delta tower moves every tower for any
 * coordinate, so no single move measures one.
 */
export function axisLetter(stepper: string, kinematics: string | null): string | null {
  if (/^delta|^rotary_delta/i.test(kinematics ?? '')) return null
  const match = /^stepper_([xyz])\d*$/.exec(stepper)
  return match ? match[1]!.toUpperCase() : null
}

/**
 * The other steppers that have to carry the same drive values. A Z axis with
 * several motors has them all turning the same screws, and a CoreXY's two
 * motors share one belt path, so writing one without the other leaves the
 * axes moving different distances. `stepper_x1`-style second motors are the
 * same axis doubled.
 */
export function companionSteppers(
  stepper: string,
  sections: readonly string[],
  kinematics: string | null,
): string[] {
  const letter = /^stepper_([a-z])\d*$/.exec(stepper)?.[1]
  if (!letter) return []
  const partners = new Set([letter])
  const kind = (kinematics ?? '').toLowerCase()
  if (kind.startsWith('corexy') || kind.startsWith('hybrid_corexy')) {
    if (letter === 'x' || letter === 'y') ['x', 'y'].forEach((axis) => partners.add(axis))
  }
  if (kind.startsWith('corexz') || kind.startsWith('hybrid_corexz')) {
    if (letter === 'x' || letter === 'z') ['x', 'z'].forEach((axis) => partners.add(axis))
  }
  if (/^delta|^rotary_delta/.test(kind)) ['a', 'b', 'c'].forEach((axis) => partners.add(axis))
  return axisSteppers(sections).filter(
    (section) => section !== stepper && partners.has(section.charAt('stepper_'.length)),
  )
}

/** The drive a stepper most likely has, for the calculator's first guess. */
export function likelyDrive(stepper: string, kinematics: string | null): DriveKind {
  if (stepper.startsWith('extruder')) return 'driveGear'
  const kind = (kinematics ?? '').toLowerCase()
  if (/^stepper_z\d*$/.test(stepper) && !kind.startsWith('corexz')) return 'leadScrew'
  return 'belt'
}
