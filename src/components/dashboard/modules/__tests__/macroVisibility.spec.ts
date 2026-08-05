import { describe, expect, it } from 'vitest'

import { currentVisibilityState } from '@/components/dashboard/modules/macroVisibility'

describe('currentVisibilityState', () => {
  it('reads printing and paused as exclusive, and everything else as standby', () => {
    expect(currentVisibilityState(true, false)).toBe('printing')
    expect(currentVisibilityState(false, true)).toBe('paused')
    expect(currentVisibilityState(false, false)).toBe('standby')
    // Printing takes precedence over a stale paused flag, which should never
    // both be true at once, but the function still has to answer something.
    expect(currentVisibilityState(true, true)).toBe('printing')
  })
})
