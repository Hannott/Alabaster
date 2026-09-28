import { describe, expect, it } from 'vitest'

import { diffLines, lineChangeMarks, NO_LINE_CHANGE_MARKS } from '../lineChanges'

const lines = (text: string): string[] => text.split('\n')

describe('diffLines', () => {
  it('reports nothing for identical content', () => {
    expect(diffLines(lines('a\nb\nc'), lines('a\nb\nc'))).toEqual({
      changed: [],
      removedAbove: [],
    })
  })

  it('marks a rewritten line without claiming a deletion above it', () => {
    expect(diffLines(lines('a\nb\nc'), lines('a\nB\nc'))).toEqual({
      changed: [1],
      removedAbove: [],
    })
  })

  it('marks inserted lines and leaves the untouched ones alone', () => {
    expect(diffLines(lines('a\nd'), lines('a\nb\nc\nd'))).toEqual({
      changed: [1, 2],
      removedAbove: [],
    })
  })

  it('carries a deletion on the line that closed over it', () => {
    expect(diffLines(lines('a\nb\nc\nd'), lines('a\nd'))).toEqual({
      changed: [],
      removedAbove: [1],
    })
  })

  it('carries a deletion at the end of the file past the last line', () => {
    expect(diffLines(lines('a\nb\nc'), lines('a'))).toEqual({
      changed: [],
      removedAbove: [1],
    })
  })

  it('reads a deleted run longer than its replacement as both', () => {
    const diff = diffLines(lines('a\nb\nc\nd\ne'), lines('a\nX\ne'))
    expect(diff.changed).toEqual([1])
    expect(diff.removedAbove).toEqual([2])
  })

  it('marks the lines under the caret when a blank line is inserted beside one', () => {
    const before = lines('square_corner_velocity: 5.0\n\nmax_z_velocity: 12')
    const after = lines('square_corner_velocity: 5.0\n\n\n\nmax_z_velocity: 12')
    expect(diffLines(before, after)).toEqual({ changed: [1, 2], removedAbove: [] })
  })

  it('anchors an insertion identical to its neighbour at the earliest position', () => {
    expect(diffLines(lines('a\nb'), lines('a\na\nb'))).toEqual({
      changed: [0],
      removedAbove: [],
    })
  })

  it('marks every line of a wholesale rewrite past the exact-diff cap', () => {
    const before = Array.from({ length: 900 }, (_, index) => `before ${index}`)
    const after = Array.from({ length: 900 }, (_, index) => `after ${index}`)
    const diff = diffLines(before, after)
    expect(diff.changed).toHaveLength(900)
    expect(diff.removedAbove).toEqual([])
  })

  it('costs only the differing line in a long file', () => {
    const before = Array.from({ length: 5000 }, (_, index) => `line ${index}`)
    const after = [...before]
    after[2500] = 'edited'
    expect(diffLines(before, after)).toEqual({ changed: [2500], removedAbove: [] })
  })
})

describe('lineChangeMarks', () => {
  it('returns the shared empty marks when nothing differs', () => {
    const same = lines('a\nb')
    expect(lineChangeMarks(same, same, same)).toBe(NO_LINE_CHANGE_MARKS)
  })

  it('calls an edit that has not been written unsaved', () => {
    const origin = lines('a\nb\nc')
    const marks = lineChangeMarks(lines('a\nB\nc'), origin, origin)
    expect([...marks.changed]).toEqual([[1, 'unsaved']])
  })

  it('keeps a saved edit marked once it has reached disk', () => {
    const origin = lines('a\nb\nc')
    const saved = lines('a\nB\nc')
    const marks = lineChangeMarks(saved, saved, origin)
    expect([...marks.changed]).toEqual([[1, 'saved']])
  })

  it('separates an unsaved edit from a saved one in the same file', () => {
    const origin = lines('a\nb\nc\nd')
    const saved = lines('a\nB\nc\nd')
    const content = lines('a\nB\nc\nD')
    const marks = lineChangeMarks(content, saved, origin)
    expect(marks.changed.get(1)).toBe('saved')
    expect(marks.changed.get(3)).toBe('unsaved')
  })

  it('prefers unsaved where a line differs from both baselines', () => {
    const marks = lineChangeMarks(lines('a\nC'), lines('a\nB'), lines('a\nb'))
    expect(marks.changed.get(1)).toBe('unsaved')
  })

  it('marks a line edited back to what was saved as saved only', () => {
    const marks = lineChangeMarks(lines('a\nB'), lines('a\nB'), lines('a\nb'))
    expect(marks.changed.get(1)).toBe('saved')
  })

  it('carries a deletion with the state it is in', () => {
    const origin = lines('a\nb\nc')
    const marks = lineChangeMarks(lines('a\nc'), origin, origin)
    expect([...marks.removedAbove]).toEqual([[1, 'unsaved']])
  })
})
