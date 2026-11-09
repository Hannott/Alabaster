/**
 * The boolean value picker: a plain `True`/`False` option value drawn as a
 * combobox while the pointer is on it, with a chevron that opens a list of
 * both values.
 *
 * Which values qualify comes from two sources that must agree: the syntax tree
 * has to call the word a `boolean`, and `booleanOptionIn` has to find it as a
 * column-zero option's whole value. The first keeps this from ever disagreeing
 * with the colouring; the second keeps the Jinja `true` inside a macro out.
 *
 * The outline is a mark on the value's own text, so its edges come from where
 * the text is. The chevron is a zero-width widget after the value, so showing
 * it never moves anything. Both are hidden until hovered, in CSS.
 */

import { syntaxTree } from '@codemirror/language'
import { RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'

import { booleanChoices, booleanOptionIn } from '@/features/machine/booleanValue'

export interface ValuePickerRequest {
  /** The value's range in the document. */
  from: number
  to: number
  option: string
  value: string
  choices: [string, string]
  /** Where the drawn box is, in client coordinates, for placing the list under it. */
  box: { left: number; right: number; bottom: number }
}

export interface ValuePickerOptions {
  /** The chevron's accessible name, for one option. */
  label: (option: string) => string
  open: (request: ValuePickerRequest) => void
}

/** Which value's list is open, by the value's start, so its chevron says so. */
export const setOpenValuePicker = StateEffect.define<number | null>()

const valueMark = Decoration.mark({ class: 'machine-value-picker__value' })

const CHEVRON_PATH = 'm7 9 5 5 5-5'

class ChevronWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly value: string,
    readonly label: string,
    readonly expanded: boolean,
    readonly onOpen: (button: HTMLElement) => void,
  ) {
    super()
  }

  /*
   * The click handler closes over the value and its range, so a widget whose
   * value or position changed is a different widget: kept as equal, its old
   * DOM would open the list for the value before the last edit, and the edit
   * guard would then rightly refuse every choice made from it.
   */
  override eq(other: ChevronWidget): boolean {
    return (
      other.from === this.from &&
      other.value === this.value &&
      other.label === this.label &&
      other.expanded === this.expanded
    )
  }

  override toDOM(): HTMLElement {
    const anchor = document.createElement('span')
    anchor.className = 'machine-value-picker'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'text-action'
    button.tabIndex = -1
    button.setAttribute('aria-haspopup', 'listbox')
    button.setAttribute('aria-expanded', String(this.expanded))
    button.setAttribute('aria-label', this.label)
    const svgNs = 'http://www.w3.org/2000/svg'
    const icon = document.createElementNS(svgNs, 'svg')
    icon.setAttribute('viewBox', '0 0 24 24')
    icon.setAttribute('fill', 'none')
    icon.setAttribute('stroke', 'currentColor')
    icon.setAttribute('stroke-width', '1.8')
    icon.setAttribute('stroke-linecap', 'round')
    icon.setAttribute('stroke-linejoin', 'round')
    icon.setAttribute('aria-hidden', 'true')
    const path = document.createElementNS(svgNs, 'path')
    path.setAttribute('d', CHEVRON_PATH)
    icon.append(path)
    button.append(icon)
    // The editor would otherwise take the press as a caret move and steal focus.
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', (event) => {
      event.preventDefault()
      this.onOpen(button)
    })
    anchor.append(button)
    return anchor
  }

  override ignoreEvent(): boolean {
    return true
  }
}

function buildDecorations(
  view: EditorView,
  options: ValuePickerOptions,
  openAt: number | null,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  if (view.state.readOnly) return builder.finish()
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'boolean') return
        // `node` is the tree cursor itself and moves on; the click handler needs this node's range.
        const { from: valueFrom, to: valueTo } = node
        const line = view.state.doc.lineAt(valueFrom)
        const found = booleanOptionIn(line.text)
        if (!found || line.from + found.start !== valueFrom || line.from + found.end !== valueTo) {
          return
        }
        const request = (button: HTMLElement): ValuePickerRequest => {
          let valueLeft = button.getBoundingClientRect().left
          try {
            valueLeft = view.coordsAtPos(valueFrom, 1)?.left ?? valueLeft
          } catch {
            // Nothing is laid out (a hidden pane, jsdom); the list opens under the chevron.
          }
          const pad = parseFloat(getComputedStyle(button).paddingInlineStart) || 0
          const rect = button.getBoundingClientRect()
          return {
            from: valueFrom,
            to: valueTo,
            option: found.option,
            value: found.value,
            choices: booleanChoices(found.value),
            box: { left: valueLeft - pad, right: rect.right, bottom: rect.bottom },
          }
        }
        builder.add(valueFrom, valueTo, valueMark)
        builder.add(
          valueTo,
          valueTo,
          Decoration.widget({
            side: 1,
            widget: new ChevronWidget(
              valueFrom,
              found.value,
              options.label(found.option),
              openAt === valueFrom,
              (button) => options.open(request(button)),
            ),
          }),
        )
      },
    })
  }
  return builder.finish()
}

export function machineValuePicker(options: ValuePickerOptions): Extension {
  return ViewPlugin.define(
    (view) => {
      let openAt: number | null = null
      return {
        decorations: buildDecorations(view, options, openAt),
        update(update: ViewUpdate) {
          let changed = false
          for (const transaction of update.transactions) {
            for (const effect of transaction.effects) {
              if (effect.is(setOpenValuePicker)) {
                openAt = effect.value
                changed = true
              }
            }
          }
          if (
            changed ||
            update.docChanged ||
            update.viewportChanged ||
            update.startState.readOnly !== update.state.readOnly ||
            syntaxTree(update.startState) !== syntaxTree(update.state)
          ) {
            this.decorations = buildDecorations(update.view, options, openAt)
          }
        },
      }
    },
    { decorations: (plugin) => plugin.decorations },
  )
}
