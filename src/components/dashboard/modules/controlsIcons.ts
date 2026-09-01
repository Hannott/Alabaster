import type { AppIconName } from '@/components/AppIcon.vue'

/**
 * The icons an Outputs row may show — a curated subset of `AppIcon`'s full
 * registry, not all of it. Most of that registry is interface chrome (undo,
 * folder, sidebar collapse…) that means nothing as "what does this fan look
 * like"; this list is only the handful that already represent a physical
 * output concept. Extend it here, and nowhere else, when a new glyph earns a
 * place — the picker and every default below read from this one list.
 */
export const outputIconTokens = [
  'fan',
  'bulb',
  'probe',
  'temperature',
  'bolt',
] as const satisfies readonly AppIconName[]

export type OutputIconToken = (typeof outputIconTokens)[number]

export type OutputKind = 'fan' | 'pin'

function isOutputIconToken(value: unknown): value is OutputIconToken {
  return typeof value === 'string' && (outputIconTokens as readonly string[]).includes(value)
}

/**
 * The override value that means "this row was explicitly set to no icon" —
 * distinct from a row nobody has customized yet, which reads its kind's own
 * default instead. A fan's default is `fan`, so its "no icon" choice has to
 * be a real, stored fact rather than absence; a pin's default is already
 * `null`, so it never strictly needs this, but it uses the same sentinel for
 * one rule instead of a kind-dependent one.
 */
const NONE_ICON = 'none'

/**
 * A stable default for a row nobody has customized yet. A fan still
 * defaults to looking like a fan; a pin defaults to no icon at all — `bolt`
 * read as "this switches power" for every unconfigured pin regardless of
 * what it actually is, which guessed wrong more often than it helped. No
 * default is a truer starting point, and the picker (`IconPickerDialog`'s
 * `allowNone`) lets any row, fan included, opt in or out of one.
 */
export function defaultOutputIcon(kind: OutputKind): OutputIconToken | null {
  return kind === 'fan' ? 'fan' : null
}

/**
 * The icon for a row, honouring its card's own choice if it has one — the
 * same shape as `temperatureSensors.ts`'s `sensorColorKey`, one level over
 * (icon instead of color). An override naming something outside
 * `outputIconTokens` and not the `NONE_ICON` sentinel (a hand-edited profile,
 * an icon a future release renamed) is dropped rather than trusted, so a
 * corrupt or stale value degrades to this row's own default alone.
 */
export function outputIcon(
  objectName: string,
  kind: OutputKind,
  overrides: Record<string, string> = {},
): OutputIconToken | null {
  const chosen = overrides[objectName]
  if (chosen === NONE_ICON) return null
  return isOutputIconToken(chosen) ? chosen : defaultOutputIcon(kind)
}

/** The value `ControlsSettingsPane` writes to `outputIcons` when a row picks "None". */
export function noneOutputIconOverride(): string {
  return NONE_ICON
}
