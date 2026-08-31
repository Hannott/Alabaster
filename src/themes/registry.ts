/*
 * A list rather than a constant because the shape is what makes a new pack a
 * CSS file and a line here -- and because `isThemePackId` is what quietly
 * migrates a reader whose stored pack no longer exists back to the default,
 * which is how a removed pack stays invisible to anyone who had it selected.
 *
 * `lockedMode` is for a pack whose whole identity is one mode: Terminal's CRT
 * phosphor screen has no light-mode equivalent, only a different pack concept
 * (the dot-matrix printout) wearing the same name. Rather than let a reader
 * land on a combination the pack was never designed for, a locked pack always
 * renders in its one mode regardless of the stored `system`/`light`/`dark`
 * preference -- `useTheme.ts`'s `resolvedTheme` is what enforces this, and
 * `SettingsView.vue` disables the Mode group and explains why while such a
 * pack is active. The preference itself is left untouched, so switching back
 * to an unlocked pack restores whatever mode the reader had before.
 */
export const themePacks = [
  { id: 'alabaster', labelKey: 'theme.packs.alabaster', lockedMode: null },
  { id: 'terminal', labelKey: 'theme.packs.terminal', lockedMode: 'dark' },
  { id: 'blueprint', labelKey: 'theme.packs.blueprint', lockedMode: null },
] as const

export type ThemePackId = (typeof themePacks)[number]['id']

export const defaultThemePackId: ThemePackId = 'alabaster'

export function isThemePackId(value: string): value is ThemePackId {
  return themePacks.some(({ id }) => id === value)
}

/** The one mode a pack renders in, or `null` when it follows the reader's own preference. */
export function lockedModeFor(packId: ThemePackId): 'light' | 'dark' | null {
  return themePacks.find(({ id }) => id === packId)?.lockedMode ?? null
}
