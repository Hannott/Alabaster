import { nextTick, ref, watch, type Ref } from 'vue'

/** Within this many pixels of the end counts as reading the newest line. */
const followThresholdPx = 24

/**
 * Keeps a scrolling log on its newest line as lines arrive, for as long as
 * the reader is at the end of it.
 *
 * A log sized by a line count rather than by its box overflowed under any
 * typeface taller than the one it was measured with — OpenDyslexic's line
 * box is a good deal taller than the monospace default — and then the line
 * that had just arrived was the one below the fold, so every run needed a
 * scroll to read. Following the end fixes that for any typeface. Scrolling
 * back to read an earlier line stops the following, so the next line does
 * not yank the reader away from it; scrolling back to the end resumes it.
 * `MachineUpdateConsoleDialog` follows its transcript the same way.
 *
 * Bind `onScroll` to the element's `scroll` event.
 */
export function useFollowingLog(element: Ref<HTMLElement | null>, size: () => number) {
  const isFollowing = ref(true)

  function scrollToEnd(): void {
    const box = element.value
    if (box) box.scrollTop = box.scrollHeight
  }

  function onScroll(): void {
    const box = element.value
    if (!box) return
    isFollowing.value = box.scrollHeight - box.scrollTop - box.clientHeight <= followThresholdPx
  }

  watch(size, async () => {
    if (!isFollowing.value) return
    await nextTick()
    scrollToEnd()
  })

  /* A log that appears — opened, or a run that starts — opens on its end. */
  watch(
    element,
    async (box) => {
      if (!box) return
      isFollowing.value = true
      await nextTick()
      scrollToEnd()
    },
    { flush: 'post' },
  )

  return { isFollowing, onScroll }
}
