/**
 * Movement's step scales, shared by the card and its settings pane so the two
 * cannot drift. Steps are buttons rather than a selection, so what the pane
 * chooses is which three values appear — not which one is armed.
 */
export const movementStepScales = ['fine', 'coarse'] as const
export type StepScale = (typeof movementStepScales)[number]

export const planarStepSets: Record<StepScale, readonly number[]> = {
  fine: [0.1, 1, 10],
  coarse: [1, 10, 100],
}

/**
 * X and Y once offered a third "position" mode that jumped to the axis's
 * configured travel limits instead of stepping by a distance. It is gone: the
 * bed plan answers the same question — reach a corner or the centre without
 * adding up jog presses — for any coordinate rather than three, and it could
 * never be drawn anyway. `235.0` is 33px of text in a jog cell whose content
 * box is 29.9px at the dashboard's own card width, and there was no
 * configuration in which it fitted.
 *
 * The alias stays so a stored `planarStepScale: 'position'` has something to
 * fall back from rather than rendering a segment that no longer exists.
 */
export const planarStepModes = movementStepScales
export type PlanarStepMode = (typeof planarStepModes)[number]

export const verticalStepSets: Record<StepScale, readonly number[]> = {
  fine: [0.1, 1, 10],
  coarse: [0.5, 5, 25],
}

/**
 * Babystepping lives here; the Z jog row deliberately stops at 0.1mm. Always
 * millimetres, whatever the card is asked to display: this is the unit
 * `SET_GCODE_OFFSET` takes, so the unit setting below is a choice about
 * writing, never about what gets sent.
 *
 * Four magnitudes per scale, so the row draws eight buttons around its own
 * middle. Three left a gap in the ladder that mattered: `fine` jumped 0.01 to
 * 0.05, and a first layer being dialed in wants the step between them far more
 * often than it wants either end. The fourth rung costs nothing at the default
 * unit — eight micrometre labels fit one row of a 299px card, see
 * `.trim__steps` — and where it does not fit, the row wraps to four and four,
 * which lands the split exactly on the sign change.
 */
export const offsetStepSets: Record<StepScale, readonly number[]> = {
  fine: [0.005, 0.01, 0.025, 0.05],
  coarse: [0.01, 0.025, 0.05, 0.1],
}

export const zOffsetUnits = ['micrometre', 'millimetre'] as const
export type ZOffsetUnit = (typeof zOffsetUnits)[number]

/**
 * The offset row is the one place in Alabaster that writes a decimal separator
 * itself instead of taking the active locale's, and it is deliberate.
 *
 * Three reasons, and the row needs all three. The buttons are sized against
 * these exact labels — six of them across a 271px card — so a separator that
 * changes with the language changes the width the row was measured for.
 * Dropping the leading zero is what makes millimetres fit at all, and `,005`
 * is not how any locale writes that number, so the comma form would have to
 * keep the zero and then no longer fit. And the six magnitudes are read
 * against each other and against the value above them, where telling `.05`
 * from `.005` at a glance matters more than matching the surrounding prose —
 * mistaking one for the other is a ten-fold babystep into the bed.
 *
 * Do not "fix" this by routing it through `Intl.NumberFormat`. Every other
 * number on the card should go through the locale; this row is the exception,
 * and it is an exception about a fixed set of magnitudes, not about numbers in
 * general.
 */
export function offsetMagnitude(millimetres: number, unit: ZOffsetUnit): string {
  if (unit === 'micrometre') return String(Math.round(millimetres * 1000))
  // Three decimals is the finest step offered and finer than Klipper's own
  // babystepping resolution. Trailing zeros go only after the point, so 0.05
  // reads as `.05` rather than `.050` and 10 never collapses to 1.
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
