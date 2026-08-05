import { onBeforeUnmount, readonly, ref, type Ref } from 'vue'

import type { DashboardDropTarget } from '@/dashboard/layout'

/**
 * Pointer events rather than HTML5 drag and drop.
 *
 * The dashboard's drag never crosses the browser boundary, and three things it
 * does need are exactly the three the native API withholds: it fires nothing at
 * all for touch, so the mobile profile — the one people are most likely to want
 * reordered — could only ever be arranged with the arrow buttons; its drag image
 * is a raster snapshot taken by the OS, so the card being carried cannot follow
 * the theme or be reduced to a header; and the drop position it reports is a
 * target element rather than a slot, which is why the old implementation could
 * only drop *onto* a card and had to guess the side from the direction of
 * travel.
 *
 * The File Explorer stays on native drag and drop, because it accepts files
 * dragged in from the desktop and only the native API delivers those.
 */

/** Far enough to be a drag rather than a press that wobbled. */
const dragThresholdPx = 5
/** How close to the scroller's edge starts the auto-scroll, and how fast it can get. */
const autoScrollEdgePx = 56
const autoScrollMaxPxPerFrame = 16

export interface CardDragGhost {
  x: number
  y: number
  width: number
}

interface CardDragOptions {
  /** Column stack elements in column order; a missing one is simply not a target. */
  columns: () => (HTMLElement | null | undefined)[]
  /** The scrolling ancestor, nudged when the pointer nears its edges. */
  scroller: () => HTMLElement | null | undefined
  /** Where the card started, so a drag that ends where it began writes nothing. */
  origin: (instanceId: string) => DashboardDropTarget
  commit: (instanceId: string, target: DashboardDropTarget) => void
}

export interface CardDragSession {
  /** The card being carried, or null when nothing is being dragged. */
  instanceId: Readonly<Ref<string | null>>
  /** The slot the card would land in, which is also the slot it is rendered in. */
  target: Readonly<Ref<DashboardDropTarget | null>>
  ghost: Readonly<Ref<CardDragGhost | null>>
  begin: (event: PointerEvent, instanceId: string) => void
}

/**
 * The column under the pointer horizontally. Vertical position never chooses a
 * column: the stacks fill the grid row's height, so a pointer below the last
 * card in a short column is still inside that column's box. Outside the grid
 * entirely, the nearest column keeps the drag live rather than dropping the
 * target and snapping the card home in the middle of the gesture.
 */
export function columnAt(
  columns: readonly (HTMLElement | null | undefined)[],
  x: number,
): number | null {
  let nearest: number | null = null
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const [index, element] of columns.entries()) {
    if (!element) continue
    const rect = element.getBoundingClientRect()
    if (x >= rect.left && x <= rect.right) return index
    const distance = x < rect.left ? rect.left - x : x - rect.right
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = index
    }
  }

  return nearest
}

/**
 * The slot the pointer is over, counted in cards rather than pixels.
 *
 * The dragged card is deliberately counted with the rest. It is rendered in its
 * prospective slot, so hovering its own box resolves to the index it already
 * has and the gesture sits still. Excluding it instead makes the measurement
 * chase itself: the preview moves the card, the moved card changes every rect
 * below it, and the next frame resolves a different slot — a card that flickers
 * between two positions while the pointer is not moving at all.
 */
export function resolveDropTarget(
  columns: readonly (HTMLElement | null | undefined)[],
  draggedId: string,
  x: number,
  y: number,
): DashboardDropTarget | null {
  const column = columnAt(columns, x)
  if (column === null) return null

  const element = columns[column]
  if (!element) return null

  const cards = [...element.querySelectorAll<HTMLElement>('[data-instance-id]')]
  let index = 0
  let draggedIndex = -1

  for (const [position, card] of cards.entries()) {
    if (card.dataset.instanceId === draggedId) draggedIndex = position
    const rect = card.getBoundingClientRect()
    if (y > rect.top + rect.height / 2) index = position + 1
  }

  /*
   * `index` counts slots in a column that still contains the dragged card,
   * while the placement move counts them in a column it has already left. Past
   * the card's own position those two disagree by one.
   */
  if (draggedIndex >= 0 && index > draggedIndex) index -= 1
  return { column, index }
}

export function useDashboardCardDrag(options: CardDragOptions): CardDragSession {
  const instanceId = ref<string | null>(null)
  const target = ref<DashboardDropTarget | null>(null)
  const ghost = ref<CardDragGhost | null>(null)

  /** Set at pointerdown; the drag only becomes real once the threshold is passed. */
  let pending: {
    instanceId: string
    x: number
    y: number
    width: number
    offsetX: number
    offsetY: number
  } | null = null
  let pointer = { x: 0, y: 0 }
  let ghostOffset = { x: 0, y: 0 }
  let ghostWidth = 0
  let scrollFrame = 0

  function update(): void {
    const dragged = instanceId.value
    const next = dragged
      ? resolveDropTarget(options.columns(), dragged, pointer.x, pointer.y)
      : null
    if (next) target.value = next
    /*
     * Offset by where the card was grabbed, on both axes. Anchoring the ghost's
     * corner to the pointer instead puts it down and to the right of the hand,
     * and since the handle sits at the card's trailing edge, a card as wide as
     * its column then hangs most of its width off the screen — which on a phone
     * is most of the card.
     */
    ghost.value = {
      x: pointer.x - ghostOffset.x,
      y: pointer.y - ghostOffset.y,
      width: ghostWidth,
    }
  }

  /**
   * Reaching a column's far end means scrolling the page, not giving up on the
   * drag. Runs on its own frame loop so holding the pointer still at the edge
   * keeps scrolling, and re-resolves the slot as content passes underneath.
   */
  function autoScroll(): void {
    scrollFrame = 0
    if (instanceId.value === null) return

    const scroller = options.scroller()
    if (scroller) {
      const rect = scroller.getBoundingClientRect()
      const fromTop = pointer.y - rect.top
      const fromBottom = rect.bottom - pointer.y
      let delta = 0
      if (fromTop < autoScrollEdgePx) {
        delta = -((autoScrollEdgePx - Math.max(0, fromTop)) / autoScrollEdgePx)
      } else if (fromBottom < autoScrollEdgePx) {
        delta = (autoScrollEdgePx - Math.max(0, fromBottom)) / autoScrollEdgePx
      }

      if (delta !== 0) {
        const before = scroller.scrollTop
        scroller.scrollTop += delta * autoScrollMaxPxPerFrame
        if (scroller.scrollTop !== before) update()
      }
    }

    scrollFrame = window.requestAnimationFrame(autoScroll)
  }

  function onPointerMove(event: PointerEvent): void {
    pointer = { x: event.clientX, y: event.clientY }

    if (pending) {
      const travelled = Math.hypot(event.clientX - pending.x, event.clientY - pending.y)
      if (travelled < dragThresholdPx) return
      instanceId.value = pending.instanceId
      ghostOffset = { x: pending.offsetX, y: pending.offsetY }
      ghostWidth = pending.width
      pending = null
      scrollFrame = window.requestAnimationFrame(autoScroll)
    }

    if (instanceId.value === null) return
    // Stops a touch drag from also panning the page, and a mouse drag from
    // selecting text across the cards it passes over.
    event.preventDefault()
    update()
  }

  function finish(commit: boolean): void {
    const dragged = instanceId.value
    const slot = target.value

    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
    window.removeEventListener('keydown', onKeyDown, true)
    if (scrollFrame) window.cancelAnimationFrame(scrollFrame)
    scrollFrame = 0
    pending = null
    instanceId.value = null
    target.value = null
    ghost.value = null

    if (!commit || !dragged || !slot) return
    const origin = options.origin(dragged)
    // A drag that ends where it started is not an edit, and writing it would
    // persist the whole profile for nothing.
    if (origin.column === slot.column && origin.index === slot.index) return
    options.commit(dragged, slot)
  }

  function onPointerUp(): void {
    finish(true)
  }

  function onPointerCancel(): void {
    finish(false)
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    // Captured, so Escape abandons the drag rather than closing whatever else
    // happens to be listening for it.
    event.stopPropagation()
    event.preventDefault()
    finish(false)
  }

  function begin(event: PointerEvent, id: string): void {
    if (instanceId.value !== null || pending !== null) return
    // Secondary buttons open menus; only a primary press starts a drag.
    if (event.button !== 0 && event.pointerType === 'mouse') return

    const card =
      event.currentTarget instanceof Element
        ? event.currentTarget.closest('[data-instance-id]')
        : null
    const rect = card?.getBoundingClientRect()
    event.preventDefault()

    pointer = { x: event.clientX, y: event.clientY }
    pending = {
      instanceId: id,
      x: event.clientX,
      y: event.clientY,
      width: rect?.width ?? 0,
      // Where in the card the handle was grabbed. Keeping it means the ghost
      // appears exactly over the card it came from rather than jumping to sit
      // under the pointer's corner.
      offsetX: rect ? event.clientX - rect.left : 0,
      offsetY: rect ? event.clientY - rect.top : 0,
    }

    window.addEventListener('pointermove', onPointerMove, { passive: false })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('keydown', onKeyDown, true)
  }

  onBeforeUnmount(() => finish(false))

  return {
    instanceId: readonly(instanceId),
    target: readonly(target),
    ghost: readonly(ghost),
    begin,
  }
}
