/*
 * What the configuration editor's keyboard inserts, as arithmetic on strings —
 * pure, so it can be tested without a textarea, a layout, or `execCommand`.
 *
 * The editor writes spaces rather than tabs. A tab's width belongs to whoever
 * is reading the file: the same `gcode:` block paints two columns deep in the
 * editor, eight in `less` over SSH and four in most editors, so a file this
 * editor indented reads with a different structure everywhere it is opened. It
 * also breaks the monospace column grid the `[include]` hit test measures in
 * characters, because a tab is one character wide and several columns wide at
 * the same time. See docs/design/configuration-editor.md.
 */

/**
 * The widths offered. Two is Klipper's own documentation and the default; four
 * and eight are the other two conventions a reader arrives with. This is
 * deliberately not an open number field — every value in between produces a
 * file that lines up with nothing else, and the point of the setting is
 * matching whatever else edits these files.
 */
export const indentWidths = [2, 4, 8] as const

export type IndentWidth = (typeof indentWidths)[number]

export const defaultIndentWidth: IndentWidth = 2

export function isIndentWidth(value: unknown): value is IndentWidth {
  return typeof value === 'number' && (indentWidths as readonly number[]).includes(value)
}

/** One level of indentation, which is what a continuation line is offset by. */
export function indentUnit(width: IndentWidth): string {
  return ' '.repeat(width)
}

/**
 * How many columns `text` occupies on the editor's grid.
 *
 * Columns rather than characters, because a file the editor did not write may
 * already contain literal tabs, and a tab advances to the next stop rather
 * than counting as one. Getting this wrong means Tab lands off the grid in
 * exactly the files where alignment is hardest to fix by hand.
 */
export function visualColumn(text: string, width: IndentWidth): number {
  let column = 0
  for (const character of text) {
    column = character === '\t' ? column + width - (column % width) : column + 1
  }
  return column
}

/**
 * The spaces a Tab press inserts, given everything on the line before the
 * caret: enough to reach the next tab stop, never a fixed run of `width`.
 *
 * A fixed run inserted mid-line leaves everything after it off the grid, so
 * the continuation lines under it no longer align with each other — which is
 * the whole purpose of choosing an indent width.
 */
export function softTabInsertion(lineBeforeCursor: string, width: IndentWidth): string {
  const column = visualColumn(lineBeforeCursor, width)
  return ' '.repeat(width - (column % width))
}

/**
 * The whitespace a newline carries over from the line it is splitting off.
 *
 * The line's own leading whitespace, verbatim — tabs included. The width
 * preference governs what the editor inserts, never what it rewrites: a file
 * opened to read one value out of must not have its neighbouring lines
 * re-indented to a width chosen after they were written, and a saved config is
 * what a printer boots from.
 *
 * One extra level is added after a property with no value yet, because
 * Klipper's parser reads the lines under it as that property's value — a
 * `gcode:` line is the case this exists for.
 */
export function continuationIndent(line: string, width: IndentWidth, startsBlock: boolean): string {
  const existing = /^[ \t]*/.exec(line)?.[0] ?? ''
  return startsBlock ? `${existing}${indentUnit(width)}` : existing
}
