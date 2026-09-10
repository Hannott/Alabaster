/**
 * How much detail the G-code viewer draws, and who decides.
 *
 * Two levers, chosen deliberately, because they cost very different things:
 *
 * - **Tier** is the library's vertex budget, which it meets by picking a
 *   cheaper representation (solid beads, then lines, then points) and drawing
 *   fewer of them. It is the lever that makes a large file possible at all on
 *   hardware with no discrete GPU — and changing it reparses the whole file,
 *   so it is chosen once per load and never while the user is orbiting.
 * - **Resolution** is how many device pixels the scene is drawn at. It moves
 *   between two frames for free, and on the fragment-bound hardware this
 *   viewer was failing on it is the lever that actually shifts frame time.
 *
 * So the governor below measures frames and spends only the free lever. The
 * expensive one is a decision, made from the mode the user picked and from
 * what this device has already been seen to manage.
 *
 * What neither lever ever touches: the reveal semantics, the byte cursor,
 * the overlay's frame rate, and colour. A viewer that changed what "printed
 * so far" means under load would be lying to save time.
 */

import type { GcodeRenderTier } from '@/features/gcode/scene'

export type GcodeQualityMode = 'quality' | 'auto' | 'performance'

export interface GcodeQualityState {
  /**
   * Device-pixel-ratio cap for the scene. Below 1 the scene is drawn under
   * CSS resolution and scaled up, which looks soft and is the difference
   * between usable and not on a weak integrated GPU.
   */
  resolutionScale: number
}

export interface GcodeQualitySettings {
  targetFrameMilliseconds: number
  recoverFrameMilliseconds: number
  slowFramesBeforeDegrading: number
  fastFramesBeforeRecovering: number
  sampleWindow: number
  /**
   * Slow frames at the bottom of the ladder before the device is judged
   * unable to hold this tier at all. Deliberately far larger than
   * `slowFramesBeforeDegrading`: degrading is free and reversible, while
   * writing a lower ceiling changes what the *next* load looks like.
   */
  slowFramesBeforeLoweringTier: number
}

export const defaultGcodeQualitySettings: GcodeQualitySettings = {
  // 60 Hz leaves 16.7 ms; degrade past 22 ms so an occasional long frame does
  // not count, and only recover below 12 ms so recovery needs real headroom.
  targetFrameMilliseconds: 22,
  recoverFrameMilliseconds: 12,
  slowFramesBeforeDegrading: 12,
  fastFramesBeforeRecovering: 90,
  sampleWindow: 30,
  slowFramesBeforeLoweringTier: 180,
}

/**
 * The resolution ladder. Index 0 draws every device pixel; the last rung
 * draws one pixel for every four. Named rungs rather than a formula so the
 * sequence is reviewable and a rung can never be half-applied.
 */
const resolutionSteps: readonly GcodeQualityState[] = [
  { resolutionScale: 2 },
  { resolutionScale: 1.5 },
  { resolutionScale: 1 },
  { resolutionScale: 0.85 },
  { resolutionScale: 0.7 },
  { resolutionScale: 0.5 },
]

export const gcodeQualityStepCount = resolutionSteps.length

function stepFor(index: number): GcodeQualityState {
  const clamped = Math.min(resolutionSteps.length - 1, Math.max(0, index))
  return resolutionSteps[clamped] ?? resolutionSteps[0]!
}

/** Where each mode starts on the resolution ladder, and how far it may move. */
function boundsFor(mode: GcodeQualityMode): { start: number; minimum: number; maximum: number } {
  // Quality is pinned: someone taking a screenshot asked to wait.
  if (mode === 'quality') return { start: 0, minimum: 0, maximum: 0 }
  if (mode === 'performance') return { start: 2, minimum: 0, maximum: resolutionSteps.length - 1 }
  return { start: 0, minimum: 0, maximum: resolutionSteps.length - 1 }
}

/**
 * The highest tier this device has been seen to hold. Learned from real use
 * rather than from a synthetic benchmark: the first load runs at the mode's
 * nominal tier, and if the governor runs out of resolution ladder while frames
 * are still long, the ceiling drops and the *next* load starts cheaper.
 *
 * Stored per browser, never synced — it is a fact about this machine, and
 * carrying it to another screen would be carrying the wrong answer there.
 */
export const defaultGcodeTierCeiling: GcodeRenderTier = 4

/**
 * Above this many bytes a file starts one tier below the ceiling. A tier is a
 * vertex budget, so the same budget on a much larger file means much heavier
 * decimation anyway; starting lower reaches the same picture without the
 * reparse that finding out the hard way would cost.
 */
export const gcodeLargeFileTierBytes = 60 * 1_048_576

export function gcodeTierFor(
  mode: GcodeQualityMode,
  tierCeiling: GcodeRenderTier,
  fileBytes: number,
): GcodeRenderTier {
  if (mode === 'quality') return 5
  const large = fileBytes > gcodeLargeFileTierBytes
  if (mode === 'performance') return large ? 1 : 2
  const stepped = large ? tierCeiling - 1 : tierCeiling
  return Math.min(5, Math.max(1, stepped)) as GcodeRenderTier
}

export function isGcodeRenderTier(value: unknown): value is GcodeRenderTier {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5
}

export interface GcodeQualityReport {
  step: number
  state: GcodeQualityState
  medianFrameMilliseconds: number
  changed: boolean
  /**
   * True on the one sample where the ladder has been exhausted and frames are
   * still long. The page lowers the stored tier ceiling when it sees this,
   * which is the only thing that makes the next load cheaper.
   */
  tierExhausted: boolean
}

export class GcodeQualityGovernor {
  private intervals: number[] = []
  private slowFrames = 0
  private fastFrames = 0
  private slowFramesAtFloor = 0
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
    this.reset()
  }

  /** Called on every load: a new file is a new measurement. */
  reset(): void {
    this.intervals = []
    this.slowFrames = 0
    this.fastFrames = 0
    this.slowFramesAtFloor = 0
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
        if (this.step >= bounds.maximum) this.slowFramesAtFloor += 1
      } else if (intervalMilliseconds < this.settings.recoverFrameMilliseconds) {
        this.fastFrames += 1
        this.slowFrames = 0
        this.slowFramesAtFloor = 0
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

    const tierExhausted = this.slowFramesAtFloor >= this.settings.slowFramesBeforeLoweringTier
    // Reported once: lowering the ceiling twice for one bad stretch would walk
    // a merely busy machine down to the cheapest tier it has.
    if (tierExhausted) this.slowFramesAtFloor = 0

    return {
      step: this.step,
      state: stepFor(this.step),
      medianFrameMilliseconds: median,
      changed,
      tierExhausted,
    }
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
