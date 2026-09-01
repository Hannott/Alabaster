/**
 * How long a heater takes to reach a temperature, learned from watching it.
 *
 * The question this answers is not "how fast is it climbing" — a fitted rate
 * overstates every arrival, because both PID and MPC back their power off well
 * before the setpoint. It is "how long did this heater take to cross each part
 * of its range last time", which is a different measurement and a reusable one:
 * time from A to B is the sum of the parts between them, so one full climb from
 * cold answers every later question about any stretch inside it.
 *
 * Nothing here reproduces Klipper's control model. The calibrated constants are
 * used only as an identity — to decide whether two observations describe the
 * same heater — so a release that changes how Klipper drives its heaters cannot
 * make these numbers wrong, only stale.
 *
 * Pure: no Vue, no Pinia, no storage. `telemetry.ts` owns the feed and the
 * persistence and calls in here.
 */

/**
 * The resolution the curve is learned at. Five degrees is fine enough that the
 * last stretch before a setpoint is not averaged in with the fast part of the
 * climb, and coarse enough that a full climb still fills every band it covers
 * in a single pass.
 */
export const bandWidth = 5

/**
 * A sample interval that jumps more bands than this is not resolving them, so
 * none of them are recorded.
 *
 * This is not really about fast heaters, though an induction hot end reaching
 * 200° in three seconds is what makes it obvious. It is about a delayed status
 * update on an ordinary one: a multi-second gap mid-climb would otherwise
 * credit several bands a fraction of their true duration, and that lands in
 * storage and biases every later estimate optimistic.
 */
const maximumBandsPerInterval = 2

/** Below this a duration is measurement noise, not a crossing worth keeping. */
const minimumBandSeconds = 0.05

/**
 * How far a reading must fall below the climb's high-water mark to count as
 * cooling rather than as a sensor hunting around its setpoint. A real cooldown
 * clears this in a second; noise never does.
 */
const coolingTolerance = 1

/**
 * The share of `max_power` a heater must be averaging for a band to count as
 * full drive.
 *
 * Measured rather than assumed from a fixed number of degrees below target.
 * A fixed margin has to be wrong for one of the two schemes: MPC drives hard
 * until about two seconds out, a PID bed eases off much earlier, and erring
 * small is the dangerous direction — degrees where the controller was already
 * backing off get written into the shared table as full drive and contaminate
 * every estimate that crosses them.
 */
const fullDrivePowerFraction = 0.9

/** How recent a heat-up counts for, against everything before it. */
const bandEmaAlpha = 0.3

/**
 * How far from a recorded target an approach may be borrowed. The final
 * stretch depends on the setpoint, so this is an approximation — but it is the
 * difference between a model that applies to 215° after learning 210° and one
 * that only ever answers for temperatures it has seen exactly.
 */
const approachTargetTolerance = 25

export interface HeatSample {
  /** Exponentially weighted seconds, so a changed duct or room converges. */
  seconds: number
  count: number
}

/** The final stretch, where the controller is no longer driving flat out. */
export interface ApproachSample extends HeatSample {
  /** Where full drive stopped, so the bands below it can be summed up to here. */
  fromTemperature: number
}

export interface HeatCurve {
  /** Keyed by band floor: `bands['200']` is the time to cross 200→205. */
  bands: Record<string, HeatSample>
  /** Keyed by the target approached. */
  approach: Record<string, ApproachSample>
}

export function emptyCurve(): HeatCurve {
  return { bands: {}, approach: {} }
}

export function bandFloor(temperature: number): number {
  return Math.floor(temperature / bandWidth) * bandWidth
}

function fold(existing: HeatSample | undefined, seconds: number): HeatSample {
  if (!existing || existing.count === 0) return { seconds, count: 1 }
  return {
    seconds: existing.seconds + (seconds - existing.seconds) * bandEmaAlpha,
    count: existing.count + 1,
  }
}

/**
 * An identity for a heater's control behavior, built from the values Klipper
 * reports for it.
 *
 * A curve is stored under this rather than being invalidated by it, which is
 * what makes a recalibration non-destructive: new constants start a new table,
 * and putting the old constants back brings the old table with them. Nothing
 * here is used to compute anything — only to tell one heater's behavior apart
 * from the same heater's behavior after it was changed.
 */
export function fingerprintFor(settings: Record<string, unknown> | null | undefined): string {
  if (!settings) return 'unknown'
  const control = String(settings.control ?? 'unknown')

  // The drive terms scale every climb whichever scheme is in use, and are not
  // calibrated — a user editing `max_power` changes the curve just as surely
  // as a calibration does.
  const keys = ['control', 'max_power']
  if (control === 'pid') keys.push('pid_kp', 'pid_ki', 'pid_kd')
  if (control === 'mpc') {
    keys.push(
      // Everything MPC_CALIBRATE writes...
      'block_heat_capacity',
      'ambient_transfer',
      'sensor_responsiveness',
      'fan_ambient_transfer',
      // ...plus the declared hardware it is all scaled against.
      'heater_power',
    )
  }

  return keys.map((key) => `${key}=${JSON.stringify(settings[key] ?? null)}`).join('|')
}

/* ------------------------------------------------------------------------ */
/* Recording                                                                 */
/* ------------------------------------------------------------------------ */

export interface HeatRecorderState {
  target: number | null
  /** The previous sample, for interpolating a crossing between the two. */
  previousEventtime: number | null
  previousTemperature: number | null
  /** The boundary last crossed upward, and the interpolated moment it happened. */
  bandFloorReached: number | null
  bandStartedAt: number | null
  powerSum: number
  powerCount: number
  /**
   * When the heater stopped driving flat out. Everything from here to arrival
   * is the approach, and nothing after it belongs in the shared band table.
   */
  approachFrom: number | null
  approachFromTemperature: number | null
  /** The highest reading of this climb, so noise is not mistaken for cooling. */
  peakTemperature: number | null
  /** Where this climb began, so an arrival it never climbed to is not recorded. */
  climbFromTemperature: number | null
  /** Set once a target is reached, so one arrival is not recorded twice. */
  settled: boolean
}

export function emptyRecorderState(): HeatRecorderState {
  return {
    target: null,
    previousEventtime: null,
    previousTemperature: null,
    bandFloorReached: null,
    bandStartedAt: null,
    powerSum: 0,
    powerCount: 0,
    approachFrom: null,
    approachFromTemperature: null,
    peakTemperature: null,
    climbFromTemperature: null,
    settled: false,
  }
}

export interface HeatObservation {
  eventtime: number
  temperature: number
  target: number | null
  power: number | null
}

export interface RecordedBand {
  floor: number
  seconds: number
}

export interface RecordedApproach {
  target: number
  fromTemperature: number
  seconds: number
}

export interface RecordResult {
  bands: RecordedBand[]
  approach: RecordedApproach | null
}

function restart(state: HeatRecorderState, observation: HeatObservation): void {
  state.previousEventtime = observation.eventtime
  state.previousTemperature = observation.temperature
  state.bandFloorReached = bandFloor(observation.temperature)
  state.bandStartedAt = null
  state.powerSum = 0
  state.powerCount = 0
  state.approachFrom = null
  state.approachFromTemperature = null
  state.peakTemperature = observation.temperature
  state.climbFromTemperature = observation.temperature
  state.settled = false
}

/**
 * Folds one status sample into the recorder, returning whatever it completed.
 *
 * Mutates `state` — it is per-heater bookkeeping owned by the caller, and
 * copying it on every push at four samples a second would be waste for no
 * safety, since nothing else reads it.
 */
export function recordObservation(
  state: HeatRecorderState,
  observation: HeatObservation,
  options: { maximumPower?: number; settleMargin?: number } = {},
): RecordResult {
  const maximumPower = options.maximumPower ?? 1
  const settleMargin = options.settleMargin ?? 0.5
  const empty: RecordResult = { bands: [], approach: null }

  const { eventtime, temperature, target, power } = observation

  // Nothing to learn from a heater that is not being asked for anything.
  if (target === null || target <= 0) {
    const wasTarget = state.target
    Object.assign(state, emptyRecorderState())
    if (wasTarget !== null) state.target = null
    return empty
  }

  // A new request is a new climb; whatever was in flight described the old one.
  if (state.target !== target) {
    state.target = target
    restart(state, observation)
    return empty
  }

  if (state.previousEventtime === null || state.previousTemperature === null) {
    restart(state, observation)
    return empty
  }

  /*
   * Genuinely falling — the target was lowered, or the heater switched off —
   * so whatever climb was in flight is over.
   *
   * Measured against the climb's high-water mark and with room to spare, not
   * against the previous sample. A reading hunting around its setpoint dips by
   * hundredths of a degree constantly, and treating that as the end of a climb
   * threw away the approach a fraction of a second before it completed: the
   * first real heat-up on a printer recorded sixteen bands and no arrival at
   * all, because the sample that would have settled it came after a wobble.
   */
  if (state.peakTemperature !== null && temperature < state.peakTemperature - coolingTolerance) {
    restart(state, observation)
    return empty
  }
  state.peakTemperature = Math.max(state.peakTemperature ?? temperature, temperature)

  const elapsed = eventtime - state.previousEventtime
  if (elapsed <= 0) return empty

  if (power !== null) {
    state.powerSum += power
    state.powerCount += 1
  }

  const result: RecordResult = { bands: [], approach: null }
  const fromFloor = bandFloor(state.previousTemperature)
  const toFloor = bandFloor(temperature)
  const crossings = Math.max(0, (toFloor - fromFloor) / bandWidth)

  if (crossings > 0) {
    const meanPower = state.powerCount > 0 ? state.powerSum / state.powerCount : 0
    const fullDrive = meanPower >= fullDrivePowerFraction * maximumPower
    const resolvable = crossings <= maximumBandsPerInterval

    for (let index = 1; index <= crossings; index += 1) {
      const boundary = fromFloor + index * bandWidth
      // Where between the two samples the reading actually passed the boundary.
      // Taking the sample's own timestamp quantises every band to the feed's
      // interval, which is most of a short band's duration.
      const fraction =
        (boundary - state.previousTemperature) / (temperature - state.previousTemperature)
      const crossedAt = state.previousEventtime + fraction * elapsed

      if (
        resolvable &&
        state.bandStartedAt !== null &&
        state.bandFloorReached === boundary - bandWidth
      ) {
        const seconds = crossedAt - state.bandStartedAt
        if (seconds >= minimumBandSeconds) {
          if (fullDrive && state.approachFrom === null) {
            result.bands.push({ floor: boundary - bandWidth, seconds })
          } else if (state.approachFrom === null) {
            // Drive has eased off: this band and everything above it is the
            // approach, which belongs to this target rather than to the heater.
            state.approachFrom = state.bandStartedAt
            state.approachFromTemperature = boundary - bandWidth
          }
        }
      }

      state.bandFloorReached = boundary
      state.bandStartedAt = crossedAt
      state.powerSum = 0
      state.powerCount = 0
    }
  }

  state.previousEventtime = eventtime
  state.previousTemperature = temperature

  if (!state.settled && target - temperature <= settleMargin) {
    state.settled = true
    const from = state.approachFrom ?? state.bandStartedAt
    const fromTemperature = state.approachFromTemperature ?? state.bandFloorReached
    /*
     * Only for a climb this recorder actually watched. A heater already sitting
     * at its target when observation starts satisfies the settle test on the
     * very first sample, and recorded an "approach" of a sixth of a second on a
     * real printer — a number that would then be handed out as an estimate.
     * Requiring a band's worth of climbing is what makes an arrival evidence of
     * having arrived somewhere.
     */
    const climbed =
      state.climbFromTemperature !== null && target - state.climbFromTemperature >= bandWidth
    if (
      climbed &&
      from !== null &&
      fromTemperature !== null &&
      eventtime - from >= minimumBandSeconds
    ) {
      result.approach = { target, fromTemperature, seconds: eventtime - from }
    }
  }

  return result
}

/** Folds what a recorder produced into the stored curve, in place. */
export function applyRecording(curve: HeatCurve, result: RecordResult): HeatCurve {
  if (result.bands.length === 0 && !result.approach) return curve
  const bands = { ...curve.bands }
  for (const band of result.bands) {
    bands[String(band.floor)] = fold(bands[String(band.floor)], band.seconds)
  }
  const approach = { ...curve.approach }
  if (result.approach) {
    const key = String(Math.round(result.approach.target))
    const folded = fold(approach[key], result.approach.seconds)
    approach[key] = { ...folded, fromTemperature: result.approach.fromTemperature }
  }
  return { bands, approach }
}

/* ------------------------------------------------------------------------ */
/* Estimating                                                                */
/* ------------------------------------------------------------------------ */

function nearestApproach(curve: HeatCurve, target: number): ApproachSample | null {
  let best: ApproachSample | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const [key, sample] of Object.entries(curve.approach)) {
    const distance = Math.abs(Number(key) - target)
    if (distance < bestDistance && distance <= approachTargetTolerance) {
      best = sample
      bestDistance = distance
    }
  }
  return best
}

/**
 * Seconds to climb from `from` to `to`, or null when the curve cannot answer.
 *
 * **Every band across the span must have been measured.** A gap is not
 * interpolated over, because a band invented from its neighbors produces a
 * number indistinguishable from a real one — and the whole value of this model
 * is that its numbers were observed. Declining sends the caller back to the
 * fitted rate, which is honest about being a guess.
 */
export function estimateSeconds(curve: HeatCurve, from: number, to: number): number | null {
  if (!(to > from)) return null

  const approach = nearestApproach(curve, to)
  if (!approach) return null

  const approachStart = approach.fromTemperature
  // Already inside the final stretch. Prorated linearly, which is the model's
  // least accurate region — and its shortest, so the absolute error is small.
  if (from >= approachStart) {
    const span = to - approachStart
    if (span <= 0) return null
    return Math.max(0, approach.seconds * ((to - from) / span))
  }

  let seconds = 0
  for (let floor = bandFloor(from); floor < approachStart; floor += bandWidth) {
    const sample = curve.bands[String(floor)]
    if (!sample || sample.count === 0) return null
    // The first band is entered part-way up.
    const covered = Math.min(floor + bandWidth, approachStart) - Math.max(from, floor)
    seconds += sample.seconds * (covered / bandWidth)
  }

  return seconds + approach.seconds
}
