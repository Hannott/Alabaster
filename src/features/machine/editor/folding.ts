/**
 * Folding, wired to the format rules in `../folding.ts`.
 *
 * CodeMirror's own folding is driven by a syntax tree, which a stream parser
 * does not produce, so the ranges come from a fold service instead — a function
 * CodeMirror calls with one line at a time, for the lines it is about to draw.
 * That is also why the rules take a reader rather than an array: the service is
 * asked again on every repaint.
 */

import { codeFolding, foldGutter, foldKeymap, foldService } from '@codemirror/language'
import type { EditorState, Extension, Text } from '@codemirror/state'
import { keymap } from '@codemirror/view'

import { foldableRangeAt, type LineReader } from '@/features/machine/folding'

/** Reads a CodeMirror document by line without copying it. */
export function documentLineReader(doc: Text): LineReader {
  return {
    count: doc.lines,
    text: (index) => (index >= 0 && index < doc.lines ? doc.line(index + 1).text : undefined),
  }
}

export interface MachineFoldingOptions {
  /**
   * The label standing in for the hidden lines, given how many there are.
   * CodeMirror's default is a bare `…`, which says something is hidden but not
   * how much — and how much is the whole question when what is folded is a
   * macro body of unknown length. Without the count the only way to find out
   * is to unfold, which is what the fold was for.
   */
  placeholder: (lines: number) => string
  /** Titles for the gutter controls. */
  foldLabel: string
  unfoldLabel: string
}

export function machineFolding(options: MachineFoldingOptions): Extension {
  return [
    foldService.of((state: EditorState, lineStart: number) => {
      const line = state.doc.lineAt(lineStart)
      const range = foldableRangeAt(documentLineReader(state.doc), line.number - 1)
      if (!range) return null
      /*
       * The fold starts at the end of its own line rather than at the start of
       * the next one, so the line carrying the control keeps all of its text
       * and the placeholder sits after it instead of replacing part of it.
       */
      return { from: line.to, to: state.doc.line(range.endLine + 1).to }
    }),
    codeFolding({
      preparePlaceholder: (state, range) =>
        state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number,
      placeholderDOM: (_view, onclick, prepared) => {
        const element = document.createElement('span')
        element.className = 'machine-fold-placeholder'
        element.textContent = options.placeholder(typeof prepared === 'number' ? prepared : 0)
        element.title = options.unfoldLabel
        element.onclick = onclick
        return element
      },
    }),
    foldGutter({
      markerDOM: (open) => {
        const element = document.createElement('span')
        element.className = `machine-fold-marker machine-fold-marker--${open ? 'open' : 'closed'}`
        element.textContent = open ? '▾' : '▸'
        element.title = open ? options.foldLabel : options.unfoldLabel
        return element
      },
    }),
    keymap.of(foldKeymap),
  ]
}
