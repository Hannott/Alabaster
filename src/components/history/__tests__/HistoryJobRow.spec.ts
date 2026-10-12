import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, ref, type ComponentPublicInstance } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'

import HistoryJobRow from '@/components/history/HistoryJobRow.vue'
import { useActionGuard } from '@/composables/useActionGuard'
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
    details: {
      estimatedTime: null,
      filamentType: 'PLA',
      filamentName: null,
      filamentWeight: 8.84,
      layerHeight: null,
      objectHeight: null,
      slicer: null,
      thumbnailSmall: null,
      thumbnailLarge: null,
    },
    ...overrides,
  }
}

function rowProps(overrides: Partial<HistoryJob> = {}, selected = false) {
  return {
    job: job(overrides),
    selected,
    thumbnailUrl: null,
    time: '00:26',
    canReprint: true,
    canQueue: true,
    canDelete: true,
    reprintGuard: useActionGuard({ tier: 'terminal', emphasis: 'quiet', key: 'reprintJob' }),
    deleteGuard: useActionGuard({
      tier: 'terminal',
      emphasis: 'danger-quiet',
      key: 'deleteHistoryJob',
    }),
  }
}

describe('HistoryJobRow', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('states the outcome as a word beside its icon, never color alone', () => {
    const wrapper = mount(HistoryJobRow, {
      props: rowProps({ outcome: 'error' }),
      global: { plugins: [i18n] },
    })

    const outcome = wrapper.get('.history-job__outcome')
    expect(outcome.text()).toContain('Failed')
    expect(outcome.find('svg').exists()).toBe(true)
  })

  it('shows the file name without its folders or extension, keeping the full path reachable', () => {
    const wrapper = mount(HistoryJobRow, { props: rowProps(), global: { plugins: [i18n] } })

    expect(wrapper.get('.machine-row__name').text()).toBe('bracket_v3')
    expect(wrapper.get('.machine-row__detail').attributes('title')).toBe(
      'prints/parts/bracket_v3.gcode',
    )
  })

  it('reads the time, the print time, and the weight the slicer planned for a finished print', () => {
    const wrapper = mount(HistoryJobRow, { props: rowProps(), global: { plugins: [i18n] } })

    expect(wrapper.get('.machine-row__meta').text()).toBe('00:26 · 1h 0m · 8.8 g PLA')
  })

  it("never borrows the plan's weight for a job that stopped early, and says how it ended", () => {
    const wrapper = mount(HistoryJobRow, {
      props: rowProps({ outcome: 'interrupted', printDuration: 0, filamentUsed: 0 }),
      global: { plugins: [i18n] },
    })

    expect(wrapper.get('.machine-row__meta').text()).toBe('00:26 · Interrupted')
  })

  it('marks the open row for assistive technology, not only visually', () => {
    const wrapper = mount(HistoryJobRow, {
      props: rowProps({}, true),
      global: { plugins: [i18n] },
    })

    expect(wrapper.get('.machine-row__toggle').attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('.machine-row').classes()).toContain('machine-row--open')
  })

  it('asks the parent to open it rather than deciding for itself', async () => {
    const wrapper = mount(HistoryJobRow, { props: rowProps(), global: { plugins: [i18n] } })

    await wrapper.get('.machine-row__toggle').trigger('click')

    expect(wrapper.emitted('select')).toHaveLength(1)
  })

  it('offers print again, queue, and remove from its menu, each asked of the parent', async () => {
    const wrapper = mount(HistoryJobRow, { props: rowProps(), global: { plugins: [i18n] } })

    await wrapper.get('.machine-row__menu > .button').trigger('click')
    await wrapper.get('.history-job__queue').trigger('click')
    expect(wrapper.emitted('queue')).toHaveLength(1)

    await wrapper.get('.machine-row__menu > .button').trigger('click')
    await wrapper.get('.history-job__remove').trigger('click')
    expect(wrapper.emitted('remove')).toHaveLength(1)
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
  it('does not re-render rows whose own props did not change', async () => {
    const updates: string[] = []
    const jobs = [job({ id: 'a' }), job({ id: 'b' }), job({ id: 'c' })]
    const selectedId = ref('a')
    const unrelated = ref(0)
    const shared = rowProps()

    const host = defineComponent({
      components: { HistoryJobRow },
      setup: () => ({ jobs, selectedId, unrelated, shared }),
      template: `
        <div>
          <p>{{ unrelated }}</p>
          <HistoryJobRow
            v-for="entry in jobs"
            :key="entry.id"
            :job="entry"
            :selected="entry.id === selectedId"
            :thumbnail-url="null"
            time="00:26"
            :can-reprint="true"
            :can-queue="true"
            :can-delete="true"
            :reprint-guard="shared.reprintGuard"
            :delete-guard="shared.deleteGuard"
            @select="selectedId = entry.id"
            @reprint="unrelated += 0"
          />
        </div>
      `,
    })

    const wrapper = mount(host, {
      global: {
        plugins: [i18n],
        mixins: [
          {
            updated(this: ComponentPublicInstance) {
              const props = this.$props as { job?: HistoryJob; time?: string }
              if (props.job && props.time !== undefined) updates.push(props.job.id)
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
