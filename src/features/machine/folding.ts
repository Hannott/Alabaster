/**
 * Which lines of a Klipper config can be collapsed, and what each one hides.
 *
 * The format has two kinds of block and no brackets to find them by: a section
 * runs from its `[header]` to the line before the next one, and a key's value
 * runs from the key to the last line indented under it. Both are the same
 * structure `configLines.ts` already defines for the tokenizer and the reindent
 * command, so this asks those predicates rather than describing the format a
 * third time — two opinions about where a macro ends is how a fold comes to
 * hide a line the colouring says belongs to the next section.
 *
 * Pure, and stated in line numbers rather than document offsets, so the rules
 * can be tested without a CodeMirror document.
 *
 * Lines are read through a `LineReader` rather than taken as an array. The
 * editor asks for a fold range once per line it is about to draw, and a split
 * of a multi-megabyte buffer per visible line per repaint is the cost that
 * would make folding unaffordable on exactly the files it helps most with.
 * A CodeMirror document answers `text` in log time without copying anything.
 */

import { COMMENT_LINE, SECTION_LINE, isContinuationLine, opensValue } from './configLines'

export interface LineReader {
  /** How many lines the document has. */
  readonly count: number
  /** Line `index`, 0-based, or undefined past the end. */
  text(index: number): string | undefined
}

/** A reader over lines already split, for callers that hold an array. */
export function linesReader(lines: readonly string[]): LineReader {
  return { count: lines.length, text: (index) => lines[index] }
}

export interface FoldableRange {
  /** The line carrying the fold control, which stays visible. */
  readonly line: number
  /** The last line the fold hides, always greater than `line`. */
  readonly endLine: number
}

const isSectionHeader = (line: string): boolean => SECTION_LINE.test(line.trim())

const isBlank = (line: string): boolean => line.trim().length === 0

/**
 * The range `line` folds, or null when it opens nothing.
 *
 * Trailing blank lines are left out of every range. They read as the gap
 * before the next section rather than as part of the one above, and a fold
 * that swallowed them would close the space between two collapsed sections and
 * leave the file looking like it had been reformatted.
 */
export function foldableRangeAt(lines: LineReader, line: number): FoldableRange | null {
  const text = lines.text(line)
  if (text === undefined) return null

  const lastContentLine = (end: number): number => {
    let last = end
    while (last > line && isBlank(lines.text(last) ?? '')) last -= 1
    return last
  }

  if (isSectionHeader(text)) {
    let end = line + 1
    while (end < lines.count && !isSectionHeader(lines.text(end) ?? '')) end += 1
    const last = lastContentLine(end - 1)
    return last > line ? { line, endLine: last } : null
  }

  const trimmed = text.trim()
  if (COMMENT_LINE.test(trimmed) || !opensValue(trimmed)) return null

  let end = line
  while (end + 1 < lines.count) {
    const next = lines.text(end + 1) ?? ''
    if (!isBlank(next) && !isContinuationLine(next, true)) break
    end += 1
  }
  const last = lastContentLine(end)
  return last > line ? { line, endLine: last } : null
}

/**
 * Every range in the file, for the section outline and for tests. The editor
 * itself never calls this: CodeMirror asks line by line for the lines it is
 * about to draw, which is what keeps folding off the cost of a large file.
 */
export function foldableRanges(lines: LineReader): FoldableRange[] {
  const ranges: FoldableRange[] = []
  for (let line = 0; line < lines.count; line += 1) {
    const range = foldableRangeAt(lines, line)
    if (range) ranges.push(range)
  }
  return ranges
}
