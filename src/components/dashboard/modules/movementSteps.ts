import { configNumberList, configString } from '@/dashboard/context'

/**
 * Movement's step values, shared by the card and its settings pane so the two
 * cannot drift. Steps are buttons rather than a selection, so what the pane
 * edits is which values appear — not which one is armed.
 *
 * Each group is a plain list the user edits directly (add a value, remove a
 * value), not a choice among named presets — Alabaster shipped two presets,
 * "fine" and "coarse", and dropped the distinction once editing was added:
 * a preset only earns its keep if it can express something the editor
 * cannot, and a fixed pair of three-value arrays is fully inside what a list
 * editor already covers. These defaults are what a fresh instance starts
 * from, and what `readStepList` below falls back to.
 */
export const defaultPlanarSteps: readonly number[] = [1, 10, 100]
export const defaultVerticalSteps: readonly number[] = [0.1, 1, 10]

/**
 * Babystepping lives here; the Z jog row deliberately stops at 0.1mm. Always
 * millimetres, whatever the card is asked to display: this is the unit
 * `SET_GCODE_OFFSET` takes, so the unit setting is a choice about writing,
 * never about what gets sent.
 */
export const defaultOffsetSteps: readonly number[] = [0.005, 0.01, 0.025, 0.05]

/**
 * Every scale Alabaster shipped before custom lists, keyed by the config
 * value each card used to store — kept only so a profile saved back then
 * reads the numbers it was already showing instead of silently jumping to
 * today's defaults the first time it opens post-upgrade. `position` was the
 * X/Y mode retired with the bed plan (see `interface-standards.md`); it never
 * had its own numbers, so it maps to the same three `coarse` always used.
 */
const legacyPlanarSteps: Record<string, readonly number[]> = {
  fine: [0.1, 1, 10],
  coarse: defaultPlanarSteps,
  position: defaultPlanarSteps,
}
const legacyVerticalSteps: Record<string, readonly number[]> = {
  fine: defaultVerticalSteps,
  coarse: [0.5, 5, 25],
}
const legacyOffsetSteps: Record<string, readonly number[]> = {
  fine: defaultOffsetSteps,
  coarse: [0.01, 0.025, 0.05, 0.1],
}

/** Ascending and duplicate-free: every renderer here reads "outward from the pivot" from this order. */
function normalizeSteps(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b)
}

/**
 * A group's current values: the list the user has actually edited, or —
 * absent that — the pre-upgrade scale it was showing, or — absent that too —
 * today's default. Never a mix: a stored list, however short, is the user's
 * own edit and wins outright over both fallbacks.
 */
function readStepList(
  config: Record<string, unknown>,
  listKey: string,
  legacyScaleKey: string,
  legacyScales: Record<string, readonly number[]>,
  fallback: readonly number[],
): number[] {
  const stored = configNumberList(config, listKey)
  if (stored.length > 0) return normalizeSteps(stored)
  const legacyScale = configString(config, legacyScaleKey, '')
  const legacy = legacyScales[legacyScale]
  return normalizeSteps(legacy ?? fallback)
}

export function readPlanarSteps(config: Record<string, unknown>): number[] {
  return readStepList(
    config,
    'planarSteps',
    'planarStepScale',
    legacyPlanarSteps,
    defaultPlanarSteps,
  )
}

export function readVerticalSteps(config: Record<string, unknown>): number[] {
  return readStepList(
    config,
    'verticalSteps',
    'verticalStepScale',
    legacyVerticalSteps,
    defaultVerticalSteps,
  )
}

export function readOffsetSteps(config: Record<string, unknown>): number[] {
  return readStepList(
    config,
    'offsetSteps',
    'offsetStepScale',
    legacyOffsetSteps,
    defaultOffsetSteps,
  )
}

export const zOffsetUnits = ['micrometre', 'millimetre'] as const
export type ZOffsetUnit = (typeof zOffsetUnits)[number]

/**
 * The offset row is the one place in Alabaster that writes a decimal separator
 * itself instead of taking the active locale's, and it is deliberate.
 *
 * The six or eight magnitudes are read against each other and against the
 * value above them, where telling `.05` from `.005` at a glance matters more
 * than matching the surrounding prose — mistaking one for the other is a
 * ten-fold babystep into the bed. Dropping the leading zero is what makes
 * millimetres fit at all, and `,005` is not how any locale writes that
 * number, so the comma form would have to keep the zero and then not fit.
 *
 * Do not "fix" this by routing it through `Intl.NumberFormat`. Every other
 * number on the card should go through the locale; this row is the exception,
 * and it is an exception about a fixed set of magnitudes, not about numbers in
 * general.
 */
export function offsetMagnitude(millimetres: number, unit: ZOffsetUnit): string {
  if (unit === 'micrometre') return String(Math.round(millimetres * 1000))
  // Three decimals is finer than Klipper's own babystepping resolution.
  // Trailing zeros go only after the point, so 0.05 reads as `.05` rather
  // than `.050` and 10 never collapses to 1.
  const fixed = millimetres
    .toFixed(3)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '')
  return fixed.replace(/^0\./, '.')
}

/** A step button's label: the magnitude, and which way it moves the nozzle. */
export function signedOffsetStep(millimetres: number, unit: ZOffsetUnit): string {
  const magnitude = offsetMagnitude(Math.abs(millimetres), unit)
  return millimetres < 0 ? `−${magnitude}` : `+${magnitude}`
}

/**
 * The current offset. Unsigned zero rather than a signed one: an offset
 * rounding to nothing is not a negative offset, and `−0` reads as a direction
 * that was never applied.
 */
export function offsetValue(millimetres: number, unit: ZOffsetUnit): string {
  const magnitude = offsetMagnitude(Math.abs(millimetres), unit)
  if (magnitude === '0') return magnitude
  return millimetres < 0 ? `−${magnitude}` : magnitude
}

/**
 * The negative side descends toward the pivot, so each row is symmetric about
 * it and the largest movement sits at both outer edges — reading outward from
 * the axis is the same gesture in either direction.
 */
export function descending(steps: readonly number[]): number[] {
  return [...steps].reverse()
}
