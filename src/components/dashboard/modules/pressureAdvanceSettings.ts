import { titleCaseIdentifier } from '@/utils/identifierCase'

/**
 * Pressure advance is not one control, and which one it is depends on the
 * firmware underneath.
 *
 * Mainline Klipper's `[extruder]` carries `pressure_advance` and
 * `pressure_advance_smooth_time`, both settable at runtime through
 * `SET_PRESSURE_ADVANCE`. Kalico's non-linear extrusion adds a model and its
 * coefficients — `pressure_advance_model`, `linear_advance`,
 * `nonlinear_offset`, `linearization_velocity`, `pressure_advance_time_offset`
 * — which describe a curve rather than a single gain.
 *
 * Alabaster discovers that from the configuration the machine reports and never
 * from what the firmware calls itself. A version test off `printer.info`'s
 * `software_version` breaks on a fork, a backport, a build with the feature
 * compiled out, and the next release; none of those break a key test. It would
 * also be the wrong question even if it were answerable, because non-linear
 * pressure advance lives on one Kalico branch — an owner running the other does
 * not have it, so "is this Kalico" and "does this have the model" are different
 * sets of printers. `probeRun.ts` records the same reasoning for console output:
 * matching a shape rather than a list of exact sentences, because a list of
 * exact sentences "fails closed on every firmware nobody tested".
 */

/**
 * Coefficients that belong to the model but do not carry the
 * `pressure_advance` prefix, so cannot be found by shape alone. Anything named
 * `pressure_advance*` is picked up without being listed, which is what lets a
 * firmware that adds a value render it without a release here.
 */
const unprefixedModelKeys = ['linear_advance', 'nonlinear_offset', 'linearization_velocity']

/**
 * The order the card draws them in, which is ours rather than the machine's —
 * `configfile.settings` is a JSON object and its key order is an accident of
 * serialization, so a stable reading needs an explicit one. The model leads
 * because the coefficients under it are meaningless without knowing which curve
 * they parameterise. Anything not named here sorts after, alphabetically, so a
 * key nobody anticipated still appears in a predictable place.
 */
const settingOrder = [
  'pressure_advance_model',
  'pressure_advance',
  'linear_advance',
  'nonlinear_offset',
  'linearization_velocity',
  'pressure_advance_time_offset',
  'pressure_advance_smooth_time',
]

/** The presence of a model is what says this firmware has the non-linear form. */
export const nonlinearModelKey = 'pressure_advance_model'

export interface PressureAdvanceSetting {
  key: string
  label: string
  value: string
}

function isPressureAdvanceKey(key: string): boolean {
  return key.startsWith('pressure_advance') || unprefixedModelKeys.includes(key)
}

/**
 * The prefix four of the seven keys share, elided from their labels because the
 * block's own heading already says it. Only the form with the trailing
 * underscore is stripped, which leaves the bare `pressure_advance` key labeled
 * in full rather than reduced to nothing.
 */
const redundantLabelPrefix = 'pressure_advance_'

/**
 * The setting's own name, made readable: underscores become spaces and every
 * word is capitalized.
 *
 * Deliberately not translated, and deliberately not renamed to something
 * friendlier. These are the identifiers the user typed into `printer.cfg` and
 * the ones every Kalico tuning guide refers to, so a card that renders
 * `nonlinear_offset` as "Curve strength" would be describing a value the reader
 * then cannot find in their own config. Macro names are shown the same way and
 * for the same reason — see `formatMacroLabel`, and `titleCaseIdentifier` for
 * the shared implementation both delegate to.
 *
 * The one departure is eliding `pressure_advance_`, which is repetition rather
 * than information: the block is headed "Pressure advance model", so four
 * labels restating it cost a line of wrapping each in a dashboard column and
 * bought nothing. What remains is still the identifier's own words in its own
 * order, so "Time Offset" is findable in a config as
 * `pressure_advance_time_offset` by anyone reading the heading above it — an
 * elision of stated context, not a rename. If a future key's suffix is
 * ambiguous on its own, that is the case to reconsider this for.
 */
export function formatPressureAdvanceLabel(key: string): string {
  const stripped = key.startsWith(redundantLabelPrefix)
    ? key.slice(redundantLabelPrefix.length)
    : key
  // A trailing underscore would title-case into a trailing space, which reads as
  // a stray gap before the field beside it.
  return titleCaseIdentifier((stripped === '' ? key : stripped).replace(/_+$/, ''))
}

/**
 * Klipper reports numbers, strings, and booleans here. Rendered as written
 * rather than through `Intl.NumberFormat`: these are configuration values the
 * user will compare against `printer.cfg` by eye, and a thousands separator or
 * a localized decimal comma would make the card and the file disagree on the
 * page. The same argument the console already makes for not reformatting what
 * the machine said.
 */
function formatValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (typeof value === 'boolean') return String(value)
  return null
}

/**
 * Every pressure-advance setting the `[extruder]` section actually reports, in
 * a stable order. Empty when the section is missing or carries none, which is
 * the honest answer for a printer whose configuration has not loaded yet.
 */
export function readPressureAdvanceSettings(
  section: Record<string, unknown> | null,
): PressureAdvanceSetting[] {
  if (!section) return []

  const found: PressureAdvanceSetting[] = []
  for (const [key, raw] of Object.entries(section)) {
    if (!isPressureAdvanceKey(key)) continue
    const value = formatValue(raw)
    if (value === null) continue
    found.push({ key, label: formatPressureAdvanceLabel(key), value })
  }

  return found.sort((left, right) => {
    const leftIndex = settingOrder.indexOf(left.key)
    const rightIndex = settingOrder.indexOf(right.key)
    if (leftIndex !== -1 && rightIndex !== -1) return leftIndex - rightIndex
    if (leftIndex !== -1) return -1
    if (rightIndex !== -1) return 1
    return left.key.localeCompare(right.key)
  })
}

/**
 * Whether this machine describes pressure advance as a model with coefficients
 * rather than as a single gain. The card shows the reported configuration
 * read-only in that case: `SET_PRESSURE_ADVANCE` has no parameter for the
 * model, so a form offering to change one would be offering something the
 * command cannot carry.
 */
export function hasNonlinearPressureAdvance(section: Record<string, unknown> | null): boolean {
  return section !== null && formatValue(section[nonlinearModelKey]) !== null
}
