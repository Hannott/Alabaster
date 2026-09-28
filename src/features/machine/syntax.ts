import { COMMENT_LINE, isContinuationLine, opensValue } from '@/features/machine/configLines'

export type MachineSyntaxKind =
  | 'plain'
  | 'comment'
  | 'autogen'
  | 'section'
  | 'key'
  | 'parameter'
  | 'value'
  | 'boolean'
  | 'pin'
  | 'number'
  | 'string'
  | 'command'
  | 'gcode'
  | 'templateDelimiter'
  | 'templateKeyword'
  | 'templateGlobal'
  | 'templateFilter'
  | 'includePath'

export interface MachineSyntaxToken {
  kind: MachineSyntaxKind
  text: string
}

type TemplateOpening = '{%' | '{{' | '{' | '{#'

/**
 * What one line leaves behind for the next. A macro body is a continuation of
 * its `gcode:` key, so no line inside it can be coloured on its own: an
 * indented `status: ready` there is G-code, not a key, and the second line of a
 * `{% set … %}` that wraps is still inside the statement.
 */
export interface MachineSyntaxState {
  /** The section type the line sits under — `gcode_macro` for `[gcode_macro PARK]`. */
  section: string
  /** What an indented line continues: nothing, a plain value, or a template. */
  block: 'none' | 'value' | 'template'
  /** A Jinja delimiter an earlier line opened and has not closed yet. */
  opening: TemplateOpening | null
  /** Braces opened inside that expression — a dict literal — which its own `}` must not end. */
  depth: number
}

export function initialSyntaxState(): MachineSyntaxState {
  return { section: '', block: 'none', opening: null, depth: 0 }
}

function appendToken(tokens: MachineSyntaxToken[], kind: MachineSyntaxKind, text: string): void {
  if (!text) return
  const previous = tokens.at(-1)
  if (previous?.kind === kind) previous.text += text
  else tokens.push({ kind, text })
}

function compact(tokens: MachineSyntaxToken[]): MachineSyntaxToken[] {
  return tokens.filter((token) => token.text.length > 0)
}

const PIN_PATTERN = /^[!^~]+[A-Za-z0-9_]+$/
const BOOLEAN_PATTERN = /^(?:True|False|true|false)$/
const AUTOGEN_LINE = /^(\s*)(#\*#.*)$/
const EMPTY_KEY_LINE = /^[A-Za-z_][\w.-]*:$/
const INCLUDE_LINE = /^([ \t]*)(\[[ \t]*include[ \t]+)([^\]\r\n]+?)([ \t]*\][ \t]*)$/i
const SECTION_HEADER = /^(\s*)(\[[^\]\r\n]+])(.*)$/
const PROPERTY_LINE = /^(\s*)([A-Za-z_][\w.-]*)(\s*[:=])(.*)$/
/*
 * Python's configparser, which Klipper reads its config with, only takes `#`
 * or `;` as an inline comment when whitespace precedes it — so a quoted colour
 * code in a value is a value, and ` # note` after one is not.
 */
const INLINE_COMMENT = /\s[#;]/

/*
 * Every `gcode` and `*_gcode` option is rendered through Jinja wherever it
 * appears — macros, delayed_gcode, homing_override, idle_timeout, gcode_button,
 * the filament sensors — and the rest are named per section. `variable_*` is
 * deliberately absent: those are Python literals read with `ast.literal_eval`,
 * and colouring one as a template would suggest a `{ }` inside it is
 * substituted when it is not.
 */
const TEMPLATE_KEYS_BY_SECTION: Readonly<Record<string, ReadonlySet<string>>> = {
  display_template: new Set(['text']),
  display_data: new Set(['text']),
  menu: new Set(['name', 'enable', 'input']),
}

function holdsTemplate(section: string, key: string): boolean {
  const name = key.toLowerCase()
  return (
    name === 'gcode' ||
    name.endsWith('_gcode') ||
    (TEMPLATE_KEYS_BY_SECTION[section]?.has(name) ?? false)
  )
}

function sectionType(header: string): string {
  return (header.slice(1, -1).trim().split(/\s+/)[0] ?? '').toLowerCase()
}

const JINJA_KEYWORDS = new Set([
  'if',
  'elif',
  'else',
  'endif',
  'for',
  'endfor',
  'in',
  'set',
  'endset',
  'macro',
  'endmacro',
  'call',
  'endcall',
  'filter',
  'endfilter',
  'raw',
  'endraw',
  'with',
  'endwith',
  'break',
  'continue',
  'recursive',
  'not',
  'and',
  'or',
  'is',
])
const JINJA_LITERAL = /^(?:true|false|none)$/i
/* What Klipper puts in every template's context, beside the macro's own variables. */
const KLIPPER_GLOBALS = new Set([
  'printer',
  'params',
  'rawparams',
  'action_respond_info',
  'action_raise_error',
  'action_emergency_stop',
  'action_call_remote_method',
])

const TEMPLATE_OPENING = /^(?:\{%-?|\{\{-?|\{#|\{)/
const IDENTIFIER = /^[A-Za-z_]\w*/
const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/
const SIGNED_NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)/
const COMMAND_WORD = /^[A-Za-z_]\w*(?:\.\d+)?/
const CLASSIC_CODE = /^[GMTgmt]\d+(?:\.\d+)?$/
const NAMED_PARAMETER = /^[A-Za-z_]\w*=/
const AXIS_PARAMETER = /^[A-Za-z](?=[-+.\d{])/

/** What a single line's scan knows that the next line does not inherit. */
interface LineScan {
  /** The next bare word is the command: at line start, and after every `{% … %}`. */
  expectCommand: boolean
  /** The command is a numbered G/M/T code, whose arguments are single letters. */
  classic: boolean
  /** Inside a G-code `"…"` argument, which a `{…}` substitution may still interrupt. */
  inString: boolean
  afterPipe: boolean
  afterIs: boolean
  afterDot: boolean
}

function scanGcode(
  text: string,
  at: number,
  state: MachineSyntaxState,
  scan: LineScan,
  tokens: MachineSyntaxToken[],
): number {
  const rest = text.slice(at)
  const opening = TEMPLATE_OPENING.exec(rest)?.[0]
  if (opening) {
    if (opening === '{#') {
      state.opening = '{#'
      appendToken(tokens, 'comment', opening)
    } else {
      state.opening = opening.startsWith('{%') ? '{%' : opening.startsWith('{{') ? '{{' : '{'
      state.depth = 0
      appendToken(tokens, 'templateDelimiter', opening)
    }
    return at + opening.length
  }

  // Klipper renders the template before the command sees its arguments, so a
  // substitution inside a quoted message is still a substitution.
  if (scan.inString) {
    const run = /^[^"{]+/.exec(rest)?.[0]
    if (run) {
      appendToken(tokens, 'string', run)
      return at + run.length
    }
    scan.inString = false
    appendToken(tokens, 'string', '"')
    return at + 1
  }

  const character = rest[0] ?? ''
  if (character === '#' || character === ';') {
    appendToken(tokens, 'comment', rest)
    return text.length
  }
  const space = /^\s+/.exec(rest)?.[0]
  if (space) {
    appendToken(tokens, 'plain', space)
    return at + space.length
  }
  if (character === '"') {
    scan.inString = true
    appendToken(tokens, 'string', character)
    return at + 1
  }

  if (scan.expectCommand) {
    const command = COMMAND_WORD.exec(rest)?.[0]
    if (command) {
      scan.expectCommand = false
      scan.classic = CLASSIC_CODE.test(command)
      appendToken(tokens, scan.classic ? 'gcode' : 'command', command)
      return at + command.length
    }
  }

  const named = NAMED_PARAMETER.exec(rest)?.[0]
  if (named) {
    appendToken(tokens, 'parameter', named)
    return at + named.length
  }
  const previous = at > 0 ? (text[at - 1] ?? '') : ''
  if (scan.classic && (previous === '' || /[\s}]/.test(previous))) {
    const axis = AXIS_PARAMETER.exec(rest)?.[0]
    if (axis) {
      appendToken(tokens, 'parameter', axis)
      return at + axis.length
    }
  }
  if (tokens.at(-1)?.kind === 'parameter' || !/[\w.]/.test(previous)) {
    const number = SIGNED_NUMBER.exec(rest)?.[0]
    if (number) {
      appendToken(tokens, 'number', number)
      return at + number.length
    }
  }
  const word = IDENTIFIER.exec(rest)?.[0] ?? character
  appendToken(tokens, 'plain', word)
  return at + word.length
}

function closingOf(opening: TemplateOpening): RegExp {
  if (opening === '{%') return /^-?%\}/
  if (opening === '{{') return /^-?\}\}/
  return /^\}/
}

function scanExpression(
  text: string,
  at: number,
  state: MachineSyntaxState,
  scan: LineScan,
  tokens: MachineSyntaxToken[],
): number {
  const rest = text.slice(at)
  const space = /^\s+/.exec(rest)?.[0]
  if (space) {
    appendToken(tokens, 'plain', space)
    return at + space.length
  }

  const opening = state.opening ?? '{'
  if (state.depth === 0) {
    const closing = closingOf(opening).exec(rest)?.[0]
    if (closing) {
      appendToken(tokens, 'templateDelimiter', closing)
      if (opening === '{%') scan.expectCommand = true
      state.opening = null
      scan.afterPipe = scan.afterIs = scan.afterDot = false
      return at + closing.length
    }
  }

  const character = rest[0] ?? ''
  if (character === '"' || character === "'") {
    let end = 1
    while (end < rest.length && rest[end] !== character) end += rest[end] === '\\' ? 2 : 1
    const literal = rest.slice(0, end + 1)
    appendToken(tokens, 'string', literal)
    scan.afterPipe = scan.afterIs = scan.afterDot = false
    return at + literal.length
  }

  const previous = at > 0 ? (text[at - 1] ?? '') : ''
  if (!/\w/.test(previous)) {
    const number = NUMBER.exec(rest)?.[0]
    if (number) {
      appendToken(tokens, 'number', number)
      scan.afterPipe = scan.afterIs = scan.afterDot = false
      return at + number.length
    }
  }

  const word = IDENTIFIER.exec(rest)?.[0]
  if (word) {
    const kind: MachineSyntaxKind = scan.afterDot
      ? 'plain'
      : (scan.afterPipe || scan.afterIs) && word !== 'not'
        ? 'templateFilter'
        : JINJA_KEYWORDS.has(word)
          ? 'templateKeyword'
          : JINJA_LITERAL.test(word)
            ? 'boolean'
            : KLIPPER_GLOBALS.has(word)
              ? 'templateGlobal'
              : 'plain'
    appendToken(tokens, kind, word)
    // `x is defined` and `x is not none` name a Jinja test, which reads like a filter.
    scan.afterIs = word === 'is' || (scan.afterIs && word === 'not')
    scan.afterPipe = scan.afterDot = false
    return at + word.length
  }

  if (character === '{') state.depth += 1
  else if (character === '}' && state.depth > 0) state.depth -= 1
  scan.afterPipe = character === '|'
  scan.afterDot = character === '.'
  scan.afterIs = false
  appendToken(tokens, 'plain', character)
  return at + 1
}

function scanTemplateComment(
  text: string,
  at: number,
  state: MachineSyntaxState,
  tokens: MachineSyntaxToken[],
): number {
  const close = text.indexOf('#}', at)
  const end = close < 0 ? text.length : close + 2
  if (close >= 0) state.opening = null
  appendToken(tokens, 'comment', text.slice(at, end))
  return end
}

/** A line of a template value: G-code, with Jinja statements and substitutions through it. */
function tokenizeTemplate(text: string, state: MachineSyntaxState): MachineSyntaxToken[] {
  const tokens: MachineSyntaxToken[] = []
  const scan: LineScan = {
    expectCommand: true,
    classic: false,
    inString: false,
    afterPipe: false,
    afterIs: false,
    afterDot: false,
  }
  let cursor = 0
  while (cursor < text.length) {
    if (state.opening === '{#') cursor = scanTemplateComment(text, cursor, state, tokens)
    else if (state.opening) cursor = scanExpression(text, cursor, state, scan, tokens)
    else cursor = scanGcode(text, cursor, state, scan, tokens)
  }
  return tokens
}

// A bare value token that is only a pin modifier or boolean literal gets its
// own color so the safety-relevant bit (an inverted pin, a flipped flag) isn't
// lost in the noise.
function splitValueWord(text: string): MachineSyntaxToken[] {
  const word = /^(\s*)(\S+)(\s*)$/.exec(text)
  if (!word) return [{ kind: 'value', text }]
  const [, lead, core, trail] = word
  const kind = PIN_PATTERN.test(core ?? '')
    ? 'pin'
    : BOOLEAN_PATTERN.test(core ?? '')
      ? 'boolean'
      : null
  if (!kind) return [{ kind: 'value', text }]
  return compact([
    { kind: 'value', text: lead ?? '' },
    { kind, text: core ?? '' },
    { kind: 'value', text: trail ?? '' },
  ])
}

/** A line of a plain value: literal text up to an inline comment. */
function tokenizeValue(text: string): MachineSyntaxToken[] {
  const comment = INLINE_COMMENT.exec(text)
  const end = comment ? comment.index + 1 : text.length
  return compact([
    ...splitValueWord(text.slice(0, end)),
    { kind: 'comment', text: text.slice(end) },
  ])
}

/** Whatever follows a `[section]` header on its line. */
function tokenizeTrailing(text: string): MachineSyntaxToken[] {
  const comment = text.search(/[#;]/)
  if (comment < 0) return [{ kind: 'plain', text }]
  return [
    { kind: 'plain', text: text.slice(0, comment) },
    { kind: 'comment', text: text.slice(comment) },
  ]
}

/**
 * Colours one line. `state` is what the lines above it left behind, and it is
 * updated in place for the line after — the shape a streaming tokenizer takes,
 * so a caller colouring a run of lines passes one state object down the run.
 * Called without one, the line is read as if it began the file.
 */
export function tokenizeMachineLine(
  line: string,
  state: MachineSyntaxState = initialSyntaxState(),
): MachineSyntaxToken[] {
  const autogen = AUTOGEN_LINE.exec(line)
  if (autogen) {
    return compact([
      { kind: 'plain', text: autogen[1] ?? '' },
      { kind: 'autogen', text: autogen[2] ?? '' },
    ])
  }

  const trimmed = line.trim()
  if (trimmed === '') return compact([{ kind: 'plain', text: line }])
  const lead = line.slice(0, line.length - line.trimStart().length)

  if (isContinuationLine(line, state.block !== 'none')) {
    if (COMMENT_LINE.test(trimmed)) {
      return compact([
        { kind: 'plain', text: lead },
        { kind: 'comment', text: line.slice(lead.length) },
      ])
    }
    return state.block === 'template' ? tokenizeTemplate(line, state) : tokenizeValue(line)
  }

  // A comment line leaves the value above it open, as configparser does.
  if (COMMENT_LINE.test(trimmed)) {
    return compact([
      { kind: 'plain', text: lead },
      { kind: 'comment', text: line.slice(lead.length) },
    ])
  }
  state.opening = null
  state.depth = 0

  // Mirrors includes.ts's own INCLUDE_PATTERN (case-insensitive, no trailing
  // content after ']') so a line is only ever hotlink-eligible here if the
  // include bookkeeping elsewhere in the app would recognize it too.
  const include = INCLUDE_LINE.exec(line)
  if (include) {
    state.section = 'include'
    state.block = 'none'
    return compact([
      { kind: 'plain', text: include[1] ?? '' },
      { kind: 'section', text: include[2] ?? '' },
      { kind: 'includePath', text: include[3] ?? '' },
      { kind: 'section', text: include[4] ?? '' },
    ])
  }

  const section = SECTION_HEADER.exec(line)
  if (section) {
    state.section = sectionType(section[2] ?? '')
    state.block = 'none'
    return compact([
      { kind: 'plain', text: section[1] ?? '' },
      { kind: 'section', text: section[2] ?? '' },
      ...tokenizeTrailing(section[3] ?? ''),
    ])
  }

  const property = PROPERTY_LINE.exec(line)
  if (property) {
    const template = holdsTemplate(state.section, property[2] ?? '')
    state.block = template ? 'template' : 'value'
    const value = property[4] ?? ''
    return compact([
      { kind: 'plain', text: property[1] ?? '' },
      { kind: 'key', text: `${property[2] ?? ''}${property[3] ?? ''}` },
      ...(template ? tokenizeTemplate(value, state) : tokenizeValue(value)),
    ])
  }

  // Not a section or a recognisable key: read it as the G-code it most likely
  // is, the way a line pasted without its `gcode:` above it would run.
  state.block = opensValue(trimmed) ? 'value' : 'none'
  return tokenizeTemplate(line, state)
}

/**
 * What the lines above `line` leave behind for it, read from the section header
 * it sits under — the same walk `tokenizeMachineRange` colours a window from,
 * so anything that asks what a line is gets the answer the colouring shows.
 */
export function syntaxStateBefore(lines: readonly string[], line: number): MachineSyntaxState {
  let anchor = line
  while (anchor > 0 && !(lines[anchor] ?? '').startsWith('[')) anchor -= 1
  const state = initialSyntaxState()
  for (let index = anchor; index < line; index += 1) {
    tokenizeMachineLine(lines[index] ?? '', state)
  }
  return state
}

export function tokenizeMachineConfig(content: string): MachineSyntaxToken[][] {
  const state = initialSyntaxState()
  return content.split('\n').map((line) => tokenizeMachineLine(line, state))
}

/**
 * The tokens of `lines[start..end)`, coloured as though every line above had
 * been read. Only the section a window opens inside can reach into it — a
 * column-zero `[` ends every value and every open delimiter before it — so the
 * lines read and discarded are the ones between that header and `start`,
 * never the file above it. That keeps the editor's cost bounded by the window
 * plus one section, however far down a large file the reader is.
 */
export function tokenizeMachineRange(
  lines: readonly string[],
  start: number,
  end: number,
): MachineSyntaxToken[][] {
  const state = syntaxStateBefore(lines, start)
  const rows: MachineSyntaxToken[][] = []
  for (let index = start; index < end; index += 1) {
    rows.push(tokenizeMachineLine(lines[index] ?? '', state))
  }
  return rows
}

export interface MachineSyntaxMatchSegment extends MachineSyntaxToken {
  matched: boolean
}

/**
 * Splits every token whose text contains `query` (case-insensitively) into
 * matched and unmatched segments, each keeping its token's own `kind` — a
 * search highlight marks a substring, never a whole token, so `description:`
 * still colors as a key even when only `desc` inside it matched. This is the
 * same technique `splitValueWord` already uses to carve a token further; a
 * search match is one more reason a token's boundaries
 * don't have to land on a whole word.
 *
 * `query` empty is the common case — nothing is being searched for most of
 * the time an editor is open — so it short-circuits to one allocation-free
 * pass rather than running an empty-needle search against every token.
 */
export function splitTokensForSearch(
  tokens: MachineSyntaxToken[],
  query: string,
): MachineSyntaxMatchSegment[] {
  if (!query) return tokens.map((token) => ({ ...token, matched: false }))
  const needle = query.toLocaleLowerCase()
  const segments: MachineSyntaxMatchSegment[] = []
  for (const token of tokens) {
    const haystack = token.text.toLocaleLowerCase()
    let cursor = 0
    let at = haystack.indexOf(needle, cursor)
    if (at === -1) {
      segments.push({ kind: token.kind, text: token.text, matched: false })
      continue
    }
    while (at !== -1) {
      if (at > cursor) {
        segments.push({ kind: token.kind, text: token.text.slice(cursor, at), matched: false })
      }
      segments.push({
        kind: token.kind,
        text: token.text.slice(at, at + needle.length),
        matched: true,
      })
      cursor = at + needle.length
      at = haystack.indexOf(needle, cursor)
    }
    if (cursor < token.text.length) {
      segments.push({ kind: token.kind, text: token.text.slice(cursor), matched: false })
    }
  }
  return segments
}

export function isEmptyPropertyLine(line: string): boolean {
  return EMPTY_KEY_LINE.test(line.trim())
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLocaleLowerCase()
}

/*
 * The one format this tokenizer describes. `.bkp` is here because a backup of a
 * config file is still a config file, and reading one against the same colors as
 * the original is the whole reason to open it.
 */
const CONFIG_EXTENSIONS = new Set(['cfg', 'conf', 'cnf', 'ini', 'toml', 'bkp'])

/**
 * Whether `name` is a file this tokenizer actually understands.
 *
 * Everything else the workspace opens — a log, a `.txt`, a `.service`, a Python
 * file, a sliced `.gcode`, a file with no extension at all — is shown as plain
 * text. Two reasons, and the second is why this is a predicate rather than a
 * wider set of tokenizers:
 *
 * - Klipper's config grammar applied to something that isn't one invents
 *   structure. A log line beginning with a capitalized word is not a G-code
 *   command, and `key: value` inside a stack trace is not a config property, but
 *   both get colored as though the file had been understood.
 * - Highlighting is the expensive half of the editor, and the files that aren't
 *   config are exactly the large ones. A 2 MB log or sliced G-code file costs
 *   hundreds of thousands of elements to color and reads no better for it.
 */
export function isConfigSyntaxFile(name: string): boolean {
  return CONFIG_EXTENSIONS.has(extensionOf(name))
}
