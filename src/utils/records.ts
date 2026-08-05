/**
 * Narrows an unknown JSON value to a plain string-keyed object before its
 * properties are read. This is the guard every store applies to Moonraker
 * notification payloads and persisted-storage reads, and it lives here as the
 * single definition because it used to be copied into eleven files: a copy
 * that drops the `!Array.isArray` clause still type-checks, yet lets an array
 * through to code that indexes it by name. Import this one everywhere —
 * including `src/services/moonraker`, which stays Vue- and Pinia-free and can
 * therefore share it safely.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
