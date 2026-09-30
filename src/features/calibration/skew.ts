/**
 * Klipper's skew correction, measured the way its guide describes: print the
 * calibration object with no correction applied, measure the two diagonals
 * AC and BD and the side AD of each plane with calipers, and hand the three
 * lengths to `SET_SKEW`. `SKEW_PROFILE SAVE=` then stages the factors for
 * `SAVE_CONFIG`.
 *
 * The factor is worked out here as well as by Klipper, with Klipper's own
 * formula, so the reader sees the skew in degrees while typing rather than
 * after a command — a transposed digit shows as a skew of several degrees
 * before it is sent.
 *
 * Kept free of Vue so the formula is testable against the guide's example.
 */

export const skewPlanes = ['xy', 'xz', 'yz'] as const

export type SkewPlane = (typeof skewPlanes)[number]

export interface SkewLengths {
  ac: number
  bd: number
  ad: number
}

/**
 * `skew_correction.py`'s `calc_skew_factor`: the tangent of how far the
 * corner at A is from square, from the parallelogram the three lengths
 * describe. Null for lengths that describe no parallelogram — a side longer
 * than the diagonals allow — where Klipper would fail on a square root or an
 * arc cosine of a negative or out-of-range number.
 */
export function skewFactor({ ac, bd, ad }: SkewLengths): number | null {
  if (![ac, bd, ad].every((length) => Number.isFinite(length) && length > 0)) return null
  const squared = 2 * ac * ac + 2 * bd * bd - 4 * ad * ad
  if (squared <= 0) return null
  const side = Math.sqrt(squared) / 2
  const cosine = (ac * ac - side * side - ad * ad) / (2 * side * ad)
  if (cosine < -1 || cosine > 1) return null
  return Math.tan(Math.PI / 2 - Math.acos(cosine))
}

export function skewDegrees(factor: number): number {
  return (factor * 180) / Math.PI
}

/** A length as it goes on the command line: no exponent, no trailing zeros. */
function length(value: number): string {
  return String(Number(value.toFixed(3)))
}

/**
 * The `SET_SKEW` line for the planes given, cleared first: `SET_SKEW` only
 * replaces the planes it names, so a plane measured on an earlier sitting and
 * not measured now would otherwise stay in the saved profile unseen. Null
 * while any given plane's lengths are not a parallelogram.
 */
export function setSkewScript(planes: Partial<Record<SkewPlane, SkewLengths>>): string | null {
  const words: string[] = []
  for (const plane of skewPlanes) {
    const lengths = planes[plane]
    if (!lengths) continue
    if (skewFactor(lengths) === null) return null
    words.push(
      `${plane.toUpperCase()}=${length(lengths.ac)},${length(lengths.bd)},${length(lengths.ad)}`,
    )
  }
  if (words.length === 0) return null
  return ['SET_SKEW CLEAR=1', `SET_SKEW ${words.join(' ')}`].join('\n')
}

/** A profile name `SKEW_PROFILE` takes as one word, which is also a section name. */
export function isSkewProfileName(name: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(name)
}

export interface SkewProfile {
  name: string
  /** Factors in radians, per plane, as the section stores them. */
  factors: Record<SkewPlane, number>
}

/** The profiles `[skew_correction <name>]` sections hold, in the order the config lists them. */
export function skewProfiles(
  sections: readonly string[],
  settings: (section: string) => Record<string, unknown> | null,
): SkewProfile[] {
  return sections
    .filter((section) => section.startsWith('skew_correction '))
    .map((section) => {
      const values = settings(section) ?? {}
      const factor = (option: string): number => {
        const value = Number(values[option])
        return Number.isFinite(value) ? value : 0
      }
      return {
        name: section.slice('skew_correction '.length),
        factors: { xy: factor('xy_skew'), xz: factor('xz_skew'), yz: factor('yz_skew') },
      }
    })
}

/**
 * Whether any macro loads a skew profile or sets skew itself. Klipper loads
 * no profile at start-up, so a saved profile corrects nothing until a start
 * macro loads it — after homing, per the guide — and a reader who saved one
 * and never added that line has a correction that is never applied.
 */
export function macrosApplySkew(
  sections: readonly string[],
  settings: (section: string) => Record<string, unknown> | null,
): boolean {
  return sections
    .filter((section) => section.startsWith('gcode_macro '))
    .some((section) => {
      const gcode = settings(section)?.gcode
      return typeof gcode === 'string' && /SKEW_PROFILE\s+LOAD|SET_SKEW\s+(XY|XZ|YZ)/i.test(gcode)
    })
}
