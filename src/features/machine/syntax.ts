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
  | 'template'
  | 'command'
  | 'includePath'

export interface MachineSyntaxToken {
  kind: MachineSyntaxKind
  text: string
}

function appendToken(tokens: MachineSyntaxToken[], kind: MachineSyntaxKind, text: string): void {
  if (!text) return
  const previous = tokens.at(-1)
  if (previous?.kind === kind) previous.text += text
  else tokens.push({ kind, text })
}

const PIN_PATTERN = /^[!^~]+[A-Za-z0-9_]+$/
const BOOLEAN_PATTERN = /^(?:True|False|true|false)$/
const PARAMETER_PATTERN = /[A-Z_][A-Z0-9_]*=/g
const AUTOGEN_LINE = /^(\s*)(#\*#.*)$/
const EMPTY_KEY_LINE = /^[A-Za-z_][\w.-]*:$/
const INCLUDE_LINE = /^([ \t]*)(\[[ \t]*include[ \t]+)([^\]\r\n]+?)([ \t]*\][ \t]*)$/i

// Klipper's gcode_macro templates use a single { } for value substitution —
// {{ }} is the rarely-seen standard-Jinja form. A bare value token that is
// only a pin modifier or boolean literal gets its own color so the safety-
// relevant bit (an inverted pin, a flipped flag) isn't lost in the noise.
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
  const tokens: MachineSyntaxToken[] = []
  if (lead) tokens.push({ kind: 'value', text: lead })
  tokens.push({ kind, text: core ?? '' })
  if (trail) tokens.push({ kind: 'value', text: trail })
  return tokens
}

function splitParameters(text: string): MachineSyntaxToken[] {
  PARAMETER_PATTERN.lastIndex = 0
  const tokens: MachineSyntaxToken[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = PARAMETER_PATTERN.exec(text))) {
    if (match.index > cursor) tokens.push({ kind: 'plain', text: text.slice(cursor, match.index) })
    tokens.push({ kind: 'parameter', text: match[0] })
    cursor = PARAMETER_PATTERN.lastIndex
  }
  if (cursor < text.length) tokens.push({ kind: 'plain', text: text.slice(cursor) })
  return tokens.length > 0 ? tokens : [{ kind: 'plain', text }]
}

function refineTokens(tokens: MachineSyntaxToken[]): MachineSyntaxToken[] {
  return tokens.flatMap((token) => {
    if (token.kind === 'value') return splitValueWord(token.text)
    if (token.kind === 'plain') return splitParameters(token.text)
    return [token]
  })
}

function tokenizeRemainder(text: string, fallback: MachineSyntaxKind): MachineSyntaxToken[] {
  const tokens: MachineSyntaxToken[] = []
  let cursor = 0

  while (cursor < text.length) {
    const remaining = text.slice(cursor)
    const marker = /(\{[{%#]?|["']|[#;])/.exec(remaining)
    if (!marker || marker.index === undefined) {
      appendToken(tokens, fallback, remaining)
      break
    }

    appendToken(tokens, fallback, remaining.slice(0, marker.index))
    cursor += marker.index
    const opening = text.slice(cursor, cursor + 2)

    if (opening === '{{' || opening === '{%' || opening === '{#') {
      const closing = opening === '{{' ? '}}' : opening === '{%' ? '%}' : '#}'
      const end = text.indexOf(closing, cursor + 2)
      const tokenEnd = end < 0 ? text.length : end + 2
      appendToken(tokens, opening === '{#' ? 'comment' : 'template', text.slice(cursor, tokenEnd))
      cursor = tokenEnd
      continue
    }

    const character = text[cursor]

    if (character === '{') {
      const end = text.indexOf('}', cursor + 1)
      const tokenEnd = end < 0 ? text.length : end + 1
      appendToken(tokens, 'template', text.slice(cursor, tokenEnd))
      cursor = tokenEnd
      continue
    }

    if (character === '#' || character === ';') {
      appendToken(tokens, 'comment', text.slice(cursor))
      break
    }

    if (character === '"' || character === "'") {
      let end = cursor + 1
      while (end < text.length) {
        if (text[end] === character && text[end - 1] !== '\\') {
          end += 1
          break
        }
        end += 1
      }
      appendToken(tokens, 'value', text.slice(cursor, end))
      cursor = end
      continue
    }

    appendToken(tokens, fallback, character ?? '')
    cursor += 1
  }

  return tokens
}

export function tokenizeMachineLine(line: string): MachineSyntaxToken[] {
  const autogen = AUTOGEN_LINE.exec(line)
  if (autogen) {
    return [
      { kind: 'plain', text: autogen[1] ?? '' },
      { kind: 'autogen', text: autogen[2] ?? '' },
    ].filter((token) => token.text.length > 0) as MachineSyntaxToken[]
  }

  // Mirrors includes.ts's own INCLUDE_PATTERN (case-insensitive, no trailing
  // content after ']') so a line is only ever hotlink-eligible here if the
  // include bookkeeping elsewhere in the app would recognize it too.
  const include = INCLUDE_LINE.exec(line)
  if (include) {
    return [
      { kind: 'plain', text: include[1] ?? '' },
      { kind: 'section', text: include[2] ?? '' },
      { kind: 'includePath', text: include[3] ?? '' },
      { kind: 'section', text: include[4] ?? '' },
    ].filter((token) => token.text.length > 0) as MachineSyntaxToken[]
  }

  const section = /^(\s*)(\[[^\]\r\n]+])/.exec(line)
  if (section) {
    return refineTokens(
      [
        { kind: 'plain', text: section[1] ?? '' },
        { kind: 'section', text: section[2] ?? '' },
        ...tokenizeRemainder(line.slice(section[0].length), 'plain'),
      ].filter((token) => token.text.length > 0) as MachineSyntaxToken[],
    )
  }

  const property = /^(\s*)([A-Za-z_][\w.-]*)(\s*:)(.*)$/.exec(line)
  if (property) {
    return refineTokens(
      [
        { kind: 'plain', text: property[1] ?? '' },
        { kind: 'key', text: `${property[2] ?? ''}${property[3] ?? ''}` },
        ...tokenizeRemainder(property[4] ?? '', 'value'),
      ].filter((token) => token.text.length > 0) as MachineSyntaxToken[],
    )
  }

  const command = /^(\s*)([A-Z_][A-Z0-9_]*(?=\s|$))(.*)$/.exec(line)
  if (command) {
    return refineTokens(
      [
        { kind: 'plain', text: command[1] ?? '' },
        { kind: 'command', text: command[2] ?? '' },
        ...tokenizeRemainder(command[3] ?? '', 'plain'),
      ].filter((token) => token.text.length > 0) as MachineSyntaxToken[],
    )
  }

  return refineTokens(tokenizeRemainder(line, 'plain'))
}

export function tokenizeMachineConfig(content: string): MachineSyntaxToken[][] {
  return content.split('\n').map(tokenizeMachineLine)
}

export interface MachineSyntaxMatchSegment extends MachineSyntaxToken {
  matched: boolean
}

/**
 * Splits every token whose text contains `query` (case-insensitively) into
 * matched and unmatched segments, each keeping its token's own `kind` — a
 * search highlight marks a substring, never a whole token, so `description:`
 * still colors as a key even when only `desc` inside it matched. This is the
 * same technique `splitValueWord` and `splitParameters` already use to carve
 * a token further; a search match is one more reason a token's boundaries
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
