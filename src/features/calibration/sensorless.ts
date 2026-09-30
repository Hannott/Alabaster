/**
 * Tuning a TMC driver's stall detection for sensorless homing, the way
 * Klipper's TMC guide describes: from the carriage near the middle of its
 * rail, set a sensitivity and home, over and over, to find the most sensitive
 * value that still reaches the end of the rail, and the least sensitive one
 * that still stops there with a single touch. The value kept is a third of
 * the way from the second to the first.
 *
 * Which way "more sensitive" runs depends on the driver: a TMC2209's `SGTHRS`
 * is most sensitive at 255, every other driver's `sgt` at -64. The arithmetic
 * is on the raw values either way, since the guide's formula is linear.
 *
 * Kept free of Vue so the search is testable on its own.
 */

export interface StallDriver {
  /** The driver's section, `tmc2209 stepper_x`. */
  section: string
  stepper: string
  /** The axis `G28` homes for this stepper, upper case. */
  axis: string
  /** The field `SET_TMC_FIELD` takes and the option the config keeps it in. */
  field: 'sgthrs' | 'sgt'
  option: 'driver_SGTHRS' | 'driver_SGT'
  mostSensitive: number
  leastSensitive: number
}

/** Drivers with StallGuard; the TMC2208 has none. */
const stallDrivers = ['tmc2209', 'tmc2130', 'tmc5160', 'tmc2240', 'tmc2660']

/**
 * The steppers set up to home against their driver: an `endstop_pin` on the
 * driver's `virtual_endstop`. A TMC2660 reports a stall on a real pin
 * instead, which the config cannot tell from a switch, so it is not offered.
 */
export function stallDriversFor(
  sections: readonly string[],
  settings: (section: string) => Record<string, unknown> | null,
): StallDriver[] {
  const drivers: StallDriver[] = []
  for (const section of sections) {
    const match = /^(tmc\d+) (stepper_([a-z]))$/.exec(section)
    if (!match || !stallDrivers.includes(match[1]!)) continue
    const [, driver, stepper, axis] = match as unknown as [string, string, string, string]
    const pin = settings(stepper)?.endstop_pin
    if (typeof pin !== 'string' || !/virtual_endstop/.test(pin)) continue
    const isThreshold = driver === 'tmc2209'
    drivers.push({
      section,
      stepper,
      axis: axis.toUpperCase(),
      field: isThreshold ? 'sgthrs' : 'sgt',
      option: isThreshold ? 'driver_SGTHRS' : 'driver_SGT',
      mostSensitive: isThreshold ? 255 : -64,
      leastSensitive: isThreshold ? 0 : 63,
    })
  }
  return drivers
}

/** What one homing attempt did, as the reader saw and heard it. */
export type AttemptOutcome = 'stoppedEarly' | 'singleTouch' | 'banged'

export interface Attempt {
  value: number
  outcome: AttemptOutcome
}

/** Whether `left` is more sensitive than `right` on this driver. */
export function moreSensitive(driver: StallDriver, left: number, right: number): boolean {
  return driver.mostSensitive > driver.leastSensitive ? left > right : left < right
}

export interface SensitivityRange {
  /** The guide's maximum_sensitivity: the most sensitive value that reached the end. */
  maximum: number | null
  /** The guide's minimum_sensitivity: the least sensitive value that stopped with one touch. */
  minimum: number | null
}

export function sensitivityRange(
  driver: StallDriver,
  attempts: readonly Attempt[],
): SensitivityRange {
  let maximum: number | null = null
  let minimum: number | null = null
  for (const attempt of attempts) {
    if (attempt.outcome === 'stoppedEarly') continue
    if (maximum === null || moreSensitive(driver, attempt.value, maximum)) maximum = attempt.value
    if (attempt.outcome !== 'singleTouch') continue
    if (minimum === null || moreSensitive(driver, minimum, attempt.value)) minimum = attempt.value
  }
  return { maximum, minimum }
}

/** `minimum + (maximum - minimum) / 3`, rounded, per the guide; null until both are found. */
export function recommendedSensitivity(range: SensitivityRange): number | null {
  if (range.maximum === null || range.minimum === null) return null
  return Math.round(range.minimum + (range.maximum - range.minimum) / 3)
}

/** Under this many steps apart, the guide warns that homing may be unstable. */
export const narrowRange = 5

/**
 * The next value to try: one step less sensitive than the last attempt while
 * the search is still looking for the end of the rail or for the first bang,
 * clamped to the driver's range.
 */
export function nextValue(driver: StallDriver, last: Attempt | undefined): number {
  if (!last) return driver.mostSensitive
  const step = driver.field === 'sgthrs' ? 10 : 2
  const direction = driver.leastSensitive > driver.mostSensitive ? 1 : -1
  const next = last.value + direction * step
  const low = Math.min(driver.mostSensitive, driver.leastSensitive)
  const high = Math.max(driver.mostSensitive, driver.leastSensitive)
  return Math.min(Math.max(next, low), high)
}

/**
 * One homing attempt: the sensitivity, the two seconds the guide says a
 * driver needs to clear its stall flag, and a home of that axis alone.
 */
export function attemptScript(driver: StallDriver, value: number): string {
  return [
    `SET_TMC_FIELD STEPPER=${driver.stepper} FIELD=${driver.field} VALUE=${Math.round(value)}`,
    'G4 P2000',
    `G28 ${driver.axis}`,
  ].join('\n')
}
