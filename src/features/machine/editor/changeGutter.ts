/**
 * The margin marks saying which lines differ from disk, as a CodeMirror gutter.
 *
 * What a mark means, and the three-baseline arithmetic behind it, stays in
 * `../lineChanges.ts`; this file only renders what that returns. The marks
 * arrive through a state effect rather than being recomputed inside the editor,
 * because the baselines live in the file buffer and the editor is not the only
 * writer of it — Quick config edits the same buffer from the other view.
 */

import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { gutter, GutterMarker } from '@codemirror/view'

import { NO_LINE_CHANGE_MARKS, type LineChangeMarks } from '@/features/machine/lineChanges'

export const setLineChanges = StateEffect.define<LineChangeMarks>()

const lineChangeField = StateField.define<LineChangeMarks>({
  create: () => NO_LINE_CHANGE_MARKS,
  update(marks, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setLineChanges)) return effect.value
    }
    return marks
  },
})

/** The words each mark carries on hover, so this module needs no locale of its own. */
export interface LineChangeLabels {
  changedUnsaved: string
  changedSaved: string
  removedUnsaved: string
  removedSaved: string
}

class ChangeMarker extends GutterMarker {
  constructor(
    private readonly change: string | null,
    private readonly removedAbove: string | null,
    private readonly removedBelow: string | null,
    private readonly labels: LineChangeLabels,
  ) {
    super()
  }

  override eq(other: ChangeMarker): boolean {
    return (
      this.change === other.change &&
      this.removedAbove === other.removedAbove &&
      this.removedBelow === other.removedBelow
    )
  }

  override toDOM(): HTMLElement {
    const host = document.createElement('div')
    host.className = 'machine-line-marks'
    if (this.change) {
      host.append(
        this.mark(
          `machine-line-mark machine-line-mark--change machine-line-mark--${this.change}`,
          this.change === 'unsaved' ? this.labels.changedUnsaved : this.labels.changedSaved,
        ),
      )
    }
    if (this.removedAbove) {
      host.append(
        this.mark(
          `machine-line-mark machine-line-mark--removed machine-line-mark--${this.removedAbove}`,
          this.removedAbove === 'unsaved' ? this.labels.removedUnsaved : this.labels.removedSaved,
        ),
      )
    }
    if (this.removedBelow) {
      host.append(
        this.mark(
          `machine-line-mark machine-line-mark--removed machine-line-mark--removed-below machine-line-mark--${this.removedBelow}`,
          this.removedBelow === 'unsaved' ? this.labels.removedUnsaved : this.labels.removedSaved,
        ),
      )
    }
    return host
  }

  private mark(className: string, title: string): HTMLElement {
    const element = document.createElement('span')
    element.className = className
    element.title = title
    return element
  }
}

export function machineChangeGutter(labels: LineChangeLabels): Extension {
  return [
    lineChangeField,
    gutter({
      class: 'machine-change-gutter',
      lineMarker(view, block) {
        const marks = view.state.field(lineChangeField)
        if (marks === NO_LINE_CHANGE_MARKS) return null
        const line = view.state.doc.lineAt(block.from).number - 1
        const change = marks.changed.get(line) ?? null
        const removedAbove = marks.removedAbove.get(line) ?? null
        /*
         * A deletion that took the end of the file has no line below it to be
         * carried by, so the last line carries it on its lower edge. Without
         * this the one edit that leaves no text behind leaves no mark at all.
         */
        const removedBelow =
          line === view.state.doc.lines - 1
            ? (marks.removedAbove.get(view.state.doc.lines) ?? null)
            : null
        if (!change && !removedAbove && !removedBelow) return null
        return new ChangeMarker(change, removedAbove, removedBelow, labels)
      },
      /*
       * Without this the gutter is only asked for markers on lines the last
       * transaction touched, and a save — which changes no text at all, only
       * the baseline every line is compared against — would repaint nothing.
       */
      lineMarkerChange: (update) =>
        update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(setLineChanges)),
        ),
    }),
  ]
}
