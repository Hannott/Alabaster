import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import HistoryTrendChart from '@/components/history/HistoryTrendChart.vue'
import type { HistoryBucket } from '@/features/history/statistics'
import { i18n } from '@/i18n'

function bucket(overrides: Partial<HistoryBucket> = {}): HistoryBucket {
  return {
    start: 1_700_000_000,
    end: 1_700_086_400,
    completedJobs: 0,
    notCompletedJobs: 0,
    completedFilament: 0,
    notCompletedFilament: 0,
    completedTime: 0,
    notCompletedTime: 0,
    ...overrides,
  }
}

function mountChart(buckets: HistoryBucket[], measure: 'jobs' | 'filament' | 'time' = 'jobs') {
  return mount(HistoryTrendChart, {
    props: { buckets, measure },
    global: { plugins: [i18n] },
  })
}

describe('HistoryTrendChart', () => {
  it('renders nothing for an empty bucket list rather than an empty chart', () => {
    const wrapper = mountChart([])
    expect(wrapper.find('svg').exists()).toBe(false)
  })

  it('draws one bar per bucket, stacked completed under not-completed', () => {
    const wrapper = mountChart([
      bucket({ start: 1, end: 2, completedJobs: 4, notCompletedJobs: 1 }),
      bucket({ start: 2, end: 3, completedJobs: 0, notCompletedJobs: 0 }),
    ])

    expect(wrapper.findAll('.history-trend__bar--completed')).toHaveLength(2)
    // The second, empty bucket has no not-completed segment to draw.
    expect(wrapper.findAll('.history-trend__bar--not-completed')).toHaveLength(1)
  })

  it('switches which measure it stacks when the prop changes', async () => {
    const buckets = [bucket({ completedJobs: 1, completedFilament: 9000, completedTime: 10 })]
    const wrapper = mountChart(buckets, 'jobs')
    const jobsHeight = Number(wrapper.get('.history-trend__bar--completed').attributes('height'))

    await wrapper.setProps({ measure: 'filament' })
    const filamentHeight = Number(
      wrapper.get('.history-trend__bar--completed').attributes('height'),
    )

    expect(filamentHeight).not.toBe(jobsHeight)
  })

  it('carries an accessible description naming the population, not per-bucket noise', () => {
    const wrapper = mountChart([bucket(), bucket(), bucket()])
    const label = wrapper.get('svg').attributes('aria-label')
    expect(label).toContain('3')
  })

  /**
   * A 90-day window's per-bucket totals run into the tens of thousands of
   * millimetres or seconds. `chartGeometry`'s tick ladder tops out at a step
   * of 500, so a scale left in those raw units drew hundreds of gridlines —
   * a wall of white. Scaling to metres and hours before handing the range to
   * that ladder is what keeps this to a handful.
   */
  it('keeps the axis to a handful of gridlines for filament and time, not a wall of them', () => {
    const buckets = Array.from({ length: 12 }, (_, index) =>
      bucket({
        start: index,
        end: index + 1,
        completedFilament: 8000 + index * 500,
        completedTime: 60000 + index * 3000,
      }),
    )

    const filamentWrapper = mountChart(buckets, 'filament')
    expect(filamentWrapper.findAll('.history-trend__grid').length).toBeLessThanOrEqual(6)

    const timeWrapper = mountChart(buckets, 'time')
    expect(timeWrapper.findAll('.history-trend__grid').length).toBeLessThanOrEqual(6)
  })

  it('shows a bucket detail popup on hover, in the units its own measure reads in', async () => {
    const wrapper = mountChart(
      [bucket({ completedFilament: 2500, notCompletedFilament: 500 })],
      'filament',
    )

    expect(wrapper.find('.history-trend__tooltip').exists()).toBe(false)
    await wrapper.get('.history-trend__hit').trigger('mouseenter')

    const tooltip = wrapper.get('.history-trend__tooltip')
    expect(tooltip.text()).toContain('2.5 m')
    expect(tooltip.text()).toContain('0.5 m')

    await wrapper.get('.history-trend__hit').trigger('mouseleave')
    expect(wrapper.find('.history-trend__tooltip').exists()).toBe(false)
  })

  it('keeps the detail reachable by keyboard, not only by mouse hover', async () => {
    const wrapper = mountChart([bucket({ completedJobs: 3 })])

    const hit = wrapper.get('.history-trend__hit')
    expect(hit.attributes('tabindex')).toBe('0')

    await hit.trigger('focus')
    expect(wrapper.find('.history-trend__tooltip').exists()).toBe(true)

    await hit.trigger('blur')
    expect(wrapper.find('.history-trend__tooltip').exists()).toBe(false)
  })
})
