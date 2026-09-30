/**
 * An accelerometer's `axes_map` as directions: which way each of the chip's
 * own axes points on the printer.
 *
 * Klipper reads `axes_map` as one entry per printer axis — X, Y, Z in that
 * order — each naming the chip axis that measures it and its sign, so
 * `-y, x, z` says the printer's X is the chip's negative Y. Turned around,
 * that is how the chip is mounted: its Y axis points along the printer's −X.
 * The second reading is the one a picture can show, and the one a reader
 * holding the board in their hand can check.
 */

export type Axis = 'x' | 'y' | 'z'

export interface ChipAxisDirection {
  /** The chip's own axis. */
  chip: Axis
  /** The printer axis it points along, and which way. */
  printer: Axis
  sign: 1 | -1
}

const axes: readonly Axis[] = ['x', 'y', 'z']

/** `axes_map` as Klipper accepts it, or null for one that is not a permutation of x, y, z. */
export function parseAxesMap(value: string | null | undefined): ChipAxisDirection[] | null {
  const text = (value ?? '').trim()
  const entries = (text === '' ? 'x,y,z' : text)
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
  if (entries.length !== 3) return null
  const directions: ChipAxisDirection[] = []
  for (const [index, entry] of entries.entries()) {
    const match = /^([+-]?)([xyz])$/.exec(entry)
    if (!match) return null
    directions.push({
      chip: match[2] as Axis,
      printer: axes[index]!,
      sign: match[1] === '-' ? -1 : 1,
    })
  }
  if (new Set(directions.map((direction) => direction.chip)).size !== 3) return null
  return directions.sort((left, right) => axes.indexOf(left.chip) - axes.indexOf(right.chip))
}

/** `axes_map` written the way the log compacts it, for comparing two of them. */
export function sameAxesMap(left: string | null, right: string | null): boolean {
  const compact = (value: string | null) =>
    (value ?? '').replace(/\s+/g, '').replace(/\+/g, '').toLowerCase() || 'x,y,z'
  return compact(left) === compact(right)
}
