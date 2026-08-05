import { describe, expect, it } from 'vitest'

import {
  duplicateSelectedLines,
  indentSelection,
  moveSelectedLines,
  outdentSelection,
  reindentDocument,
  toggleComment,
  type LineEdit,
} from '@/features/machine/lineEdit'

/** What the document reads as once an edit is applied. */
function applied(content: string, edit: LineEdit | null): string {
  if (!edit) return content
  return `${content.slice(0, edit.from)}${edit.text}${content.slice(edit.to)}`
}

/** Where the caret sits afterwards, marked in the resulting document. */
function withCaret(content: string, edit: LineEdit): string {
  const next = applied(content, edit)
  return `${next.slice(0, edit.selectionStart)}|${next.slice(edit.selectionStart)}`
}

const macro = ['[gcode_macro TEST]', 'gcode:', '  G28', '  G1 Z10'].join('\n')

describe('which lines a command acts on', () => {
  /*
   * Dragging down through a newline leaves the selection on the next line's
   * first column. Counting that line in makes every downward drag act on one
   * line more than the reader highlighted.
   */
  it('excludes a line the selection only reaches the start of', () => {
    const content = 'a\nb\nc'
    const edit = indentSelection(content, 0, 2, 2)

    expect(applied(content, edit)).toBe('  a\nb\nc')
  })

  it('takes the caret’s whole line when nothing is selected', () => {
    const content = 'a\nb\nc'
    const edit = indentSelection(content, 3, 3, 2)

    expect(applied(content, edit)).toBe('a\n  b\nc')
  })
})

describe('indenting a block', () => {
  it('adds one level to every line it touches', () => {
    const edit = indentSelection(macro, 19, macro.length, 2)

    expect(applied(macro, edit)).toBe(
      ['[gcode_macro TEST]', '  gcode:', '    G28', '    G1 Z10'].join('\n'),
    )
  })

  /*
   * A whitespace-only line inside a `gcode:` block is part of the block as far
   * as Klipper's parser is concerned, and trailing spaces are invisible to the
   * person who would have to remove them.
   */
  it('leaves a blank line blank', () => {
    const content = ['  G28', '', '  G1 Z10'].join('\n')
    const edit = indentSelection(content, 0, content.length, 4)

    expect(applied(content, edit)).toBe(['      G28', '', '      G1 Z10'].join('\n'))
  })

  it('leaves the block selected so the command repeats', () => {
    const content = 'a\nb'
    const edit = indentSelection(content, 0, content.length, 2)

    expect(edit.selectionStart).toBe(0)
    expect(applied(content, edit).slice(edit.selectionStart, edit.selectionEnd)).toBe('  a\n  b')
  })
})

describe('outdenting a block', () => {
  it('removes one level from every line it touches', () => {
    const content = ['    G28', '    G1 Z10'].join('\n')
    const edit = outdentSelection(content, 0, content.length, 2)

    expect(applied(content, edit)).toBe(['  G28', '  G1 Z10'].join('\n'))
  })

  it('removes only what is there when the line is shallower than one level', () => {
    const content = ' G28'

    expect(applied(content, outdentSelection(content, 0, 0, 4))).toBe('G28')
  })

  /*
   * The rule that keeps a keyboard-only reader able to leave the editor: Tab
   * already costs them the way forward, so Shift+Tab on a flush line has to
   * stay the browser's and move focus.
   */
  it('declines the key when there is nothing to remove', () => {
    expect(outdentSelection('[stepper_x]', 0, 0, 2)).toBeNull()
    expect(outdentSelection('a\nb', 0, 3, 8)).toBeNull()
  })

  it('acts when any line in the selection has something to remove', () => {
    const content = ['[gcode_macro TEST]', '  G28'].join('\n')
    const edit = outdentSelection(content, 0, content.length, 2)

    expect(applied(content, edit)).toBe(['[gcode_macro TEST]', 'G28'].join('\n'))
  })

  /* A tab is removed whole rather than converted: an outdent is not a reformat. */
  it('removes a leading tab without rewriting it as spaces', () => {
    const content = '\t\tG28'
    const edit = outdentSelection(content, 0, 0, 4)

    expect(applied(content, edit)).toBe('\tG28')
  })

  it('keeps the caret on its own line rather than letting it climb', () => {
    const content = '    G28'

    // Caret inside the indentation, further left than what is removed.
    expect(withCaret(content, outdentSelection(content, 1, 1, 4)!)).toBe('|G28')
    // Caret in the text, which shifts left by exactly what came off.
    expect(withCaret(content, outdentSelection(content, 5, 5, 4)!)).toBe('G|28')
  })
})

describe('toggling comments', () => {
  it('comments at the shallowest indentation in the block', () => {
    const content = ['  G28', '    G1 Z10'].join('\n')
    const edit = toggleComment(content, 0, content.length)

    expect(applied(content, edit)).toBe(['  # G28', '  #   G1 Z10'].join('\n'))
  })

  it('uncomments when every written line already is', () => {
    const content = ['  # G28', '  #   G1 Z10'].join('\n')
    const edit = toggleComment(content, 0, content.length)

    expect(applied(content, edit)).toBe(['  G28', '    G1 Z10'].join('\n'))
  })

  it('round-trips a block unchanged', () => {
    const commented = applied(macro, toggleComment(macro, 0, macro.length))

    expect(applied(commented, toggleComment(commented, 0, commented.length))).toBe(macro)
  })

  /* A partly-commented block reads as "not commented yet". */
  it('comments a block where only some lines are', () => {
    const content = ['# G28', 'G1 Z10'].join('\n')
    const edit = toggleComment(content, 0, content.length)

    expect(applied(content, edit)).toBe(['# # G28', '# G1 Z10'].join('\n'))
  })

  it('leaves a blank line alone rather than parking a marker on it', () => {
    const content = ['G28', '', 'G1 Z10'].join('\n')
    const edit = toggleComment(content, 0, content.length)

    expect(applied(content, edit)).toBe(['# G28', '', '# G1 Z10'].join('\n'))
  })

  it('has nothing to do on blank lines alone', () => {
    expect(toggleComment('\n\n', 0, 2)).toBeNull()
  })

  it('keeps a comment written without a space after the marker', () => {
    const content = '#G28'

    expect(applied(content, toggleComment(content, 0, 0))).toBe('G28')
  })
})

describe('moving lines', () => {
  it('swaps the line with the one above', () => {
    const edit = moveSelectedLines(macro, 26, 26, -1)

    expect(applied(macro, edit)).toBe(
      ['[gcode_macro TEST]', '  G28', 'gcode:', '  G1 Z10'].join('\n'),
    )
  })

  it('swaps the line with the one below', () => {
    const edit = moveSelectedLines(macro, 0, 0, 1)

    expect(applied(macro, edit)).toBe(
      ['gcode:', '[gcode_macro TEST]', '  G28', '  G1 Z10'].join('\n'),
    )
  })

  it('carries the caret with the line so the key can be held down', () => {
    const content = ['first', 'second'].join('\n')
    const edit = moveSelectedLines(content, 8, 8, -1)!

    expect(withCaret(content, edit)).toBe('se|cond\nfirst')
  })

  it('moves every line the selection touches as one block', () => {
    const content = ['a', 'b', 'c'].join('\n')
    const edit = moveSelectedLines(content, 0, 3, 1)

    expect(applied(content, edit)).toBe(['c', 'a', 'b'].join('\n'))
  })

  it('declines the key at either end of the file', () => {
    const content = ['a', 'b'].join('\n')

    expect(moveSelectedLines(content, 0, 0, -1)).toBeNull()
    expect(moveSelectedLines(content, 2, 2, 1)).toBeNull()
  })
})

describe('reindenting a whole file', () => {
  function reindent(content: string, width: 2 | 4 | 8 = 2, caret = 0): string {
    return applied(content, reindentDocument(content, caret, width))
  }

  it('puts sections, keys, and the comments between them at column zero', () => {
    const messy = ['  [stepper_x]', '   # the X motor', '    step_pin: PA0'].join('\n')

    expect(reindent(messy)).toBe(['[stepper_x]', '# the X motor', 'step_pin: PA0'].join('\n'))
  })

  it('gives a continuation block exactly one level, in spaces', () => {
    const messy = ['[gcode_macro TEST]', 'gcode:', '\t\tG28', '\t\tG1 Z10'].join('\n')

    expect(reindent(messy)).toBe(['[gcode_macro TEST]', 'gcode:', '  G28', '  G1 Z10'].join('\n'))
  })

  /*
   * The rule the whole command rests on. A macro whose Jinja bodies step inward
   * was written that way on purpose; flattening it would destroy the structure
   * the formatter was asked to tidy.
   */
  it('preserves relative indentation inside a continuation block', () => {
    const messy = [
      '[gcode_macro TEST]',
      'gcode:',
      '      {% if printer.idle_timeout.state == "Printing" %}',
      '        M117 printing',
      '          M118 deeper',
      '      {% endif %}',
    ].join('\n')

    expect(reindent(messy, 4)).toBe(
      [
        '[gcode_macro TEST]',
        'gcode:',
        '    {% if printer.idle_timeout.state == "Printing" %}',
        '      M117 printing',
        '        M118 deeper',
        '    {% endif %}',
      ].join('\n'),
    )
  })

  it('converts a tab-indented block to spaces without changing its shape', () => {
    const messy = ['gcode:', '\tG28', '\t\tM117 nested'].join('\n')

    expect(reindent(messy, 2)).toBe(['gcode:', '  G28', '    M117 nested'].join('\n'))
  })

  /* configparser keeps a blank line inside a value, so it is not a block end. */
  it('keeps a blank line inside a block, and empties a whitespace-only one', () => {
    const messy = ['gcode:', '    G28', '   ', '    G1 Z10'].join('\n')

    expect(reindent(messy)).toBe(['gcode:', '  G28', '', '  G1 Z10'].join('\n'))
  })

  it('strips trailing whitespace', () => {
    expect(reindent('[stepper_x]   \nstep_pin: PA0\t')).toBe('[stepper_x]\nstep_pin: PA0')
  })

  it('leaves an already-tidy file, and its undo history, alone', () => {
    const tidy = ['[gcode_macro TEST]', 'gcode:', '  G28', ''].join('\n')

    expect(reindentDocument(tidy, 0, 2)).toBeNull()
  })

  /*
   * Outside a continuation, nothing in this format is indented — so a line that
   * belongs to no value gets column zero like everything else there, rather than
   * keeping an indentation that means nothing.
   */
  it('flushes an indented line that belongs to no value', () => {
    const stray = ['[stepper_x]', '    stray line'].join('\n')

    expect(reindent(stray)).toBe(['[stepper_x]', 'stray line'].join('\n'))
  })

  /*
   * The line this would get wrong if an indented key-looking line were promoted:
   * a macro body is full of them, and `M117 done: yes` is not a config key.
   */
  it('never reinterprets a line inside a value as a key', () => {
    const macroBody = ['gcode:', '      M117 done: yes', '      SET_PIN VALUE=1'].join('\n')

    expect(reindent(macroBody)).toBe(['gcode:', '  M117 done: yes', '  SET_PIN VALUE=1'].join('\n'))
  })

  /* A bracketed value inside a macro body is not a section header. */
  it('leaves a bracketed continuation line inside the value', () => {
    const withBrackets = ['gcode:', '    {% set points = [1, 2] %}'].join('\n')

    expect(reindent(withBrackets)).toBe(['gcode:', '  {% set points = [1, 2] %}'].join('\n'))
  })

  it('pulls a misindented section header back to column zero', () => {
    expect(reindent(['gcode:', '  G28', '  [stepper_y]'].join('\n'))).toBe(
      ['gcode:', '  G28', '[stepper_y]'].join('\n'),
    )
  })

  it('keeps the caret on its own line rather than at the top of the file', () => {
    const messy = ['[stepper_x]', '\t\tstep_pin: PA0'].join('\n')
    // Caret just after "step" on the second line.
    const edit = reindentDocument(messy, messy.indexOf('step_pin') + 4, 2)!

    expect(withCaret(messy, edit)).toBe(['[stepper_x]', 'step|_pin: PA0'].join('\n'))
  })
})

describe('duplicating lines', () => {
  it('leaves the caret in the lower copy when asked downwards', () => {
    const content = 'G28'
    const edit = duplicateSelectedLines(content, 3, 3, 1)

    expect(withCaret(content, edit)).toBe('G28\nG28|')
  })

  it('leaves the caret in the upper copy when asked upwards', () => {
    const content = 'G28'
    const edit = duplicateSelectedLines(content, 3, 3, -1)

    expect(withCaret(content, edit)).toBe('G28|\nG28')
  })

  it('copies every line the selection touches', () => {
    const content = ['a', 'b'].join('\n')
    const edit = duplicateSelectedLines(content, 0, 3, 1)

    expect(applied(content, edit)).toBe(['a', 'b', 'a', 'b'].join('\n'))
  })
})
