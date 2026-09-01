import { describe, expect, it } from 'vitest'

import {
  continuationIndent,
  defaultIndentWidth,
  indentUnit,
  isIndentWidth,
  softTabInsertion,
  visualColumn,
} from '@/features/machine/indent'

describe('the offered widths', () => {
  it('defaults to what Klipper’s own documentation uses', () => {
    expect(defaultIndentWidth).toBe(2)
  })

  it('accepts only a width that lines up with another editor', () => {
    expect(isIndentWidth(2)).toBe(true)
    expect(isIndentWidth(4)).toBe(true)
    expect(isIndentWidth(8)).toBe(true)
    expect(isIndentWidth(3)).toBe(false)
    expect(isIndentWidth(0)).toBe(false)
    // A stored preference and a synced bundle both arrive as unknown.
    expect(isIndentWidth('4')).toBe(false)
    expect(isIndentWidth(Number.NaN)).toBe(false)
    expect(isIndentWidth(undefined)).toBe(false)
  })

  it('measures one level in spaces, never a tab', () => {
    expect(indentUnit(2)).toBe('  ')
    expect(indentUnit(8)).toBe(' '.repeat(8))
    expect(indentUnit(4)).not.toContain('\t')
  })
})

describe('a column on the editor’s grid', () => {
  it('counts an ordinary character as one', () => {
    expect(visualColumn('step_pin', 4)).toBe(8)
    expect(visualColumn('', 4)).toBe(0)
  })

  /*
   * The grid is what the reader sees, not what the file stores: a file the
   * editor did not write can already contain tabs, and a tab is one character
   * and several columns at the same time.
   */
  it('advances a literal tab to the next stop', () => {
    expect(visualColumn('\t', 4)).toBe(4)
    expect(visualColumn('ab\t', 4)).toBe(4)
    expect(visualColumn('abcd\t', 4)).toBe(8)
    expect(visualColumn('\t\t', 2)).toBe(4)
  })
})

describe('what the Tab key inserts', () => {
  it('inserts a full level at the start of a line', () => {
    expect(softTabInsertion('', 2)).toBe('  ')
    expect(softTabInsertion('', 8)).toBe(' '.repeat(8))
  })

  /*
   * A fixed run of `width` inserted mid-line would leave everything after it
   * off the grid, so the continuation lines under it stop aligning with each
   * other — which is the entire point of choosing a width.
   */
  it('pads to the next stop from anywhere in the line', () => {
    expect(softTabInsertion('a', 4)).toBe('   ')
    expect(softTabInsertion('abc', 4)).toBe(' ')
    expect(softTabInsertion('abcde', 4)).toBe('   ')
  })

  it('inserts a whole level when the caret already sits on a stop', () => {
    expect(softTabInsertion('abcd', 4)).toBe('    ')
  })

  it('lands on the grid in a file someone else indented with tabs', () => {
    expect(softTabInsertion('\t', 4)).toBe('    ')
    expect(softTabInsertion('\tab', 4)).toBe('  ')
  })
})

describe('what a newline carries over', () => {
  it('repeats the line’s own indentation', () => {
    expect(continuationIndent('    step_pin: X_STEP', 2, false)).toBe('    ')
  })

  it('leaves a flush line flush', () => {
    expect(continuationIndent('[stepper_x]', 4, false)).toBe('')
  })

  /*
   * The width preference governs what the editor inserts, never what it
   * rewrites: a file opened to read one value out of must not have its
   * neighboring lines re-indented to a width chosen after they were written.
   */
  it('repeats an existing tab rather than converting it', () => {
    expect(continuationIndent('\tstep_pin: X_STEP', 4, false)).toBe('\t')
  })

  it('opens one more level under a property with no value yet', () => {
    expect(continuationIndent('gcode:', 2, true)).toBe('  ')
    expect(continuationIndent('  gcode:', 4, true)).toBe('      ')
  })

  it('opens that level in spaces even below a tab-indented line', () => {
    expect(continuationIndent('\tgcode:', 2, true)).toBe('\t  ')
  })
})
