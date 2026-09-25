/**
 * Which line in which file holds a config option, read the way Klipper reads
 * it — and the edit that changes it.
 *
 * Quick config edits options as fields, so everything it writes depends on
 * finding the line Klipper actually uses. That is not the first line that
 * mentions the option. Klipper expands every `[include]` where it stands,
 * lets a later definition of an option override an earlier one, and reads the
 * `SAVE_CONFIG` block at the end of `printer.cfg` last of all. An interface
 * that takes "the first file containing the section" rewrites a line Klipper
 * ignores whenever a section is split across files, and reports success on a
 * change that does nothing after the restart. So the index below walks the
 * configuration in Klipper's order and keeps every occurrence; the effective
 * one is the last.
 *
 * The parsing rules copy Klipper's `configfile.py` on top of Python's
 * `RawConfigParser`, because those two decide what a line means:
 *
 * - `#` starts a comment anywhere on a line, since Klipper cuts it before the
 *   parser runs; `;` does only at the start or after whitespace, which is the
 *   parser's own inline-comment rule.
 * - An option's value continues onto following lines that are indented deeper
 *   than the option, with blank and comment lines in between not ending it.
 * - Each stretch of text between includes is parsed on its own, so an include
 *   ends the section it appears in.
 * - The `SAVE_CONFIG` block is only read from the primary file.
 *
 * Kept free of Vue, Pinia, and the transport: it takes file text and returns
 * positions and new file text, so every rule is testable against raw config.
 */

import {
  expandIncludeTarget,
  isGlob,
  normalizeConfigPath,
  resolveIncludeTarget,
} from '@/features/machine/includes'

export interface OptionOccurrence {
  /** The section as written, `heater_generic chamber`. */
  section: string
  /** The option as written, before Klipper lowercases it. */
  option: string
  path: string
  /** Zero-based line of the `option: value` line. */
  line: number
  /** Zero-based last line of the value; equal to `line` unless it continues. */
  endLine: number
  /** The value as Klipper reads it, continuation lines joined by `\n`. */
  value: string
  multiline: boolean
  /** Inside the `#*#` block `SAVE_CONFIG` regenerates. */
  autosave: boolean
  /** Columns of the value on `line` in the raw file text, for an in-place edit. */
  valueStart: number
  valueEnd: number
}

export interface SectionOccurrence {
  section: string
  path: string
  /** Zero-based line of the `[section]` header. */
  line: number
  /** The last line holding one of this block's values, or `line` when it has none. */
  lastLine: number
  autosave: boolean
}

export type ConfigProblem =
  /** A literal include naming a file that does not exist; Klipper refuses to start. */
  | { kind: 'missingInclude'; path: string; line: number; target: string }
  /** An absolute path or one above the config root, which the files API cannot reach. */
  | { kind: 'unreachableInclude'; path: string; line: number; target: string }
  /** An included file that exists but was not passed in, so its options are unknown. */
  | { kind: 'unloadedInclude'; path: string; line: number; target: string }
  /** An include chain that returns to a file already being read. */
  | { kind: 'recursiveInclude'; path: string; line: number; target: string }
  /** A `SAVE_CONFIG` block Klipper would ignore as corrupted. */
  | { kind: 'unreadableAutosave'; path: string; line: number }

export interface ConfigIndex {
  primaryPath: string
  /** Every file read, in the order Klipper first reaches it. */
  files: string[]
  /** Keyed by {@link optionKey}; occurrences in Klipper's reading order. */
  options: ReadonlyMap<string, readonly OptionOccurrence[]>
  /** Keyed by {@link sectionKey}; occurrences in Klipper's reading order. */
  sections: ReadonlyMap<string, readonly SectionOccurrence[]>
  problems: ConfigProblem[]
}

/*
 * Matched without case: `configfile.settings`, which is where Quick config
 * gets the names it looks up, reports every section and option in lower case.
 */
export function sectionKey(section: string): string {
  return section.toLowerCase()
}

export function optionKey(section: string, option: string): string {
  return `${sectionKey(section)}\n${option.toLowerCase()}`
}

const SAVE_CONFIG_MARKER = /^[ \t]*#\*#[ \t]*<-+[ \t]*SAVE_CONFIG[ \t]*-+>[ \t]*$/
const SECTION_HEADER = /^\[(.+)\]/

interface SourceLine {
  /** Zero-based line in the raw file. */
  index: number
  /** The text Klipper parses: no `\r`, no `#*# ` prefix. */
  text: string
  /** Columns the raw line has before `text` starts. */
  offset: number
}

function splitLines(text: string): string[] {
  return text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
}

/**
 * Where the comment starts in `text`, or `text.length` when it has none, and
 * whether the parser saw it. Klipper cuts `#` before the parser runs, so to
 * the parser a `#` comment line is a blank line; only a `;` comment is one.
 */
function commentStart(text: string): { cut: number; parserComment: boolean } {
  const hash = text.indexOf('#')
  const code = hash === -1 ? text : text.slice(0, hash)
  for (let index = code.indexOf(';'); index !== -1; index = code.indexOf(';', index + 1)) {
    if (index === 0 || /\s/.test(code[index - 1] as string)) {
      return { cut: index, parserComment: true }
    }
  }
  return { cut: code.length, parserComment: false }
}

function indentOf(text: string): number {
  const match = /\S/.exec(text)
  return match ? match.index : 0
}

/**
 * The `SAVE_CONFIG` block's lines, with their `#*# ` prefix removed, or null
 * when Klipper would refuse to read it. Klipper takes a line as `#*#` or
 * `#*# …` and nothing else; one other line and it ignores the whole block.
 * Trailing blank lines are what a file's final newline leaves, not content.
 */
function autosaveLines(lines: readonly string[], marker: number): SourceLine[] | null {
  let last = lines.length - 1
  while (last > marker && (lines[last] as string).trim() === '') last -= 1

  const result: SourceLine[] = []
  for (let index = marker + 1; index <= last; index += 1) {
    const raw = lines[index] as string
    if (raw === '#*#') {
      result.push({ index, text: '', offset: 3 })
    } else if (raw.startsWith('#*# ')) {
      result.push({ index, text: raw.slice(4), offset: 4 })
    } else {
      return null
    }
  }
  return result
}

interface IndexBuilder {
  files: ReadonlyMap<string, string>
  available: string[]
  visitedFiles: string[]
  options: Map<string, OptionOccurrence[]>
  sections: Map<string, SectionOccurrence[]>
  problems: ConfigProblem[]
}

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

function parseLines(
  builder: IndexBuilder,
  path: string,
  lines: readonly SourceLine[],
  autosave: boolean,
  chain: readonly string[],
): void {
  let section: SectionOccurrence | null = null
  let current: OptionOccurrence | null = null
  let currentIndent = 0
  let continuation: string[] = []

  const closeOption = (): void => {
    if (current && continuation.length > 0) {
      while (continuation.length > 0 && continuation[continuation.length - 1] === '') {
        continuation.pop()
      }
      if (continuation.length > 0) current.value = [current.value, ...continuation].join('\n')
    }
    current = null
    continuation = []
  }

  for (const line of lines) {
    const { cut, parserComment } = commentStart(line.text)
    const code = line.text.slice(0, cut)
    const value = code.trim()

    if (value === '') {
      // A blank line inside a value belongs to it only if the value continues after it.
      if (current && !parserComment) continuation.push('')
      continue
    }

    const indent = indentOf(code)
    if (current && indent > currentIndent) {
      continuation.push(value)
      current.endLine = line.index
      current.multiline = true
      if (section) section.lastLine = line.index
      continue
    }
    closeOption()

    // Klipper recognizes an include only when `[` opens the line.
    const include = SECTION_HEADER.exec(code)?.[1]
    if (!autosave && include?.startsWith('include ')) {
      section = null
      readInclude(builder, path, line.index, include.slice(8).trim(), chain)
      continue
    }

    const header = SECTION_HEADER.exec(value)?.[1]
    if (header !== undefined) {
      section = { section: header, path, line: line.index, lastLine: line.index, autosave }
      pushTo(builder.sections, sectionKey(header), section)
      continue
    }

    // Klipper refuses an option outside any section; it has no line to edit either.
    if (!section) continue

    const separator = /[=:]/.exec(value)
    if (!separator) continue
    const option = value.slice(0, separator.index).trimEnd()
    if (option === '') continue

    const separatorColumn = indent + separator.index
    const afterSeparator = code.slice(separatorColumn + 1)
    const valueStart = separatorColumn + 1 + indentOf(afterSeparator)
    const valueEnd = Math.max(valueStart, code.trimEnd().length)

    current = {
      section: section.section,
      option,
      path,
      line: line.index,
      endLine: line.index,
      value: code.slice(valueStart, valueEnd),
      multiline: false,
      autosave,
      valueStart: line.offset + valueStart,
      valueEnd: line.offset + valueEnd,
    }
    currentIndent = indent
    section.lastLine = line.index
    pushTo(builder.options, optionKey(section.section, option), current)
  }
  closeOption()
}

function readInclude(
  builder: IndexBuilder,
  path: string,
  line: number,
  target: string,
  chain: readonly string[],
): void {
  if (target.startsWith('/') || resolveIncludeTarget(path, target).startsWith('..')) {
    builder.problems.push({ kind: 'unreachableInclude', path, line, target })
    return
  }
  const matches = expandIncludeTarget(path, target, builder.available)
  if (matches.length === 0 && !isGlob(target)) {
    builder.problems.push({ kind: 'missingInclude', path, line, target })
    return
  }
  for (const included of matches) {
    if (chain.includes(included)) {
      builder.problems.push({ kind: 'recursiveInclude', path, line, target })
      continue
    }
    const text = builder.files.get(included)
    if (text === undefined) {
      builder.problems.push({ kind: 'unloadedInclude', path, line, target })
      continue
    }
    readFile(builder, included, text, [...chain, included], false)
  }
}

function readFile(
  builder: IndexBuilder,
  path: string,
  text: string,
  chain: readonly string[],
  primary: boolean,
): void {
  if (!builder.visitedFiles.includes(path)) builder.visitedFiles.push(path)
  const raw = splitLines(text)
  const marker = primary ? raw.findIndex((line) => SAVE_CONFIG_MARKER.test(line)) : -1
  const bodyEnd = marker === -1 ? raw.length : marker

  const body = raw.slice(0, bodyEnd).map((line, index) => ({ index, text: line, offset: 0 }))
  parseLines(builder, path, body, false, chain)

  if (marker === -1) return
  const autosave = autosaveLines(raw, marker)
  if (!autosave) {
    builder.problems.push({ kind: 'unreadableAutosave', path, line: marker })
    return
  }
  // The block opens with Klipper's own "DO NOT EDIT" lines, which precede any section.
  const firstSection = autosave.findIndex((line) => SECTION_HEADER.test(line.text.trim()))
  if (firstSection === -1) return
  parseLines(builder, path, autosave.slice(firstSection), true, chain)
}

/**
 * The files one config file includes, in order, for a caller that has to
 * fetch them before it can build the index. Missing literal targets are
 * left out here; {@link indexConfig} reports them.
 */
export function includedConfigFiles(
  path: string,
  text: string,
  availablePaths: Iterable<string>,
): string[] {
  const available = [...availablePaths]
  const found: string[] = []
  const raw = splitLines(text)
  for (const line of raw) {
    if (SAVE_CONFIG_MARKER.test(line)) break
    const header = SECTION_HEADER.exec(line.slice(0, commentStart(line).cut))?.[1]
    if (!header?.startsWith('include ')) continue
    for (const included of expandIncludeTarget(path, header.slice(8).trim(), available)) {
      if (!found.includes(included)) found.push(included)
    }
  }
  return found
}

/**
 * Every section and option Klipper would read, starting at `primaryPath`.
 *
 * `files` holds the text of each file to read, keyed by path relative to the
 * config root; `availablePaths` is every file that exists there, which is
 * what glob includes are matched against. A file that is included but not in
 * `files` is reported rather than guessed at.
 */
export function indexConfig(
  primaryPath: string,
  files: ReadonlyMap<string, string>,
  availablePaths: Iterable<string>,
): ConfigIndex {
  const primary = normalizeConfigPath(primaryPath)
  const builder: IndexBuilder = {
    files,
    available: [...availablePaths].map(normalizeConfigPath),
    visitedFiles: [],
    options: new Map(),
    sections: new Map(),
    problems: [],
  }
  const text = files.get(primary)
  if (text !== undefined) readFile(builder, primary, text, [primary], true)
  return {
    primaryPath: primary,
    files: builder.visitedFiles,
    options: builder.options,
    sections: builder.sections,
    problems: builder.problems,
  }
}

/** The occurrence Klipper uses: the last one it reads. */
export function effectiveOption(
  index: ConfigIndex,
  section: string,
  option: string,
): OptionOccurrence | null {
  return index.options.get(optionKey(section, option))?.at(-1) ?? null
}

export type OptionWriteFailure =
  /** A value Klipper would read differently: empty, several lines, or holding a comment marker. */
  | 'invalidValue'
  /** The effective value spans lines; a one-line edit would leave its continuation behind. */
  | 'multiline'
  /** Neither the option nor its section is in the configuration. */
  | 'sectionMissing'

export type OptionWrite =
  | {
      ok: true
      path: string
      /** The whole file with the edit applied. */
      content: string
      line: number
      placement: 'replaced' | 'inserted'
      autosave: boolean
    }
  | { ok: false; reason: OptionWriteFailure }

function isWritableValue(value: string): boolean {
  if (value === '' || /[\r\n]/.test(value)) return false
  return commentStart(value).cut === value.length
}

/**
 * The edit that makes `section.option` read `value`.
 *
 * An option Klipper already reads is changed on its effective line, in place,
 * keeping the key's spelling, the separator, and any trailing comment. An
 * option at its default is added as a new line at the end of the section's
 * last block in the file body, so no later definition can shadow it — and
 * never into the `SAVE_CONFIG` block unless that is the only place the
 * section exists.
 *
 * `files` must be the same text `index` was built from.
 */
export function writeOption(
  index: ConfigIndex,
  files: ReadonlyMap<string, string>,
  section: string,
  option: string,
  value: string,
): OptionWrite {
  const next = value.trim()
  if (!isWritableValue(next)) return { ok: false, reason: 'invalidValue' }

  const existing = effectiveOption(index, section, option)
  if (existing) {
    if (existing.multiline) return { ok: false, reason: 'multiline' }
    const text = files.get(existing.path)
    if (text === undefined) return { ok: false, reason: 'sectionMissing' }
    const lines = text.split('\n')
    const raw = lines[existing.line] as string
    const before = raw.slice(0, existing.valueStart)
    // `max_accel:` with no value yet gains the space the other lines have.
    const gap = existing.valueStart === existing.valueEnd && /[=:]$/.test(before) ? ' ' : ''
    lines[existing.line] = `${before}${gap}${next}${raw.slice(existing.valueEnd)}`
    return {
      ok: true,
      path: existing.path,
      content: lines.join('\n'),
      line: existing.line,
      placement: 'replaced',
      autosave: existing.autosave,
    }
  }

  const blocks = index.sections.get(sectionKey(section)) ?? []
  const target = blocks.filter((block) => !block.autosave).at(-1) ?? blocks.at(-1)
  if (!target) return { ok: false, reason: 'sectionMissing' }
  const text = files.get(target.path)
  if (text === undefined) return { ok: false, reason: 'sectionMissing' }

  const lines = text.split('\n')
  const entry = target.autosave ? `#*# ${option} = ${next}` : `${option}: ${next}`
  const at = target.lastLine + 1
  const carriage = at < lines.length && text.includes('\r\n') ? '\r' : ''
  lines.splice(at, 0, `${entry}${carriage}`)
  return {
    ok: true,
    path: target.path,
    content: lines.join('\n'),
    line: at,
    placement: 'inserted',
    autosave: target.autosave,
  }
}
