import { computed, ref } from 'vue'

/**
 * Native HTML5 drag-and-drop for files dragged in from outside the browser —
 * the same mechanism, for the same reason, as the File Explorer's own drop
 * zone in `ConfigurationView.vue`: only the native API delivers files
 * dragged in from the desktop, so this stays separate from
 * `useDashboardCardDrag`'s pointer-events reordering. See
 * `docs/design/interface-standards.md`'s "Two drag mechanisms" note.
 *
 * `depth` counts nested `dragenter`/`dragleave` pairs rather than toggling a
 * boolean, because the browser fires `dragleave` on every child element the
 * pointer crosses while still inside the drop zone as a whole — without the
 * counter, moving over any nested element would flicker the active state off.
 */
export interface UseExternalFileDropOptions {
  /** Checked on every drag event; a drop already in flight refuses another. */
  canDrop?: () => boolean
  /** Called once per drop, with whatever files that drop carried. */
  onDrop: (files: File[]) => void | Promise<void>
}

export function useExternalFileDrop(options: UseExternalFileDropOptions) {
  const depth = ref(0)
  const isActive = computed(() => depth.value > 0)

  function isExternalFileDrag(event: DragEvent): boolean {
    return Boolean(event.dataTransfer?.types.includes('Files'))
  }

  function accepts(): boolean {
    return options.canDrop ? options.canDrop() : true
  }

  function onDragEnter(event: DragEvent): void {
    if (!isExternalFileDrag(event) || !accepts()) return
    event.preventDefault()
    depth.value += 1
  }

  function onDragOver(event: DragEvent): void {
    if (!isExternalFileDrag(event) || !accepts()) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  function onDragLeave(event: DragEvent): void {
    if (!isExternalFileDrag(event)) return
    depth.value = Math.max(0, depth.value - 1)
  }

  async function onDrop(event: DragEvent): Promise<void> {
    if (!isExternalFileDrag(event)) return
    event.preventDefault()
    depth.value = 0
    if (!accepts()) return
    const files = [...(event.dataTransfer?.files ?? [])]
    if (files.length > 0) await options.onDrop(files)
  }

  return { isActive, onDragEnter, onDragOver, onDragLeave, onDrop }
}
