import { describe, expect, it } from 'vitest'

import {
  CODE_WINDOW_BLOCK,
  codeWindow,
  DEFAULT_CODE_LINE_HEIGHT,
  lineNumberAt,
} from '../codeWindow'

const lineHeight = DEFAULT_CODE_LINE_HEIGHT
/** Around what a 2 MB sliced G-code file comes to. */
const hugeFile = 60_000

describe('codeWindow', () => {
  it('renders a screenful and its slack, not the file', () => {
    const { start, end } = codeWindow(0, 960, lineHeight, hugeFile)

    expect(start).toBe(0)
    // 40 viewport rows plus three blocks of slack — bounded by the viewport, so
    // it stays the same whether the file is 60,000 lines or 600,000.
    expect(end - start).toBe(40 + CODE_WINDOW_BLOCK * 3)
    expect(codeWindow(0, 960, lineHeight, hugeFile * 10).end).toBe(end)
  })

  it('covers everything the viewport shows, plus a block either side', () => {
    const scrollTop = 5_000
    const { start, end } = codeWindow(scrollTop, 960, lineHeight, hugeFile)
    const firstVisible = Math.floor(scrollTop / lineHeight)
    const lastVisible = Math.ceil((scrollTop + 960) / lineHeight)

    expect(start).toBeLessThanOrEqual(firstVisible - 1)
    expect(end).toBeGreaterThanOrEqual(lastVisible + CODE_WINDOW_BLOCK)
  })

  /*
   * The reason the window snaps to a block at all: a repaint per wheel notch is
   * what makes scrolling stutter on a Pi, so scrolling within a block must not
   * change what is mounted.
   */
  it('holds the same window while the scroll stays inside one block', () => {
    const base = CODE_WINDOW_BLOCK * 3
    const first = codeWindow(base * lineHeight, 960, lineHeight, hugeFile)

    for (let line = base; line < base + CODE_WINDOW_BLOCK; line += 1) {
      expect(codeWindow(line * lineHeight, 960, lineHeight, hugeFile)).toEqual(first)
    }
    expect(
      codeWindow((base + CODE_WINDOW_BLOCK) * lineHeight, 960, lineHeight, hugeFile),
    ).not.toEqual(first)
  })

  it('never runs past the end of the file', () => {
    expect(codeWindow(0, 960, lineHeight, 3)).toEqual({ start: 0, end: 3 })
    expect(codeWindow(10_000, 960, lineHeight, 3).end).toBe(3)
  })

  /**
   * A textarea keeps its scroll offset when a shorter file is opened into it, so
   * the window has to be anchored to a line the new file actually has. It
   * rendered nothing at all until the user scrolled.
   */
  it('shows the end of a short file opened while scrolled deep into a long one', () => {
    const { start, end } = codeWindow(40_000 * lineHeight, 960, lineHeight, 120)

    expect(start).toBeLessThan(120)
    expect(end).toBe(120)
  })

  it('has nothing to render for an empty file', () => {
    expect(codeWindow(0, 960, lineHeight, 0)).toEqual({ start: 0, end: 0 })
  })
})

describe('lineNumberAt', () => {
  it('counts from one', () => {
    expect(lineNumberAt('a\nb\nc', 0)).toBe(1)
    expect(lineNumberAt('a\nb\nc', 2)).toBe(2)
    expect(lineNumberAt('a\nb\nc', 4)).toBe(3)
  })

  it('agrees with slicing and splitting, which is what it replaces', () => {
    const content = 'first\n\nthird line\n\ttabbed\nlast'

    for (let index = 0; index <= content.length; index += 1) {
      expect(lineNumberAt(content, index)).toBe(content.slice(0, index).split('\n').length)
    }
  })
})
