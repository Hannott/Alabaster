import { describe, expect, it } from 'vitest'

import {
  GcodeQualityGovernor,
  defaultGcodeQualitySettings,
  gcodeBeadProfileFor,
  gcodeQualityStepCount,
  gcodeSubPixelStrategyFor,
} from '@/features/gcode/quality'

/**
 * The governor spends a measurement, so its whole value depends on measuring
 * honestly and moving predictably. These tests pin the order it gives things
 * up, that it needs sustained evidence in both directions, and that the two
 * manual modes really do bound it.
 */

function feed(governor: GcodeQualityGovernor, interval: number, frames: number) {
  let last = governor.sample(interval)
  for (let frame = 1; frame < frames; frame += 1) last = governor.sample(interval)
  return last
}

const slow = defaultGcodeQualitySettings.targetFrameMilliseconds + 10
const fast = defaultGcodeQualitySettings.recoverFrameMilliseconds - 4

describe('GcodeQualityGovernor', () => {
  it('starts at full quality and stays there while frames are fast', () => {
    const governor = new GcodeQualityGovernor('auto')

    const report = feed(governor, fast, 200)

    expect(report.step).toBe(0)
    expect(report.state).toMatchObject({ tierBias: 1, resolutionScale: 2, contactShadow: true })
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
   * Geometry detail is given up before resolution, and the contact shadow last:
   * losing the shadow flattens the scene, so it buys the most and costs the
   * most. A reordering here would change what the viewer looks like under load.
   */
  it('gives things up in the documented order', () => {
    const governor = new GcodeQualityGovernor('auto')
    const seen: Array<{
      step: number
      tierBias: number
      resolutionScale: number
      shadow: boolean
    }> = []

    for (let step = 0; step < gcodeQualityStepCount + 2; step += 1) {
      const report = feed(governor, slow, defaultGcodeQualitySettings.slowFramesBeforeDegrading + 1)
      seen.push({
        step: report.step,
        tierBias: report.state.tierBias,
        resolutionScale: report.state.resolutionScale,
        shadow: report.state.contactShadow,
      })
    }

    // Tier bias rises before resolution falls.
    expect(seen[0]).toMatchObject({ step: 1, tierBias: 1.6, resolutionScale: 2 })
    expect(seen[1]).toMatchObject({ step: 2, resolutionScale: 1.5 })
    // The shadow survives every step but the last.
    const withoutShadow = seen.filter((entry) => !entry.shadow)
    expect(withoutShadow.length).toBeGreaterThan(0)
    for (const entry of withoutShadow) expect(entry.step).toBe(gcodeQualityStepCount - 1)
    // Never past the end of the ladder.
    expect(Math.max(...seen.map((entry) => entry.step))).toBe(gcodeQualityStepCount - 1)
  })

  it('recovers only with much more evidence than it degraded on', () => {
    const governor = new GcodeQualityGovernor('auto')
    feed(governor, slow, defaultGcodeQualitySettings.slowFramesBeforeDegrading + 1)
    expect(governor.currentStep()).toBe(1)

    // Degrading took 12 frames; recovering must take the full 90, so a brief
    // quiet moment cannot start an oscillation.
    expect(feed(governor, fast, 40).step).toBe(1)
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

  it('ignores the enormous interval a backgrounded tab reports', () => {
    const governor = new GcodeQualityGovernor('auto')

    for (let frame = 0; frame < 20; frame += 1) governor.sample(4_000)

    expect(governor.currentStep()).toBe(0)
  })

  it('pins Quality mode at full detail no matter how slow frames get', () => {
    const governor = new GcodeQualityGovernor('quality')

    const report = feed(governor, slow * 4, 500)

    expect(report.step).toBe(0)
    expect(report.state.resolutionScale).toBe(2)
    expect(report.state.contactShadow).toBe(true)
  })

  it('starts Performance mode already reduced but lets it climb back', () => {
    const governor = new GcodeQualityGovernor('performance')

    expect(governor.currentStep()).toBe(2)
    expect(
      feed(governor, fast, defaultGcodeQualitySettings.fastFramesBeforeRecovering + 1).step,
    ).toBe(1)
  })

  it('resets its evidence when the mode changes', () => {
    const governor = new GcodeQualityGovernor('auto')
    feed(governor, slow, defaultGcodeQualitySettings.slowFramesBeforeDegrading - 1)

    governor.setMode('auto')

    // The near-complete slow streak was discarded, so one more slow frame
    // cannot tip it over.
    expect(governor.sample(slow).step).toBe(0)
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
 * Bead shape is the one quality decision the governor is not allowed to take.
 * It is the most visible thing on screen, so it answers to the mode the user
 * chose and to nothing else — not to a frame-time streak, and not to the
 * camera. A bead that changed shape mid-orbit would read as a rendering fault
 * rather than as an adaptation.
 */
describe('gcodeBeadProfileFor', () => {
  it('squares the bead only where speed was chosen over fidelity', () => {
    expect(gcodeBeadProfileFor('performance')).toBe('square')
  })

  it('keeps rounded beads in both modes that did not ask for speed', () => {
    expect(gcodeBeadProfileFor('quality')).toBe('round')
    expect(gcodeBeadProfileFor('auto')).toBe('round')
  })

  it('does not follow the governor down its ladder', () => {
    // Auto degrades all the way to its last step under sustained slow frames;
    // the profile it reports must be the same at the bottom as at the top.
    const governor = new GcodeQualityGovernor('auto')
    feed(governor, slow, defaultGcodeQualitySettings.slowFramesBeforeDegrading * 20)

    expect(governor.currentStep()).toBe(gcodeQualityStepCount - 1)
    expect(gcodeBeadProfileFor('auto')).toBe('round')
  })
})

/**
 * Far enough out, a print's sparse interior shows through the layers above it,
 * because those gaps are real — measured on a 115 MB model, one layer drawn
 * alone covered 13,081 of the 40,998 pixels its whole stack covered. So this is
 * a choice between two defensible pictures rather than a bug with a fix, and the
 * two modes are exactly where such a choice belongs.
 */
describe('gcodeSubPixelStrategyFor', () => {
  it('keeps the geometry honest wherever fidelity was asked for', () => {
    expect(gcodeSubPixelStrategyFor('quality')).toBe('preserve')
    expect(gcodeSubPixelStrategyFor('auto')).toBe('preserve')
  })

  it('closes the surface only where speed was chosen over fidelity', () => {
    expect(gcodeSubPixelStrategyFor('performance')).toBe('widen')
  })

  it('agrees with the bead profile about which mode trades truth for calm', () => {
    // Both concessions belong to the same mode; splitting them would leave a
    // mode that squares its beads but still shows its infill through them.
    for (const mode of ['quality', 'auto', 'performance'] as const) {
      const tradesAway = gcodeSubPixelStrategyFor(mode) === 'widen'
      expect(gcodeBeadProfileFor(mode) === 'square').toBe(tradesAway)
    }
  })
})
