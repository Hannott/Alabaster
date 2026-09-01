/**
 * Adaptive render quality for the G-code viewer.
 *
 * Detail used to be chosen from camera distance alone, which says what a frame
 * *costs* but nothing about what the machine can *afford*. The result was that
 * a weak GPU drew full-detail geometry at whatever frame rate it could manage
 * and a strong one left headroom unused. This governor measures actual frame
 * intervals and spends that measurement, in a fixed order:
 *
 * 1. **Tier bias** — engage the reduced streams sooner. Cheapest first because
 *    it costs the least visible quality per frame saved.
 * 2. **Resolution scale** — render fewer device pixels and let the browser
 *    scale up. Visible as softness, but it never changes what is on screen.
 * 3. **Contact shadow** — dropped last, because losing it flattens the scene.
 *
 * What it never touches: the reveal semantics, the rule that the active layer
 * stays segment-exact, the overlay's frame rate, and color. A viewer that
 * changed what "printed so far" means under load would be lying to save time.
 */

import type { GcodeBeadProfile, GcodeSubPixelStrategy } from '@/features/gcode/types'

export type GcodeQualityMode = 'quality' | 'auto' | 'performance'

/**
 * Bead shape is the one quality decision the governor does not get to make.
 *
 * Every other lever above is invisible enough to move under load: a tier engages,
 * pixels soften, a shadow drops. A bead's cross-section is the most visible thing
 * on screen, and having it change shape mid-orbit because a few frames ran long
 * would read as a rendering fault rather than as an adaptation. So it follows the
 * mode the user chose and nothing else — square only where they asked for speed
 * over fidelity, and constant for as long as they leave that setting alone.
 */
export function gcodeBeadProfileFor(mode: GcodeQualityMode): GcodeBeadProfile {
  return mode === 'performance' ? 'square' : 'round'
}

/**
 * What to do where a surface has stopped holding together on screen.
 *
 * Far enough out, a print's sparse interior starts showing through the layers
 * above it, because those gaps are real: a layer of infill covers only about a
 * third of its own footprint, and the rest genuinely is a view down into the
 * part. Measured on a 115 MB model, one layer drawn alone covered 13,081 of
 * the 40,998 pixels its whole stack covered.
 *
 * That leaves a real choice rather than a bug to fix. `preserve` draws beads
 * at the width the file says and lets the interior show, which is honest and
 * is information — infill density and direction are readable from it — but at
 * a distance reads as speckle. `widen` grows beads once they are too small to
 * resolve until the gaps close, so the model reads as one solid object, at the
 * cost of hiding structure that is really there.
 *
 * Neither is correct in general, so it follows the mode: the mode that exists
 * for fidelity keeps the truth, and the mode that exists for speed takes the
 * cheaper, calmer picture.
 */
export function gcodeSubPixelStrategyFor(mode: GcodeQualityMode): GcodeSubPixelStrategy {
  return mode === 'performance' ? 'widen' : 'preserve'
}

export interface GcodeQualityState {
  /** Multiplies the pixel thresholds that select a tier; higher reduces sooner. */
  tierBias: number
  /** Device-pixel-ratio cap for the scene canvas. */
  resolutionScale: number
  contactShadow: boolean
}

export interface GcodeQualitySettings {
  targetFrameMilliseconds: number
  recoverFrameMilliseconds: number
  slowFramesBeforeDegrading: number
  fastFramesBeforeRecovering: number
  sampleWindow: number
}

export const defaultGcodeQualitySettings: GcodeQualitySettings = {
  // 60 Hz leaves 16.7 ms; degrade past 22 ms so an occasional long frame does
  // not count, and only recover below 12 ms so recovery needs real headroom.
  targetFrameMilliseconds: 22,
  recoverFrameMilliseconds: 12,
  slowFramesBeforeDegrading: 12,
  fastFramesBeforeRecovering: 90,
  sampleWindow: 30,
}

/**
 * The ladder every mode moves along. Index 0 is full quality; each step gives
 * up the next cheapest thing. Named steps rather than free-floating numbers so
 * the sequence is reviewable and a step can never be half-applied.
 */
const qualitySteps: readonly GcodeQualityState[] = [
  { tierBias: 1, resolutionScale: 2, contactShadow: true },
  { tierBias: 1.6, resolutionScale: 2, contactShadow: true },
  { tierBias: 1.6, resolutionScale: 1.5, contactShadow: true },
  { tierBias: 2.4, resolutionScale: 1, contactShadow: true },
  { tierBias: 2.4, resolutionScale: 0.75, contactShadow: true },
  { tierBias: 3.2, resolutionScale: 0.75, contactShadow: false },
]

export const gcodeQualityStepCount = qualitySteps.length

function stepFor(index: number): GcodeQualityState {
  const clamped = Math.min(qualitySteps.length - 1, Math.max(0, index))
  return qualitySteps[clamped] ?? qualitySteps[0]!
}

/** Where each mode starts, and how far it is allowed to move. */
function boundsFor(mode: GcodeQualityMode): { start: number; minimum: number; maximum: number } {
  if (mode === 'quality') return { start: 0, minimum: 0, maximum: 0 }
  if (mode === 'performance') return { start: 2, minimum: 0, maximum: qualitySteps.length - 1 }
  return { start: 0, minimum: 0, maximum: qualitySteps.length - 1 }
}

export interface GcodeQualityReport {
  step: number
  state: GcodeQualityState
  medianFrameMilliseconds: number
  changed: boolean
}

export class GcodeQualityGovernor {
  private intervals: number[] = []
  private slowFrames = 0
  private fastFrames = 0
  private step: number
  private mode: GcodeQualityMode

  constructor(
    mode: GcodeQualityMode = 'auto',
    private readonly settings: GcodeQualitySettings = defaultGcodeQualitySettings,
  ) {
    this.mode = mode
    this.step = boundsFor(mode).start
  }

  setMode(mode: GcodeQualityMode): void {
    this.mode = mode
    const bounds = boundsFor(mode)
    this.step = Math.min(bounds.maximum, Math.max(bounds.minimum, bounds.start))
    this.intervals = []
    this.slowFrames = 0
    this.fastFrames = 0
  }

  state(): GcodeQualityState {
    return stepFor(this.step)
  }

  currentStep(): number {
    return this.step
  }

  /**
   * Feeds one measured frame interval. Only call this for frames that actually
   * rendered the scene: idle frames would look infinitely fast and would talk
   * the governor into a quality it cannot sustain once the user moves again.
   */
  sample(intervalMilliseconds: number): GcodeQualityReport {
    const bounds = boundsFor(this.mode)
    // A tab returning from the background reports one enormous interval; it
    // says nothing about capability, so it is discarded rather than acted on.
    if (intervalMilliseconds > 0 && intervalMilliseconds < 500) {
      this.intervals.push(intervalMilliseconds)
      if (this.intervals.length > this.settings.sampleWindow) this.intervals.shift()
      if (intervalMilliseconds > this.settings.targetFrameMilliseconds) {
        this.slowFrames += 1
        this.fastFrames = 0
      } else if (intervalMilliseconds < this.settings.recoverFrameMilliseconds) {
        this.fastFrames += 1
        this.slowFrames = 0
      }
    }

    const median = this.medianInterval()
    let changed = false
    if (this.slowFrames >= this.settings.slowFramesBeforeDegrading && this.step < bounds.maximum) {
      this.step += 1
      changed = true
      this.slowFrames = 0
      this.intervals = []
    } else if (
      this.fastFrames >= this.settings.fastFramesBeforeRecovering &&
      this.step > bounds.minimum
    ) {
      this.step -= 1
      changed = true
      this.fastFrames = 0
      this.intervals = []
    }

    return { step: this.step, state: stepFor(this.step), medianFrameMilliseconds: median, changed }
  }

  private medianInterval(): number {
    if (this.intervals.length === 0) return 0
    const sorted = [...this.intervals].sort((left, right) => left - right)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0)
  }
}
