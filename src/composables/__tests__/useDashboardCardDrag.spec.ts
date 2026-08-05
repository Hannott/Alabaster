import { describe, expect, it } from 'vitest'

import { columnAt, resolveDropTarget } from '@/composables/useDashboardCardDrag'

interface Box {
  left: number
  right: number
  top: number
  height: number
}

function stub(element: HTMLElement, box: Box): HTMLElement {
  element.getBoundingClientRect = () =>
    ({
      left: box.left,
      right: box.right,
      width: box.right - box.left,
      top: box.top,
      bottom: box.top + box.height,
      height: box.height,
      x: box.left,
      y: box.top,
      toJSON: () => ({}),
    }) as DOMRect
  return element
}

/**
 * A column of cards at known heights. jsdom lays nothing out, so every rect the
 * hit test reads is stated here — which is also what makes the boundary cases
 * legible: a card at top 0 height 100 has its midpoint at exactly 50.
 */
function column(box: Box, cards: { id: string; top: number; height: number }[]): HTMLElement {
  const element = stub(document.createElement('div'), box)
  for (const card of cards) {
    const article = document.createElement('article')
    article.dataset.instanceId = card.id
    element.append(stub(article, { left: box.left, right: box.right, ...card }))
  }
  return element
}

describe('columnAt', () => {
  const columns = [
    stub(document.createElement('div'), { left: 0, right: 100, top: 0, height: 800 }),
    stub(document.createElement('div'), { left: 110, right: 210, top: 0, height: 800 }),
    stub(document.createElement('div'), { left: 220, right: 320, top: 0, height: 800 }),
  ]

  it('picks the column the pointer is inside', () => {
    expect(columnAt(columns, 50)).toBe(0)
    expect(columnAt(columns, 150)).toBe(1)
    expect(columnAt(columns, 300)).toBe(2)
  })

  it('picks the nearest column in the gap between two, and past either end', () => {
    // Releasing over the gutter, or off the side of the dashboard, must still
    // land the card somewhere rather than abandoning the drag.
    expect(columnAt(columns, 104)).toBe(0)
    expect(columnAt(columns, 106)).toBe(1)
    expect(columnAt(columns, -400)).toBe(0)
    expect(columnAt(columns, 9000)).toBe(2)
  })

  it('skips a column that is not rendered', () => {
    expect(columnAt([null, columns[1]], 5)).toBe(1)
    expect(columnAt([null, undefined], 5)).toBeNull()
  })
})

describe('resolveDropTarget', () => {
  /** print, movement, console stacked 100px tall each, with the drag elsewhere. */
  function otherColumn(): HTMLElement[] {
    return [
      column({ left: 0, right: 100, top: 0, height: 800 }, [
        { id: 'print', top: 0, height: 100 },
        { id: 'movement', top: 110, height: 100 },
        { id: 'console', top: 220, height: 100 },
      ]),
    ]
  }

  it('counts the cards whose midpoint the pointer has passed', () => {
    const columns = otherColumn()

    expect(resolveDropTarget(columns, 'camera', 50, 10)?.index).toBe(0)
    expect(resolveDropTarget(columns, 'camera', 50, 49)?.index).toBe(0)
    expect(resolveDropTarget(columns, 'camera', 50, 51)?.index).toBe(1)
    expect(resolveDropTarget(columns, 'camera', 50, 165)?.index).toBe(2)
    expect(resolveDropTarget(columns, 'camera', 50, 700)?.index).toBe(3)
  })

  /*
   * The stability property the whole gesture rests on. The dragged card is
   * rendered in the slot it would land in, so resolving the pointer anywhere
   * over that card must return the index it already has — otherwise the preview
   * moves the card, the move changes the rects, and the card oscillates between
   * two slots under a motionless pointer.
   */
  it('resolves a card hovering its own slot to the slot it already holds', () => {
    const columns = [
      column({ left: 0, right: 100, top: 0, height: 800 }, [
        { id: 'print', top: 0, height: 100 },
        { id: 'dragged', top: 110, height: 100 },
        { id: 'console', top: 220, height: 100 },
      ]),
    ]

    // Anywhere within its own box, top edge to bottom edge.
    for (const y of [111, 150, 160, 200, 209]) {
      expect(resolveDropTarget(columns, 'dragged', 50, y), `y=${y}`).toEqual({
        column: 0,
        index: 1,
      })
    }
  })

  it('reports slots in the column the card has left, not the one it still sits in', () => {
    const columns = [
      column({ left: 0, right: 100, top: 0, height: 800 }, [
        { id: 'print', top: 0, height: 100 },
        { id: 'dragged', top: 110, height: 100 },
        { id: 'console', top: 220, height: 100 },
      ]),
    ]

    // Above print: the front of the column either way.
    expect(resolveDropTarget(columns, 'dragged', 50, 10)?.index).toBe(0)
    // Below console: two cards remain once the dragged one is taken out, so the
    // end of the column is index 2 and not 3.
    expect(resolveDropTarget(columns, 'dragged', 50, 700)?.index).toBe(2)
  })

  it('does not discount the dragged card when the pointer is over another column', () => {
    const columns = [
      column({ left: 0, right: 100, top: 0, height: 800 }, [
        { id: 'dragged', top: 0, height: 100 },
      ]),
      column({ left: 110, right: 210, top: 0, height: 800 }, [
        { id: 'camera', top: 0, height: 100 },
        { id: 'macros', top: 110, height: 100 },
      ]),
    ]

    // Past both midpoints in a column of two cards, none of them the dragged
    // one: the end of that column is index 2.
    expect(resolveDropTarget(columns, 'dragged', 150, 700)).toEqual({ column: 1, index: 2 })
    expect(resolveDropTarget(columns, 'dragged', 150, 5)).toEqual({ column: 1, index: 0 })
  })

  it('offers the first slot of a column holding nothing', () => {
    const columns = [
      column({ left: 0, right: 100, top: 0, height: 800 }, [
        { id: 'dragged', top: 0, height: 100 },
      ]),
      column({ left: 110, right: 210, top: 0, height: 800 }, []),
    ]

    expect(resolveDropTarget(columns, 'dragged', 150, 400)).toEqual({ column: 1, index: 0 })
  })

  it('has no target when no column is rendered', () => {
    expect(resolveDropTarget([], 'dragged', 50, 50)).toBeNull()
  })
})
