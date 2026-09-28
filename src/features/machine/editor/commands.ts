/**
 * The editor's own keyboard, as CodeMirror commands.
 *
 * Every command still comes from `lineEdit.ts` and `indent.ts`, which are pure
 * and stay that way; this file only turns the `LineEdit` they return into a
 * transaction. What changed with CodeMirror is that the "one contiguous
 * replacement" rule is no longer load-bearing — a transaction is one undo step
 * however many ranges it touches — but the commands still return one, because
 * the arithmetic is tested that way and a second shape would need its own.
 */

import { Prec, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import type { Command, KeyBinding } from '@codemirror/view'

import { continuationIndent, softTabInsertion, type IndentWidth } from '@/features/machine/indent'
import {
  duplicateSelectedLines,
  indentSelection,
  moveSelectedLines,
  outdentSelection,
  reindentDocument,
  toggleComment,
  type LineEdit,
} from '@/features/machine/lineEdit'
import { isEmptyPropertyLine } from '@/features/machine/syntax'

export interface MachineCommandOptions {
  /** The reader's indent width, read fresh so a settings change lands at once. */
  indentWidth: () => IndentWidth
  /**
   * Whether the open file is Klipper's format. Every line command asserts
   * something about that format — `#` is its comment marker, a continuation
   * block is its indentation rule — so a `.json` or a `.txt` sitting in the
   * config root must not get them. This is the same predicate that decides
   * whether the file is coloured at all.
   */
  formatsKlipperConfig: () => boolean
  /** Ctrl+S and Ctrl+Alt+S; see the shortcut reference for why not Shift. */
  save: (restart: boolean) => void
  canSaveAndRestart: () => boolean
  /** Ctrl+? opens the reference, ahead of any read-only gate. */
  openShortcuts: () => void
}

function applyLineEdit(view: EditorView, edit: LineEdit | null): boolean {
  if (!edit) return false
  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.text },
    selection: { anchor: edit.selectionStart, head: edit.selectionEnd },
    scrollIntoView: true,
    userEvent: 'input.machine',
  })
  return true
}

/**
 * A command over the whole document as a string. Materialising the buffer costs
 * a copy, which is why only these explicit commands do it — never anything on
 * the typing path, where the document is read through CodeMirror's own rope.
 */
function documentCommand(
  options: MachineCommandOptions,
  edit: (content: string, start: number, end: number) => LineEdit | null,
  requiresKlipperConfig = true,
): Command {
  return (view) => {
    if (view.state.readOnly) return false
    if (requiresKlipperConfig && !options.formatsKlipperConfig()) return false
    const { from, to } = view.state.selection.main
    return applyLineEdit(view, edit(view.state.doc.toString(), from, to))
  }
}

export function machineKeymap(options: MachineCommandOptions): Extension {
  const width = () => options.indentWidth()

  /*
   * Tab over a selection that spans lines indents those lines; anywhere else it
   * inserts one soft tab, replacing the selection the way any other character
   * key would. The soft tab is not gated on the format: it moves whitespace and
   * claims nothing, and gating it would put literal tabs back into exactly the
   * files that have no reason to want them.
   */
  const insertTab: Command = (view) => {
    if (view.state.readOnly) return false
    const { from, to } = view.state.selection.main
    if (options.formatsKlipperConfig() && view.state.doc.sliceString(from, to).includes('\n')) {
      return applyLineEdit(view, indentSelection(view.state.doc.toString(), from, to, width()))
    }
    const line = view.state.doc.lineAt(from)
    const insert = softTabInsertion(line.text.slice(0, from - line.from), width())
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
      userEvent: 'input.indent',
    })
    return true
  }

  /*
   * Claimed only where there is indentation to remove. Tab already costs a
   * keyboard-only reader their way forward out of the editor; taking Shift+Tab
   * unconditionally would take the way back as well and leave no exit at all.
   */
  const outdent = documentCommand(options, (content, from, to) =>
    outdentSelection(content, from, to, width()),
  )

  /*
   * Enter carries the previous line's own leading whitespace verbatim, tabs
   * included — the preference governs what the editor inserts, never what it
   * rewrites — and adds one level only after a property with no value yet,
   * because that is a line whose next line is a continuation by Klipper's own
   * parser. On a line that is only whitespace it clears it instead, so an
   * abandoned indent does not become trailing whitespace.
   */
  const carryIndent: Command = (view) => {
    if (view.state.readOnly) return false
    const range = view.state.selection.main
    if (!range.empty) return false
    const line = view.state.doc.lineAt(range.from)
    const before = line.text.slice(0, range.from - line.from)

    if (/^\s*$/.test(before)) {
      if (!before) return false
      view.dispatch({
        changes: { from: line.from, to: range.from, insert: '\n' },
        selection: { anchor: line.from + 1 },
        userEvent: 'input',
      })
      return true
    }

    const carried = continuationIndent(before, width(), isEmptyPropertyLine(before))
    if (!carried) return false
    view.dispatch({
      changes: { from: range.from, insert: `\n${carried}` },
      selection: { anchor: range.from + 1 + carried.length },
      scrollIntoView: true,
      userEvent: 'input',
    })
    return true
  }

  const moveLines = (direction: -1 | 1): Command =>
    documentCommand(options, (content, from, to) => moveSelectedLines(content, from, to, direction))

  const duplicateLines = (direction: -1 | 1): Command =>
    documentCommand(options, (content, from, to) =>
      duplicateSelectedLines(content, from, to, direction),
    )

  const bindings: KeyBinding[] = [
    { key: 'Tab', run: insertTab },
    { key: 'Shift-Tab', run: outdent },
    { key: 'Enter', run: carryIndent },
    {
      key: 'Mod-/',
      run: documentCommand(options, (content, from, to) => toggleComment(content, from, to)),
    },
    { key: 'Alt-ArrowUp', run: moveLines(-1) },
    { key: 'Alt-ArrowDown', run: moveLines(1) },
    { key: 'Shift-Alt-ArrowUp', run: duplicateLines(-1) },
    { key: 'Shift-Alt-ArrowDown', run: duplicateLines(1) },
  ]

  /*
   * The chords whose meaning depends on Shift exactly, which a keymap cannot
   * express: CodeMirror drops the Shift modifier when the key produced a
   * character, because the character already encodes it. That is right for
   * Ctrl+/ — `/` is Shift+7 on a Norwegian layout and the comment toggle has to
   * work there — and wrong for these three, where Shift is what tells them
   * apart from a chord that must be left alone.
   */
  const chords = Prec.highest(
    EditorView.domEventHandlers({
      keydown(event, view) {
        /*
         * Ahead of the read-only gate: a file the printer will not let us write
         * is still one whose reading shortcuts apply, and a reader looking for
         * the list has no way to know the file's permissions decided whether
         * the key worked.
         *
         * Matched on the character the layout produced rather than on a
         * physical key. `?` is the shifted twin of `/` on a US layout and a
         * different key entirely on a Norwegian one.
         */
        if ((event.ctrlKey || event.metaKey) && event.key === '?') {
          event.preventDefault()
          options.openShortcuts()
          return true
        }
        /*
         * Reformatting is the one command allowed to rewrite lines the reader
         * never touched, which is why it is a named chord and nothing else:
         * never on save, never a side effect of typing. Shift+Alt+F rather than
         * Ctrl+Alt+L because some Linux desktops take that one for the lock
         * screen.
         */
        if (
          event.altKey &&
          event.shiftKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          event.key.toLowerCase() === 'f'
        ) {
          if (view.state.readOnly || !options.formatsKlipperConfig()) return false
          const { from } = view.state.selection.main
          if (!applyLineEdit(view, reindentDocument(view.state.doc.toString(), from, width()))) {
            return false
          }
          event.preventDefault()
          return true
        }
        if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return false
        /*
         * Save is Ctrl+S; save-and-restart adds Alt, not Shift. Ctrl+Shift+S is
         * claimed globally by screen-capture tools on Windows, and a global
         * hotkey is consumed before the browser sees it — so the page cannot
         * even say why nothing happened. Alt keeps the S mnemonic without being
         * one slip from a key pressed constantly in a text editor.
         *
         * Shift makes it none of ours rather than falling through to a plain
         * save: where no capture tool holds the chord, that would write a
         * half-edited config to the printer because someone reached for a
         * screenshot. The press is left un-prevented so whatever does want it
         * still gets it.
         */
        if (event.shiftKey) return false
        event.preventDefault()
        options.save(event.altKey && options.canSaveAndRestart())
        return true
      },
    }),
  )

  /*
   * Above CodeMirror's own bindings, which claim Tab, Enter, Mod-/ and the
   * Alt+arrow keys for defaults of their own.
   */
  return [chords, Prec.highest(keymap.of(bindings))]
}
