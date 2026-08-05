/**
 * What a macro can be called with, read from the macro's own body.
 *
 * Klipper reports no parameter schema anywhere — a `gcode_macro`'s parameters
 * exist only as `params.NAME` references inside its Jinja body, which
 * `configfile.settings` already carries. This module extracts them, so the
 * card can offer a small form instead of making the user remember every
 * parameter's spelling.
 *
 * It is a pure module, tested with nothing mounted, and it **fails closed**:
 * a body this parser cannot read yields no parameters, and a macro with no
 * parameters stays a plain one-tap button. Parsing must never make a macro
 * harder to run than it was.
 *
 * Only a literal default — a quoted string or a bare number — is reported as
 * one. `default(printer.extruder.target)` is a real default the printer will
 * apply, but prefilling the *expression text* into a form field would invite
 * the user to send it back as a literal, so an expression default reads as
 * "the macro decides" and the field is left empty.
 */

export interface MacroParameter {
  name: string
  defaultValue: string | null
}

const paramReference = /params\.([A-Za-z_][A-Za-z0-9_]*)((?:\s*\|\s*[a-z_]+(?:\([^)]*\))?)*)/g
const paramGet =
  /params\.get\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*(?:,\s*(?:'([^']*)'|"([^"]*)"|([^)]*?)))?\s*\)/g
const paramMembership = /['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s+(?:not\s+)?in\s+params/g
const defaultFilter = /\|\s*default\(\s*(?:'([^']*)'|"([^"]*)"|([^)]*?))\s*\)/
const bareLiteral = /^-?(?:\d+\.?\d*|\.\d+)$/

function literalDefault(
  quoted1: string | undefined,
  quoted2: string | undefined,
  bare: string | undefined,
): string | null {
  if (quoted1 !== undefined) return quoted1
  if (quoted2 !== undefined) return quoted2
  const candidate = bare?.trim() ?? ''
  return bareLiteral.test(candidate) ? candidate : null
}

export function parseMacroParams(gcode: unknown): MacroParameter[] {
  if (typeof gcode !== 'string' || gcode === '') return []

  const found = new Map<string, { index: number; defaultValue: string | null }>()

  function record(name: string, index: number, defaultValue: string | null): void {
    // Klipper uppercases every parameter it passes in, so the form speaks the
    // same case whatever case the body reads it in. Underscore-led names are
    // the same "internal, not operator-facing" convention macros themselves
    // follow.
    if (name.startsWith('_')) return
    const key = name.toUpperCase()
    const existing = found.get(key)
    if (existing === undefined) {
      found.set(key, { index, defaultValue })
      return
    }
    // The first reference wins the position; the first reference that carries
    // a default wins the default.
    if (existing.defaultValue === null && defaultValue !== null) {
      existing.defaultValue = defaultValue
    }
  }

  for (const match of gcode.matchAll(paramGet)) {
    record(match[1] ?? '', match.index, literalDefault(match[2], match[3], match[4]))
  }
  for (const match of gcode.matchAll(paramReference)) {
    const name = match[1] ?? ''
    // `params.get(...)` matches this pattern as a reference named "get"; the
    // dedicated pass above already read it properly.
    if (name === 'get') continue
    const filters = match[2] ?? ''
    const defaulted = defaultFilter.exec(filters)
    record(
      name,
      match.index,
      defaulted ? literalDefault(defaulted[1], defaulted[2], defaulted[3]) : null,
    )
  }
  for (const match of gcode.matchAll(paramMembership)) {
    record(match[1] ?? '', match.index, null)
  }

  return [...found.entries()]
    .sort((left, right) => left[1].index - right[1].index)
    .map(([name, entry]) => ({ name, defaultValue: entry.defaultValue }))
}

/**
 * The parameters of one named macro, read from `configfile.settings` — the
 * record `usePrinterConfigStore` already loads once per Klipper-ready, keyed
 * by lowercased section name exactly as Klipper reports it.
 */
export function macroParamsFromSettings(
  settings: Readonly<Record<string, unknown>>,
  macroName: string,
): MacroParameter[] {
  const section = settings[`gcode_macro ${macroName.trim().toLowerCase()}`]
  if (typeof section !== 'object' || section === null) return []
  return parseMacroParams((section as Record<string, unknown>).gcode)
}
