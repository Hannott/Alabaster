import { mount } from '@vue/test-utils'
import { defineComponent, ref, type ComponentPublicInstance } from 'vue'
import { describe, expect, it } from 'vitest'

import HistoryJobRow from '@/components/history/HistoryJobRow.vue'
import { i18n } from '@/i18n'
import type { HistoryJob } from '@/stores/history'

function job(overrides: Partial<HistoryJob> = {}): HistoryJob {
  return {
    id: '1',
    filename: 'prints/parts/bracket_v3.gcode',
    outcome: 'completed',
    startedAt: 1_700_000_000,
    endedAt: 1_700_003_600,
    printDuration: 3600,
    totalDuration: 4000,
    filamentUsed: 5000,
    fileExists: true,
    auxiliaryData: [],
    ...overrides,
  }
}

describe('HistoryJobRow', () => {
  it('states the outcome as a word beside its icon, never colour alone', () => {
    const wrapper = mount(HistoryJobRow, {
      props: { job: job({ outcome: 'error' }), selected: false },
      global: { plugins: [i18n] },
    })

    const outcome = wrapper.get('.history-job__outcome')
    expect(outcome.text()).toContain('Failed')
    expect(outcome.find('svg').exists()).toBe(true)
  })

  it('shows the file name without its folders, keeping the full path reachable', () => {
    const wrapper = mount(HistoryJobRow, {
      props: { job: job(), selected: false },
      global: { plugins: [i18n] },
    })

    const name = wrapper.get('.history-job__name')
    expect(name.text()).toBe('bracket_v3.gcode')
    expect(name.attributes('title')).toBe('prints/parts/bracket_v3.gcode')
  })

  it('marks the selected row for assistive technology, not only visually', () => {
    const wrapper = mount(HistoryJobRow, {
      props: { job: job(), selected: true },
      global: { plugins: [i18n] },
    })

    expect(wrapper.get('button').attributes('aria-current')).toBe('true')
    expect(wrapper.get('button').classes()).toContain('history-job--selected')
  })

  it('reports a job with no usable timestamp rather than rendering an epoch date', () => {
    const wrapper = mount(HistoryJobRow, {
      props: { job: job({ startedAt: 0, endedAt: null }), selected: false },
      global: { plugins: [i18n] },
    })

    expect(wrapper.get('.history-job__when').text()).toBe('—')
  })

  it('asks the parent to open it rather than deciding for itself', async () => {
    const wrapper = mount(HistoryJobRow, {
      props: { job: job(), selected: false },
      global: { plugins: [i18n] },
    })

    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('select')).toHaveLength(1)
  })

  /**
   * This row exists as a component so that a change elsewhere on the page does
   * not re-render every loaded job — measured at 0.05 ms per row per change,
   * which is 49 ms for a list a user has pressed "Load more" on twenty times.
   * Vue delivers that by skipping a child whose props are unchanged, and the
   * one thing that would silently undo it is handing the row a callback prop
   * instead of listening to a declared emit: an inline handler is a new
   * function on every parent render, and only declared emit listeners are
   * exempt from the props comparison. So this asserts the property directly.
   */
  it('does not re-render rows whose own job and selection did not change', async () => {
    const updates: string[] = []
    const jobs = [job({ id: 'a' }), job({ id: 'b' }), job({ id: 'c' })]
    const selectedId = ref('a')
    const unrelated = ref(0)

    const host = defineComponent({
      components: { HistoryJobRow },
      setup: () => ({ jobs, selectedId, unrelated }),
      template: `
        <ul>
          <li>{{ unrelated }}</li>
          <li v-for="entry in jobs" :key="entry.id">
            <HistoryJobRow
              :job="entry"
              :selected="entry.id === selectedId"
              @select="selectedId = entry.id"
            />
          </li>
        </ul>
      `,
    })

    const wrapper = mount(host, {
      global: {
        plugins: [i18n],
        mixins: [
          {
            updated(this: ComponentPublicInstance) {
              const rowJob = (this.$props as { job?: HistoryJob }).job
              if (rowJob) updates.push(rowJob.id)
            },
          },
        ],
      },
    })

    // A change that touches no row at all re-renders no row.
    unrelated.value += 1
    await wrapper.vm.$nextTick()
    expect(updates).toEqual([])

    // Moving the selection re-renders only the two rows it moved between.
    selectedId.value = 'c'
    await wrapper.vm.$nextTick()
    expect([...updates].sort()).toEqual(['a', 'c'])
  })
})
