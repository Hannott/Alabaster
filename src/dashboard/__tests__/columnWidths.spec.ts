import { describe, expect, it } from 'vitest'

import {
  columnWidthFractions,
  columnWidthRatios,
  columnWidthUnits,
  dashboardColumnWidthNames,
  defaultColumnWidths,
} from '@/dashboard/layout'

describe('column width geometry', () => {
  /*
   * The picker presents the names as one ladder from XS to XL, so a ratio out of
   * order would make the control lie about what it is about to do — and `normal`
   * has to stay exactly 1, because that is the ratio three equal columns were
   * laid out at before any of them could choose a width.
   */
  it('rises strictly from XS to XL, through a normal column of exactly 1', () => {
    const ratios = dashboardColumnWidthNames.map((name) => columnWidthRatios[name])

    expect(ratios).toEqual([...ratios].sort((a, b) => a - b))
    expect(new Set(ratios).size).toBe(ratios.length)
    expect(columnWidthRatios.normal).toBe(1)
  })

  it('gives every column its own track, in column order', () => {
    expect(columnWidthFractions(['xs', 'xl', 'xs'], 'desktop')).toEqual([
      columnWidthRatios.xs,
      columnWidthRatios.xl,
      columnWidthRatios.xs,
    ])
  })

  it('fills a short or missing entry with a normal column', () => {
    expect(columnWidthFractions(['xl'], 'desktop')).toEqual([
      columnWidthRatios.xl,
      columnWidthRatios.normal,
      columnWidthRatios.normal,
    ])
  })

  it('never returns more tracks than the viewport has columns', () => {
    expect(columnWidthFractions(['xl', 'xl', 'xl'], 'mobile')).toHaveLength(1)
    expect(columnWidthFractions(['xl', 'xl', 'xl'], 'tablet')).toHaveLength(2)
  })

  /*
   * The whole point of the cap: a row of narrow columns has to be worth less
   * total width than a row of normal ones, or "narrow" is only ever a statement
   * about the column beside it and three narrow columns fill the window exactly
   * like three normal ones would.
   */
  it('caps a narrow row well short of a normal row, and a wide row past it', () => {
    const narrow = columnWidthUnits(['xs', 'xs', 'xs'], 'desktop')
    const normal = columnWidthUnits(defaultColumnWidths('desktop'), 'desktop')
    const wide = columnWidthUnits(['xl', 'xl', 'xl'], 'desktop')

    expect(narrow).toBeLessThan(normal)
    expect(normal).toBeLessThan(wide)
    expect(normal).toBe(3)
  })

  it('counts a mixed row as the sum of its own columns', () => {
    expect(columnWidthUnits(['xs', 'xl', 'xs'], 'desktop')).toBeCloseTo(
      columnWidthRatios.xs * 2 + columnWidthRatios.xl,
    )
  })
})
