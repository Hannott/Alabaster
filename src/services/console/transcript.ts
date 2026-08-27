/**
 * The G-code console's transcript logic, kept free of Vue and Pinia so the
 * classification and filtering can be tested against real Klipper output
 * without mounting anything. The store owns the subscription and the list; this
 * module owns what a line *means*.
 */

import type { MacroParameter } from '@/dashboard/macroParams'

/**
 * Klipper prefixes its output rather than tagging it, so the kind has to be read
 * back off the text. `command` is the only kind Alabaster assigns itself, when it
 * echoes what the user sent.
 */
export type ConsoleEntryKind = 'command' | 'response' | 'error' | 'action' | 'debug'

export interface ConsoleEntry {
  /** Monotonic within a session, so a repeated message still gets a stable key. */
  id: number
  kind: ConsoleEntryKind
  /** Exactly what Klipper sent, prefixes intact, for the raw-output setting. */
  raw: string
  /** The same text with Klipper's prefixes removed — what is normally shown. */
  message: string
  /** Epoch milliseconds. Backfilled entries carry Moonraker's own timestamp. */
  at: number
}

/**
 * Builds the entry for something Klipper said. Both the live notification and the
 * history backfill go through here so a restored transcript is classified and
 * cleaned exactly like a live one — the two diverging is how a filter starts
 * working on new output but not on old.
 */
export function consoleEntryFromResponse(raw: string, id: number, at: number): ConsoleEntry {
  return { id, kind: classifyResponse(raw), raw, message: cleanConsoleMessage(raw), at }
}

/** Builds the entry for something the user sent. Never cleaned: it is their text. */
export function consoleEntryFromCommand(raw: string, id: number, at: number): ConsoleEntry {
  return { id, kind: 'command', raw, message: raw, at }
}

export interface ConsoleFilterOptions {
  hideTemperatureReports: boolean
  hideTimelapseCommands: boolean
}

/**
 * `M105` and any `M109`/`M190` wait emit one of these per second. They are the
 * single largest source of console noise and are never what someone opened the
 * console to read, which is why hiding them is the one filter that defaults on.
 *
 * Anchored and applied to the raw text: `ok T:24.1 /0.0 B:23.8 /0.0` and the
 * bare `T:24.1 ...` form both occur, and matching unanchored would swallow any
 * response that merely mentions a temperature.
 */
const temperatureReportPattern = /^(?:ok\s+)?(?:B|C|T\d*):/

/**
 * The timelapse component drives itself with macros, so an installed timelapse
 * turns every layer change into several console lines the user did not type.
 * Only meaningful when that component is present; the caller gates on it.
 */
const timelapseCommandPatterns = [
  /^_TIMELAPSE_NEW_FRAME/,
  /^TIMELAPSE_TAKE_FRAME/,
  /^TIMELAPSE_RENDER/,
  /^_SET_TIMELAPSE_SETUP/,
  /^HYPERLAPSE ACTION=/,
  /^SET_GCODE_VARIABLE MACRO=TIMELAPSE_/,
]

/**
 * Klipper marks errors with `!! `, informational output with `// `, and macro
 * output with `echo:`. `// action:` and `// debug:` are narrower cases of the
 * informational prefix that Alabaster dims rather than hides, because they are
 * machine chatter that still matters when something goes wrong.
 */
export function classifyResponse(raw: string): ConsoleEntryKind {
  if (raw.startsWith('!! ')) return 'error'
  if (raw.startsWith('// action:')) return 'action'
  if (raw.startsWith('// debug:')) return 'debug'
  return 'response'
}

/**
 * Strips the prefixes Klipper uses to mark a line's kind, since the kind is
 * carried by `ConsoleEntry.kind` and rendered as styling instead of as
 * punctuation the reader has to decode.
 *
 * Applied per line rather than once: a single response can carry several lines
 * and Klipper prefixes each of them, so a whole-string replace would clean the
 * first and leave the rest looking like literal text.
 */
export function cleanConsoleMessage(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.replace(/^(?:!!|\/\/)\s?/, '').replace(/^(?:echo|debug):\s?/, ''))
    .join('\n')
    .trimEnd()
}

/**
 * True when the entry is noise the reader asked not to see. Commands the user
 * typed are never hidden — a filter exists to quiet the printer, and silently
 * dropping someone's own input would read as the console having missed it.
 */
export function isFilteredEntry(entry: ConsoleEntry, options: ConsoleFilterOptions): boolean {
  if (entry.kind === 'command') return false
  if (options.hideTemperatureReports && temperatureReportPattern.test(entry.raw)) return true
  if (
    options.hideTimelapseCommands &&
    timelapseCommandPatterns.some((pattern) => pattern.test(entry.message))
  ) {
    return true
  }
  return false
}

export function filterConsoleEntries(
  entries: readonly ConsoleEntry[],
  options: ConsoleFilterOptions,
): ConsoleEntry[] {
  return entries.filter((entry) => !isFilteredEntry(entry, options))
}

export interface CommandCompletion {
  /** What the input should become. Unchanged when nothing matched. */
  value: string
  /** Every command the fragment matched, so several can be offered at once. */
  matches: string[]
}

/** The longest prefix every candidate shares, which is how far Tab can safely fill. */
function longestCommonPrefix(values: readonly string[]): string {
  if (values.length === 0) return ''
  let prefix = values[0] ?? ''
  for (const value of values.slice(1)) {
    let length = 0
    while (length < prefix.length && length < value.length && prefix[length] === value[length]) {
      length += 1
    }
    prefix = prefix.slice(0, length)
  }
  return prefix
}

/**
 * Resolves a Tab press against the machine's own command list. Completing to the
 * longest common prefix rather than to the first match is what makes repeated
 * Tab presses converge instead of cycling: `SET_` fills to `SET_` and lists, and
 * one more character narrows it.
 *
 * G-code commands are upper case, so the fragment is compared upper case and the
 * completion is inserted in the machine's own casing.
 */
export function completeCommand(fragment: string, commands: readonly string[]): CommandCompletion {
  const needle = fragment.trim().toUpperCase()
  if (needle === '') return { value: fragment, matches: [] }
  const matches = commands.filter((command) => command.toUpperCase().startsWith(needle))
  if (matches.length === 0) return { value: fragment, matches: [] }
  if (matches.length === 1) return { value: matches[0] ?? fragment, matches }
  const shared = longestCommonPrefix(matches.map((command) => command.toUpperCase()))
  // Only grow the input. Falling back to the fragment keeps a Tab press from
  // deleting characters the user deliberately typed in a different case.
  return { value: shared.length > needle.length ? shared : fragment, matches }
}

/** The word before the first space, which is where Klipper looks for a macro name. */
export function commandNameFromLine(line: string): string {
  return line.trim().split(/\s+/, 1)[0] ?? ''
}

/**
 * Which of a macro's declared parameters have not appeared on this line yet, in
 * the order the macro's body first references them. A parameter counts as
 * present the moment its `NAME=` token appears anywhere on the line, however
 * the value trails off — this answers "what could still be typed", not "is
 * what's already there valid".
 */
export function unfilledMacroParams(
  line: string,
  params: readonly MacroParameter[],
): MacroParameter[] {
  if (params.length === 0) return []
  const present = new Set(
    [...line.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=/g)].map((match) => (match[1] ?? '').toUpperCase()),
  )
  return params.filter((param) => !present.has(param.name))
}

/**
 * Whether the caret sits where a new parameter's name could start. Only right
 * after whitespace — never mid-word — so the preview cannot appear while a
 * parameter name or value is still being typed and get mistaken for what's
 * already there.
 */
export function atParamBoundary(line: string): boolean {
  return /\s$/.test(line)
}
