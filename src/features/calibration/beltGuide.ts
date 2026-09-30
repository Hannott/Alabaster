/**
 * Reading Shake&Tune's belt comparison: which belt is looser, and whether the
 * axis resonances are the belts' at all.
 *
 * Shake&Tune's graph marks each belt's peaks but prints only the unsigned
 * frequency gap between a pair, so which belt sits lower has to be read off the
 * curves. The reader types the peaks they see; everything here is a pure
 * function of those numbers and the kinematics, kept free of Vue so it can be
 * tested against them.
 *
 * What the numbers can and cannot support, since every verdict leans on it:
 *
 * - The peaks are the toolhead mass ringing on the belt's stiffness, not a
 *   plucked string, so frequency does not convert to tension. Tension going
 *   with frequency squared holds for a pluck test and not here; quoting "about
 *   N% less tension" from it would be a number with nothing behind it, so only
 *   the frequency gap is ever stated.
 * - Both diagonals move the same mass, so a gap between the belts is the belts.
 *   Which one is at the right tension is not in the graph at all — it takes a
 *   pluck test or a gauge — so the action is conditional until the reader says
 *   which belt they measured.
 * - Unpaired peaks come from the belt path, and a tension change does not move
 *   them. Tension advice is withheld while any exist, so a reader is not sent
 *   tightening a belt to chase a loose idler.
 */

/** Kinematics Shake&Tune's belt test runs on. */
export type BeltKinematics = 'corexy' | 'corexz'

export interface Belt {
  /** Shake&Tune's name for the belt, as its graph labels the curve. */
  name: string
  /** The Klipper stepper that is the only one turning while this belt is measured. */
  stepper: string
}

/** One peak seen on both curves, in Hz. */
export interface PeakPair {
  first: number
  second: number
}

export type BeltVerdict =
  | { kind: 'incomplete' }
  | { kind: 'beltPath'; unpaired: number }
  | { kind: 'disagree'; pairs: PeakPair[] }
  | { kind: 'matched'; offset: number; pairs: PeakPair[] }
  | {
      kind: 'looser'
      /** Index into the belt pair: 0 for the first curve, 1 for the second. */
      looser: 0 | 1
      /** How far apart the belts are, as a fraction of their mean frequency. */
      offset: number
      /**
       * `either` until the reader names a belt measured at target tension:
       * tighten the looser one, unless it is already at target.
       */
      action: 'either' | 'tightenLooser' | 'loosenTighter'
      pairs: PeakPair[]
    }

export type AxisVerdict = 'belts' | 'softer' | 'stiffer'

export interface AxisCheck {
  expected: number
  measured: number | null
  /** Signed, as a fraction of the expected frequency. */
  offset: number | null
  verdict: AxisVerdict | null
}

/*
 * Reading a peak off a 300 dpi graph by eye is good to about a hertz, which is
 * 1.5% at the 60–120 Hz a belt peak sits in; a smaller gap is not a reading.
 */
export const matchTolerance = 0.015
/* Further apart than this, two peaks are different modes rather than one mode on two belts. */
export const pairTolerance = 0.15
/*
 * Motor holding stiffness, pulleys, idlers and the frame are all in series with
 * the belt, and none of them is in the model, so its prediction is only this good.
 */
export const modelTolerance = 0.15

export function beltKinematics(kinematics: string | null): BeltKinematics | null {
  const kind = (kinematics ?? '').toLowerCase()
  if (kind === 'corexy' || kind === 'limited_corexy') return 'corexy'
  if (kind === 'corexz' || kind === 'limited_corexz') return 'corexz'
  return null
}

/**
 * The two belts in the order Shake&Tune measures and draws them.
 *
 * Shake&Tune's belt A is its `(1, -1)` diagonal and belt B its `(1, 1)` one.
 * Klipper's CoreXY rails are `stepper_x = x + y` and `stepper_y = x − y`, so
 * the A diagonal turns `stepper_y` alone and B turns `stepper_x` — the opposite
 * of what the letters suggest, and the reason the stepper is named beside the
 * belt. CoreXZ is measured as belts X `(1, 0, 1)` and Z `(-1, 0, 1)`, which turn
 * `stepper_x` and `stepper_z` respectively.
 */
export function beltsFor(kinematics: BeltKinematics): [Belt, Belt] {
  return kinematics === 'corexy'
    ? [
        { name: 'A', stepper: 'stepper_y' },
        { name: 'B', stepper: 'stepper_x' },
      ]
    : [
        { name: 'X', stepper: 'stepper_x' },
        { name: 'Z', stepper: 'stepper_z' },
      ]
}

/**
 * Frequencies typed as "78, 126", ascending. Commas, semicolons and spaces all
 * separate; the decimal mark is a point. `null` when any entry is not a
 * frequency, so a typo is reported rather than silently dropped.
 */
export function parsePeaks(text: string): number[] | null {
  const tokens = text.split(/[,;\s]+/).filter((token) => token !== '')
  const peaks = tokens.map(Number)
  if (peaks.some((peak) => !Number.isFinite(peak) || peak <= 0 || peak > 1000)) return null
  return peaks.sort((a, b) => a - b)
}

function relativeGap(a: number, b: number): number {
  return (b - a) / ((a + b) / 2)
}

/**
 * Pairs the closest peaks first, as Shake&Tune does, so a strong pair is not
 * broken up to make a weak one. What is left over on either curve is unpaired.
 */
export function pairPeaks(
  first: readonly number[],
  second: readonly number[],
): { pairs: PeakPair[]; unpaired: number } {
  const left = [...first]
  const right = [...second]
  const pairs: PeakPair[] = []
  for (;;) {
    let best: { i: number; j: number; gap: number } | null = null
    for (let i = 0; i < left.length; i++) {
      for (let j = 0; j < right.length; j++) {
        const gap = Math.abs(relativeGap(left[i]!, right[j]!))
        if (gap <= pairTolerance && (best === null || gap < best.gap)) best = { i, j, gap }
      }
    }
    if (best === null) break
    const { i, j } = best
    pairs.push({ first: left[i]!, second: right[j]! })
    left.splice(i, 1)
    right.splice(j, 1)
  }
  pairs.sort((a, b) => a.first - b.first)
  return { pairs, unpaired: left.length + right.length }
}

export function beltVerdict(input: {
  first: readonly number[]
  second: readonly number[]
  /** Shake&Tune's own count from the graph's legend. */
  unpaired: number
  /** The belt the reader measured at target tension, if any. */
  atTarget: 0 | 1 | null
}): BeltVerdict {
  if (input.first.length === 0 || input.second.length === 0) return { kind: 'incomplete' }
  const { pairs, unpaired } = pairPeaks(input.first, input.second)
  const totalUnpaired = Math.max(0, Math.round(input.unpaired)) + unpaired
  if (totalUnpaired > 0) return { kind: 'beltPath', unpaired: totalUnpaired }

  const gaps = pairs.map((pair) => relativeGap(pair.first, pair.second))
  const significant = gaps.filter((gap) => Math.abs(gap) >= matchTolerance)
  if (significant.some((gap) => gap > 0) && significant.some((gap) => gap < 0)) {
    return { kind: 'disagree', pairs }
  }

  const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length
  const offset = Math.abs(mean)
  if (offset < matchTolerance) return { kind: 'matched', offset, pairs }

  const looser: 0 | 1 = mean > 0 ? 0 : 1
  const action =
    input.atTarget === null
      ? 'either'
      : input.atTarget === looser
        ? 'loosenTighter'
        : 'tightenLooser'
  return { kind: 'looser', looser, offset, action, pairs }
}

function axisCheck(expected: number, measured: number | null): AxisCheck {
  if (measured === null) return { expected, measured, offset: null, verdict: null }
  const offset = (measured - expected) / expected
  const verdict: AxisVerdict =
    Math.abs(offset) <= modelTolerance ? 'belts' : offset < 0 ? 'softer' : 'stiffer'
  return { expected, measured, offset, verdict }
}

/**
 * Where a CoreXY's X and Y resonances would sit if the belts were the softest
 * thing in the path, from one belt pair and the two moving masses.
 *
 * With `a = x + y` and `b = x − y`, a diagonal move turns one motor and moves
 * the toolhead in X and the gantry with it in Y, an effective mass in the
 * motor's own coordinate of `(2·m_toolhead + m_gantry) / 4` — the same for
 * both belts, so each belt's stiffness is `(2πf)²` times it. A pure X move
 * stretches both belts and carries the toolhead alone, a pure Y move both belts
 * and the gantry as well, which gives the two predictions. A measured peak
 * well below its prediction means something softer than the belts sets that
 * axis, which no amount of tensioning will raise.
 */
export function axisCrossCheck(input: {
  pair: PeakPair
  toolheadGrams: number
  gantryGrams: number
  measuredX: number | null
  measuredY: number | null
}): { x: AxisCheck; y: AxisCheck } | null {
  const toolhead = input.toolheadGrams / 1000
  const gantry = input.gantryGrams / 1000
  if (!(toolhead > 0) || !(gantry >= 0)) return null
  const diagonalMass = (2 * toolhead + gantry) / 4
  // (k_A + k_B) / (2π)², which is all either prediction needs.
  const beltStiffness = (input.pair.first ** 2 + input.pair.second ** 2) * diagonalMass
  return {
    x: axisCheck(Math.sqrt(beltStiffness / toolhead), input.measuredX),
    y: axisCheck(Math.sqrt(beltStiffness / (toolhead + gantry)), input.measuredY),
  }
}
