import { describe, expect, it } from 'vitest'

import { collapsedTabRow, packTabRows } from '@/features/machine/tabRows'

describe('packTabRows', () => {
  it('fills each row in order before starting the next', () => {
    expect(packTabRows([40, 40, 40, 40, 40], 125, 5)).toEqual([[0, 1], [2, 3], [4]])
  })

  it('counts the gap between tabs, not before the first', () => {
    expect(packTabRows([60, 60], 125, 5)).toEqual([[0, 1]])
    expect(packTabRows([60, 60], 124, 5)).toEqual([[0], [1]])
  })

  it('gives a tab wider than the well a row of its own', () => {
    expect(packTabRows([300, 40], 100, 5)).toEqual([[0], [1]])
  })

  it('packs nothing into no rows', () => {
    expect(packTabRows([], 100, 5)).toEqual([])
  })
})

describe('collapsedTabRow', () => {
  const widths = [40, 40, 40, 40, 40, 40]
  const rows = packTabRows(widths, 130, 5)

  it('shows every tab when there is only one row to begin with', () => {
    expect(collapsedTabRow([[0, 1]], [40, 40], 1, 130, 5, 20)).toEqual({
      visible: [0, 1],
      folded: 0,
    })
  })

  it('makes room for the folded count', () => {
    expect(collapsedTabRow(rows, widths, 0, 130, 5, 20)).toEqual({ visible: [0, 1], folded: 4 })
    expect(collapsedTabRow(rows, widths, 0, 100, 5, 20)).toEqual({ visible: [0], folded: 5 })
  })

  it('brings a folded active tab into the last slot', () => {
    expect(collapsedTabRow(rows, widths, 4, 130, 5, 20)).toEqual({ visible: [0, 4], folded: 4 })
  })

  it('keeps the active tab even when nothing else fits', () => {
    expect(collapsedTabRow(rows, widths, 5, 50, 5, 20)).toEqual({ visible: [5], folded: 5 })
  })
})
