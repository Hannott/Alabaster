/*
 * The configuration editor's line-scoped commands, as arithmetic on the whole
 * document — pure, so each one can be tested without a textarea.
 *
 * Every command returns one `LineEdit`: a single contiguous range and what
 * replaces it. That shape is the point rather than a convenience. The editor
 * mutates its textarea through `document.execCommand('insertText')` so the
 * browser records the change on its own undo stack, and several separate
 * replacements become several separate undo steps — undoing one "move this
 * section down" would turn into a Ctrl+Z marathon ending in a half-moved file.
 * See docs/design/configuration-editor.md.
 */

import { indentUnit, visualColumn, type IndentWidth } from '@/features/machine/indent'

export interface LineEdit {
  /** Character range in the document being replaced. */
  from: number
  to: number
  /** What replaces it. */
  text: string
  /** Where the selection lands once it has been applied. */
  selectionStart: number
  selectionEnd: number
}

/** Klipper's config format takes `#` comments; `;` is a G-code convention. */
const commentMarker = '#'

/**
 * The whole lines a selection touches.
 *
 * A selection that ends exactly on a line start — what dragging down through a
 * newline produces — does not include that line. Treating it as included makes
 * every downward drag operate on one line more than the user highlighted.
 */
function lineBounds(content: string, start: number, end: number): { from: number; to: number } {
  const searchEnd = end > start && content[end - 1] === '\n' ? end - 1 : end
  const from = content.lastIndexOf('\n', start - 1) + 1
  const newline = content.indexOf('\n', searchEnd)
  return { from, to: newline === -1 ? content.length : newline }
}

/** Whether a line holds anything a command should act on. */
function isBlank(line: string): boolean {
  return line.trim() === ''
}

/**
 * How much leading whitespace one outdent takes off a line: a single tab, or up
 * to one level of spaces. A tab is removed whole rather than converted, because
 * an outdent is not permission to reformat lines the user did not ask about.
 */
function outdentAmount(line: string, width: IndentWidth): number {
  if (line.startsWith('\t')) return 1
  let spaces = 0
  while (spaces < width && line[spaces] === ' ') spaces += 1
  return spaces
}

/**
 * Adds one level to every line the selection touches, and leaves the whole
 * block selected so the command can be repeated.
 *
 * Blank lines are skipped: indenting them would leave trailing whitespace on a
 * line the user cannot see it on, and Klipper's parser reads a whitespace-only
 * line inside a `gcode:` block as part of the block.
 */
export function indentSelection(
  content: string,
  start: number,
  end: number,
  width: IndentWidth,
): LineEdit {
  const { from, to } = lineBounds(content, start, end)
  const unit = indentUnit(width)
  const text = content
    .slice(from, to)
    .split('\n')
    .map((line) => (isBlank(line) ? line : `${unit}${line}`))
    .join('\n')
  return { from, to, text, selectionStart: from, selectionEnd: from + text.length }
}

/**
 * Removes one level from every line the selection touches, or from the caret's
 * own line when nothing is selected.
 *
 * Returns `null` when there is nothing to remove, which is what lets Shift+Tab
 * keep working as "move focus backwards" on a line that is already flush. Tab
 * inside a textarea already costs a keyboard-only reader their way forward; the
 * way back out must not go too.
 */
export function outdentSelection(
  content: string,
  start: number,
  end: number,
  width: IndentWidth,
): LineEdit | null {
  const { from, to } = lineBounds(content, start, end)
  const lines = content.slice(from, to).split('\n')
  const removals = lines.map((line) => outdentAmount(line, width))
  if (removals.every((amount) => amount === 0)) return null

  const text = lines.map((line, index) => line.slice(removals[index])).join('\n')

  /*
   * An offset moves left by everything removed on the lines above it plus
   * whatever came off its own line before it — and never past its own line's
   * start, or a caret sitting inside the indentation would jump onto the line
   * above.
   */
  const mapOffset = (offset: number): number => {
    let originalStart = from
    let newStart = from
    for (const [index, line] of lines.entries()) {
      const removed = removals[index] ?? 0
      if (offset <= originalStart + line.length) {
        const column = Math.max(0, offset - originalStart - removed)
        return newStart + Math.min(column, line.length - removed)
      }
      originalStart += line.length + 1
      newStart += line.length - removed + 1
    }
    return newStart
  }

  return { from, to, text, selectionStart: mapOffset(start), selectionEnd: mapOffset(end) }
}

/**
 * Comments every line the selection touches, or uncomments them when all of
 * them already are.
 *
 * The marker goes at the shallowest indentation in the block rather than at
 * column zero, so a commented-out `gcode:` body keeps the shape that shows
 * which lines belonged to it.
 */
export function toggleComment(content: string, start: number, end: number): LineEdit | null {
  const { from, to } = lineBounds(content, start, end)
  const lines = content.slice(from, to).split('\n')
  const written = lines.filter((line) => !isBlank(line))
  if (written.length === 0) return null

  const allCommented = written.every((line) => line.trimStart().startsWith(commentMarker))
  const text = allCommented
    ? lines.map(uncommentLine).join('\n')
    : commentBlock(lines, Math.min(...written.map(leadingWhitespaceLength)))

  return { from, to, text, selectionStart: from, selectionEnd: from + text.length }
}

function leadingWhitespaceLength(line: string): number {
  return (/^[ \t]*/.exec(line)?.[0] ?? '').length
}

/** Removes the marker and the one space that `commentBlock` adds after it. */
function uncommentLine(line: string): string {
  const match = /^([ \t]*)#[ ]?(.*)$/.exec(line)
  return match ? `${match[1]}${match[2]}` : line
}

function commentBlock(lines: readonly string[], column: number): string {
  return lines
    .map((line) =>
      isBlank(line)
        ? line
        : `${line.slice(0, column)}${commentMarker} ${line.slice(column)}`.trimEnd(),
    )
    .join('\n')
}

/**
 * Swaps the lines the selection touches with the line above or below, carrying
 * the selection along so the command can be held down.
 *
 * Returns `null` at either end of the file rather than doing nothing visible,
 * so the caller can leave the key to whatever else wants it.
 */
export function moveSelectedLines(
  content: string,
  start: number,
  end: number,
  direction: -1 | 1,
): LineEdit | null {
  const { from, to } = lineBounds(content, start, end)
  const block = content.slice(from, to)

  if (direction === -1) {
    if (from === 0) return null
    const previousFrom = content.lastIndexOf('\n', from - 2) + 1
    const previous = content.slice(previousFrom, from - 1)
    const shift = from - previousFrom
    return {
      from: previousFrom,
      to,
      text: `${block}\n${previous}`,
      selectionStart: start - shift,
      selectionEnd: end - shift,
    }
  }

  if (to === content.length) return null
  const newline = content.indexOf('\n', to + 1)
  const nextTo = newline === -1 ? content.length : newline
  const next = content.slice(to + 1, nextTo)
  const shift = next.length + 1
  return {
    from,
    to: nextTo,
    text: `${next}\n${block}`,
    selectionStart: start + shift,
    selectionEnd: end + shift,
  }
}

/*
 * --- Whole-file reindent ---
 *
 * A Klipper config is INI: a `[section]` and the `key: value` lines under it all
 * sit flush, and only a value that runs onto further lines is indented — a
 * `gcode:` body being the case that matters. So "fix the indentation" means
 * three things and deliberately not a fourth:
 *
 * 1. Everything that owns a column-zero position gets it: sections, keys, and
 *    the comments between them.
 * 2. Every continuation block starts at exactly one indent level, in spaces.
 * 3. Trailing whitespace goes, and a whitespace-only line becomes empty.
 * 4. **Relative indentation inside a continuation block is preserved exactly.**
 *    A macro whose Jinja `{% if %}` bodies step inward was written that way on
 *    purpose, and a formatter that flattened it to one level would be destroying
 *    the structure it was asked to tidy. The block's own minimum column becomes
 *    one level, and every line keeps its offset from that minimum — which
 *    converts tabs to spaces without reinterpreting anyone's shape.
 *
 * This is the one command allowed to rewrite lines the reader never touched,
 * because it is invoked by name on a stated scope — never on save, never as a
 * side effect of typing. See docs/design/configuration-editor.md.
 */

const COMMENT_LINE = /^[#;]/
const KEY_LINE = /^[^\s#;[][^:=]*[:=]/
/*
 * Deliberately stricter than "starts with a bracket": a continuation line may
 * begin with one — a bracketed value, a Jinja expression — and promoting that to
 * column zero would tear a line out of the macro it belongs to. A Klipper
 * section is a bracketed identifier alone on its line, optionally with a
 * trailing comment, so that is what this asks for.
 */
const SECTION_LINE = /^\[[A-Za-z_][\w. -]*\]\s*(?:[#;].*)?$/

type LineKind = 'blank' | 'top' | 'continuation'

/**
 * What each line is, in one pass, so the second pass can treat a continuation
 * block as the unit it actually is.
 *
 * Only two states matter: inside a value that runs onto further lines, or not.
 * Outside one, nothing in this format is indented — so an indented `[section]`
 * or `key: value` is a misindented top-level line and gets its column back,
 * which is most of what the command is asked to fix. Inside one, an indented
 * line is part of the value and is never reinterpreted, because `M117 done: yes`
 * in a macro body looks exactly like a key and is not one.
 *
 * A blank line does not end a block: Python's `configparser` keeps blank lines
 * inside a value, so the empty line in the middle of a `gcode:` body is part of
 * the macro rather than the end of it. Nor does a comment change who owns the
 * lines after it — a note written above one line of a macro body must not detach
 * the rest of the body from its key.
 */
function classifyLines(lines: readonly string[]): LineKind[] {
  let insideValue = false
  return lines.map((line) => {
    const trimmed = line.trim()
    if (trimmed === '') return 'blank'
    const indented = line[0] === ' ' || line[0] === '\t'
    if (indented && insideValue && !SECTION_LINE.test(trimmed)) return 'continuation'
    if (!COMMENT_LINE.test(trimmed)) {
      insideValue = !SECTION_LINE.test(trimmed) && KEY_LINE.test(trimmed)
    }
    return 'top'
  })
}

/** The end of the continuation block starting at `start`, blanks included. */
function blockEnd(kinds: readonly LineKind[], start: number): number {
  let end = start
  let last = start
  while (end < kinds.length && (kinds[end] === 'continuation' || kinds[end] === 'blank')) {
    if (kinds[end] === 'continuation') last = end
    end += 1
  }
  // Trailing blanks belong to whatever comes next, not to this block.
  return last + 1
}

export function reindentDocument(
  content: string,
  caret: number,
  width: IndentWidth,
): LineEdit | null {
  const lines = content.split('\n')
  const kinds = classifyLines(lines)
  const unit = indentUnit(width)
  const formatted: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const kind = kinds[index]

    if (kind === 'blank') {
      formatted.push('')
      continue
    }
    if (kind === 'top') {
      formatted.push(line.trim())
      continue
    }

    const end = blockEnd(kinds, index)
    const block = lines.slice(index, end)
    const columns = block
      .filter((entry) => entry.trim() !== '')
      .map((entry) => visualColumn(/^[ \t]*/.exec(entry)?.[0] ?? '', width))
    const base = Math.min(...columns)
    for (const entry of block) {
      if (entry.trim() === '') {
        formatted.push('')
        continue
      }
      const own = visualColumn(/^[ \t]*/.exec(entry)?.[0] ?? '', width)
      formatted.push(`${unit}${' '.repeat(own - base)}${entry.trim()}`)
    }
    index = end - 1
  }

  const text = formatted.join('\n')
  if (text === content) return null

  /*
   * The caret stays on its own line, the same distance into the text as it was —
   * not at the top of the file, and not selecting everything. A reader who
   * formats mid-edit should be able to keep typing where they were.
   */
  const caretLine = content.slice(0, caret).split('\n').length - 1
  const lineStart = content.slice(0, caret).lastIndexOf('\n') + 1
  const oldIndent = (/^[ \t]*/.exec(lines[caretLine] ?? '')?.[0] ?? '').length
  const newLine = formatted[caretLine] ?? ''
  const newIndent = (/^[ \t]*/.exec(newLine)?.[0] ?? '').length
  const intoText = Math.max(0, caret - lineStart - oldIndent)
  const newLineStart = formatted
    .slice(0, caretLine)
    .reduce((sum, entry) => sum + entry.length + 1, 0)
  const mapped = newLineStart + Math.min(newIndent + intoText, newLine.length)

  return {
    from: 0,
    to: content.length,
    text,
    selectionStart: mapped,
    selectionEnd: mapped,
  }
}

/**
 * Copies the lines the selection touches, and leaves the selection on the copy
 * in the direction asked for — so the shortcut reads as "give me another one of
 * these to edit" whichever way it is pressed. Both directions insert the same
 * text; only which of the two copies the caret lands in differs.
 */
export function duplicateSelectedLines(
  content: string,
  start: number,
  end: number,
  direction: -1 | 1,
): LineEdit {
  const { from, to } = lineBounds(content, start, end)
  const block = content.slice(from, to)
  const shift = direction === 1 ? block.length + 1 : 0
  return {
    from,
    to,
    text: `${block}\n${block}`,
    selectionStart: start + shift,
    selectionEnd: end + shift,
  }
}
