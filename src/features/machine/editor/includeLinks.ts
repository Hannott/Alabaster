/**
 * `[include]` paths: the mark on one that points nowhere, the tooltip naming
 * the target, and Ctrl/Cmd+click to open it.
 *
 * The paths come from the syntax tree the colouring is already built from,
 * never from a second pass over the text. Two parsers with slightly different
 * opinions about spacing or case is exactly how a link comes to appear under
 * text that is not one, and the old pixel hit test existed only because the
 * textarea sat on top of the coloured layer and always won the pointer. It
 * does not any more: these are real spans, so hover is `:hover` and the click
 * lands on the element itself.
 */

import { syntaxTree } from '@codemirror/language'
import { RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'

/** What the application knows about one include target. */
export interface IncludeTargetInfo {
  /** The resolved path, for the click handler. */
  targetPath: string
  /** The tooltip: what this link opens, or that it points nowhere. */
  title: string
  /** Confirmed to point at no file; false while the index is still loading. */
  dead: boolean
  /** Whether the folder that would hold it exists, for the create-it flow. */
  directoryExists: boolean | null
}

export interface IncludeLinkOptions {
  /**
   * What `text` — the path exactly as written in the file — resolves to, or
   * null when it is not a path this application can open. Reads the file index,
   * so it lives with the store rather than here.
   */
  describe: (text: string) => IncludeTargetInfo | null
  /** Called on Ctrl/Cmd+click over a resolvable path. */
  open: (target: IncludeTargetInfo) => void
}

/**
 * Asks for the decorations to be rebuilt although the document has not changed
 * — the file index finishing its load turns every include from "unknown" into
 * "real" or "dead", and no edit says so.
 */
export const refreshIncludeLinks = StateEffect.define<null>()

const deadMark = (title: string): Decoration =>
  Decoration.mark({ class: 'machine-syntax--includePath-dead', attributes: { title } })

const liveMark = (title: string): Decoration =>
  Decoration.mark({ class: 'machine-syntax--includePath-link', attributes: { title } })

function buildDecorations(view: EditorView, options: IncludeLinkOptions): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'includePath') return
        const text = view.state.doc.sliceString(node.from, node.to)
        const info = options.describe(text)
        if (!info) return
        builder.add(node.from, node.to, info.dead ? deadMark(info.title) : liveMark(info.title))
      },
    })
  }
  return builder.finish()
}

function targetAt(view: EditorView, position: number, options: IncludeLinkOptions) {
  const node = syntaxTree(view.state).resolveInner(position, 1)
  if (node.name !== 'includePath') return null
  return options.describe(view.state.doc.sliceString(node.from, node.to))
}

export function machineIncludeLinks(options: IncludeLinkOptions): Extension {
  return [
    ViewPlugin.define(
      (view) => ({
        decorations: buildDecorations(view, options),
        update(update: ViewUpdate) {
          const refreshed = update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(refreshIncludeLinks)),
          )
          if (update.docChanged || update.viewportChanged || refreshed) {
            this.decorations = buildDecorations(update.view, options)
          }
        },
      }),
      { decorations: (plugin) => plugin.decorations },
    ),
    EditorView.domEventHandlers({
      click(event, view) {
        if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (position === null) return false
        const target = targetAt(view, position, options)
        if (!target) return false
        event.preventDefault()
        options.open(target)
        return true
      },
    }),
  ]
}
