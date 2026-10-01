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
  /** What the config has to change before, or while, this axis is tuned. */
  setup: StallSetup
}

/** One option to set: `value` null is the DIAG pin, which only the wiring knows. */
export interface SetupLine {
  section: string
  option: string
  value: string | null
}

export interface StallSetup {
  /** Lines to add or change, grouped by section in the order written. */
  lines: SetupLine[]
  /** Options to take out. */
  removes: { section: string; option: string }[]
  /**
   * Whether an attempt can run before the lines are in: not while the axis
   * homes against a switch, since `G28` would stop at the switch and measure
   * nothing about the driver.
   */
  blocking: boolean
}

/** Drivers with StallGuard; the TMC2208 has none. */
const stallDrivers = ['tmc2209', 'tmc2130', 'tmc5160', 'tmc2240', 'tmc2660']

/*
 * The drivers that report a stall on a DIAG pin Klipper turns into a virtual
 * endstop. A TMC2660 reports it on SG_TST, wired as an ordinary endstop pin,
 * so an axis not yet using it cannot be told from one homing on a switch, and
 * is only offered once it is set up.
 */
const diagDrivers: Readonly<Record<string, string>> = {
  tmc2209: 'diag_pin',
  tmc2130: 'diag1_pin',
  tmc5160: 'diag1_pin',
  tmc2240: 'diag1_pin',
}

const diagOptions = ['diag_pin', 'diag0_pin', 'diag1_pin']

/*
 * The driver's own virtual endstop, `tmc2209_stepper_x:virtual_endstop`. A
 * probe's `probe:z_virtual_endstop` is a virtual endstop too, and Z homing
 * on the probe is not homing on a stall.
 */
function isVirtual(pin: unknown): boolean {
  return (
    typeof pin === 'string' && /^[\^~!]*tmc\d+_stepper_[a-z]:virtual_endstop$/i.test(pin.trim())
  )
}

function setupFor(
  driver: string,
  section: string,
  stepper: string,
  stepperSettings: Record<string, unknown>,
  driverWritten: Readonly<Record<string, string>>,
  option: string,
  mostSensitive: number,
): StallSetup {
  const lines: SetupLine[] = []
  const removes: { section: string; option: string }[] = []
  const homesOnDriver = isVirtual(stepperSettings.endstop_pin)
  if (!homesOnDriver) {
    lines.push({
      section: stepper,
      option: 'endstop_pin',
      value: `${driver}_${stepper}:virtual_endstop`,
    })
  }
  // Klipper's guide: the second, slower homing move does not work sensorless and confuses the search.
  if (Number(stepperSettings.homing_retract_dist ?? 5) !== 0) {
    lines.push({ section: stepper, option: 'homing_retract_dist', value: '0' })
  }
  const direction = homingDirectionFix(stepperSettings)
  if (direction !== null) {
    lines.push({ section: stepper, option: 'homing_positive_dir', value: direction })
  }
  // A virtual endstop without one is a config Klipper refuses to load, so only a switch axis can lack it.
  if (!homesOnDriver && !diagOptions.some((name) => driverWritten[name] !== undefined)) {
    lines.push({ section, option: diagDrivers[driver] ?? 'diag1_pin', value: null })
  }
  if (!homesOnDriver) {
    lines.push({ section, option, value: String(mostSensitive) })
  }
  /*
   * A hold current lowered while the carriage presses on the frame moves it,
   * per the guide. Read from what the file writes: Klipper reports a default
   * for it in the settings whether or not anyone set one.
   */
  if (driverWritten.hold_current !== undefined) removes.push({ section, option: 'hold_current' })
  return { lines, removes, blocking: !homesOnDriver || direction !== null }
}

/**
 * `homing_positive_dir` that matches where `position_endstop` sits, or null
 * where it already does. Klipper's homing move is 1.5 × the distance from
 * the endstop to the far limit (`homing.py`), so an endstop at the top of the
 * axis homed downward moves 1.5 mm and fails with "No trigger after full
 * movement" at every sensitivity — the move is over before the motor can
 * stall. Klipper only refuses the case where the endstop sits exactly on the
 * wrong limit. The fix keeps the coordinates and turns the direction, since
 * `position_endstop` is what everything else on the machine is measured from.
 */
export function homingDirectionFix(stepperSettings: Record<string, unknown>): string | null {
  const positive = stepperSettings.homing_positive_dir
  const endstop = Number(stepperSettings.position_endstop)
  const minimum = Number(stepperSettings.position_min ?? 0)
  const maximum = Number(stepperSettings.position_max)
  if (typeof positive !== 'boolean') return null
  if (![endstop, minimum, maximum].every(Number.isFinite) || maximum <= minimum) return null
  const towardMaximum = endstop - minimum > maximum - endstop
  return towardMaximum === positive ? null : towardMaximum ? 'True' : 'False'
}

/**
 * The steppers whose driver can detect a stall: every one already set up to
 * home against its driver (an `endstop_pin` on the driver's
 * `virtual_endstop`), and X and Y on a DIAG-capable driver that still homes
 * on a switch, with the lines that would set it up. Z is offered only once it
 * is set up: Klipper's guide advises against homing Z by stall, and saying
 * how would be advising it.
 */
export function stallDriversFor(
  sections: readonly string[],
  settings: (section: string) => Record<string, unknown> | null,
  written: (section: string) => Readonly<Record<string, string>> | null,
): StallDriver[] {
  const drivers: StallDriver[] = []
  for (const section of sections) {
    const match = /^(tmc\d+) (stepper_([a-z]))$/.exec(section)
    if (!match || !stallDrivers.includes(match[1]!)) continue
    const [, driver, stepper, axis] = match as unknown as [string, string, string, string]
    const stepperSettings = settings(stepper) ?? {}
    const offered =
      isVirtual(stepperSettings.endstop_pin) ||
      ((axis === 'x' || axis === 'y') && diagDrivers[driver] !== undefined)
    if (!offered) continue
    const isThreshold = driver === 'tmc2209'
    const option = isThreshold ? 'driver_SGTHRS' : 'driver_SGT'
    const mostSensitive = isThreshold ? 255 : -64
    drivers.push({
      section,
      stepper,
      axis: axis.toUpperCase(),
      field: isThreshold ? 'sgthrs' : 'sgt',
      option,
      mostSensitive,
      leastSensitive: isThreshold ? 0 : 63,
      setup: setupFor(
        driver,
        section,
        stepper,
        stepperSettings,
        written(section) ?? {},
        option,
        mostSensitive,
      ),
    })
  }
  return drivers
}

/** The setup lines as config text, one block per section, the DIAG pin left as `pin`. */
export function setupSnippet(setup: StallSetup, pin: string): string {
  const blocks: string[] = []
  let current: string | null = null
  for (const line of setup.lines) {
    if (line.section !== current) {
      if (blocks.length > 0) blocks.push('')
      blocks.push(`[${line.section}]`)
      current = line.section
    }
    blocks.push(`${line.option}: ${line.value ?? pin}`)
  }
  return blocks.join('\n')
}

/** What one homing attempt did, as the reader saw and heard it. */
/**
 * `noTrigger` is Klipper's own answer, not the reader's: the home ran its
 * whole move and the driver never reported a stall.
 */
export type AttemptOutcome = 'stoppedEarly' | 'singleTouch' | 'banged' | 'noTrigger'

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
    if (attempt.outcome === 'stoppedEarly' || attempt.outcome === 'noTrigger') continue
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
  // A stall never seen is a step toward more sensitive, not less.
  const toLeast = driver.leastSensitive > driver.mostSensitive ? 1 : -1
  const direction = last.outcome === 'noTrigger' ? -toLeast : toLeast
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
