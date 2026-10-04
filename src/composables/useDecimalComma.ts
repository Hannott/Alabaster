import { onBeforeUnmount, onMounted } from 'vue'

/**
 * Lets a number field take a comma as its decimal separator.
 *
 * A browser decides what a `type="number"` field accepts from its own UI
 * locale, not the page's or the keyboard's. An English-language Chromium
 * swallows a typed comma outright, and Firefox lets it in and then reports the
 * whole value as empty — so a reader on a Norwegian or German layout, whose
 * numpad decimal key *is* a comma, could not type `0,4` into any field in the
 * product, and nothing on screen said why. Klipper only reads a period, so the
 * comma is rewritten into one as it is typed or pasted rather than accepted as
 * an alternative spelling the rest of the application would have to parse.
 *
 * The field stays `type="number"`: switching every field to text would cost
 * the arrow-key stepping and the numeric touch keypad to fix one character.
 * The period goes in through `insertText` because a number field exposes no
 * caret position to write at — the editing command is the one way to insert at
 * the caret, and it fires the same `input` event a keystroke does, so
 * `AppField`'s draft and every `v-model` see an ordinary edit.
 *
 * One document-level listener, for the same reason the context-menu guard is
 * one: a per-field opt-in only ever covers the fields somebody remembered.
 */

/** Exported for the test: the predicate is the whole of the targeting. */
export function isNumberField(target: EventTarget | null): target is HTMLInputElement {
  return (
    target instanceof HTMLInputElement &&
    target.type === 'number' &&
    !target.readOnly &&
    !target.disabled
  )
}

/** Exported for the test: what a pasted value becomes. */
export function withDecimalPoint(text: string): string {
  return text.replaceAll(',', '.')
}

function insertText(text: string): void {
  // Deprecated in name only — no browser has removed it, and nothing else
  // inserts at a number field's caret.
  document.execCommand('insertText', false, text)
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== ',' || event.ctrlKey || event.metaKey || event.altKey) return
  if (!isNumberField(event.target)) return
  event.preventDefault()
  insertText('.')
}

function onPaste(event: ClipboardEvent): void {
  if (!isNumberField(event.target)) return
  const text = event.clipboardData?.getData('text/plain') ?? ''
  if (!text.includes(',')) return
  event.preventDefault()
  insertText(withDecimalPoint(text.trim()))
}

export function useDecimalComma(): void {
  onMounted(() => {
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('paste', onPaste, true)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('paste', onPaste, true)
  })
}
