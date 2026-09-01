import { dashboardColorTokens, type DashboardColorKey } from '@/dashboard/colorTokens'

/**
 * A macro's color is optional and defaults to none — unlike a temperature
 * sensor, which always needs one to stay distinguishable on a chart, a macro
 * is already distinguished by its label. Recoloring one is personalisation a
 * user opts into, not a requirement every macro is assigned by default; an
 * auto-assigned hue on every button would change the look of every existing
 * dashboard the moment this shipped, for a card that never asked for it.
 */
const colorByKey = new Map(dashboardColorTokens.map((token) => [token.key, token.variable]))

export function macroColorKey(
  name: string,
  overrides: Record<string, string>,
): DashboardColorKey | null {
  const chosen = overrides[name]
  return colorByKey.has(chosen as DashboardColorKey) ? (chosen as DashboardColorKey) : null
}

export function macroColorVariable(name: string, overrides: Record<string, string>): string | null {
  const key = macroColorKey(name, overrides)
  return key ? (colorByKey.get(key) ?? null) : null
}

/**
 * One click cycles to the next color and wraps back to none, mirroring the
 * cycle-through-the-list interaction established Klipper interfaces use for
 * the same job — a swatch row needs no separate "clear" control when cycling
 * already passes through "none" on its way round.
 */
export function nextMacroColorKey(current: DashboardColorKey | null): DashboardColorKey | null {
  if (current === null) return dashboardColorTokens[0]?.key ?? null
  const index = dashboardColorTokens.findIndex((token) => token.key === current)
  return dashboardColorTokens[index + 1]?.key ?? null
}
