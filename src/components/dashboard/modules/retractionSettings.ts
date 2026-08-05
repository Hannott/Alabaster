/**
 * Firmware retraction, the settings `[firmware_retraction]` exposes.
 *
 * Which of them exist depends on the firmware, the same way pressure advance
 * does: mainline Klipper takes four, Kalico adds `z_hop_height`. So the block
 * renders the ones the machine actually reports rather than a fixed four — see
 * `pressureAdvanceSettings.ts` for the rule and why a firmware-name test would
 * be the wrong question.
 *
 * The difference from pressure advance is that all of these are settable at
 * runtime, so each needs a unit and a step to be an editable field. That is
 * knowledge Alabaster has to hold, which makes this list bounded where the
 * pressure-advance one is open: a reading can be rendered from nothing but its
 * value, and a control cannot. A setting this map does not describe is not
 * drawn — a field with a guessed step is worse than a field that waited for
 * someone to add one line here.
 */

/** The status fields that are settings rather than derived values or state. */
export interface RetractionField {
  /** The status key, which is also the config key. */
  key: string
  /** The `SET_RETRACTION` parameter. Identical uppercased here, unlike pressure advance's. */
  parameter: string
  /** i18n key for the unit shown beside the field. */
  unitKey: string
  step: number
  decimals: number
}

/**
 * In the order the block draws them: each length beside the speed that applies
 * to it, so the two numbers a reader changes together sit together. Z hop is
 * last because it is the one not every firmware has, and a block whose first
 * rows move depending on the machine is harder to learn than one that grows at
 * the end.
 */
const retractionFields: readonly RetractionField[] = [
  {
    key: 'retract_length',
    parameter: 'RETRACT_LENGTH',
    unitKey: 'dashboard.extruder.millimetresUnit',
    step: 0.05,
    decimals: 2,
  },
  {
    key: 'retract_speed',
    parameter: 'RETRACT_SPEED',
    unitKey: 'dashboard.extruder.millimetresPerSecondUnit',
    step: 1,
    decimals: 0,
  },
  {
    key: 'unretract_extra_length',
    parameter: 'UNRETRACT_EXTRA_LENGTH',
    unitKey: 'dashboard.extruder.millimetresUnit',
    step: 0.05,
    decimals: 2,
  },
  {
    key: 'unretract_speed',
    parameter: 'UNRETRACT_SPEED',
    unitKey: 'dashboard.extruder.millimetresPerSecondUnit',
    step: 1,
    decimals: 0,
  },
  {
    key: 'z_hop_height',
    parameter: 'Z_HOP_HEIGHT',
    unitKey: 'dashboard.extruder.millimetresUnit',
    step: 0.05,
    decimals: 2,
  },
]

/**
 * The retraction settings this machine reports, in draw order.
 *
 * Driven by the reported status rather than by the config section: the two
 * agree on which settings exist, and the status is the one that also carries
 * the live value, so reading both from one place keeps a rendered field and its
 * number from ever disagreeing about whether they exist.
 *
 * `unretract_length`, `retract_state` and `zhop_state` are deliberately not
 * here. The first is derived — retract length plus the extra — and the other
 * two are momentary state, not settings; offering any of them as a field would
 * be offering to set something `SET_RETRACTION` has no parameter for.
 */
export function readRetractionFields(
  reported: Readonly<Record<string, number>>,
): RetractionField[] {
  return retractionFields.filter((field) => typeof reported[field.key] === 'number')
}

/**
 * The `SET_RETRACTION` arguments for a set of edited values, omitting anything
 * this firmware does not have. Empty when nothing is settable, which the caller
 * treats as nothing to send rather than as a bare command.
 */
export function retractionArguments(
  fields: readonly RetractionField[],
  values: Readonly<Record<string, number>>,
): string[] {
  return fields.flatMap((field) => {
    const value = values[field.key]
    if (typeof value !== 'number' || !Number.isFinite(value)) return []
    return [`${field.parameter}=${Number(value.toFixed(field.decimals))}`]
  })
}

/**
 * One step up or down, clamped at zero and rounded back onto the field's own
 * precision — binary addition of 0.05 does not stay on two decimals by itself,
 * and a value that drifts to 0.15000000000000002 is one Klipper will accept and
 * nobody wants to read.
 */
export function steppedRetractionValue(
  field: RetractionField,
  current: number,
  direction: 1 | -1,
): number {
  const next = current + field.step * direction
  const rounded = Number(Math.max(0, next).toFixed(field.decimals))
  return Number.isFinite(rounded) ? rounded : 0
}
