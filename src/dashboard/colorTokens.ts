/**
 * The seven Okabe-Ito hues, which is the whole chromatic palette this product
 * has — the one list a module reaches for whenever it lets the user tag
 * something with a color of its own choosing.
 *
 * Established Klipper interfaces offer a full hex picker for this. This
 * shared list cannot grow into one: new chromatic color reaching every
 * consumer of `dashboardColorTokens` is restricted to this palette, so every
 * theme pack stays coherent and every hue keeps its measured contrast. These
 * are `--color-data-*` — value, not role, per `src/themes/README.md` — so
 * unlike a status color they do not remap per theme pack and need no separate
 * verification pass per pack.
 *
 * A single consumer that wants a personalization escape hatch on top of this
 * — a color nothing else in the interface reads as meaning, chosen by the one
 * person who will see it — builds it beside this list rather than reopening
 * it. `temperatureSensors.ts`'s `sensorCustomColor` is the first: a chart
 * line's own hex, offered through a color wheel next to these seven swatches,
 * because the line's label and reading are always shown in text and nothing
 * else infers meaning from which hue a reader assigned their own thermistor.
 * Every other reader of this list — Settings' camera crosshair color among
 * them — stays restricted to the seven, and earns the same escape hatch only
 * if it turns out to want one for itself.
 *
 * Shared rather than duplicated because the palette itself has to move as one
 * set: a hue renamed or dropped here has to be renamed or dropped everywhere
 * it is offered. What each caller does with it — whether every item gets a
 * color or none does until chosen, whether one is derived from a name — is
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
