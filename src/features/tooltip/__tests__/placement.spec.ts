import { describe, expect, it } from 'vitest'

import { placeTooltip } from '@/features/tooltip/placement'

const box = { width: 120, height: 30 }

describe('placeTooltip', () => {
  it('opens above the pointer when there is room', () => {
    const placement = placeTooltip({ x: 500, y: 400 }, box, 1920)
    expect(placement.side).toBe('above')
    expect(placement.anchorY).toBeLessThan(400)
    expect(placement.shift).toBe(0)
  })

  it('flips below, clear of the cursor, near the top edge', () => {
    const placement = placeTooltip({ x: 500, y: 20 }, box, 1920)
    expect(placement.side).toBe('below')
    expect(placement.anchorY).toBeGreaterThan(20)
  })

  it('slides right when the box would leave the left edge', () => {
    const placement = placeTooltip({ x: 10, y: 400 }, box, 1920)
    expect(placement.anchorX).toBe(10)
    expect(placement.shift).toBe(8 - (10 - 60))
  })

  it('slides left when the box would leave the right edge', () => {
    const placement = placeTooltip({ x: 1915, y: 400 }, box, 1920)
    expect(placement.shift).toBe(-(1915 + 60 - (1920 - 8)))
  })
})
