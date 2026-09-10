import { describe, expect, it } from 'vitest'

import {
  GcodeQualityGovernor,
  defaultGcodeQualitySettings,
  defaultGcodeTierCeiling,
  gcodeLargeFileTierBytes,
  gcodeQualityStepCount,
  gcodeTierFor,
  isGcodeRenderTier,
} from '@/features/gcode/quality'
import type { GcodeRenderTier } from '@/features/gcode/scene'

/**
 * Quality is split across two levers that cost different things, and these
 * tests hold that split. The governor may spend resolution, which is free
 * between two frames and reversible; it may not spend the tier, which costs a
 * reparse. So what is pinned here is that the governor moves only on sustained
 * evidence, that the two manual modes really do bound it, and that the one
 * signal which does reach the expensive lever fires once per bad stretch.
 */

const slow = defaultGcodeQualitySettings.targetFrameMilliseconds + 10
const fast = defaultGcodeQualitySettings.recoverFrameMilliseconds - 4

function feed(governor: GcodeQualityGovernor, interval: number, frames: number) {
  let last = governor.sample(interval)
  for (let frame = 1; frame < frames; frame += 1) last = governor.sample(interval)
  return last
}

/** Samples slow frames until the resolution ladder is spent, reporting what it saw on the way. */
function walkToFloor(governor: GcodeQualityGovernor): { exhaustedOnTheWay: boolean } {
  let frames = 0
  let exhaustedOnTheWay = false
  while (governor.currentStep() < gcodeQualityStepCount - 1) {
    if (governor.sample(slow).tierExhausted) exhaustedOnTheWay = true
    frames += 1
    // A guard rather than a bare loop: a governor that stopped descending
    // should fail this helper instead of hanging the suite.
    if (frames > 10_000) throw new Error('the governor never reached the bottom of the ladder')
  }
  return { exhaustedOnTheWay }
}

describe('GcodeQualityGovernor', () => {
  it('starts at full resolution and stays there while frames are fast', () => {
    const governor = new GcodeQualityGovernor('auto')

    const report = feed(governor, fast, 200)

    expect(report.step).toBe(0)
    expect(report.state.resolutionScale).toBe(2)
    expect(report.changed).toBe(false)
  })

  it('degrades only after sustained slow frames, not on one long frame', () => {
    const governor = new GcodeQualityGovernor('auto')

    expect(governor.sample(slow).step).toBe(0)
    expect(
      feed(governor, slow, defaultGcodeQualitySettings.slowFramesBeforeDegrading - 2).step,
    ).toBe(0)
    expect(feed(governor, slow, 4).step).toBe(1)
  })

  /**
   * Resolution is the only thing the governor gives up, and it gives it up one
   * named rung at a time. A rung that moved by a formula, or a step that could
   * run past the end of the ladder, would put the scene at a scale nobody
   * reviewed.
   */
  it('walks the resolution ladder down in order and stops at its last rung', () => {
    const governor = new GcodeQualityGovernor('auto')
    const scales: number[] = [governor.state().resolutionScale]

    for (let step = 0; step < gcodeQualityStepCount + 2; step += 1) {
      // Exactly one degrade's worth of frames, so the returned report is the
      // one that moved — or, past the last rung, one that could not.
      const report = feed(governor, slow, defaultGcodeQualitySettings.slowFramesBeforeDegrading)
      if (report.changed) scales.push(report.state.resolutionScale)
      expect(report.step).toBeLessThanOrEqual(gcodeQualityStepCount - 1)
    }

    expect(scales).toHaveLength(gcodeQualityStepCount)
    for (let index = 1; index < scales.length; index += 1) {
      expect(scales[index]!).toBeLessThan(scales[index - 1]!)
    }
    expect(governor.currentStep()).toBe(gcodeQualityStepCount - 1)
  })

  it('recovers only with much more evidence than it degraded on', () => {
    const governor = new GcodeQualityGovernor('auto')
    feed(governor, slow, defaultGcodeQualitySettings.slowFramesBeforeDegrading + 1)
    expect(governor.currentStep()).toBe(1)

    // Degrading took a dozen frames; recovering must take the full run, so a
    // brief quiet moment cannot start an oscillation the user watches.
    expect(
      feed(governor, fast, defaultGcodeQualitySettings.fastFramesBeforeRecovering - 10).step,
    ).toBe(1)
    expect(feed(governor, fast, defaultGcodeQualitySettings.fastFramesBeforeRecovering).step).toBe(
      0,
    )
  })

  it('does not oscillate when frames sit either side of the target', () => {
    const governor = new GcodeQualityGovernor('auto')
    let changes = 0
    for (let frame = 0; frame < 400; frame += 1) {
      // Alternating around the threshold: neither counter can ever accumulate.
      if (governor.sample(frame % 2 === 0 ? slow : fast).changed) changes += 1
    }

    expect(changes).toBe(0)
  })

  /**
   * A tab returning from the background reports one enormous interval. It says
   * nothing about what this device can draw, so acting on it would drop the
   * scene's resolution for a machine that was never slow — and the sample is
   * discarded outright rather than merely being outvoted by its neighbours.
   */
  it('discards the enormous interval a backgrounded tab reports', () => {
    const governor = new GcodeQualityGovernor('auto')

    let report = governor.sample(4_000)
    for (let frame = 0; frame < 40; frame += 1) report = governor.sample(4_000)

    expect(governor.currentStep()).toBe(0)
    expect(report.medianFrameMilliseconds).toBe(0)
    expect(report.tierExhausted).toBe(false)
  })

  it('pins Quality mode at full resolution no matter how slow frames get', () => {
    const governor = new GcodeQualityGovernor('quality')

    const report = feed(governor, slow * 4, 500)

    expect(report.step).toBe(0)
    expect(report.state.resolutionScale).toBe(2)
  })

  it('starts Performance mode already reduced but lets it climb back', () => {
    const governor = new GcodeQualityGovernor('performance')

    expect(governor.currentStep()).toBeGreaterThan(0)
    expect(governor.state().resolutionScale).toBeLessThan(2)
    expect(
      feed(governor, fast, defaultGcodeQualitySettings.fastFramesBeforeRecovering).changed,
    ).toBe(true)
    expect(governor.currentStep()).toBe(1)
  })

  it('takes the mode change as the new starting point and drops the old evidence', () => {
    const governor = new GcodeQualityGovernor('auto')
    feed(governor, slow, defaultGcodeQualitySettings.slowFramesBeforeDegrading - 1)

    governor.setMode('performance')

    expect(governor.currentStep()).toBe(2)
    // The near-complete slow streak was discarded, so one more slow frame
    // cannot tip it over.
    expect(governor.sample(slow).changed).toBe(false)
  })

  it('clears its counters on reset, because a new file is a new measurement', () => {
    const governor = new GcodeQualityGovernor('auto')
    feed(governor, slow, defaultGcodeQualitySettings.slowFramesBeforeDegrading - 1)

    governor.reset()

    expect(governor.sample(slow).changed).toBe(false)
    expect(governor.sample(slow).medianFrameMilliseconds).toBe(slow)
    expect(governor.currentStep()).toBe(0)
  })

  it('reports a median frame time for the diagnostics overlay', () => {
    const governor = new GcodeQualityGovernor('auto')

    governor.sample(10)
    governor.sample(20)
    const report = governor.sample(30)

    expect(report.medianFrameMilliseconds).toBe(20)
  })
})

/**
 * `tierExhausted` is the only measurement that reaches the expensive lever: the
 * page lowers this device's stored tier ceiling when it sees one, which changes
 * what the *next* load looks like. So it has to be scarce in both directions —
 * never raised while there is still free resolution to spend, and raised once
 * per bad stretch rather than once per slow frame, since a merely busy machine
 * that reported it repeatedly would walk itself down to the cheapest tier it
 * has and stay there.
 */
describe('tierExhausted', () => {
  it('stays quiet while there is still resolution ladder left to spend', () => {
    const governor = new GcodeQualityGovernor('auto')

    const { exhaustedOnTheWay } = walkToFloor(governor)

    expect(exhaustedOnTheWay).toBe(false)
  })

  it('is reported once for one bad stretch, not once per slow frame', () => {
    const governor = new GcodeQualityGovernor('auto')
    walkToFloor(governor)

    let fires = 0
    const stretch = defaultGcodeQualitySettings.slowFramesBeforeLoweringTier * 2 - 1
    for (let frame = 0; frame < stretch; frame += 1) {
      if (governor.sample(slow).tierExhausted) fires += 1
    }

    expect(fires).toBe(1)
  })

  it('needs far more evidence than a resolution step does', () => {
    const governor = new GcodeQualityGovernor('auto')
    walkToFloor(governor)

    // One degrade's worth of slow frames at the floor is not a verdict about
    // the device; writing a lower ceiling on that little would be.
    expect(
      feed(governor, slow, defaultGcodeQualitySettings.slowFramesBeforeDegrading).tierExhausted,
    ).toBe(false)
    expect(defaultGcodeQualitySettings.slowFramesBeforeLoweringTier).toBeGreaterThan(
      defaultGcodeQualitySettings.slowFramesBeforeDegrading,
    )
  })

  it('forgets a partial bad stretch once frames come good again', () => {
    const governor = new GcodeQualityGovernor('auto')
    walkToFloor(governor)
    feed(governor, slow, defaultGcodeQualitySettings.slowFramesBeforeLoweringTier - 1)

    governor.sample(fast)

    expect(
      feed(governor, slow, defaultGcodeQualitySettings.slowFramesBeforeLoweringTier - 1)
        .tierExhausted,
    ).toBe(false)
  })
})

/**
 * The tier is chosen once per load, from the mode the user picked and from what
 * this device has already been seen to hold. Every answer has to be a tier the
 * library actually offers: tier 6 forces solid blocks with no decimation at any
 * file size, and tier 0 does not exist, so an off-by-one here ends a session in
 * a dead tab rather than in a coarse picture.
 */
describe('gcodeTierFor', () => {
  const tiers: GcodeRenderTier[] = [1, 2, 3, 4, 5]

  it('gives Quality the richest tier whatever the device has been seen to hold', () => {
    for (const ceiling of tiers) {
      expect(gcodeTierFor('quality', ceiling, 0)).toBe(5)
      expect(gcodeTierFor('quality', ceiling, gcodeLargeFileTierBytes * 4)).toBe(5)
    }
  })

  it('holds Performance at the cheap tiers, and cheapest of all on a large file', () => {
    expect(gcodeTierFor('performance', 5, 0)).toBe(2)
    expect(gcodeTierFor('performance', 5, gcodeLargeFileTierBytes + 1)).toBe(1)
  })

  it('follows the learned ceiling in Auto rather than a nominal default', () => {
    for (const ceiling of tiers) {
      expect(gcodeTierFor('auto', ceiling, 0)).toBe(ceiling)
    }
  })

  /**
   * A tier is a vertex budget, so the same budget spread over a much larger
   * file means much heavier decimation anyway. Starting a rung lower reaches
   * the same picture without the reparse that finding out the hard way costs.
   */
  it('steps one tier below the ceiling for a large file, and only above the threshold', () => {
    expect(gcodeTierFor('auto', 4, gcodeLargeFileTierBytes + 1)).toBe(3)
    expect(gcodeTierFor('auto', 4, gcodeLargeFileTierBytes)).toBe(4)
    expect(gcodeTierFor('auto', defaultGcodeTierCeiling, 0)).toBe(defaultGcodeTierCeiling)
  })

  it('never answers with a tier the library does not offer', () => {
    // The bottom of the ladder plus a large file is where the arithmetic would
    // otherwise produce tier 0.
    expect(gcodeTierFor('auto', 1, gcodeLargeFileTierBytes * 10)).toBe(1)
    for (const mode of ['quality', 'auto', 'performance'] as const) {
      for (const ceiling of tiers) {
        for (const bytes of [0, 1, gcodeLargeFileTierBytes, gcodeLargeFileTierBytes + 1]) {
          const tier = gcodeTierFor(mode, ceiling, bytes)
          expect(isGcodeRenderTier(tier)).toBe(true)
        }
      }
    }
  })
})

describe('isGcodeRenderTier', () => {
  it('accepts every tier the library offers', () => {
    for (const tier of [1, 2, 3, 4, 5]) expect(isGcodeRenderTier(tier)).toBe(true)
  })

  /**
   * This guards stored values, which is the only place a bad tier can come
   * from: tier 6 is the library's undecimated mode and deliberately never
   * offered, and a string is what `localStorage` hands back unparsed.
   */
  it('rejects the tiers either side of the ladder and anything that is not a number', () => {
    for (const value of [0, 6, -1, 2.5, Number.NaN]) expect(isGcodeRenderTier(value)).toBe(false)
    for (const value of ['3', null, undefined, {}, [], true]) {
      expect(isGcodeRenderTier(value)).toBe(false)
    }
  })
})
