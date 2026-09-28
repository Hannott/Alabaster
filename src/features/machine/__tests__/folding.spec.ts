import { describe, expect, it } from 'vitest'

import { foldableRangeAt, foldableRanges, linesReader, type LineReader } from '../folding'

const lines = (text: string): LineReader => linesReader(text.split('\n'))

const CONFIG = lines(
  [
    '# a leading comment',
    '',
    '[printer]',
    'kinematics: cartesian',
    'max_accel: 5000',
    '',
    '[gcode_macro PARK]',
    'gcode:',
    '  G90',
    '  G1 X0 Y0',
    '',
    '[idle_timeout]',
    'timeout: 600',
  ].join('\n'),
)

describe('foldableRangeAt', () => {
  it('folds a section down to its last line of content', () => {
    expect(foldableRangeAt(CONFIG, 2)).toEqual({ line: 2, endLine: 4 })
  })

  it('leaves the blank line before the next section outside the fold', () => {
    const range = foldableRangeAt(CONFIG, 6)
    expect(range).toEqual({ line: 6, endLine: 9 })
    expect(CONFIG.text(10)).toBe('')
  })

  it('folds a key down to the last line indented under it', () => {
    expect(foldableRangeAt(CONFIG, 7)).toEqual({ line: 7, endLine: 9 })
  })

  it('does not fold a key whose value is on its own line', () => {
    expect(foldableRangeAt(CONFIG, 3)).toBeNull()
  })

  it('does not fold a section with nothing under it', () => {
    expect(foldableRangeAt(lines('[printer]\n[stepper_x]'), 0)).toBeNull()
  })

  it('does not fold a comment, a blank line, or a continuation line', () => {
    expect(foldableRangeAt(CONFIG, 0)).toBeNull()
    expect(foldableRangeAt(CONFIG, 1)).toBeNull()
    expect(foldableRangeAt(CONFIG, 8)).toBeNull()
  })

  it('keeps a blank line inside a value block inside the fold', () => {
    const block = lines('[gcode_macro M]\ngcode:\n  G90\n\n  G91\n\n[next]')
    expect(foldableRangeAt(block, 1)).toEqual({ line: 1, endLine: 4 })
  })

  it('stops a section at the next header even with no blank line between', () => {
    const tight = lines('[a]\nkey: 1\n[b]\nkey: 2')
    expect(foldableRangeAt(tight, 0)).toEqual({ line: 0, endLine: 1 })
    expect(foldableRangeAt(tight, 2)).toEqual({ line: 2, endLine: 3 })
  })

  it('runs the last section to the end of the file', () => {
    expect(foldableRangeAt(CONFIG, 11)).toEqual({ line: 11, endLine: 12 })
  })

  it('reads an indented section header as a misindented header, not a continuation', () => {
    const odd = lines('[gcode_macro M]\ngcode:\n  G90\n  [printer]')
    expect(foldableRangeAt(odd, 1)).toEqual({ line: 1, endLine: 2 })
  })

  it('answers null past the end of the file', () => {
    expect(foldableRangeAt(CONFIG, 99)).toBeNull()
  })
})

describe('foldableRanges', () => {
  it('finds every section and every value block', () => {
    expect(foldableRanges(CONFIG)).toEqual([
      { line: 2, endLine: 4 },
      { line: 6, endLine: 9 },
      { line: 7, endLine: 9 },
      { line: 11, endLine: 12 },
    ])
  })
})
