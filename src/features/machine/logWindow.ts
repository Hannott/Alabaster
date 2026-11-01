/**
 * A log file held as a byte range of it, split into lines.
 *
 * A log is read from its end and grows at its end, so the range only ever
 * widens in both directions: earlier bytes are prepended as the reader walks
 * back toward the start of a run, and new bytes appended as Klipper writes
 * them. Splitting on the newline byte is safe in UTF-8, where 0x0A never
 * appears inside a multi-byte character, so a chunk boundary can fall
 * anywhere without corrupting a line.
 */

const NEWLINE = 0x0a
const EMPTY = new Uint8Array(0)
const decoder = new TextDecoder()

export interface LogWindow {
  /** Byte offset of the first byte held. */
  start: number
  /** Byte offset one past the last byte held. */
  end: number
  /**
   * The bytes from `start` up to the first newline: the end of a line that
   * may begin before `start`, so not shown until the rest of it is read.
   * Always empty once `start` is 0.
   */
  head: Uint8Array
  /** Whether the newline that ends `head` has been read. */
  headClosed: boolean
  /** Every complete line between `head` and `tail`. */
  lines: string[]
  /** The bytes after the last newline: a line still being written. */
  tail: Uint8Array
}

export function emptyLogWindow(at: number): LogWindow {
  return { start: at, end: at, head: EMPTY, headClosed: at === 0, lines: [], tail: EMPTY }
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length === 0) return right
  if (right.length === 0) return left
  const joined = new Uint8Array(left.length + right.length)
  joined.set(left)
  joined.set(right, left.length)
  return joined
}

function decodeLines(bytes: Uint8Array): string[] {
  return decoder.decode(bytes).split('\n')
}

/** `bytes` read from `window.end` onward. */
export function appendLogBytes(window: LogWindow, bytes: Uint8Array): LogWindow {
  if (bytes.length === 0) return window
  const end = window.end + bytes.length
  if (!window.headClosed) {
    const pending = concat(window.head, bytes)
    const firstNewline = pending.indexOf(NEWLINE)
    if (firstNewline < 0) return { ...window, end, head: pending }
    const rest = pending.slice(firstNewline + 1)
    const closed: LogWindow = {
      ...window,
      end: end - rest.length,
      head: pending.slice(0, firstNewline),
      headClosed: true,
    }
    return appendLogBytes(closed, rest)
  }
  const pending = concat(window.tail, bytes)
  const lastNewline = pending.lastIndexOf(NEWLINE)
  if (lastNewline < 0) return { ...window, end, tail: pending }
  return {
    ...window,
    end,
    lines: window.lines.concat(decodeLines(pending.subarray(0, lastNewline))),
    tail: pending.slice(lastNewline + 1),
  }
}

/** `bytes` that end where `window` starts. */
export function prependLogBytes(window: LogWindow, bytes: Uint8Array): LogWindow {
  if (bytes.length === 0) return window
  const start = window.start - bytes.length
  if (start < 0) throw new RangeError('Prepended bytes reach before the start of the file')
  const pending = concat(bytes, window.head)
  if (!window.headClosed) {
    // Nothing held so far contained a newline: all of it is one unfinished line.
    if (start === 0) {
      return {
        ...emptyLogWindow(0),
        end: window.end,
        tail: pending,
      }
    }
    return { ...window, start, head: pending }
  }
  if (start === 0) {
    return {
      ...window,
      start,
      head: EMPTY,
      lines: decodeLines(pending).concat(window.lines),
    }
  }
  const firstNewline = pending.indexOf(NEWLINE)
  if (firstNewline < 0) return { ...window, start, head: pending }
  return {
    ...window,
    start,
    head: pending.slice(0, firstNewline),
    lines: decodeLines(pending.subarray(firstNewline + 1)).concat(window.lines),
  }
}
