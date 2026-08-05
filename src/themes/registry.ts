/*
 * One pack today. The registry stays a list rather than collapsing into a
 * constant because the shape is what makes a second pack a CSS file and a line
 * here -- and because `isThemePackId` is what quietly migrates a reader whose
 * stored pack no longer exists back to the default, which is how the Kalico
 * pack's removal is invisible to anyone who had selected it.
 */
export const themePacks = [{ id: 'alabaster', labelKey: 'theme.packs.alabaster' }] as const

export type ThemePackId = (typeof themePacks)[number]['id']

export const defaultThemePackId: ThemePackId = 'alabaster'

export function isThemePackId(value: string): value is ThemePackId {
  return themePacks.some(({ id }) => id === value)
}
