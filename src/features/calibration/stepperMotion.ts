/**
 * Which way a stepper moves the machine when it turns in its positive
 * direction, which is what `STEPPER_BUZZ` does first — so the reader can tell
 * "the right way" from the wrong one before answering the question that
 * follows the run.
 *
 * On a Cartesian machine that is the stepper's own axis. On CoreXY it is
 * not: one motor turning alone moves the toolhead diagonally, and "it moved
 * the right way" can only be judged against the diagonal. Klipper's CoreXY
 * rails are `stepper_x = x + y` and `stepper_y = x − y`, so `stepper_x` alone
 * moves toward +X +Y and `stepper_y` toward +X −Y, wherever the motors happen
 * to be mounted. CoreXZ is the same in X and Z. A Z stepper grows the
 * distance between nozzle and bed; a delta tower's carriage climbs its tower.
 *
 * Kept free of Vue so every kinematics can be tested against plain names.
 */

export type StepperMotion =
  /** The toolhead's move over the bed, seen from above; Y grows toward the back. */
  | { kind: 'plan'; x: number; y: number }
  /** The toolhead's move seen from the front; Z grows away from the bed. */
  | { kind: 'front'; x: number; z: number }
  /** Nozzle and bed move apart; `index` is the Z stepper's number, 0 for `stepper_z`. */
  | { kind: 'z'; index: number }
  | { kind: 'tower'; tower: 'a' | 'b' | 'c' }
  | { kind: 'extruder' }

const diagonal = Math.SQRT1_2

export function stepperMotion(stepper: string, kinematics: string | null): StepperMotion | null {
  const name = stepper.trim().toLowerCase()
  const kind = (kinematics ?? '').toLowerCase()
  if (/^extruder\d*$|^extruder_stepper /.test(name)) return { kind: 'extruder' }

  if (kind === 'delta' || kind === 'rotary_delta') {
    const tower = /^stepper_([abc])$/.exec(name)?.[1]
    return tower ? { kind: 'tower', tower: tower as 'a' | 'b' | 'c' } : null
  }

  const match = /^stepper_([xyz])(\d*)$/.exec(name)
  if (!match) return null
  const axis = match[1]!
  const index = match[2] === '' ? 0 : Number(match[2])

  if (kind === 'corexy' || kind === 'limited_corexy') {
    if (axis === 'x') return { kind: 'plan', x: diagonal, y: diagonal }
    if (axis === 'y') return { kind: 'plan', x: diagonal, y: -diagonal }
    return { kind: 'z', index }
  }
  if (kind === 'corexz' || kind === 'limited_corexz') {
    if (axis === 'x') return { kind: 'front', x: diagonal, z: diagonal }
    if (axis === 'z') return { kind: 'front', x: diagonal, z: -diagonal }
    return { kind: 'plan', x: 0, y: 1 }
  }
  if (kind === 'cartesian' || kind === 'limited_cartesian') {
    if (axis === 'x') return { kind: 'plan', x: 1, y: 0 }
    if (axis === 'y') return { kind: 'plan', x: 0, y: 1 }
    return { kind: 'z', index }
  }
  return null
}

/** The compass direction of a move over the bed, as the message key that names it. */
export function planDirectionKey(x: number, y: number): string {
  const horizontal = x > 0.1 ? 'Right' : x < -0.1 ? 'Left' : ''
  const depth = y > 0.1 ? 'back' : y < -0.1 ? 'front' : ''
  if (depth === '')
    return `calibration.context.motion.direction.${horizontal === 'Right' ? 'right' : 'left'}`
  return `calibration.context.motion.direction.${depth}${horizontal}`
}
