/**
 * Which lines of the open file differ from what disk holds, split into the
 * edit the user has not written yet and the edit they already wrote this
 * session. The editor's gutter renders the two apart so a reader can tell
 * "I changed this and it is still only in the browser" from "I changed this
 * and the printer has it", which is the difference that decides whether
 * closing the tab loses work.
 *
 * Pure so the arithmetic is testable without mounting the editor, like every
 * other module in `features/machine`.
 */

/** Whether a marked line's change has reached disk yet. */
export type LineChangeState = 'saved' | 'unsaved'

export interface LineChangeMarks {
  /** Lines added or rewritten, by 0-based index into the current content. */
  readonly changed: ReadonlyMap<number, LineChangeState>
  /**
   * Lines with a run of deleted lines immediately above them. A deletion has
   * no line of its own left to mark, so it is carried by the line that closed
   * over it — and by index `content.length` when the file ended with one.
   */
  readonly removedAbove: ReadonlyMap<number, LineChangeState>
}

const NO_MARKS: LineChangeMarks = { changed: new Map(), removedAbove: new Map() }

/**
 * The longest run of differing lines still worth an exact diff. The dynamic
 * program below is O(n·m) in both time and memory, so a file whose middle has
 * been rewritten wholesale — a paste over a selection, a Shift+Alt+F reindent,
 * a different file arriving in the same buffer — would otherwise allocate a
 * matrix of millions of cells on a keystroke, on a machine that may be a Pi.
 * Past the cap the whole differing run is marked changed instead, which is what
 * such an edit means anyway; the exact case is the one the reader is typing in,
 * and that one never approaches the cap.
 */
const MAX_EXACT_DIFF_LINES = 500

interface LineDiff {
  /** Indices into `after` that were added or rewritten. */
  readonly changed: number[]
  /** Indices into `after` that closed over a run of deleted lines. */
  readonly removedAbove: number[]
}

/**
 * The lines of `after` that `before` does not account for. Equal lines at the
 * head and tail are trimmed before anything expensive runs, which is what keeps
 * an ordinary keystroke — one line differing in a file of thousands — from
 * costing more than the line it touched.
 *
 * A deleted run adjacent to an added one is read as a rewrite rather than as
 * both, so replacing a line marks that line and does not also claim a deletion
 * above it.
 */
export function diffLines(before: readonly string[], after: readonly string[]): LineDiff {
  const changed: number[] = []
  const removedAbove: number[] = []

  /*
   * The tail is matched before the head, and the head is then bounded by what
   * the tail already claimed. Which of two runs of identical lines counts as
   * the inserted one is genuinely ambiguous — pressing Enter twice beside a
   * blank line leaves three blank lines and no way to tell them apart — and
   * this is what settles it in favour of the earliest position, which is the
   * one the caret is on. Matching the head first settles it the other way and
   * marks the lines below the ones the reader just made, up until the moment
   * they type a character into them and the ambiguity disappears on its own.
   */
  const shortest = Math.min(before.length, after.length)
  let suffix = 0
  while (
    suffix < shortest &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1
  }
  let prefix = 0
  while (prefix < shortest - suffix && before[prefix] === after[prefix]) prefix += 1

  const beforeStart = prefix
  const beforeEnd = before.length - suffix
  const afterStart = prefix
  const afterEnd = after.length - suffix
  const beforeCount = beforeEnd - beforeStart
  const afterCount = afterEnd - afterStart

  if (beforeCount === 0 && afterCount === 0) return { changed, removedAbove }
  if (beforeCount === 0) {
    for (let line = afterStart; line < afterEnd; line += 1) changed.push(line)
    return { changed, removedAbove }
  }
  if (afterCount === 0) {
    removedAbove.push(afterStart)
    return { changed, removedAbove }
  }
  if (beforeCount > MAX_EXACT_DIFF_LINES || afterCount > MAX_EXACT_DIFF_LINES) {
    for (let line = afterStart; line < afterEnd; line += 1) changed.push(line)
    return { changed, removedAbove }
  }

  const stride = afterCount + 1
  const lcs = new Uint32Array((beforeCount + 1) * stride)
  const common = (i: number, j: number): number => lcs[i * stride + j] ?? 0
  for (let i = beforeCount - 1; i >= 0; i -= 1) {
    for (let j = afterCount - 1; j >= 0; j -= 1) {
      lcs[i * stride + j] =
        before[beforeStart + i] === after[afterStart + j]
          ? common(i + 1, j + 1) + 1
          : Math.max(common(i + 1, j), common(i, j + 1))
    }
  }

  let pendingDeletes = 0
  let i = 0
  let j = 0
  const flushDeletes = (line: number): void => {
    if (pendingDeletes > 0) removedAbove.push(line)
    pendingDeletes = 0
  }
  while (i < beforeCount && j < afterCount) {
    if (before[beforeStart + i] === after[afterStart + j]) {
      flushDeletes(afterStart + j)
      i += 1
      j += 1
    } else if (common(i + 1, j) >= common(i, j + 1)) {
      pendingDeletes += 1
      i += 1
    } else {
      changed.push(afterStart + j)
      if (pendingDeletes > 0) pendingDeletes -= 1
      j += 1
    }
  }
  pendingDeletes += beforeCount - i
  for (; j < afterCount; j += 1) {
    changed.push(afterStart + j)
    if (pendingDeletes > 0) pendingDeletes -= 1
  }
  flushDeletes(afterEnd)

  return { changed, removedAbove }
}

/**
 * The gutter's marks for one file: `content` against `saved` gives what is
 * still only in the browser, `content` against `origin` — what disk held when
 * the file was first read this session — gives everything touched since. A
 * line in both is unsaved, since that is the state the reader has to act on.
 *
 * Passing pre-split arrays is deliberate: the view already holds one split of
 * the current content (`editorLines`) and re-splitting a multi-megabyte file
 * per keystroke is the cost this whole feature has to stay under.
 */
export function lineChangeMarks(
  contentLines: readonly string[],
  savedLines: readonly string[],
  originLines: readonly string[],
): LineChangeMarks {
  const changed = new Map<number, LineChangeState>()
  const removedAbove = new Map<number, LineChangeState>()

  const sinceOrigin = diffLines(originLines, contentLines)
  for (const line of sinceOrigin.changed) changed.set(line, 'saved')
  for (const line of sinceOrigin.removedAbove) removedAbove.set(line, 'saved')

  const sinceSaved = diffLines(savedLines, contentLines)
  for (const line of sinceSaved.changed) changed.set(line, 'unsaved')
  for (const line of sinceSaved.removedAbove) removedAbove.set(line, 'unsaved')

  if (changed.size === 0 && removedAbove.size === 0) return NO_MARKS
  return { changed, removedAbove }
}

export { NO_MARKS as NO_LINE_CHANGE_MARKS }
