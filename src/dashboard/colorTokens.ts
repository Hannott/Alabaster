/**
 * The seven Okabe-Ito hues, which is the whole chromatic palette this product
 * has — the one list a module reaches for whenever it lets the user tag
 * something with a colour of its own choosing.
 *
 * Established Klipper interfaces offer a full hex picker for this. That cannot
 * ship in Alabaster: new chromatic colour is restricted to this palette, so
 * every theme pack stays coherent and every hue keeps its measured contrast.
 * These are `--color-data-*` — value, not role, per `src/themes/README.md` —
 * so unlike a status colour they do not remap per theme pack and need no
 * separate verification pass per pack.
 *
 * Shared rather than duplicated because the palette itself has to move as one
 * set: a hue renamed or dropped here has to be renamed or dropped everywhere
 * it is offered. What each caller does with it — whether every item gets a
 * colour or none does until chosen, whether one is derived from a name — is
 * that caller's own policy and stays with the caller.
 */
export const dashboardColorTokens = [
  { key: 'orange', variable: 'var(--color-data-orange)' },
  { key: 'sky', variable: 'var(--color-data-sky)' },
  { key: 'green', variable: 'var(--color-data-green)' },
  { key: 'purple', variable: 'var(--color-data-purple)' },
  { key: 'blue', variable: 'var(--color-data-blue)' },
  { key: 'red', variable: 'var(--color-data-red)' },
  { key: 'yellow', variable: 'var(--color-data-yellow)' },
] as const

export type DashboardColorKey = (typeof dashboardColorTokens)[number]['key']
