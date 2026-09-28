/**
 * What the configuration editor's context menu is about: the thing under a
 * line and column, and the structure around it.
 *
 * Everything here is read off the tokens `syntax.ts` already produces for the
 * colouring, from the state the lines above leave behind — so the menu can
 * never call something a key that the editor paints as G-code, the failure the
 * streaming tokenizer was written to end. The only text this module reads for
 * itself is within one token or one line: the word under a column inside a run
 * the tokenizer left `plain`, a URL inside a comment, a pin inside a value.
 * Which sections, keys, and files exist is the menu's question, answered from
 * Klipper's own `configfile` and the Quick config index, never from here.
 *
 * Pure, so each target can be tested from a fixture without a textarea.
 */

import { COMMENT_LINE, isContinuationLine, SECTION_LINE } from '@/features/machine/configLines'
import { jinjaName, type JinjaName } from '@/features/machine/docsLinks'
import {
  syntaxStateBefore,
  tokenizeMachineLine,
  type MachineSyntaxToken,
} from '@/features/machine/syntax'

/** A zero-based, inclusive range of lines. */
export interface LineRange {
  from: number
  to: number
}

export type EditorTarget =
  /** A `[section]` header, or one commented out whole: `#[bed_mesh]`. */
  | { kind: 'section'; name: string; commented: boolean }
  | { kind: 'include'; path: string }
  /** A key, its value, or — `commented` — a key someone commented out. */
  | {
      kind: 'option'
      option: string
      value: string
      commented: boolean
      /** The value is rendered as a template: `gcode`, `*_gcode`, and their kind. */
      template: boolean
      /** The value continues onto the lines below. */
      multiline: boolean
    }
  /** One pin inside a pin option's value, split into its chip and its name. */
  | { kind: 'pin'; option: string; pin: string; chip: string | null; name: string }
  | { kind: 'command'; name: string }
  /**
   * `printer.toolhead.homed_axes`, `printer['gcode_macro PARK'].z_lift`, or an
   * alias a `{% set %}` in the same body bound to a `printer` path.
   */
  | {
      kind: 'printerPath'
      /** The printer object, as Klipper names it: `toolhead`, `gcode_macro PARK`. */
      object: string
      /** The attributes read from it, outermost first. */
      attributes: string[]
      /** How the path reads once any alias is expanded, for the menu's heading. */
      display: string
    }
  /** `params`, `rawparams`, and `action_*` — Klipper's additions to a template's context. */
  | { kind: 'templateGlobal'; name: string }
  | { kind: 'jinja'; name: JinjaName }
  /** A Jinja delimiter, with the character span of the expression it opens or closes. */
  | { kind: 'delimiter'; start: number; end: number }
  | { kind: 'url'; href: string }
  /** A line of the block `SAVE_CONFIG` writes; `option` is null on its `[section]` line. */
  | { kind: 'autogen'; section: string | null; option: string | null }
  | { kind: 'plain' }

export interface EditorContext {
  line: number
  column: number
  target: EditorTarget
  /** The characters on the line the target covers, for copying it when nothing is selected. */
  span: { start: number; end: number } | null
  /** The section header the line sits under, as written between its brackets. */
  section: { name: string; line: number } | null
  /** The header through the section's last line that holds anything. */
  sectionRange: LineRange | null
  /** The template value the line belongs to, from its key line to its last continuation. */
  templateBody: LineRange | null
}

const SECTION_HEADER = /^\[([^\]]+)\]/
const SAVE_CONFIG_MARKER = /^[ \t]*#\*#[ \t]*<-+[ \t]*SAVE_CONFIG[ \t]*-+>/
const COMMENTED_SECTION = /^\s*[#;]+\s*\[([A-Za-z_][\w. -]*)\]\s*$/
const COMMENTED_OPTION = /^\s*[#;]+\s*([A-Za-z_][\w.-]*)\s*[:=]\s*(.*)$/
const AUTOGEN_SECTION = /^\s*#\*#\s*\[([^\]]+)\]/
const AUTOGEN_OPTION = /^\s*#\*#\s*([A-Za-z_][\w.-]*)\s*[:=]/
const URL = /https?:\/\/[^\s<>"'`)]+/g
const PIN = /^([!^~]*)(?:([A-Za-z0-9_]+):)?([A-Za-z0-9_.]+)$/
const PRINTER_PATH = /^printer((?:\s*\.\s*[A-Za-z_]\w*|\s*\[\s*(?:'[^']*'|"[^"]*")\s*\])*)/
const PATH_SEGMENT = /\s*\.\s*([A-Za-z_]\w*)|\s*\[\s*(?:'([^']*)'|"([^"]*)")\s*\]/g
const OPENING_DELIMITER = /^\{[%{]?-?$/

function isColumnZeroContent(line: string): boolean {
  return line.length > 0 && line[0] !== ' ' && line[0] !== '\t' && line.trim() !== ''
}

function isSectionHeaderLine(line: string): boolean {
  return line.startsWith('[') && SECTION_LINE.test(line.trimEnd())
}

/** The header `line` sits under, walking up to the nearest column-zero `[`. */
export function enclosingSection(
  lines: readonly string[],
  line: number,
): { name: string; line: number } | null {
  for (let index = line; index >= 0; index -= 1) {
    const text = lines[index] ?? ''
    if (!text.startsWith('[')) continue
    const match = SECTION_HEADER.exec(text)
    if (match?.[1]) return { name: match[1].trim().replace(/\s+/g, ' '), line: index }
  }
  return null
}

/**
 * A section's own lines: its header through the last line that holds anything
 * before the next header or the `SAVE_CONFIG` block. Blank lines and
 * column-zero comments at the end are left out — a comment directly above the
 * next header describes that section, and commenting this one out should not
 * reach across to it.
 */
export function sectionLines(lines: readonly string[], header: number): LineRange {
  let next = header + 1
  while (next < lines.length) {
    const text = lines[next] ?? ''
    if (isSectionHeaderLine(text) || SAVE_CONFIG_MARKER.test(text)) break
    next += 1
  }
  let last = next - 1
  while (last > header) {
    const text = lines[last] ?? ''
    if (text.trim() !== '' && !COMMENT_LINE.test(text)) break
    last -= 1
  }
  return { from: header, to: last }
}

/**
 * Lines a commented-out section spans: its commented header and the commented
 * lines directly under it. A blank line ends it — once everything is a comment
 * there is nothing else to say where the section stopped, and uncommenting a
 * paragraph of notes below it into keys would break the file.
 */
function commentedSectionLines(lines: readonly string[], header: number): LineRange {
  let last = header
  for (let index = header + 1; index < lines.length; index += 1) {
    const text = lines[index] ?? ''
    if (text.trim() === '' || !/^\s*[#;]/.test(text)) break
    if (COMMENTED_SECTION.test(text) || /^\s*#\*#/.test(text)) break
    last = index
  }
  return { from: header, to: last }
}

/** The key line a continuation belongs to: the nearest column-zero line above that is not a comment. */
function keyLineAbove(lines: readonly string[], line: number): number | null {
  for (let index = line; index >= 0; index -= 1) {
    const text = lines[index] ?? ''
    if (!isColumnZeroContent(text) || COMMENT_LINE.test(text)) continue
    return isSectionHeaderLine(text) ? null : index
  }
  return null
}

/**
 * A value's lines: its key line, then every line that continues it. Blank
 * lines and comments keep a value open, as `configparser` reads it, so they
 * are walked past — and trimmed back off the end, since the value is over by
 * the time a trailing one appears.
 */
function valueLines(lines: readonly string[], keyLine: number): LineRange {
  let last = keyLine
  for (let index = keyLine + 1; index < lines.length; index += 1) {
    const text = lines[index] ?? ''
    if (text.trim() === '' || COMMENT_LINE.test(text)) continue
    if (!isContinuationLine(text, true)) break
    last = index
  }
  return { from: keyLine, to: last }
}

interface Located {
  token: MachineSyntaxToken
  index: number
  start: number
  end: number
}

function tokenAt(tokens: readonly MachineSyntaxToken[], column: number): Located | null {
  let start = 0
  for (const [index, token] of tokens.entries()) {
    const end = start + token.text.length
    if (column >= start && column < end) return { token, index, start, end }
    start = end
  }
  return null
}

function tokenStart(tokens: readonly MachineSyntaxToken[], index: number): number {
  return tokens.slice(0, index).reduce((sum, token) => sum + token.text.length, 0)
}

function optionName(keyText: string): string {
  return keyText.replace(/\s*[:=]\s*$/, '').trim()
}

/** The value text on a property line: every token after the key, up to an inline comment. */
function valueAfterKey(tokens: readonly MachineSyntaxToken[], keyIndex: number): string {
  const rest: string[] = []
  for (const token of tokens.slice(keyIndex + 1)) {
    if (token.kind === 'comment') break
    rest.push(token.text)
  }
  return rest.join('').trim()
}

function isPinOption(option: string): boolean {
  const name = option.toLowerCase()
  return name === 'pin' || name === 'pins' || name.endsWith('_pin') || name.endsWith('_pins')
}

/** The comma-separated item of `text` that `offset` falls in, with its own span. */
function listItemAt(text: string, offset: number): { text: string; start: number } | null {
  let start = 0
  for (const part of text.split(',')) {
    const end = start + part.length
    if (offset >= start && offset <= end) {
      const lead = part.length - part.trimStart().length
      return { text: part.trim(), start: start + lead }
    }
    start = end + 1
  }
  return null
}

/** The dotted identifier run under `column`: `th.position.z` from anywhere inside it. */
function identifierPathAt(text: string, column: number): { path: string; start: number } | null {
  if (!/\w/.test(text[column] ?? '')) return null
  let start = column
  while (start > 0 && /[\w.]/.test(text[start - 1] ?? '')) start -= 1
  while (text[start] === '.') start += 1
  let end = column
  while (end < text.length && /[\w.]/.test(text[end] ?? '')) end += 1
  while (end > start && text[end - 1] === '.') end -= 1
  const path = text.slice(start, end)
  if (!/^[A-Za-z_]/.test(path)) return null
  return { path, start }
}

function readPrinterPath(
  text: string,
): { object: string; attributes: string[]; length: number } | null {
  const match = PRINTER_PATH.exec(text)
  if (!match) return null
  const segments: string[] = []
  for (const segment of (match[1] ?? '').matchAll(PATH_SEGMENT)) {
    const name = segment[1] ?? segment[2] ?? segment[3]
    if (name !== undefined) segments.push(name)
  }
  const [object, ...attributes] = segments
  if (!object) return null
  return { object: object.trim().replace(/\s+/g, ' '), attributes, length: match[0].length }
}

function displayPath(object: string, attributes: readonly string[]): string {
  const head = /^\w+$/.test(object) ? `printer.${object}` : `printer["${object}"]`
  return [head, ...attributes].join('.')
}

/**
 * An alias a `{% set name = printer… %}` in the same template body bound, so
 * `th.homed_axes` after `{% set th = printer.toolhead %}` is still read as the
 * toolhead's. Anything more dynamic than a plain `printer` path is not
 * followed — the menu then has the word, not an object.
 */
function aliasedPrinterPath(
  lines: readonly string[],
  body: LineRange,
  alias: string,
): { object: string; attributes: string[] } | null {
  const binding = new RegExp(`\\{%-?\\s*set\\s+${alias}\\s*=\\s*(printer\\b[^%]*?)\\s*-?%\\}`)
  let found: { object: string; attributes: string[] } | null = null
  for (let index = body.from; index <= body.to; index += 1) {
    const match = binding.exec(lines[index] ?? '')
    if (!match?.[1]) continue
    const path = readPrinterPath(match[1])
    if (path && path.length === match[1].length) found = path
  }
  return found
}

function delimiterSpan(
  tokens: readonly MachineSyntaxToken[],
  located: Located,
): { start: number; end: number } | null {
  const opening = OPENING_DELIMITER.test(located.token.text)
  if (opening) {
    for (let index = located.index + 1; index < tokens.length; index += 1) {
      const token = tokens[index]
      if (token?.kind !== 'templateDelimiter') continue
      if (OPENING_DELIMITER.test(token.text)) return null
      return { start: located.start, end: tokenStart(tokens, index) + token.text.length }
    }
    return null
  }
  for (let index = located.index - 1; index >= 0; index -= 1) {
    const token = tokens[index]
    if (token?.kind !== 'templateDelimiter') continue
    if (!OPENING_DELIMITER.test(token.text)) return null
    return { start: tokenStart(tokens, index), end: located.end }
  }
  return null
}

function autogenTarget(lines: readonly string[], line: number, text: string): EditorTarget {
  const header = AUTOGEN_SECTION.exec(text)
  if (header?.[1]) return { kind: 'autogen', section: header[1].trim(), option: null }
  const option = AUTOGEN_OPTION.exec(text)?.[1] ?? null
  for (let index = line - 1; index >= 0; index -= 1) {
    const match = AUTOGEN_SECTION.exec(lines[index] ?? '')
    if (match?.[1]) return { kind: 'autogen', section: match[1].trim(), option }
    if (!/^\s*#\*#/.test(lines[index] ?? '')) break
  }
  return { kind: 'autogen', section: null, option }
}

function commentTarget(
  text: string,
  column: number,
): { target: EditorTarget; span: { start: number; end: number } } | null {
  for (const match of text.matchAll(URL)) {
    const start = match.index
    const end = start + match[0].length
    if (column >= start && column < end) {
      return {
        target: { kind: 'url', href: match[0].replace(/[.,;:]+$/, '') },
        span: { start, end },
      }
    }
  }
  const section = COMMENTED_SECTION.exec(text)
  if (section?.[1]) {
    return {
      target: { kind: 'section', name: section[1].trim(), commented: true },
      span: { start: 0, end: text.length },
    }
  }
  const option = COMMENTED_OPTION.exec(text)
  if (option?.[1]) {
    const value = (option[2] ?? '').replace(/\s[#;].*$/, '').trim()
    return {
      target: {
        kind: 'option',
        option: option[1],
        value,
        commented: true,
        template: false,
        multiline: false,
      },
      span: { start: 0, end: text.length },
    }
  }
  return null
}

/**
 * Resolves what the editor's context menu is about at `line`, `column` —
 * zero-based, `column` counted in characters, which is what the monospace hit
 * test measures.
 */
export function resolveEditorContext(
  lines: readonly string[],
  line: number,
  column: number,
): EditorContext {
  const text = lines[line] ?? ''
  const state = syntaxStateBefore(lines, line)
  const insideTemplate = state.block === 'template' && isContinuationLine(text, true)
  const tokens = tokenizeMachineLine(text, state)
  const section = enclosingSection(lines, line)
  const base = {
    line,
    column,
    section,
    sectionRange: section ? sectionLines(lines, section.line) : null,
  }
  const keyIndex = tokens.findIndex((token) => token.kind === 'key')
  const keyLine = keyIndex >= 0 ? line : insideTemplate ? keyLineAbove(lines, line) : null
  const templateBody =
    keyLine !== null && (insideTemplate || (keyIndex >= 0 && state.block === 'template'))
      ? valueLines(lines, keyLine)
      : null
  const context = (target: EditorTarget, span: { start: number; end: number } | null) => ({
    ...base,
    templateBody,
    target,
    span,
  })

  const located = tokenAt(tokens, column)
  if (!located) return context({ kind: 'plain' }, null)
  const { token } = located
  const span = { start: located.start, end: located.end }

  switch (token.kind) {
    case 'section': {
      const include = tokens.find((candidate) => candidate.kind === 'includePath')
      if (include) return context({ kind: 'include', path: include.text.trim() }, span)
      const name = SECTION_HEADER.exec(text.trim())?.[1]?.trim().replace(/\s+/g, ' ')
      return name
        ? context({ kind: 'section', name, commented: false }, span)
        : context({ kind: 'plain' }, null)
    }
    case 'includePath':
      return context({ kind: 'include', path: token.text.trim() }, span)
    case 'autogen':
      return context(autogenTarget(lines, line, text), { start: located.start, end: located.end })
    case 'comment': {
      const found = commentTarget(text, column)
      if (!found) return context({ kind: 'plain' }, null)
      if (found.target.kind === 'section' && found.target.commented) {
        return {
          ...context(found.target, found.span),
          sectionRange: commentedSectionLines(lines, line),
        }
      }
      return context(found.target, found.span)
    }
    case 'command':
    case 'gcode':
      return context({ kind: 'command', name: token.text }, span)
    case 'templateKeyword': {
      const name = jinjaName('keyword', token.text)
      return name ? context({ kind: 'jinja', name }, span) : context({ kind: 'plain' }, null)
    }
    case 'templateFilter': {
      const before = text.slice(0, located.start).trimEnd()
      const name = jinjaName(before.endsWith('|') ? 'filter' : 'test', token.text)
      return name ? context({ kind: 'jinja', name }, span) : context({ kind: 'plain' }, null)
    }
    case 'templateGlobal': {
      if (token.text !== 'printer') {
        return context({ kind: 'templateGlobal', name: token.text }, span)
      }
      const path = readPrinterPath(text.slice(located.start))
      if (!path) return context({ kind: 'templateGlobal', name: 'printer' }, span)
      return context(
        {
          kind: 'printerPath',
          object: path.object,
          attributes: path.attributes,
          display: displayPath(path.object, path.attributes),
        },
        { start: located.start, end: located.start + path.length },
      )
    }
    case 'templateDelimiter': {
      const block = delimiterSpan(tokens, located)
      return block
        ? context({ kind: 'delimiter', ...block }, block)
        : context({ kind: 'plain' }, null)
    }
    case 'parameter':
    case 'number':
    case 'string':
    case 'plain':
    case 'boolean': {
      if (keyIndex >= 0 && located.index > keyIndex && !templateBody) {
        return optionContext()
      }
      if (templateBody || tokens.some((candidate) => candidate.kind === 'command')) {
        const word = identifierPathAt(text, column)
        const resolved = word ? templateWordContext(word) : null
        if (resolved) return resolved
        const command = [...tokens.slice(0, located.index)]
          .reverse()
          .find((candidate) => candidate.kind === 'command' || candidate.kind === 'gcode')
        if (command) return context({ kind: 'command', name: command.text }, null)
      }
      if (!templateBody && state.block === 'value' && isContinuationLine(text, true)) {
        return continuedOptionContext()
      }
      return context({ kind: 'plain' }, null)
    }
    case 'key':
    case 'value':
    case 'pin':
      return keyIndex >= 0 ? optionContext() : continuedOptionContext()
  }
  return context({ kind: 'plain' }, null)

  function templateWordContext(word: { path: string; start: number }): EditorContext | null {
    const [head = '', ...rest] = word.path.split('.')
    const wordSpan = { start: word.start, end: word.start + word.path.length }
    if (head === 'printer') {
      const path = readPrinterPath(text.slice(word.start))
      if (!path) return null
      return context(
        {
          kind: 'printerPath',
          object: path.object,
          attributes: path.attributes,
          display: displayPath(path.object, path.attributes),
        },
        { start: word.start, end: word.start + path.length },
      )
    }
    if (head === 'params' || head === 'rawparams') {
      return context({ kind: 'templateGlobal', name: head }, wordSpan)
    }
    if (rest.length === 0 && /^\s*\(/.test(text.slice(wordSpan.end))) {
      const global = jinjaName('global', head)
      if (global) return context({ kind: 'jinja', name: global }, wordSpan)
    }
    const alias = templateBody ? aliasedPrinterPath(lines, templateBody, head) : null
    if (!alias) return null
    const attributes = [...alias.attributes, ...rest]
    return context(
      {
        kind: 'printerPath',
        object: alias.object,
        attributes,
        display: displayPath(alias.object, attributes),
      },
      wordSpan,
    )
  }

  function optionContext(): EditorContext {
    const keyToken = tokens[keyIndex]
    const option = optionName(keyToken?.text ?? '')
    const value = valueAfterKey(tokens, keyIndex)
    const keyStart = tokenStart(tokens, keyIndex)
    const valueStart = keyStart + (keyToken?.text.length ?? 0)
    const template = templateBody !== null
    const multiline = valueLines(lines, line).to > line
    if (located && located.index > keyIndex && !template && isPinOption(option)) {
      const item = listItemAt(text.slice(valueStart), column - valueStart)
      const pin = item ? PIN.exec(item.text) : null
      if (item && pin?.[3]) {
        return context(
          { kind: 'pin', option, pin: item.text, chip: pin[2] ?? null, name: pin[3] },
          { start: valueStart + item.start, end: valueStart + item.start + item.text.length },
        )
      }
    }
    return context(
      { kind: 'option', option, value, commented: false, template, multiline },
      { start: keyStart, end: keyStart + option.length },
    )
  }

  function continuedOptionContext(): EditorContext {
    const owner = keyLineAbove(lines, line)
    if (owner === null) return context({ kind: 'plain' }, null)
    const ownerText = lines[owner] ?? ''
    const match = /^([A-Za-z_][\w.-]*)\s*[:=]\s*(.*)$/.exec(ownerText)
    if (!match?.[1]) return context({ kind: 'plain' }, null)
    return context(
      {
        kind: 'option',
        option: match[1],
        value: '',
        commented: false,
        template: false,
        multiline: true,
      },
      null,
    )
  }
}
