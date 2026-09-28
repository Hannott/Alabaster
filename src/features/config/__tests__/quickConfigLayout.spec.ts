import { describe, expect, it } from 'vitest'

import {
  arrangeQuickConfigColumns,
  moveQuickConfigCard,
  normalizeQuickConfigColumns,
  slotOf,
} from '@/features/config/quickConfigLayout'

describe('arrangeQuickConfigColumns', () => {
  it('spreads cards nobody has placed across the columns in order', () => {
    expect(arrangeQuickConfigColumns(['a', 'b', 'c', 'd'], null, 3)).toEqual([
      ['a', 'd'],
      ['b'],
      ['c'],
    ])
  })

  it('keeps every placed card where it was put, including an empty column', () => {
    expect(arrangeQuickConfigColumns(['a', 'b', 'c'], [['c', 'a'], [], ['b']], 3)).toEqual([
      ['c', 'a'],
      [],
      ['b'],
    ])
  })

  it('gives a newly pinned card the column with the fewest cards', () => {
    expect(arrangeQuickConfigColumns(['a', 'b', 'c', 'new'], [['a', 'b'], ['c']], 2)).toEqual([
      ['a', 'b'],
      ['c', 'new'],
    ])
  })

  it('stacks columns that no longer fit onto the last one, in order', () => {
    expect(arrangeQuickConfigColumns(['a', 'b', 'c'], [['a'], ['b'], ['c']], 2)).toEqual([
      ['a'],
      ['b', 'c'],
    ])
  })

  it('drops a stored card that is no longer pinned', () => {
    expect(arrangeQuickConfigColumns(['a'], [['gone', 'a']], 1)).toEqual([['a']])
  })
})

describe('moveQuickConfigCard', () => {
  const columns = [['a', 'b', 'c'], ['d']]

  it('puts a card under another in a different column and moves nothing else', () => {
    expect(moveQuickConfigCard(columns, 'a', { column: 1, index: 1 })).toEqual([
      ['b', 'c'],
      ['d', 'a'],
    ])
  })

  it('counts the index in the column the card has already left', () => {
    expect(moveQuickConfigCard(columns, 'a', { column: 0, index: 2 })).toEqual([
      ['b', 'c', 'a'],
      ['d'],
    ])
  })

  it('clamps a slot past the end to the end', () => {
    expect(moveQuickConfigCard(columns, 'd', { column: 0, index: 9 })).toEqual([
      ['a', 'b', 'c', 'd'],
      [],
    ])
  })
})

describe('slotOf', () => {
  it('finds a card, or null when it is not placed', () => {
    expect(slotOf([['a'], ['b', 'c']], 'c')).toEqual({ column: 1, index: 1 })
    expect(slotOf([['a']], 'x')).toBeNull()
  })
})

describe('normalizeQuickConfigColumns', () => {
  it('lower-cases, drops invalid entries and repeats, and keeps null for never arranged', () => {
    expect(normalizeQuickConfigColumns(undefined)).toBeNull()
    expect(
      normalizeQuickConfigColumns([['Printer', 'printer', 3], 'nonsense', ['printer', 'x']]),
    ).toEqual([['printer'], [], ['x']])
  })
})
