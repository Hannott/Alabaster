/**
 * Alabaster's typography and surfaces for the parts of CodeMirror's DOM that
 * CodeMirror itself styles.
 *
 * This file exists for a cascade reason rather than a stylistic one, and the
 * reason is worth stating because it is not a specificity problem and cannot be
 * solved like one. `main.css` imports every stylesheet into `@layer components`
 * (or `packs`), and CodeMirror injects its base theme into the document head as
 * **unlayered** CSS when the first view is created. Unlayered declarations beat
 * layered ones outright, whatever their selectors look like — so a rule written
 * in `components.css` for `.cm-content`, `.cm-gutters` or `.cm-line` silently
 * does not apply, however many classes it is scoped through.
 *
 * What that costs is not cosmetic. The gutter sizes each line number from the
 * line height it measured, so losing the line-height declaration drifts the
 * numbers further from their lines with every row — six pixels per line, and
 * several hundred by the bottom of a short file. A previous attempt at this
 * migration was reverted over exactly this.
 *
 * Every value here is a `var()` reference, so the theme packs still own the
 * colours and the contrast spec still checks them: this file says *where* a
 * token applies, never what it is. Anything CodeMirror does not style — the
 * change marks, the fold controls, the syntax kinds, the search marks — stays
 * in `components.css`, where it has no competitor and belongs.
 */

import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

export const machineEditorTheme: Extension = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--text-primary)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--code-font-size)',
    lineHeight: '1.5rem',
    fontVariantLigatures: 'none',
  },
  '.cm-content, .cm-gutters': {
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
  },
  '.cm-content': {
    paddingBlock: '1rem',
    /*
     * The text's own colour for the caret, not the accent. A caret is one pixel
     * wide and no browser lets that be changed, so its colour is all the weight
     * it has: the accent blue measured 4.5:1 on the light code surface and
     * still read as missing, where --text-primary is 18:1 and 17:1 in dark.
     */
    caretColor: 'var(--text-primary)',
  },
  '.cm-line': {
    paddingInline: '1.2rem 0',
  },
  /*
   * The application's one selection tint rather than an override of its own.
   * The override this replaced was a white veil, invisible on a light surface.
   */
  '.cm-content ::selection, .cm-line::selection': {
    background: 'color-mix(in srgb, var(--action-primary) 35%, transparent)',
  },
  '.cm-activeLine': {
    background: 'color-mix(in srgb, var(--color-data-sky) 7%, transparent)',
  },
  '.cm-gutters': {
    borderInlineEnd: '1px solid var(--border-subtle)',
    background: 'var(--code-surface)',
    color: 'var(--text-muted)',
    userSelect: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '2.4rem',
    padding: '0 0.4rem 0 0.75rem',
  },
  /*
   * Much stronger than the code line's own active tint: the gutter has no
   * syntax colour competing for attention, so the active row needs its own
   * unmistakable marker there, not just an echo of the faint sky tint across
   * the line itself. The other gutters leave the row alone — a 3px change bar
   * and a chevron have nothing to gain from a background.
   */
  '.cm-activeLineGutter': {
    background: 'transparent',
  },
  '.cm-lineNumbers .cm-activeLineGutter': {
    background: 'color-mix(in srgb, var(--action-primary) 28%, transparent)',
    color: 'var(--text-primary)',
    fontWeight: 'var(--font-weight)',
  },
  '.cm-foldGutter .cm-gutterElement': {
    padding: '0 0.15rem',
    color: 'var(--text-muted)',
    cursor: 'pointer',
  },
})
