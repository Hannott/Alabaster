import { beforeEach, describe, expect, it, vi } from 'vitest'

import { moveCard } from '@/dashboard/cardMove'

function element(): HTMLElement {
  const node = document.createElement('div')
  document.body.append(node)
  return node
}

function setReducedMotion(reduce: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
}

/** Stands in for the browser finishing whichever fade is currently running. */
function finishFade(node: HTMLElement): void {
  node.dispatchEvent(new Event('transitionend'))
}

describe('card move', () => {
  beforeEach(() => {
    setReducedMotion(false)
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  it('fades the card out before moving it, and back in only once it has landed', async () => {
    const node = element()
    let movedAt: string | null = null

    const move = moveCard(node, () => (movedAt = node.style.opacity))
    await Promise.resolve()

    // Out first, and not yet moved.
    expect(node.style.opacity).toBe('0')
    expect(node.style.transition).toContain('--motion-duration-fast')
    expect(node.style.pointerEvents).toBe('none')
    expect(movedAt).toBeNull()

    finishFade(node)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // Moved while invisible, then brought back after a beat and more slowly —
    // the same delay and duration the pane uses, so the two arrive together.
    expect(movedAt).toBe('0')
    expect(node.style.opacity).toBe('1')
    expect(node.style.transition).toContain('--motion-duration-slow')
    expect(node.style.transition).toContain('--motion-duration-fast')

    finishFade(node)
    await move
    expect(node.style.opacity).toBe('')
    expect(node.style.transition).toBe('')
    expect(node.style.pointerEvents).toBe('')
  })

  it('never touches opacity under reduced motion, and still moves the card', async () => {
    setReducedMotion(true)
    const node = element()
    let moved = false

    await moveCard(node, () => (moved = true))

    expect(moved).toBe(true)
    // Collapsing the duration would apply opacity: 0 and jump straight there,
    // which is a card that blinks out rather than one that simply moves.
    expect(node.style.opacity).toBe('')
    expect(node.style.transition).toBe('')
  })

  it('still moves the card with no element or with the animation off', async () => {
    let movedA = false
    await moveCard(null, () => (movedA = true))
    expect(movedA).toBe(true)

    const node = element()
    let movedB = false
    await moveCard(node, () => (movedB = true), { animate: false })
    expect(movedB).toBe(true)
    expect(node.style.opacity).toBe('')
  })

  /*
   * Docking is a DOM move of the same element — Teleport reuses the instance — and
   * moving a scroll container to a new parent silently discards its scroll offset.
   * Measured in a browser, the move emits nothing at all: no lifecycle hook, no
   * resize (the dock matches the card's width), no scroll event. So the move
   * itself has to put the offsets back, or every scrolling module would have to
   * discover it was moved.
   */
  it('preserves scroll offsets inside the card across a move', async () => {
    const node = element()
    const scroller = document.createElement('div')
    node.append(scroller)
    // jsdom has no layout, so scrollTop is a plain property here; the assertion is
    // that the move captures and reapplies whatever it was.
    scroller.scrollTop = 400
    scroller.scrollLeft = 25

    const move = moveCard(node, () => {
      // What re-parenting does to a scroll container, which is the whole problem.
      scroller.scrollTop = 0
      scroller.scrollLeft = 0
    })
    await Promise.resolve()
    finishFade(node)
    await Promise.resolve()
    finishFade(node)
    await move

    expect(scroller.scrollTop).toBe(400)
    expect(scroller.scrollLeft).toBe(25)
  })

  it('preserves scroll offsets on the unanimated path too', async () => {
    // Reduced motion skips the fades, not the move — so it resets scroll the same
    // way and needs the same restore.
    setReducedMotion(true)
    const node = element()
    const scroller = document.createElement('div')
    node.append(scroller)
    scroller.scrollTop = 300

    await moveCard(node, () => {
      scroller.scrollTop = 0
    })

    expect(scroller.scrollTop).toBe(300)
  })

  /*
   * The settings pane used to run its own CSS transition, tuned by hand to
   * equal these same constants — which drifted out of sync in practice
   * because it was gated behind Vue's reactive prop chain rather than these
   * direct style writes. Driving it from here, at the same lines, is what
   * makes "the same timing" a property of the code instead of two authors'
   * arithmetic agreeing.
   */
  it('fades a companion out with the card, and back in only when it also arrives', async () => {
    const node = element()
    const companion = element()

    const move = moveCard(node, () => undefined, { companion, companionArrives: true })
    await Promise.resolve()

    expect(companion.style.opacity).toBe(node.style.opacity)
    expect(companion.style.transition).toBe(node.style.transition)

    finishFade(node)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(companion.style.opacity).toBe(node.style.opacity)
    expect(companion.style.transition).toBe(node.style.transition)

    finishFade(node)
    await move

    expect(companion.style.opacity).toBe('')
    expect(companion.style.transition).toBe('')
  })

  /*
   * Closing is the direction the pane does not arrive anywhere: the dialog is
   * still visually present for a beat after it closes (`allow-discrete` holds
   * it in the top layer through its own exit transition), so forcing the pane
   * back to opaque there read as a flash of empty pane reappearing rather than
   * a continuation of anything. Without `companionArrives` it fades out with
   * the card and simply stays that way.
   */
  it('leaves a companion faded out once the card returns, unless told it arrives too', async () => {
    const node = element()
    const companion = element()

    const move = moveCard(node, () => undefined, { companion })
    await Promise.resolve()
    expect(companion.style.opacity).toBe('0')

    finishFade(node)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // The card fades back in; the companion is left alone rather than forced
    // back to opaque with it.
    expect(node.style.opacity).toBe('1')
    expect(companion.style.opacity).toBe('0')

    finishFade(node)
    await move

    expect(companion.style.opacity).toBe('')
  })

  it('restores the card even if neither fade reports finishing', async () => {
    vi.useFakeTimers()
    const node = element()
    let moved = false

    const move = moveCard(node, () => (moved = true))
    // An element hidden or removed mid-move fires no transitionend; without
    // the fallback the card would be left invisible and un-clickable.
    await vi.advanceTimersByTimeAsync(900)
    await vi.advanceTimersByTimeAsync(900)
    await move

    expect(moved).toBe(true)
    expect(node.style.opacity).toBe('')
    expect(node.style.pointerEvents).toBe('')
  })
})
