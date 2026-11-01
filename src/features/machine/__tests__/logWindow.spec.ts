import { describe, expect, it } from 'vitest'

import { appendLogBytes, emptyLogWindow, prependLogBytes } from '@/features/machine/logWindow'

const file = new TextEncoder().encode('first\nsecond\nthird — ø\nfourth\nfif')

function slice(from: number, to?: number): Uint8Array {
  return file.slice(from, to)
}

describe('log window', () => {
  it('reads a whole file into lines, keeping the unfinished last line apart', () => {
    const window = appendLogBytes(emptyLogWindow(0), slice(0))

    expect(window.lines).toEqual(['first', 'second', 'third — ø', 'fourth'])
    expect(new TextDecoder().decode(window.tail)).toBe('fif')
    expect(window.end).toBe(file.length)
  })

  /*
   * A read from the middle of the file starts inside a line it cannot know the
   * beginning of, so that fragment waits in `head` instead of showing as a line.
   */
  it('holds back the fragment a read from the middle starts in', () => {
    const window = appendLogBytes(emptyLogWindow(9), slice(9))

    expect(window.lines).toEqual(['third — ø', 'fourth'])
    expect(new TextDecoder().decode(window.head)).toBe('ond')
  })

  it('completes that fragment when the bytes before it are read', () => {
    let window = appendLogBytes(emptyLogWindow(9), slice(9))
    window = prependLogBytes(window, slice(3, 9))

    expect(window.start).toBe(3)
    expect(window.lines).toEqual(['second', 'third — ø', 'fourth'])

    window = prependLogBytes(window, slice(0, 3))

    expect(window.start).toBe(0)
    expect(window.head.length).toBe(0)
    expect(window.lines).toEqual(['first', 'second', 'third — ø', 'fourth'])
  })

  /** A chunk boundary inside a multi-byte character must not corrupt it. */
  it('splits a chunk inside a multi-byte character without corrupting it', () => {
    const inside = file.indexOf(0xc3)
    let window = appendLogBytes(emptyLogWindow(0), slice(0, inside + 1))
    window = appendLogBytes(window, slice(inside + 1))

    expect(window.lines).toContain('third — ø')
  })

  it('finishes the line being written when the rest of it arrives', () => {
    let window = appendLogBytes(emptyLogWindow(0), slice(0))
    window = appendLogBytes(window, new TextEncoder().encode('th\nsix'))

    expect(window.lines.at(-1)).toBe('fifth')
    expect(new TextDecoder().decode(window.tail)).toBe('six')
    expect(window.end).toBe(file.length + 6)
  })

  it('waits for a newline when a read holds none', () => {
    let window = appendLogBytes(emptyLogWindow(1), slice(1, 4))

    expect(window.lines).toEqual([])
    expect(window.headClosed).toBe(false)

    window = appendLogBytes(window, slice(4))

    expect(window.headClosed).toBe(true)
    expect(window.lines).toEqual(['second', 'third — ø', 'fourth'])
    expect(window.end).toBe(file.length)
  })
})
