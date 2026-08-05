import { describe, expect, it } from 'vitest'

import {
  downsample,
  linePath,
  stepPath,
  steppedBound,
  timeScale,
  valueScale,
  type TimedValue,
} from '@/dashboard/chartGeometry'

function ramp(from: number, to: number, count: number, startAt = 0): TimedValue[] {
  return Array.from({ length: count }, (_, index) => ({
    eventtime: startAt + index,
    value: from + ((to - from) * index) / (count - 1),
  }))
}

describe('chart value scale', () => {
  /*
   * The shortcut this exists to refuse. Snapping the bounds outward onto the
   * tick step turns a 26–228° climb into a 0–300° axis, which spends a quarter
   * of a 271px card on air the trace never reaches.
   */
  it('spends its height on the data rather than on empty air', () => {
    const scale = valueScale([ramp(26, 228, 50)], { activeTargets: [215] })

    // Snapping outward onto the tick step drew 0–300 here, leaving a quarter of
    // the plot above a trace that never reached it. The stepped bound still
    // rounds, but to a grid fine enough that the data keeps most of the height.
    const occupied = (228 - 26) / (scale.maximum - scale.minimum)
    expect(occupied).toBeGreaterThan(0.75)
    expect(scale.maximum).toBeLessThan(260)

    // The round numbers are still round, and all of them are inside the plot.
    expect(scale.ticks.length).toBeGreaterThanOrEqual(3)
    for (const tick of scale.ticks) {
      expect(tick).toBeGreaterThanOrEqual(scale.minimum)
      expect(tick).toBeLessThanOrEqual(scale.maximum)
      expect(tick % 10).toBe(0)
    }
  })

  /*
   * An idle printer drifts a few tenths of a degree. Fitted to the data alone
   * that fills the plot with a mountain range, and a user reads a fault into a
   * machine that is simply sitting still.
   */
  it('refuses to magnify the noise of a stable reading', () => {
    const scale = valueScale([
      [
        { eventtime: 0, value: 26.9 },
        { eventtime: 1, value: 27.1 },
        { eventtime: 2, value: 27.0 },
      ],
    ])
    // Two tenths of drift must stay a flat line, not a mountain range. What
    // matters is the share of the plot it occupies, not a fixed span — the
    // frame is chosen from the data now, so a hard 20 would be the wrong test.
    expect(0.2 / (scale.maximum - scale.minimum)).toBeLessThan(0.05)
  })

  /*
   * An idle heater reports target 0. Letting that into the range drags the
   * floor to zero and squashes every real reading into the top of the plot.
   */
  it('never widens the range to include a heater that is switched off', () => {
    const withIdleHeater = valueScale([ramp(200, 220, 20)])
    const withActiveTarget = valueScale([ramp(200, 220, 20)], { activeTargets: [240] })

    expect(withIdleHeater.minimum).toBeGreaterThan(150)
    expect(withActiveTarget.maximum).toBeGreaterThanOrEqual(240)
  })

  it('produces a usable axis before any reading has arrived', () => {
    const scale = valueScale([])
    expect(Number.isFinite(scale.minimum)).toBe(true)
    expect(Number.isFinite(scale.maximum)).toBe(true)
    expect(scale.maximum).toBeGreaterThan(scale.minimum)
  })

  /*
   * A bound fitted tightly to the data is redrawn on every push, so during a
   * heat-up the whole plot creeps downward under a trace trying to climb —
   * gridlines sliding, labels renumbering, nothing holding still to be read.
   * The axis moves in whole steps instead, with room left above the reading.
   */
  it('leaves headroom above the reading and moves in whole steps', () => {
    // A full heat-up: the coarse rung, ten degrees of room, a round number.
    const climb = valueScale([ramp(27, 211, 40)])
    expect(climb.maximum).toBe(240)
    expect(climb.maximum % 20).toBe(0)
    expect(climb.maximum - 211).toBeGreaterThanOrEqual(10)
  })

  /*
   * One step cannot serve both cases. Twenty is right for a heat-up and far
   * too coarse for two sensors nine degrees apart — it framed 29–38 as 20–60
   * and spent three quarters of the plot on nothing.
   */
  it('picks a finer step when the readings are close together', () => {
    const near = valueScale([
      [
        { eventtime: 0, value: 29.04 },
        { eventtime: 1, value: 38.28 },
      ],
    ])
    const wide = valueScale([ramp(27, 215, 40)])

    expect(near.maximum - near.minimum).toBeLessThanOrEqual(25)
    expect((38.28 - 29.04) / (near.maximum - near.minimum)).toBeGreaterThan(0.4)
    // And the coarse case is not dragged finer, which would crowd its labels.
    expect(wide.maximum % 20).toBe(0)
    expect(wide.minimum % 20).toBe(0)
  })

  it('anchors the floor at zero when asked, and only then', () => {
    const fitted = valueScale([ramp(60, 215, 30)])
    const anchored = valueScale([ramp(60, 215, 30)], { lockToZero: true })

    expect(fitted.minimum).toBeGreaterThan(0)
    expect(anchored.minimum).toBe(0)
    expect(anchored.maximum).toBe(fitted.maximum)
  })

  /*
   * With scaling off the axis is the machine's own ceiling, so every frame is
   * the same frame and a reading can be compared against one seen an hour ago.
   */
  it('holds the machine ceiling when it is given one, whatever the data does', () => {
    const cold = valueScale([ramp(25, 30, 10)], { fixedMaximum: 300, lockToZero: true })
    const hot = valueScale([ramp(25, 280, 10)], { fixedMaximum: 300, lockToZero: true })

    expect(cold.maximum).toBe(300)
    expect(hot.maximum).toBe(300)
    expect(cold.minimum).toBe(0)
    expect(cold.ticks).toEqual(hot.ticks)
  })

  /*
   * The hysteresis. A bed holding at exactly the value the axis wants to end
   * at would otherwise flip the whole plot between two framings every second
   * as its last decimal moved.
   */
  it('holds its bound until the data leaves it by a whole step', () => {
    // Sitting just under the boundary: the axis stays where it settled.
    expect(steppedBound(209, 220, 'up')).toBe(220)
    // Crossing it: one step up, not a continuous slide.
    expect(steppedBound(211, 220, 'up')).toBe(240)
    // Falling back a little does not undo it — that is the flap this prevents.
    expect(steppedBound(209, 240, 'up')).toBe(240)
    // Falling back a long way does.
    expect(steppedBound(100, 240, 'up')).toBe(120)
  })

  /*
   * The case the dead band exists for, and the one a bare "retreat by a step"
   * rule gets wrong: a heater holding steady while its last decimal wobbles
   * across a boundary. Releasing exactly on the next level's trigger makes the
   * whole plot flip between two framings, once a second, indefinitely.
   */
  it('never reframes for a heater merely holding near a boundary', () => {
    const framings = new Set<string>()
    // Let the axis settle first: the first frame after a mount legitimately
    // picks a framing, and what matters is that it then stops picking new ones.
    const settle = valueScale([[{ eventtime: 0, value: 210.4 }]])
    let bounds: { minimum: number; maximum: number } | null = {
      minimum: settle.minimum,
      maximum: settle.maximum,
    }

    // Ten seconds of a bed sitting at 210, drifting either side of it.
    for (const value of [209.8, 210.4, 209.6, 210.1, 210.6, 209.4, 210.2, 209.9]) {
      const scale = valueScale([[{ eventtime: 0, value }]], { previous: bounds })
      bounds = { minimum: scale.minimum, maximum: scale.maximum }
      framings.add(`${scale.minimum}/${scale.maximum}`)
    }

    expect(framings.size).toBe(1)
  })

  it('settles rather than walking when its own result is fed back', () => {
    const series = [[{ eventtime: 0, value: 211 }]]
    let bounds: { minimum: number; maximum: number } | null = null
    const seen = new Set<string>()
    for (let pass = 0; pass < 5; pass += 1) {
      const scale = valueScale(series, { previous: bounds })
      bounds = { minimum: scale.minimum, maximum: scale.maximum }
      seen.add(`${scale.minimum}/${scale.maximum}`)
    }
    // One framing across every pass: the computed can re-evaluate freely.
    expect(seen.size).toBe(1)
  })

  it('keeps a heat-up legible rather than giving it two gridlines', () => {
    // `1/2/5 × 10ⁿ` alone jumps from 10 to 100 across exactly this range.
    const scale = valueScale([ramp(26, 228, 50)], { activeTargets: [215] })
    expect(scale.ticks.length).toBeGreaterThanOrEqual(4)
  })
})

describe('chart time scale', () => {
  /*
   * The window is anchored to the newest sample, never stretched to whatever
   * history happens to exist. Forty seconds of session draws forty seconds of
   * trace against the right edge, rather than a full-width line claiming to be
   * five minutes that were never recorded.
   */
  it('anchors the window to the newest sample however little history exists', () => {
    const young = timeScale({
      latestEventtime: 40,
      windowSeconds: 300,
      wallClockOffsetSeconds: 0,
    })
    expect(young.end).toBe(40)
    expect(young.start).toBe(-260)

    const old = timeScale({
      latestEventtime: 9_000,
      windowSeconds: 300,
      wallClockOffsetSeconds: 0,
    })
    expect(old.end - old.start).toBe(young.end - young.start)
  })

  /*
   * Ticks on wall-clock boundaries, not equal fractions of the window — the
   * latter reads as an irregular 23:02 / 23:03 / 23:05 / 23:07.
   */
  it('lands its ticks on round wall-clock times', () => {
    const scale = timeScale({
      latestEventtime: 1_000,
      windowSeconds: 300,
      // eventtime 1000 is 23:07:13 on the wall.
      wallClockOffsetSeconds: 23 * 3600 + 7 * 60 + 13 - 1_000,
    })

    expect(scale.ticks.length).toBeGreaterThanOrEqual(3)
    for (const tick of scale.ticks) {
      expect(tick.wallSeconds % 60).toBe(0)
      expect(tick.eventtime).toBeGreaterThanOrEqual(scale.start)
      expect(tick.eventtime).toBeLessThanOrEqual(scale.end)
    }

    // Evenly spaced, and spaced by something a clock is read in.
    const gaps = scale.ticks
      .slice(1)
      .map((tick, index) => tick.wallSeconds - scale.ticks[index]!.wallSeconds)
    expect(new Set(gaps).size).toBeLessThanOrEqual(1)
  })

  /*
   * A scrolling axis is drawn shifted by a fraction of a step, so the tick
   * about to enter the plot has to exist before it is needed — without the
   * overscan it springs into being against the edge instead of sliding in.
   * The caller clips, which is why these are allowed outside the window.
   */
  it('offers whole spare steps beyond each end for a scrolling axis to slide in', () => {
    const options = {
      latestEventtime: 1_000,
      windowSeconds: 300,
      wallClockOffsetSeconds: 23 * 3600 + 7 * 60 + 13 - 1_000,
    }
    const still = timeScale(options)
    const scrolling = timeScale({ ...options, overscanSteps: 1 })

    // One extra at each end, on the same rhythm, and the window itself is
    // untouched — only the ticks offered for it reach further.
    expect(scrolling.ticks.length).toBe(still.ticks.length + 2)
    expect(scrolling.start).toBe(still.start)
    expect(scrolling.end).toBe(still.end)
    expect(scrolling.ticks[1]?.wallSeconds).toBe(still.ticks[0]?.wallSeconds)
    expect(scrolling.ticks[0]!.eventtime).toBeLessThan(still.start)
    expect(scrolling.ticks[scrolling.ticks.length - 1]!.eventtime).toBeGreaterThan(still.end)
    for (const tick of scrolling.ticks) expect(tick.wallSeconds % 60).toBe(0)
  })
})

describe('chart downsampling', () => {
  /*
   * Plain striding is what loses a spike: drop three points in four and the one
   * sample where a heater overshot is discarded three times out of four.
   */
  it('keeps an extreme that striding would throw away', () => {
    const points = ramp(200, 210, 400)
    points[137] = { eventtime: 137, value: 260 }

    const thinned = downsample(points, 60)
    expect(thinned.length).toBeLessThanOrEqual(70)
    expect(thinned.some((point) => point.value === 260)).toBe(true)
  })

  it('keeps the newest sample, so the trace reaches the axis', () => {
    const points = ramp(20, 200, 500)
    const thinned = downsample(points, 40)
    expect(thinned[thinned.length - 1]?.eventtime).toBe(points[points.length - 1]?.eventtime)
  })

  /*
   * The mirror of the rule above. A bucket contributes its extremes by value,
   * which can land most of a bucket after the data really starts — and the
   * chart deliberately holds samples from before its window so the trace runs
   * out past the plot's clipped left edge. Bucketing that margin away puts the
   * end of the line back inside the plot, where it shows as a gap that opens
   * and snaps shut once a second.
   */
  it('keeps the oldest sample, so the trace runs past the clipped edge', () => {
    const points = ramp(20, 200, 500)
    const thinned = downsample(points, 40)
    expect(thinned[0]?.eventtime).toBe(points[0]?.eventtime)
  })

  it('never reorders time', () => {
    const points = ramp(20, 200, 500)
    const thinned = downsample(points, 50)
    for (let index = 1; index < thinned.length; index += 1) {
      expect(thinned[index]!.eventtime).toBeGreaterThanOrEqual(thinned[index - 1]!.eventtime)
    }
  })

  it('leaves a series that already fits alone', () => {
    const points = ramp(20, 30, 10)
    expect(downsample(points, 60)).toEqual(points)
  })
})

describe('chart paths', () => {
  const x = (eventtime: number) => eventtime
  const y = (value: number) => value

  it('draws nothing from a single point', () => {
    expect(linePath([{ eventtime: 0, value: 1 }], x, y)).toBe('')
    expect(stepPath([{ eventtime: 0, value: 1 }], x, y)).toBe('')
  })

  /*
   * A setpoint is held and then changed at an instant. Drawing it as a slope
   * shows a ramp from 0 to 215 that the printer was never asked to perform.
   */
  it('draws a target as a staircase rather than a ramp', () => {
    const path = stepPath(
      [
        { eventtime: 0, value: 0 },
        { eventtime: 10, value: 215 },
        { eventtime: 20, value: 215 },
      ],
      x,
      y,
    )
    // The corner: travel along the old value to the moment of change, then up.
    expect(path).toContain('L10.0 0.0')
    expect(path).toContain('L10.0 215.0')
  })
})
