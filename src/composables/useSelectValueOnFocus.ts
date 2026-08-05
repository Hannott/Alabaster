import { onBeforeUnmount, onMounted } from 'vue'

/**
 * Marks all text in a value field the moment it gains focus, so replacing a
 * target temperature, a feedrate, or an acceleration limit is one click and
 * a new number rather than a click, a select-all keystroke, and a new
 * number. `focusin` only fires when focus actually moves to a new element,
 * so a click that lands on a field already focused never retriggers it and
 * places the caret at that point instead, letting correcting one digit
 * mid-edit still work. This also covers focusing a field by keyboard (Tab),
 * which a mousedown-driven check could not.
 *
 * One document-level listener rather than a per-field handler, for the same
 * reason the context-menu guard is one listener: a per-component opt-in only
 * ever covers the components somebody remembered.
 *
 * The list used to mirror `.field--value`'s grouping in `main.css` by hand, and
 * had already drifted: it still named `.temperature-target-control input` after
 * that class stopped existing in any component or stylesheet, and it named two
 * container-scoped groupings whose fields have since become one component. A
 * component carries its own class wherever it is used, so `AppField` and
 * `AppSlider` each need one entry rather than an entry per place they appear —
 * which is the drift removed rather than corrected. `.field--value` stays for
 * the bare fields that are neither: the temperature preset editor's grid cells.
 * `.module-settings__range-header input[type='number']` is gone along with the
 * hand-rolled markup it named — every slider's exact-entry field is now
 * `AppSlider`'s own.
 */
const VALUE_FIELD_SELECTOR = [
  '.app-field__input',
  '.app-slider__entry input',
  '.field--value',
].join(', ')

/** Exported for the test: the predicate is the whole of the behavior. */
export function isValueField(target: EventTarget | null): target is HTMLInputElement {
  return target instanceof HTMLInputElement && target.matches(VALUE_FIELD_SELECTOR)
}

function onFocusIn(event: FocusEvent): void {
  if (isValueField(event.target)) event.target.select()
}

export function useSelectValueOnFocus(): void {
  onMounted(() => {
    document.addEventListener('focusin', onFocusIn)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('focusin', onFocusIn)
  })
}
