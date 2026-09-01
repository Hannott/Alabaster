/*
 * The editor renders the lines the viewport can actually show, not the file.
 *
 * A 2 MB log or G-code file is around 60,000 lines, and the highlight layer
 * spends one element per line plus one per syntax token — measured on a real
 * 2 MB sliced file, 539,271 token spans and 659,111 elements in total. Mounting
 * that costs seconds on a desktop and far longer on a first-generation Pi, and
 * the cost is paid again on every keystroke, every hover over an `[include]`,
 * and in both directions each time the route is left and re-entered. Nothing
 * about it is visible: the highlight layer is `aria-hidden`, sits under the
 * textarea that owns the real content, and shows at most a screenful.
 *
 * Everything here is pure so the arithmetic can be tested without a layout.
 */

/**
 * The rendered height of one line when nothing has measured the real one yet —
 * `line-height: 1.5rem` in main.css at the default root font size. Callers that
 * have a mounted editor must measure instead, because that rem scales with the
 * root font size and with browser zoom, and a spacer computed from a stale
 * height drifts the highlight off the text it is coloring.
 */
export const DEFAULT_CODE_LINE_HEIGHT = 24

/**
 * Lines the window grows and shrinks by. The window is snapped to a multiple of
 * this so scrolling only repaints when the first visible line crosses a
 * boundary, rather than on every wheel notch: on a Pi the repaint, not the
 * scroll, is what drops the frame.
 */
export const CODE_WINDOW_BLOCK = 24

/**
 * Above this much text, the editor body is mounted in a task of its own rather
 * than inside whatever event asked for it.
 *
 * Windowing the highlight layer left one cost that no amount of not-rendering
 * avoids: the textarea holds the whole file, because it owns the text, the
 * caret, and the selection — and handing the browser a file to lay out is
 * `white-space: pre`, so it measures every line to find the scroll extent.
 * Measured on this desktop, that layout alone is 6 ms at 50 KB, 40 ms at 500 KB
 * and 174 ms at 2.4 MB, and returning to Configuration with a 2.5 MB log open
 * blocked the main thread for 233 ms end to end. A Pi is several times slower
 * again, which is what made the navigation itself feel broken.
 *
 * The threshold is where the two failure modes cross. Below it the mount is a
 * fraction of a frame even on a Pi, and deferring would only flash an indicator
 * for work that was already done — every configuration file the workspace opens
 * is far below it. Above it, the file is a log or a sliced file, and the wait is
 * worth showing.
 */
export const EDITOR_DEFERRED_MOUNT_BYTES = 64 * 1024

export interface CodeWindow {
  /** First line in the window, zero-based. */
  start: number
  /** One past the last line in the window. */
  end: number
}

/**
 * The block-aligned range of lines to render for a viewport scrolled to
 * `scrollTop`. It reaches one block behind the first visible line and two
 * blocks past the last, so a scroll of up to a block in either direction is
 * already drawn before it is asked for.
 */
export function codeWindow(
  scrollTop: number,
  viewportHeight: number,
  lineHeight: number,
  lineCount: number,
): CodeWindow {
  if (lineCount <= 0 || lineHeight <= 0) return { start: 0, end: 0 }
  const rows = Math.max(1, Math.ceil(Math.max(0, viewportHeight) / lineHeight))
  const firstVisible = Math.max(0, Math.floor(Math.max(0, scrollTop) / lineHeight))
  // Clamped before flooring: a textarea keeps its scroll offset when a shorter
  // file is opened into it, and a window starting past the end of that file
  // would render nothing at all until the user scrolled.
  const anchor = Math.min(firstVisible, Math.max(0, lineCount - 1))
  const start = Math.max(0, Math.floor(anchor / CODE_WINDOW_BLOCK - 1) * CODE_WINDOW_BLOCK)
  const end = Math.min(lineCount, start + rows + CODE_WINDOW_BLOCK * 3)
  return { start, end }
}

/**
 * Which line `index` falls on, counting from 1 — without slicing the buffer or
 * splitting it into an array, both of which allocate a copy of the whole file
 * every time the caret moves.
 */
export function lineNumberAt(content: string, index: number): number {
  let line = 1
  let at = content.indexOf('\n')
  while (at !== -1 && at < index) {
    line += 1
    at = content.indexOf('\n', at + 1)
  }
  return line
}
