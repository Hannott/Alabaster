import { describe, expect, it } from 'vitest'

import {
  applyRecording,
  bandFloor,
  emptyCurve,
  emptyRecorderState,
  estimateSeconds,
  fingerprintFor,
  recordObservation,
  type HeatCurve,
  type HeatObservation,
} from '@/stores/heatModel'

/**
 * A heater climbing to `target`, sampled at `intervalSeconds`, decelerating the
 * way a real one does: seconds per degree rise with the gap to ambient, and the
 * controller eases off over the last stretch. Power reports what it is doing,
 * which is what the recorder reads to tell full drive from the approach.
 */
function climb(options: {
  from: number
  target: number
  intervalSeconds?: number
  easesOffAt?: number
  startAt?: number
}): HeatObservation[] {
  const { from, target, intervalSeconds = 0.25, easesOffAt = target - 12, startAt = 0 } = options
  const samples: HeatObservation[] = []
  let temperature = from
  let eventtime = startAt

  samples.push({ eventtime, temperature, target, power: 1 })
  while (temperature < target) {
    const easing = temperature >= easesOffAt
    const power = easing ? 0.35 : 1
    // Degrees per second: falls as the gap to ambient grows, and again once the
    // controller stops driving flat out.
    const rate = (1 / (0.9 + temperature / 90)) * (easing ? 0.28 : 1)
    eventtime += intervalSeconds
    temperature = Math.min(target, temperature + rate * intervalSeconds)
    samples.push({ eventtime, temperature, target, power })
  }
  // A few samples holding at target, as a real feed would deliver.
  for (let index = 0; index < 4; index += 1) {
    eventtime += intervalSeconds
    samples.push({ eventtime, temperature: target, target, power: 0.3 })
  }
  return samples
}

function learn(samples: HeatObservation[], curve: HeatCurve = emptyCurve()): HeatCurve {
  const state = emptyRecorderState()
  let learned = curve
  for (const sample of samples) {
    learned = applyRecording(learned, recordObservation(state, sample))
  }
  return learned
}

describe('heat model bands', () => {
  it('splits a temperature into bands of a fixed width', () => {
    expect(bandFloor(0)).toBe(0)
    expect(bandFloor(27.4)).toBe(25)
    expect(bandFloor(215)).toBe(215)
  })

  /*
   * The measurement this model exists to make. The previous one averaged
   * seconds-per-degree across a whole heat-up and multiplied by the degrees
   * remaining, which is linear — and heating is not, because the power that
   * reaches the block is what is left after losses that grow with the gap to
   * ambient. One climb from cold has to answer for any stretch inside it.
   */
  it('answers 200 → 220 from a single climb that started at 27', () => {
    const samples = climb({ from: 27, target: 220 })
    const curve = learn(samples)

    const wholeClimb = samples[samples.length - 1]!.eventtime
    const lastStretch = estimateSeconds(curve, 200, 220)
    expect(lastStretch).not.toBeNull()

    // The honest check: the last twenty degrees take substantially longer than
    // the average degree of the climb, which is exactly what the old model got
    // wrong by assuming they did not.
    const averagePerDegree = wholeClimb / (220 - 27)
    expect(lastStretch!).toBeGreaterThan(averagePerDegree * 20 * 1.5)

    // And it is a real duration, not the whole climb over again.
    expect(lastStretch!).toBeLessThan(wholeClimb)
  })

  /*
   * Heating is not linear: the power reaching the block is what survives losses
   * that grow with the gap to ambient, so a degree near the top costs more than
   * one near the bottom. Measured as the difference between two estimates to
   * the same target, since that is the only shape the model answers in — a
   * destination it has never approached has an unmeasured final stretch, and it
   * declines rather than guessing at it.
   */
  it('knows a degree near the top costs more than one near the bottom', () => {
    const curve = learn(climb({ from: 25, target: 220 }))

    const lowStretch = estimateSeconds(curve, 60, 220)! - estimateSeconds(curve, 100, 220)!
    const highStretch = estimateSeconds(curve, 160, 220)! - estimateSeconds(curve, 200, 220)!

    expect(lowStretch).toBeGreaterThan(0)
    expect(highStretch).toBeGreaterThan(lowStretch)
  })

  it('answers for a target near one it has learned, not only for that one exactly', () => {
    const curve = learn(climb({ from: 25, target: 210 }))
    // Nobody sets exactly the temperature they last set. Borrowing the nearby
    // approach is an approximation, and the alternative is declining forever.
    expect(estimateSeconds(curve, 150, 215)).not.toBeNull()
    // But not one from a different part of the range entirely.
    expect(estimateSeconds(curve, 30, 60)).toBeNull()
  })

  /*
   * The controller eases off before the setpoint, so those degrees took longer
   * than a full-drive band and must not be filed as one — every later estimate
   * crossing them would inherit the error.
   */
  it('keeps the eased-off approach out of the shared band table', () => {
    const curve = learn(climb({ from: 25, target: 220, easesOffAt: 208 }))

    // The bands below where drive dropped are learned...
    expect(curve.bands['195']).toBeDefined()
    // ...and the ones inside the approach are not.
    expect(curve.bands['210']).toBeUndefined()
    expect(curve.bands['215']).toBeUndefined()

    const approach = curve.approach['220']
    expect(approach).toBeDefined()
    expect(approach!.fromTemperature).toBeLessThanOrEqual(210)
  })

  /*
   * A gap is never interpolated over. A band invented from its neighbours
   * produces a number indistinguishable from a measured one, and being
   * indistinguishable from a measurement is the one thing it must not be.
   */
  it('declines rather than inventing a band it has never measured', () => {
    // Learned only from 150 upward, so nothing below that exists.
    const curve = learn(climb({ from: 150, target: 220 }))

    expect(estimateSeconds(curve, 160, 200)).not.toBeNull()
    expect(estimateSeconds(curve, 40, 200)).toBeNull()
  })

  it('declines for a target it has no approach anywhere near', () => {
    const curve = learn(climb({ from: 25, target: 220 }))
    expect(estimateSeconds(curve, 30, 60)).toBeNull()
  })

  it('prorates the approach when the heater is already inside it', () => {
    const curve = learn(climb({ from: 25, target: 220, easesOffAt: 208 }))
    const whole = estimateSeconds(curve, 208, 220)
    const half = estimateSeconds(curve, 214, 220)

    expect(whole).not.toBeNull()
    expect(half).not.toBeNull()
    expect(half!).toBeLessThan(whole!)
  })

  it('never estimates a climb that is not one', () => {
    const curve = learn(climb({ from: 25, target: 220 }))
    expect(estimateSeconds(curve, 200, 200)).toBeNull()
    expect(estimateSeconds(curve, 200, 150)).toBeNull()
  })
})

describe('heat model recording guards', () => {
  /*
   * Asserted twice over, because these are the same defect and only one of
   * them is obvious: a heater fast enough to jump several bands per sample,
   * and an ordinary one whose status update arrived late. Either way the
   * interval did not resolve the bands it spans, and crediting them a fraction
   * of their true duration would persist and bias every later estimate.
   */
  it('records nothing from an interval that jumps more bands than it resolves', () => {
    // An induction hot end: 20 → 200 in about three seconds at 4 Hz.
    const fast = learn(
      climb({ from: 20, target: 200, intervalSeconds: 0.25, easesOffAt: 199 }).map(
        (sample, index) => ({ ...sample, temperature: Math.min(200, 20 + index * 15) }),
      ),
    )
    expect(Object.keys(fast.bands)).toHaveLength(0)

    // An ordinary climb whose status feed stalled for ten seconds mid-way. The
    // interval that resumes spans forty degrees, and crediting those eight
    // bands a fraction of their real duration is exactly the corruption that
    // would persist and make every later estimate optimistic.
    const stalled = emptyRecorderState()
    let curve = emptyCurve()
    const feed: HeatObservation[] = [
      { eventtime: 0, temperature: 100, target: 200, power: 1 },
      { eventtime: 0.25, temperature: 100.5, target: 200, power: 1 },
      // ...silence...
      { eventtime: 10.25, temperature: 140, target: 200, power: 1 },
      { eventtime: 10.5, temperature: 140.5, target: 200, power: 1 },
      { eventtime: 10.75, temperature: 141, target: 200, power: 1 },
    ]
    for (const sample of feed) curve = applyRecording(curve, recordObservation(stalled, sample))

    for (const floor of ['100', '105', '110', '115', '120', '125', '130', '135']) {
      expect(curve.bands[floor]).toBeUndefined()
    }
  })

  /*
   * Found on a real printer, on the first heat-up this model ever watched: it
   * recorded sixteen bands and no arrival at all.
   *
   * A sensor hunting around its setpoint dips by hundredths of a degree
   * constantly, and treating any fall as the end of a climb discarded the
   * approach a fraction of a second before it completed — so the one part of
   * the curve that can only be learned at the moment of arrival was the one
   * part that never survived to be stored.
   */
  it('records the arrival of a climb whose reading wobbles as it settles', () => {
    const state = emptyRecorderState()
    let curve = emptyCurve()
    const target = 150

    // Climb to just short of the target under easing power.
    let eventtime = 0
    for (let temperature = 120; temperature < 149; temperature += 0.5) {
      eventtime += 0.25
      curve = applyRecording(
        curve,
        recordObservation(state, { eventtime, temperature, target, power: 0.4 }),
      )
    }

    // The last stretch: rising overall, wobbling the way a real sensor does.
    for (const temperature of [149.2, 149.18, 149.31, 149.29, 149.44, 149.42, 149.53]) {
      eventtime += 0.25
      curve = applyRecording(
        curve,
        recordObservation(state, { eventtime, temperature, target, power: 0.25 }),
      )
    }

    expect(curve.approach['150']).toBeDefined()
    expect(curve.approach['150']!.seconds).toBeGreaterThan(0)
  })

  /*
   * The tolerance still has to notice a heater actually cooling, or a target
   * lowered mid-climb would keep folding into the climb it replaced.
   */
  it('still treats a real fall as the end of the climb', () => {
    const state = emptyRecorderState()
    const target = 200
    recordObservation(state, { eventtime: 0, temperature: 150, target, power: 1 })
    recordObservation(state, { eventtime: 1, temperature: 152, target, power: 1 })
    // Heater off at the wall: the reading drops away properly.
    recordObservation(state, { eventtime: 2, temperature: 140, target, power: 0 })

    expect(state.bandStartedAt).toBeNull()
    expect(state.peakTemperature).toBe(140)
  })

  /*
   * Also found on the printer. A heater already sitting at its target when
   * observation begins — a reload, a reconnect, a card mounted mid-print —
   * satisfies the settle test on its very first sample, and recorded an
   * "approach" of a sixth of a second that would then have been handed out as
   * an estimate for anything near that temperature.
   */
  it('records no arrival for a heater that was already there when watching began', () => {
    const state = emptyRecorderState()
    let curve = emptyCurve()
    // The card opens on a hot end already holding at its setpoint.
    for (const eventtime of [0, 0.25, 0.5, 0.75, 1]) {
      curve = applyRecording(
        curve,
        recordObservation(state, { eventtime, temperature: 150.3, target: 150, power: 0.24 }),
      )
    }
    expect(curve.approach).toEqual({})
  })

  it('times a crossing between samples rather than at one of them', () => {
    const state = emptyRecorderState()
    const target = 100
    // Two samples a second apart, straddling the 30° boundary near its start.
    recordObservation(state, { eventtime: 0, temperature: 25, target, power: 1 })
    recordObservation(state, { eventtime: 1, temperature: 30.1, target, power: 1 })
    const result = recordObservation(state, {
      eventtime: 2,
      temperature: 35.1,
      target,
      power: 1,
    })

    const band = result.bands.find((entry) => entry.floor === 30)
    expect(band).toBeDefined()
    // Both boundaries are crossed just after a sample, so the band is close to
    // a whole second — quantising to the sample times would give exactly 1.
    expect(band!.seconds).toBeGreaterThan(0.9)
    expect(band!.seconds).toBeLessThan(1.1)
    expect(band!.seconds).not.toBe(1)
  })

  it('discards a climb whose target changed part-way through', () => {
    const state = emptyRecorderState()
    let curve = emptyCurve()
    for (const sample of climb({ from: 25, target: 200 }).slice(0, 60)) {
      curve = applyRecording(curve, recordObservation(state, sample))
    }
    const learnedSoFar = Object.keys(curve.bands).length
    expect(learnedSoFar).toBeGreaterThan(0)

    // The user asks for something else: the climb in flight described the old
    // request and its partial band is abandoned rather than attributed.
    const after = recordObservation(state, {
      eventtime: 999,
      temperature: 90,
      target: 240,
      power: 1,
    })
    expect(after.bands).toHaveLength(0)
    expect(after.approach).toBeNull()
  })

  it('learns nothing from a heater that is switched off', () => {
    const state = emptyRecorderState()
    const result = recordObservation(state, {
      eventtime: 1,
      temperature: 80,
      target: 0,
      power: 0,
    })
    expect(result.bands).toHaveLength(0)
  })

  it('folds a repeated climb toward the newer measurement', () => {
    const slow = learn(climb({ from: 25, target: 120 }))
    const slowBand = slow.bands['80']!.seconds

    // The same heater with a part-cooling fan now blowing on it: slower.
    const again = learn(
      climb({ from: 25, target: 120 }).map((sample, index, all) => ({
        ...sample,
        eventtime: sample.eventtime + (index / all.length) * 60,
      })),
      slow,
    )

    expect(again.bands['80']!.count).toBe(2)
    expect(again.bands['80']!.seconds).toBeGreaterThan(slowBand)
  })
})

describe('heat curve identity', () => {
  const pid = {
    control: 'pid',
    max_power: 1,
    pid_kp: 70.787,
    pid_ki: 1.532,
    pid_kd: 817.59,
    min_temp: 0,
  }
  const mpc = {
    control: 'mpc',
    max_power: 1,
    heater_power: 40,
    block_heat_capacity: 18.7534,
    ambient_transfer: 0.0721552,
    sensor_responsiveness: 0.0434625,
    fan_ambient_transfer: [0.0721552, 0.0938029],
  }

  /*
   * The behaviour a recalibration should have: not invalidation, but a new
   * table. Restoring the old constants restores the measurements taken under
   * them, which falls out of storing the curve under this rather than checking
   * it against this.
   */
  it('changes when a calibration changes, and changes back when it is restored', () => {
    const original = fingerprintFor(pid)
    const recalibrated = fingerprintFor({ ...pid, pid_kp: 66.2 })
    const restored = fingerprintFor({ ...pid })

    expect(recalibrated).not.toBe(original)
    expect(restored).toBe(original)
  })

  it('ignores settings that do not change how the heater drives', () => {
    // A different sensor or temperature limit does not make it a different
    // heater, and treating it as one would throw away good measurements.
    expect(fingerprintFor({ ...pid, min_temp: 5, sensor_type: 'PT1000' })).toBe(fingerprintFor(pid))
  })

  it('notices every value a calibration writes, for both control schemes', () => {
    for (const key of ['pid_kp', 'pid_ki', 'pid_kd', 'max_power']) {
      expect(fingerprintFor({ ...pid, [key]: 1.234 })).not.toBe(fingerprintFor(pid))
    }
    for (const key of [
      'block_heat_capacity',
      'ambient_transfer',
      'sensor_responsiveness',
      'fan_ambient_transfer',
      'heater_power',
      'max_power',
    ]) {
      expect(fingerprintFor({ ...mpc, [key]: 9.99 })).not.toBe(fingerprintFor(mpc))
    }
  })

  it('tells the two control schemes apart even with everything else equal', () => {
    expect(fingerprintFor({ control: 'pid', max_power: 1 })).not.toBe(
      fingerprintFor({ control: 'mpc', max_power: 1 }),
    )
  })

  it('survives a heater whose configuration was never loaded', () => {
    expect(fingerprintFor(null)).toBe('unknown')
    expect(fingerprintFor(undefined)).toBe('unknown')
  })
})
