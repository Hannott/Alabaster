/**
 * Marks of the explorer's search query inside the open file: a tint across each
 * matching line and a mark on each matched word.
 *
 * Only the lines on screen are decorated, so a query never costs more than the
 * viewport regardless of file size. The mark is a wash plus an underline rather
 * than a text colour: the syntax palette spans green, blue, orange, purple and
 * red, and no single override reads over a solid fill for all of them at once —
 * an underline only has to clear the page, never whatever colour the matched
 * text already is.
 */

import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'

export const setSearchQuery = StateEffect.define<string>()

const searchQueryField = StateField.define<string>({
  create: () => '',
  update(query, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSearchQuery)) return effect.value
    }
    return query
  },
})

const matchMark = Decoration.mark({ class: 'machine-syntax-match' })
const matchedLine = Decoration.line({ class: 'machine-code-line--search-match' })

function buildDecorations(view: EditorView): DecorationSet {
  const query = view.state.field(searchQueryField)
  if (!query) return Decoration.none
  const needle = query.toLowerCase()
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    let line = view.state.doc.lineAt(from)
    while (line.from <= to) {
      const haystack = line.text.toLowerCase()
      let index = haystack.indexOf(needle)
      if (index >= 0) builder.add(line.from, line.from, matchedLine)
      while (index >= 0) {
        builder.add(line.from + index, line.from + index + needle.length, matchMark)
        index = haystack.indexOf(needle, index + needle.length)
      }
      if (line.to >= view.state.doc.length) break
      line = view.state.doc.lineAt(line.to + 1)
    }
  }
  return builder.finish()
}

export const machineSearchMarks: Extension = [
  searchQueryField,
  ViewPlugin.define(
    (view) => ({
      decorations: buildDecorations(view),
      update(update: ViewUpdate) {
        const queried = update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(setSearchQuery)),
        )
        if (update.docChanged || update.viewportChanged || queried) {
          this.decorations = buildDecorations(update.view)
        }
      },
    }),
    { decorations: (plugin) => plugin.decorations },
  ),
]
