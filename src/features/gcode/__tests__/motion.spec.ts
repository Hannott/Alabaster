import { describe, expect, it } from 'vitest'

import { SmoothToolheadPosition } from '@/features/gcode/motion'

describe('SmoothToolheadPosition', () => {
  it('keeps moving between sparse samples and converges without snapping', () => {
    const position = new SmoothToolheadPosition()
    position.setTarget([0, 0, 0], 0)
    position.setTarget([20, 10, 2], 250)

    const first = position.step(266)
    expect(first.moving).toBe(true)
    expect(first.position[0]).toBeGreaterThan(0)
    expect(first.position[0]).toBeLessThan(20)

    let latest = first
    for (let time = 282; time <= 1_500; time += 16) latest = position.step(time)
    expect(latest.position[0]).toBeCloseTo(20, 2)
    expect(latest.position[1]).toBeCloseTo(10, 2)
    expect(latest.position[2]).toBeCloseTo(2, 2)
  })

  it('snaps after a stale sample instead of animating through unknown printer state', () => {
    const position = new SmoothToolheadPosition()
    position.setTarget([0, 0, 0], 0)
    position.setTarget([5, 5, 5], 2_000)

    expect(position.value()).toEqual([5, 5, 5])
  })
})
