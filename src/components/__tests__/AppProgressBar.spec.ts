import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AppProgressBar from '@/components/AppProgressBar.vue'

describe('AppProgressBar', () => {
  it('reports its value through the fill width and the rounded ARIA value', () => {
    const wrapper = mount(AppProgressBar, { props: { value: 33.6, label: 'Print progress' } })

    const bar = wrapper.get('[role="progressbar"]')
    expect(bar.attributes('aria-label')).toBe('Print progress')
    expect(bar.attributes('aria-valuemin')).toBe('0')
    expect(bar.attributes('aria-valuemax')).toBe('100')
    // Rounded for the ARIA value read by assistive tech, but the fill itself
    // keeps the raw fraction so a slow print still visibly advances between
    // whole percentage points.
    expect(bar.attributes('aria-valuenow')).toBe('34')
    expect(wrapper.get('.app-progress-bar__fill').attributes('style')).toContain('width: 33.6%')
  })

  it('reaches both ends of the track', () => {
    const empty = mount(AppProgressBar, { props: { value: 0, label: 'Progress' } })
    expect(empty.get('.app-progress-bar__fill').attributes('style')).toContain('width: 0%')

    const full = mount(AppProgressBar, { props: { value: 100, label: 'Progress' } })
    expect(full.get('.app-progress-bar__fill').attributes('style')).toContain('width: 100%')
  })
})
