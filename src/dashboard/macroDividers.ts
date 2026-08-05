/**
 * A section heading is an ordinary entry in a Macros instance's `macros` order
 * list — it rides the same array, the same drag-and-drop, and the same
 * up/down reordering a macro name does, which is what lets a user split a
 * long macro list into named groups without a second mechanism to learn.
 *
 * It is told apart from a macro name by a prefix no Klipper command can ever
 * collide with: a G-code command name cannot contain a colon. The heading's
 * own text lives separately, in the `dividerLabels` config map keyed by id —
 * never in the order entry itself — so retyping it never changes its
 * position and never risks colliding with another entry's exact string.
 */
const DIVIDER_PREFIX = 'divider::'

export function isDividerEntry(entry: string): boolean {
  return entry.startsWith(DIVIDER_PREFIX)
}

/** The id portion of a divider entry, or `null` if `entry` is a macro name. */
export function dividerId(entry: string): string | null {
  return isDividerEntry(entry) ? entry.slice(DIVIDER_PREFIX.length) : null
}

export function makeDividerEntry(id: string): string {
  return `${DIVIDER_PREFIX}${id}`
}

/**
 * Timestamp + random rather than `crypto.randomUUID()`, which is unavailable
 * outside a secure context and Alabaster is deployed over plain HTTP by
 * design (ADR 0003). Only needs to be unique within one instance's own list.
 */
export function createDividerId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
