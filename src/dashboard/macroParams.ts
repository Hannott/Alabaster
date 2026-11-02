/**
 * What a command can be called with.
 *
 * Two sources feed the same shape. A Kalico bleeding-edge printer publishes a
 * parameter schema for every command and macro in `gcode.commands`, which
 * `schemaParams` reads; stock Klipper reports no schema anywhere, so a
 * `gcode_macro`'s parameters exist only as `params.NAME` references inside
 * its Jinja body, which `configfile.settings` already carries and
 * `parseMacroParams` extracts. `commandParams` prefers the schema and falls
 * back to the body, so the card can offer a small form and the console its
 * hints instead of making the user remember every parameter's spelling.
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

/**
 * The parameters a command declares in `gcode.commands[name].params`: one
 * entry per parameter, keyed by name, each a record with at least a `type`
 * and optionally a `default`. Only a literal default (a string, a number or
 * a boolean) is reported as one, for the same reason `parseMacroParams`
 * ignores expression defaults: a value the firmware computes must not be
 * prefilled as text. Anything that is not such a record yields no
 * parameters, so a printer without the schema degrades to the macro body.
 */
export function schemaParams(schema: unknown): MacroParameter[] {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return []
  const params: MacroParameter[] = []
  for (const [name, details] of Object.entries(schema as Record<string, unknown>)) {
    if (name.startsWith('_')) continue
    const value =
      typeof details === 'object' && details !== null
        ? (details as Record<string, unknown>).default
        : undefined
    const literal =
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    params.push({ name: name.toUpperCase(), defaultValue: literal ? String(value) : null })
  }
  return params
}

/**
 * The parameters of one command, from the machine's schema when it publishes
 * one and from the macro's body otherwise. `entries` is the console store's
 * `gcode.commands` listing; a command the machine does not list at all has
 * no schema and is looked up as a macro, which is also how a draft whose name
 * is still being typed resolves to nothing.
 */
export function commandParams(
  entries: readonly { command: string; params: readonly MacroParameter[] }[],
  settings: Readonly<Record<string, unknown>>,
  commandName: string,
): readonly MacroParameter[] {
  const name = commandName.trim().toUpperCase()
  const entry = entries.find((candidate) => candidate.command === name)
  if (entry && entry.params.length > 0) return entry.params
  return macroParamsFromSettings(settings, commandName)
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
