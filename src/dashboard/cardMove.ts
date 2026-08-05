import { nextTick } from 'vue'

/**
 * Out quickly, then a beat of nothing, then back more slowly. The pause is the
 * part that reads as the card having gone somewhere: without it the two fades
 * run into each other and it looks like a flicker rather than a move.
 *
 * The settings pane uses the same delay and duration, so the card and its
 * settings still arrive together.
 */
const fadeOutTransition = 'opacity var(--motion-duration-fast) var(--motion-ease-standard)'
const fadeInTransition =
  'opacity var(--motion-duration-slow) var(--motion-ease-standard) var(--motion-duration-fast)'
/**
 * Longer than the delay and either fade together. `transitionend` does not
 * fire for an element that is hidden or removed mid-move, and without this the
 * card would be left permanently invisible and un-clickable.
 */
const fadeTimeoutMs = 900

/**
 * Optional-called: an environment without `matchMedia` must not take the whole
 * move down with it. Unknown means motion is allowed, which is the safe
 * default — the alternative silently disables the animation everywhere the API
 * is missing.
 */
function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/**
 * Every scroll offset inside the card, captured before the move so it can be put
 * back after it.
 *
 * Moving a scroll container to a new parent silently discards its `scrollTop`, and
 * that is the *only* consequence of the move — measured across a dock, it emits no
 * event whatsoever: no lifecycle hook, because Teleport reuses the instance rather
 * than remounting it; no resize, because the dock matches the card's width; and no
 * scroll. So nothing inside the card can notice it was moved.
 *
 * Restoring here fixes it once for every module. The alternative — each module that
 * happens to scroll being told a move happened, and re-deriving where it should be
 * — is both more code and worse, because the offset is already known and exact.
 */
type ScrollOffset = [element: Element, top: number, left: number]

function captureScrollOffsets(element: HTMLElement): ScrollOffset[] {
  return [...element.querySelectorAll('*')]
    .filter((node) => node.scrollTop > 0 || node.scrollLeft > 0)
    .map((node) => [node, node.scrollTop, node.scrollLeft])
}

function restoreScrollOffsets(offsets: readonly ScrollOffset[]): void {
  for (const [node, top, left] of offsets) {
    node.scrollTop = top
    node.scrollLeft = left
  }
}

function settle(element: HTMLElement): Promise<void> {
  return new Promise<void>((resolve) => {
    let timer = 0
    const done = (): void => {
      window.clearTimeout(timer)
      element.removeEventListener('transitionend', done)
      resolve()
    }
    timer = window.setTimeout(done, fadeTimeoutMs)
    element.addEventListener('transitionend', done)
  })
}

/**
 * Moves a card between its dashboard column and the settings dock: it fades
 * out where it stands, is moved while invisible, and fades back in where it
 * landed.
 *
 * A fade rather than a flight. Animating the travel meant animating a card
 * across the whole viewport, which read as busy rather than as continuous, and
 * it forced the dock to match the card's width so that only position changed.
 * Fading through has no such constraint and stays legible in the stacked
 * layout, where the card genuinely re-lays out rather than only moving.
 *
 * Opacity only — no transform, so there is nothing that can be left stranded.
 * The move itself always happens: every reason to skip the animation skips
 * only the animation, so a failure degrades to an instant swap rather than to
 * a card that never arrives.
 *
 * `companion` is the settings pane. It used to fade on its own CSS `[open]`
 * transition, timed to nominally match this function's constants — but that
 * left the two driven by two different mechanisms that only coincidentally
 * agreed on paper: the pane's fade is gated behind Vue's reactive prop chain
 * (this function's own `applyMove`, a watcher, then a CSS selector match),
 * one or more ticks behind this function's own direct, synchronous style
 * writes on the card. In review the card visibly finished fading before the
 * pane did, in both directions. Driving both from the exact same inline
 * style writes, at the exact same lines, is what makes them provably
 * simultaneous instead of separately-tuned.
 *
 * `companionArrives` governs only the second half. The companion always fades
 * *out* with the card, in both directions — that half of the fix is what
 * closed the original gap where the pane kept showing after the card had
 * already left. But fading it back to opaque only belongs to the direction
 * the pane is actually arriving somewhere with the card, which is opening:
 * on close the dialog is still visually present for a beat after `applyMove`
 * closes it — `allow-discrete` keeps it in the top layer through its own
 * exit transition — and forcing the pane back to `opacity: 1` during that
 * beat reappeared as a flash of empty pane, not a continuation of anything.
 * Closing has nowhere for the pane to arrive at, so it simply stays faded out.
 */
export async function moveCard(
  element: HTMLElement | null,
  applyMove: () => void,
  options: { animate?: boolean; companion?: HTMLElement | null; companionArrives?: boolean } = {},
): Promise<void> {
  const animate = options.animate ?? true
  const companion = options.companion ?? null
  const companionArrives = options.companionArrives ?? false

  /*
   * Reduced motion skips the fades outright rather than collapsing their
   * duration. main.css zeroes transition-duration globally, so a fade run
   * under it would apply opacity: 0 and jump straight there — a card that
   * blinks out and back rather than one that simply moves.
   */
  // Captured before anything moves, and restored on both paths — a move without
  // the animation resets scroll exactly the same way.
  const scrollOffsets = element ? captureScrollOffsets(element) : []

  if (!element || !animate || prefersReducedMotion()) {
    applyMove()
    await nextTick()
    restoreScrollOffsets(scrollOffsets)
    return
  }

  element.style.transition = fadeOutTransition
  element.style.opacity = '0'
  // A control fading under the pointer must not accept the press.
  element.style.pointerEvents = 'none'
  if (companion) {
    companion.style.transition = fadeOutTransition
    companion.style.opacity = '0'
  }
  await settle(element)

  applyMove()
  await nextTick()
  // Before the fade back in, so the card is never painted at the wrong offset.
  restoreScrollOffsets(scrollOffsets)

  /*
   * The card has landed, but the browser has not yet painted it there: it was
   * `display: none` inside a closed dialog a moment ago, and an element that
   * has never been painted at `opacity: 0` in its new position has nothing to
   * transition *from* — it simply appears. Reading a layout property forces
   * that state to be committed first, so the fade actually runs.
   *
   * The same DOM node throughout: Teleport moves it rather than re-creating
   * it, so the element faded out is the one that fades back in.
   */
  element.style.transition = 'none'
  if (companion && companionArrives) companion.style.transition = 'none'
  void element.offsetWidth
  element.style.transition = fadeInTransition
  element.style.opacity = '1'
  if (companion && companionArrives) {
    companion.style.transition = fadeInTransition
    companion.style.opacity = '1'
  }
  await settle(element)

  element.style.transition = ''
  element.style.opacity = ''
  element.style.pointerEvents = ''
  // Cleared either way: an arriving companion settles back to its own resting
  // `opacity: 1`, and one that stayed faded out settles to the closed dialog's
  // resting `opacity: 0` — never left holding a stale inline value either way.
  if (companion) {
    companion.style.transition = ''
    companion.style.opacity = ''
  }
}
