import { describe, expect, it } from 'vitest'

import { dashboardViewportForWidth } from '@/composables/useDashboardViewport'

describe('dashboard viewport', () => {
  it('selects mobile, tablet, and desktop profiles at stable breakpoints', () => {
    expect(dashboardViewportForWidth(320)).toBe('mobile')
    expect(dashboardViewportForWidth(639)).toBe('mobile')
    expect(dashboardViewportForWidth(640)).toBe('tablet')
    expect(dashboardViewportForWidth(1023)).toBe('tablet')
    expect(dashboardViewportForWidth(1024)).toBe('desktop')
  })
})
