import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'

import { machineConfigSyntax } from '../language'

let view: EditorView | null = null

afterEach(() => {
  view?.destroy()
  view?.dom.parentElement?.remove()
  view = null
})

function render(doc: string): HTMLElement {
  const parent = document.createElement('div')
  document.body.append(parent)
  view = new EditorView({
    state: EditorState.create({ doc, extensions: [machineConfigSyntax] }),
    parent,
  })
  return parent
}

const kinds = (parent: HTMLElement, kind: string): string[] =>
  [...parent.querySelectorAll(`.machine-syntax--${kind}`)].map((node) => node.textContent ?? '')

describe('the Klipper config language', () => {
  it('colours a section, a key and a pin through the shared token kinds', () => {
    const parent = render('[stepper_x]\nstep_pin: !X_EN\n')

    expect(kinds(parent, 'section')).toEqual(['[stepper_x]'])
    // The separator belongs to the key token; see PROPERTY_LINE in syntax.ts.
    expect(kinds(parent, 'key')).toEqual(['step_pin:'])
    expect(kinds(parent, 'pin')).toEqual(['!X_EN'])
  })

  /**
   * The reason this is a stream parser and not a per-line one: a macro body is a
   * continuation of its `gcode:` key, so `M117 done: yes` there is G-code and
   * not a key. A parser that read each line alone colours the first of those as
   * a property and loses the rest.
   */
  it('reads a macro body as its key’s continuation, not as keys of its own', () => {
    const parent = render('[gcode_macro PARK]\ngcode:\n  M117 done: yes\n')

    expect(kinds(parent, 'key')).toEqual(['gcode:'])
    expect(kinds(parent, 'gcode')).toContain('M117')
  })

  /**
   * A blank line inside a `gcode:` block keeps that block open, the way
   * configparser reads it — and CodeMirror never hands an empty line to the
   * tokenizer, so the state has to be carried across it explicitly.
   */
  it('keeps a value block open across the blank lines inside it', () => {
    const parent = render('[gcode_macro PARK]\ngcode:\n  G90\n\n  G91\n')

    expect(kinds(parent, 'key')).toEqual(['gcode:'])
    expect(kinds(parent, 'gcode')).toEqual(expect.arrayContaining(['G90', 'G91']))
  })

  it('ends a value block at the next section header', () => {
    const parent = render('[gcode_macro PARK]\ngcode:\n  G90\n[printer]\nkinematics: corexy\n')

    expect(kinds(parent, 'section')).toEqual(['[gcode_macro PARK]', '[printer]'])
    expect(kinds(parent, 'key')).toEqual(['gcode:', 'kinematics:'])
  })
})
