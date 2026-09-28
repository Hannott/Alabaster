import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

/*
 * Hover intent, not animation timing, so these are not motion tokens. The open
 * delay keeps a pointer that overshoots the editor's scrollbar onto the strip
 * from throwing the panel over the file; the close delay lets the pointer
 * cross the gap between the strip and the panel, or leave by a few pixels,
 * without the panel sliding away under it.
 */
export const AUTO_HIDE_OPEN_DELAY_MS = 150
export const AUTO_HIDE_CLOSE_DELAY_MS = 300

export interface AutoHidePanelOptions {
  /** Whether the panel is auto-hidden at all: unpinned, and on a layout that can dock it. */
  enabled: Ref<boolean>
  /** The surfaces that count as "the panel": hovering or focusing any of them keeps it open. */
  regions: () => ReadonlyArray<HTMLElement | null>
  /**
   * Something the panel started is still in progress — a context menu, a
   * drag, a dialog — whose surface lies outside the regions. Closing then
   * would pull the panel out from under the work.
   */
  busy: () => boolean
  /** Where focus goes when Escape puts the panel away from inside it. */
  returnFocus: () => HTMLElement | null
}

/**
 * Visual Studio's auto-hide tool window: a panel that slides out while the
 * pointer is over its strip or itself, or while the keyboard is inside it, and
 * slides away again once neither is true.
 *
 * Focus only holds the panel open when it is keyboard focus. A mouse click on
 * a tree row focuses that row, and holding the panel open on that alone would
 * make it stay out after the pointer left, which is exactly what the reader
 * unpinned it to avoid. A typed-in field always matches `:focus-visible`, so
 * the search box holds it open however it was reached.
 */
export function useAutoHidePanel(options: AutoHidePanelOptions) {
  const open = ref(false)
  let openTimer: ReturnType<typeof setTimeout> | undefined
  let closeTimer: ReturnType<typeof setTimeout> | undefined

  function regionElements(): HTMLElement[] {
    return options.regions().filter((element): element is HTMLElement => element !== null)
  }

  function contains(target: EventTarget | null): boolean {
    return target instanceof Node && regionElements().some((element) => element.contains(target))
  }

  function isHovered(): boolean {
    return regionElements().some((element) => element.matches(':hover'))
  }

  function hasKeyboardFocus(): boolean {
    const active = document.activeElement
    return active instanceof HTMLElement && contains(active) && active.matches(':focus-visible')
  }

  function clearTimers(): void {
    clearTimeout(openTimer)
    clearTimeout(closeTimer)
    openTimer = undefined
    closeTimer = undefined
  }

  function show(): void {
    if (!options.enabled.value) return
    clearTimers()
    open.value = true
  }

  function hide(): void {
    clearTimers()
    open.value = false
  }

  function scheduleClose(): void {
    clearTimeout(openTimer)
    openTimer = undefined
    if (!open.value || closeTimer !== undefined) return
    closeTimer = setTimeout(() => {
      closeTimer = undefined
      if (!open.value) return
      // Re-armed rather than dropped, so the panel still goes once the menu
      // or dialog that held it closes with the pointer somewhere else.
      if (isHovered() || hasKeyboardFocus() || options.busy()) scheduleClose()
      else open.value = false
    }, AUTO_HIDE_CLOSE_DELAY_MS)
  }

  /** Pointer entering the strip: opens after a moment of hover intent. */
  function onStripPointerEnter(event: PointerEvent): void {
    if (!options.enabled.value || event.pointerType === 'touch') return
    clearTimeout(closeTimer)
    closeTimer = undefined
    if (open.value || openTimer !== undefined) return
    openTimer = setTimeout(() => {
      openTimer = undefined
      show()
    }, AUTO_HIDE_OPEN_DELAY_MS)
  }

  /** Pointer entering the panel itself only ever keeps it open; a hidden panel receives none. */
  function onPanelPointerEnter(): void {
    clearTimeout(closeTimer)
    closeTimer = undefined
  }

  function onPointerLeave(event: PointerEvent): void {
    if (!options.enabled.value) return
    if (contains(event.relatedTarget)) return
    if (!open.value) {
      clearTimeout(openTimer)
      openTimer = undefined
      return
    }
    scheduleClose()
  }

  function onFocusIn(event: FocusEvent): void {
    if (!options.enabled.value) return
    if ((event.target as HTMLElement | null)?.matches?.(':focus-visible')) show()
  }

  function onFocusOut(event: FocusEvent): void {
    if (!options.enabled.value || contains(event.relatedTarget)) return
    scheduleClose()
  }

  /** A press anywhere else puts the panel away at once, as clicking into the editor does in Visual Studio. */
  function onDocumentPointerDown(event: PointerEvent): void {
    if (!open.value || contains(event.target) || options.busy()) return
    hide()
  }

  function onDocumentKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !open.value || options.busy()) return
    const hadFocus = contains(document.activeElement)
    hide()
    if (hadFocus) options.returnFocus()?.focus()
  }

  watch(open, (isOpen) => {
    if (isOpen) {
      document.addEventListener('pointerdown', onDocumentPointerDown, true)
      document.addEventListener('keydown', onDocumentKeydown)
    } else {
      document.removeEventListener('pointerdown', onDocumentPointerDown, true)
      document.removeEventListener('keydown', onDocumentKeydown)
    }
  })

  watch(options.enabled, (enabled) => {
    if (!enabled) hide()
  })

  onBeforeUnmount(() => {
    clearTimers()
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
    document.removeEventListener('keydown', onDocumentKeydown)
  })

  return {
    open,
    show,
    hide,
    onStripPointerEnter,
    onPanelPointerEnter,
    onPointerLeave,
    onFocusIn,
    onFocusOut,
  }
}
