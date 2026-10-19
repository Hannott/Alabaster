import { beforeEach, describe, expect, it } from 'vitest'

import {
  defaultTooltipPreferences,
  useTooltipPreferences,
} from '@/composables/useTooltipPreferences'

describe('tooltip preferences', () => {
  const tooltips = useTooltipPreferences()

  beforeEach(() => {
    tooltips.reset()
  })

  it('defaults to a 280 ms animation after a 300 ms hover', () => {
    expect(tooltips.preferences.value).toEqual({ animate: true, durationMs: 280, delayMs: 300 })
    expect(defaultTooltipPreferences.durationMs).toBe(280)
  })

  it('persists every change locally', () => {
    tooltips.setAnimate(false)
    tooltips.setDurationMs(900)
    tooltips.setDelayMs(0)

    expect(JSON.parse(localStorage.getItem('alabaster.tooltips') ?? '')).toEqual({
      animate: false,
      durationMs: 900,
      delayMs: 0,
    })
  })

  it('clamps typed values into range and keeps the old one for non-numbers', () => {
    tooltips.setDurationMs(1)
    expect(tooltips.preferences.value.durationMs).toBe(60)
    tooltips.setDurationMs(999999)
    expect(tooltips.preferences.value.durationMs).toBe(5000)
    tooltips.setDelayMs(-5)
    expect(tooltips.preferences.value.delayMs).toBe(0)
    tooltips.setDelayMs(Number.NaN)
    expect(tooltips.preferences.value.delayMs).toBe(0)
  })

  it('repairs a hand-edited bundle instead of rejecting it', () => {
    tooltips.replace({ animate: 'yes', durationMs: 120.4, delayMs: 'soon' })
    expect(tooltips.preferences.value).toEqual({ animate: true, durationMs: 120, delayMs: 300 })
  })
})
