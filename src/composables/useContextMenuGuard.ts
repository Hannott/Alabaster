import { onBeforeUnmount, onMounted } from 'vue'

/**
 * Suppresses the browser's own context menu on application chrome.
 *
 * Right-clicking a jog button, a card header, or a checkbox row opens a menu
 * whose entries — Copy, Select all, Search for…, Translate — are all about text
 * the interface has already decided is not text-selection surface. It is a menu
 * with nothing in it that applies, and on a coarse pointer a long press raises
 * it over the control the user was aiming at.
 *
 * The guard is one document-level listener rather than a `@contextmenu.prevent`
 * per component, for the same reason the cursor and selection rules live at the
 * top of `main.css`: a per-component opt-in only ever covers the components
 * somebody remembered.
 *
 * What it does not touch is everything with a real menu behind it — a text
 * field, a surface marked `.selectable`, and a link, whose Open in new tab is
 * the one browser entry this application genuinely relies on. A component with
 * a context menu of its own (the File Explorer's rows) prevents the default
 * itself and opens Alabaster's chrome instead; this guard reaching the same
 * event afterwards changes nothing.
 */
const NATIVE_MENU_SURFACES = [
  // Text-bearing fields only. A checkbox, a radio, a slider, and a file picker
  // are controls whose menu is the same empty one every other control gets.
  "input:not([type='checkbox'], [type='radio'], [type='range'], [type='file'], [type='button'], [type='submit'], [type='reset'])",
  'textarea',
  '[contenteditable]:not([contenteditable="false"])',
  'a[href]',
  '.selectable',
].join(', ')

/** Exported for the guard test: the predicate is the whole of the behavior. */
export function suppressesContextMenu(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target.closest(NATIVE_MENU_SURFACES) === null
}

export function useContextMenuGuard(): void {
  function onContextMenu(event: MouseEvent): void {
    if (suppressesContextMenu(event.target)) event.preventDefault()
  }

  onMounted(() => document.addEventListener('contextmenu', onContextMenu))
  onBeforeUnmount(() => document.removeEventListener('contextmenu', onContextMenu))
}
