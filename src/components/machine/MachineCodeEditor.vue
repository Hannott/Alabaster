<script setup lang="ts">
/**
 * The configuration editor's text surface: one CodeMirror view, and the wiring
 * that keeps it and the file buffer agreeing.
 *
 * Everything about *what* the editor knows — how a line is coloured, what
 * folds, which lines differ from disk, what a command does — lives in
 * `features/machine/`, pure or at least free of Vue. This component owns only
 * the view's lifetime and the seam to the store, so those rules stay testable
 * without mounting anything.
 */
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { foldedRanges, indentUnit, unfoldEffect } from '@codemirror/language'
import { Compartment, EditorState, type Extension, type StateEffect } from '@codemirror/state'
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

import {
  machineChangeGutter,
  setLineChanges,
  type LineChangeLabels,
} from '@/features/machine/editor/changeGutter'
import { machineKeymap, type MachineCommandOptions } from '@/features/machine/editor/commands'
import { machineFolding } from '@/features/machine/editor/folding'
import {
  machineIncludeLinks,
  refreshIncludeLinks,
  type IncludeTargetInfo,
} from '@/features/machine/editor/includeLinks'
import { machineConfigSyntax } from '@/features/machine/editor/language'
import { machineSearchMarks, setSearchQuery } from '@/features/machine/editor/searchMarks'
import { machineEditorTheme } from '@/features/machine/editor/theme'
import type { IndentWidth } from '@/features/machine/indent'
import { NO_LINE_CHANGE_MARKS, type LineChangeMarks } from '@/features/machine/lineChanges'

export interface EditorContextMenuRequest {
  /** Where to put the menu, in client coordinates. */
  x: number
  y: number
  /** 0-based, the way `resolveEditorContext` counts. */
  line: number
  column: number
  selection: string
}

export type MachineEditorLabels = LineChangeLabels & {
  fold: string
  unfold: string
  foldedLines: (count: number) => string
}

const props = defineProps<{
  /** The file's text. Two-way, through `update:modelValue`. */
  modelValue: string
  readOnly: boolean
  /** Whether this file is Klipper's format: colouring, folding and commands. */
  formatsKlipperConfig: boolean
  indentWidth: IndentWidth
  changes: LineChangeMarks
  searchQuery: string
  contentLabel: string
  labels: MachineEditorLabels
  describeInclude: (text: string) => IncludeTargetInfo | null
  /** Bumped by the caller when `describeInclude` would answer differently. */
  includeGeneration: number
  commands: Omit<MachineCommandOptions, 'indentWidth' | 'formatsKlipperConfig'>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  cursorLine: [line: number]
  openInclude: [target: IncludeTargetInfo]
  contextMenu: [request: EditorContextMenuRequest]
}>()

const host = ref<HTMLElement | null>(null)
const view = shallowRef<EditorView | null>(null)
const language = new Compartment()
const editable = new Compartment()
const indentation = new Compartment()

/*
 * Set while the view is being reloaded from the store, so the update listener
 * does not echo that content straight back as though the reader had typed it.
 */
let applyingExternalValue = false
/*
 * A long press on a touch screen raises `contextmenu`, and a menu about what
 * was clicked is not what a tap means — the old editor declined it for the same
 * reason.
 */
let lastPointerType = ''

const machineCommands = computed<MachineCommandOptions>(() => ({
  ...props.commands,
  indentWidth: () => props.indentWidth,
  formatsKlipperConfig: () => props.formatsKlipperConfig,
}))

/**
 * Whether this editor answers a right-click with Alabaster's own menu.
 *
 * Only on a file it can say something about: a log, a `.json` or a `.txt`
 * keeps the browser's menu, since there is nothing Klipper-specific to offer
 * there and replacing it would cost those files their Paste. Shift is left
 * alone for the same reason — over plain HTTP a page can cut and copy but never
 * read the clipboard, so the browser's menu has to stay one gesture away. Touch
 * keeps the native long-press, whose selection handles and paste bubble are the
 * editing tools on a phone.
 */
function claimsContextMenu(event: MouseEvent): boolean {
  if (!props.formatsKlipperConfig) return false
  return !event.shiftKey && lastPointerType !== 'touch'
}

/**
 * Where the caret is on screen, for a menu opened from the keyboard.
 *
 * The measurement is guarded rather than trusted: it answers null for a
 * position outside the rendered viewport, and it throws outright where nothing
 * is laid out at all. Neither is a reason for the Menu key to do nothing, so
 * the editor's own corner stands in.
 */
function caretCoords(editorView: EditorView, position: number): { x: number; y: number } {
  const fallback = editorView.dom.getBoundingClientRect()
  try {
    const coords = editorView.coordsAtPos(position)
    if (coords) return { x: coords.left, y: coords.bottom }
  } catch {
    // Measured nothing; the fallback below is the answer.
  }
  return { x: fallback.left, y: fallback.top }
}

function requestContextMenu(editorView: EditorView, position: number, x: number, y: number): void {
  const line = editorView.state.doc.lineAt(position)
  const { from, to } = editorView.state.selection.main
  emit('contextMenu', {
    x,
    y,
    line: line.number - 1,
    column: position - line.from,
    selection: editorView.state.doc.sliceString(from, to),
  })
}

/*
 * Both halves of read-only, reconfigured together: `editable` is what stops the
 * browser typing into the contenteditable, and the `readOnly` facet is what the
 * commands ask before they act. Setting only the first leaves every line
 * command working on a file the printer will not let us write.
 */
function readOnlyExtensions(readOnly: boolean): Extension {
  return [EditorView.editable.of(!readOnly), EditorState.readOnly.of(readOnly)]
}

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      machineEditorTheme,
      machineChangeGutter(props.labels),
      lineNumbers(),
      machineFolding({
        placeholder: props.labels.foldedLines,
        foldLabel: props.labels.fold,
        unfoldLabel: props.labels.unfold,
      }),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      history(),
      machineSearchMarks,
      machineIncludeLinks({
        describe: (text) => props.describeInclude(text),
        open: (target) => emit('openInclude', target),
      }),
      machineKeymap(machineCommands.value),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      language.of(props.formatsKlipperConfig ? machineConfigSyntax : []),
      editable.of(readOnlyExtensions(props.readOnly)),
      indentation.of(indentUnit.of(' '.repeat(props.indentWidth))),
      /*
       * Chrome is not a text-selection surface in this application and does not
       * answer a right-click; both are defaults set once in main.css and
       * useContextMenuGuard, and a surface whose text the reader has a reason
       * to copy out opts back in with this class. A config file is the plainest
       * case of that, and the guard also reads the class to decide where the
       * browser's own menu — the only way to paste on some platforms — survives.
       */
      EditorView.contentAttributes.of({ class: 'selectable' }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !applyingExternalValue) {
          emit('update:modelValue', update.state.doc.toString())
        }
        if (update.selectionSet || update.docChanged) {
          emit('cursorLine', update.state.doc.lineAt(update.state.selection.main.head).number)
        }
      }),
      EditorView.domEventHandlers({
        pointerdown: (event) => {
          lastPointerType = event.pointerType
          return false
        },
        contextmenu: (event, editorView) => {
          if (!claimsContextMenu(event)) return false
          const position = editorView.posAtCoords({ x: event.clientX, y: event.clientY })
          if (position === null) return false
          event.preventDefault()
          requestContextMenu(editorView, position, event.clientX, event.clientY)
          return true
        },
        /*
         * The keyboard's own way to the menu. It is handled here rather than at
         * window level so it reaches the menu only while the editor has focus,
         * and so the caret — not a pointer that may be anywhere — decides what
         * the menu is about.
         */
        keydown: (event, editorView) => {
          if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return false
          if (!props.formatsKlipperConfig) return false
          const position = editorView.state.selection.main.head
          const { x, y } = caretCoords(editorView, position)
          event.preventDefault()
          requestContextMenu(editorView, position, x, y)
          return true
        },
      }),
    ],
  })
}

onMounted(() => {
  if (!host.value) return
  view.value = new EditorView({ state: createState(props.modelValue), parent: host.value })
  pushChanges()
  pushSearchQuery()
})

onBeforeUnmount(() => {
  view.value?.destroy()
  view.value = null
})

function pushChanges(): void {
  view.value?.dispatch({ effects: setLineChanges.of(props.changes ?? NO_LINE_CHANGE_MARKS) })
}

function pushSearchQuery(): void {
  view.value?.dispatch({ effects: setSearchQuery.of(props.searchQuery) })
}

/*
 * The store is the one source of truth for a file's text, and it has a second
 * writer: Quick config edits the same buffer from the other view. Text that
 * arrives from there is applied as a transaction rather than by rebuilding the
 * state, so this file's undo history survives an edit made next door — which is
 * the thing the old textarea could not do, since assigning its value wiped the
 * browser's undo stack outright.
 */
watch(
  () => props.modelValue,
  (value) => {
    const editorView = view.value
    if (!editorView || editorView.state.doc.toString() === value) return
    applyingExternalValue = true
    try {
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: value },
        selection: { anchor: Math.min(editorView.state.selection.main.anchor, value.length) },
      })
    } finally {
      applyingExternalValue = false
    }
  },
)

watch(() => props.changes, pushChanges)
watch(() => props.searchQuery, pushSearchQuery)
watch(
  () => props.includeGeneration,
  () => view.value?.dispatch({ effects: refreshIncludeLinks.of(null) }),
)
watch(
  () => props.formatsKlipperConfig,
  (formats) =>
    view.value?.dispatch({
      effects: language.reconfigure(formats ? machineConfigSyntax : []),
    }),
)
watch(
  () => props.readOnly,
  (value) => view.value?.dispatch({ effects: editable.reconfigure(readOnlyExtensions(value)) }),
)
watch(
  () => props.indentWidth,
  (width) =>
    view.value?.dispatch({ effects: indentation.reconfigure(indentUnit.of(' '.repeat(width))) }),
)

/**
 * Puts the caret on `line` (1-based) and scrolls it into view with two lines of
 * lead-in, so it lands under something rather than against the top edge.
 *
 * A target inside a collapsed range is unfolded first. Scrolling to a line the
 * reader cannot see would otherwise land silently on the fold's placeholder and
 * look like the command had done nothing.
 */
function revealLine(line: number): void {
  const editorView = view.value
  if (!editorView) return
  const target = editorView.state.doc.line(Math.min(Math.max(1, line), editorView.state.doc.lines))
  const unfold: StateEffect<unknown>[] = []
  const folded = foldedRanges(editorView.state)
  folded.between(target.from, target.to, (from, to) => {
    unfold.push(unfoldEffect.of({ from, to }))
  })
  editorView.focus()
  editorView.dispatch({
    selection: { anchor: target.from },
    effects: [
      ...unfold,
      EditorView.scrollIntoView(target.from, {
        y: 'start',
        yMargin: 2 * editorView.defaultLineHeight,
      }),
    ],
  })
}

/** Selects a document range and brings it into view, for the editor menu. */
function selectRange(from: number, to: number): void {
  const editorView = view.value
  if (!editorView) return
  editorView.focus()
  editorView.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true })
}

defineExpose({
  focus: () => view.value?.focus(),
  revealLine,
  selectRange,
  view: () => view.value,
})
</script>

<template>
  <div ref="host" class="machine-code-editor" role="group" :aria-label="contentLabel"></div>
</template>
