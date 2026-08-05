import { describe, expect, it } from 'vitest'

import { movePlacement, visibleIndexOf, type DashboardPlacement } from '@/dashboard/layout'

/**
 * `v`/`h` is visibility, the number is the column. The interesting cases are
 * all about hidden cards sitting between visible ones, so the fixtures say so
 * at a glance rather than through four-line object literals.
 */
function placements(spec: string): DashboardPlacement[] {
  return spec.split(' ').map((entry) => {
    const [instanceId, flags] = entry.split(':')
    return {
      instanceId: instanceId as string,
      column: Number(flags?.slice(1) ?? 0),
      visible: flags?.startsWith('v') ?? true,
      collapsed: false,
    }
  })
}

function ids(list: readonly DashboardPlacement[]): string[] {
  return list.map((placement) => placement.instanceId)
}

function visible(list: readonly DashboardPlacement[], column: number): string[] {
  return ids(list.filter((placement) => placement.column === column && placement.visible))
}

describe('movePlacement', () => {
  it('lands a card at the requested slot among its column siblings', () => {
    const list = placements('a:v0 b:v0 c:v0')

    expect(visible(movePlacement(list, 'desktop', 'c', { column: 0, index: 0 }), 0)).toEqual([
      'c',
      'a',
      'b',
    ])
    expect(visible(movePlacement(list, 'desktop', 'a', { column: 0, index: 1 }), 0)).toEqual([
      'b',
      'a',
      'c',
    ])
    expect(visible(movePlacement(list, 'desktop', 'a', { column: 0, index: 2 }), 0)).toEqual([
      'b',
      'c',
      'a',
    ])
  })

  it('carries the card into the column it was dropped on', () => {
    const list = placements('a:v0 b:v1 c:v1')
    const moved = movePlacement(list, 'desktop', 'a', { column: 1, index: 1 })

    expect(visible(moved, 0)).toEqual([])
    expect(visible(moved, 1)).toEqual(['b', 'a', 'c'])
  })

  /*
   * The index the drag reports counts visible cards, because that is all the
   * pointer can see. A hidden card between two of them means that number is not
   * a list index, and treating it as one puts the card in the wrong slot as
   * soon as anything is hidden — which, under the standard preset, is three of
   * the eleven modules from the very first load.
   */
  it('counts the drop index in visible cards, not list entries', () => {
    const list = placements('a:v0 hidden:h0 b:v0 c:v0')
    const moved = movePlacement(list, 'desktop', 'c', { column: 0, index: 1 })

    expect(visible(moved, 0)).toEqual(['a', 'c', 'b'])
  })

  it('keeps a hidden card beside the neighbour it was stored next to', () => {
    const list = placements('a:v0 hidden:h0 b:v0')
    const moved = movePlacement(list, 'desktop', 'b', { column: 0, index: 0 })

    // b moves ahead of a; hidden still follows a rather than being dragged
    // along or stranded at the end of the list.
    expect(ids(moved)).toEqual(['b', 'a', 'hidden'])
  })

  it('drops past the last visible card without jumping the hidden ones after it', () => {
    const list = placements('a:v0 b:v0 trailing:h0')
    const moved = movePlacement(list, 'desktop', 'a', { column: 0, index: 2 })

    expect(ids(moved)).toEqual(['b', 'a', 'trailing'])
  })

  it('joins a column whose only cards are hidden without leaving the list', () => {
    const list = placements('a:v0 tucked:h1')
    const moved = movePlacement(list, 'desktop', 'a', { column: 1, index: 0 })

    expect(ids(moved)).toEqual(['tucked', 'a'])
    expect(visible(moved, 1)).toEqual(['a'])
  })

  it('accepts an empty column as a destination', () => {
    const list = placements('a:v0 b:v0')
    const moved = movePlacement(list, 'desktop', 'b', { column: 2, index: 0 })

    expect(visible(moved, 2)).toEqual(['b'])
    expect(visible(moved, 0)).toEqual(['a'])
  })

  it('clamps an index past the end and a negative one', () => {
    const list = placements('a:v0 b:v0 c:v0')

    expect(visible(movePlacement(list, 'desktop', 'a', { column: 0, index: 99 }), 0)).toEqual([
      'b',
      'c',
      'a',
    ])
    expect(visible(movePlacement(list, 'desktop', 'c', { column: 0, index: -4 }), 0)).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('clamps the column to the viewport, so a desktop slot survives on mobile', () => {
    const list = placements('a:v0 b:v0')
    const moved = movePlacement(list, 'mobile', 'a', { column: 2, index: 0 })

    expect(moved.find((placement) => placement.instanceId === 'a')?.column).toBe(0)
  })

  it('leaves the list alone when the card is not in it', () => {
    const list = placements('a:v0 b:v0')

    expect(ids(movePlacement(list, 'desktop', 'missing', { column: 1, index: 0 }))).toEqual([
      'a',
      'b',
    ])
  })

  it('is a no-op when a card is dropped back on the slot it already holds', () => {
    const list = placements('a:v0 b:v0 c:v0')

    expect(ids(movePlacement(list, 'desktop', 'b', { column: 0, index: 1 }))).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('does not mutate the list it was given', () => {
    const list = placements('a:v0 b:v0')
    movePlacement(list, 'desktop', 'a', { column: 0, index: 1 })

    expect(ids(list)).toEqual(['a', 'b'])
  })
})

describe('visibleIndexOf', () => {
  it('counts only the visible cards of the same column', () => {
    const list = placements('a:v0 x:v1 hidden:h0 b:v0 c:v0')

    expect(visibleIndexOf(list, 'a')).toBe(0)
    expect(visibleIndexOf(list, 'b')).toBe(1)
    expect(visibleIndexOf(list, 'c')).toBe(2)
    expect(visibleIndexOf(list, 'x')).toBe(0)
  })

  it('reports the front of the column for a hidden or unknown card', () => {
    const list = placements('a:v0 hidden:h0')

    expect(visibleIndexOf(list, 'hidden')).toBe(0)
    expect(visibleIndexOf(list, 'missing')).toBe(0)
  })
})
