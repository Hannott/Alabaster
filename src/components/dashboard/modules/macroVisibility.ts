/**
 * The three states established Klipper interfaces gate a macro's visibility
 * on: standby (the printer is doing nothing), paused, and printing. Shared
 * between the card, which reads it to decide what to draw, and the pane,
 * which reads and writes the same three states per macro and per group.
 */
export const printStates = ['standby', 'paused', 'printing'] as const

export type PrintVisibilityState = (typeof printStates)[number]

/** A macro's own load/unload row is meaningless mid-print and a print-only
 * macro is meaningless before one starts — this is what state the request is
 * asked against, derived the same way `canManualExtrude` and similar guards
 * elsewhere already read the printer store. */
export function currentVisibilityState(
  isPrinting: boolean,
  isPaused: boolean,
): PrintVisibilityState {
  if (isPrinting) return 'printing'
  if (isPaused) return 'paused'
  return 'standby'
}
