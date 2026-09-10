import { describe, expect, it } from 'vitest'

import {
  hexToHsv,
  hsvToHex,
  isHexColor,
  normalizeHex,
  parseCssColor,
  resolveCssColor,
  rgbToHex,
} from '@/utils/color'

describe('color arithmetic', () => {
  it('normalizes what a person types into a six-digit lowercase hex', () => {
    expect(normalizeHex('#ABCDEF')).toBe('#abcdef')
    expect(normalizeHex('abcdef')).toBe('#abcdef')
    expect(normalizeHex('#fa0')).toBe('#ffaa00')
    expect(normalizeHex(' #123456 ')).toBe('#123456')
    expect(normalizeHex('chartreuse')).toBeNull()
    expect(normalizeHex('#12345')).toBeNull()

    expect(isHexColor('#fa0')).toBe(true)
    expect(isHexColor('fa0')).toBe(false)
  })

  it('round-trips a hex through HSV without drifting', () => {
    for (const hex of ['#e69f00', '#56b4e9', '#009e73', '#000000', '#ffffff', '#123456']) {
      const hsv = hexToHsv(hex)
      expect(hsv).not.toBeNull()
      expect(hsvToHex(hsv!)).toBe(hex)
    }
  })

  it('places the primaries where a hue bar expects them', () => {
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 })
    expect(hexToHsv('#00ff00')).toEqual({ h: 120, s: 1, v: 1 })
    expect(hexToHsv('#0000ff')).toEqual({ h: 240, s: 1, v: 1 })
    expect(hexToHsv('#808080')?.s).toBe(0)
  })

  it('reads the forms getComputedStyle reports', () => {
    expect(parseCssColor('rgb(230, 159, 0)')).toEqual({ r: 230, g: 159, b: 0 })
    expect(parseCssColor('rgba(86, 180, 233, 0.5)')).toEqual({ r: 86, g: 180, b: 233 })
    expect(parseCssColor('rgb(0 158 115)')).toEqual({ r: 0, g: 158, b: 115 })
    expect(parseCssColor('#0072b2')).toEqual({ r: 0, g: 114, b: 178 })
    expect(parseCssColor('var(--color-data-orange)')).toBeNull()
  })

  /*
   * The form a browser reports for anything it had to compute, which in this
   * codebase means nearly every theme token: they are built from
   * `color-mix()`. Its components are 0-to-1, not 0-to-255 — reading them as
   * bytes yields black, which is how the G-code viewer's bed grid once
   * shipped invisible on a dark background while being correct in the
   * stylesheet.
   */
  it('reads the computed color() form, whose channels are fractions', () => {
    expect(parseCssColor('color(srgb 1 1 1 / 0.56)')).toEqual({ r: 255, g: 255, b: 255 })
    const dark = parseCssColor('color(srgb 0 0.0447059 0.0698039)')
    expect(dark?.r).toBeCloseTo(0)
    expect(dark?.g).toBeCloseTo(11.4)
    expect(dark?.b).toBeCloseTo(17.8)
    // Round-tripping through a hex is the path a caller actually takes.
    expect(rgbToHex(parseCssColor('color(srgb 1 1 1 / 0.56)') ?? { r: 0, g: 0, b: 0 })).toBe(
      '#ffffff',
    )
  })

  it('resolves a literal without touching the document, and does not throw on one it cannot', () => {
    expect(resolveCssColor('#d55e00')).toEqual({ r: 213, g: 94, b: 0 })
    // jsdom has no stylesheet defining the variable, so this is the browserless answer.
    expect(resolveCssColor('var(--never-defined)')).toBeNull()
  })
})
