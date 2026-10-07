import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import HeaderCommandQueue from '@/components/HeaderCommandQueue.vue'
import { i18n } from '@/i18n'
import { useCommandPreferencesStore } from '@/stores/commandPreferences'
import { useCommandQueueStore } from '@/stores/commandQueue'

function mountQueue() {
  return mount(HeaderCommandQueue, {
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

describe('HeaderCommandQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('stays out of the header unless the reader turned the list on', async () => {
    const wrapper = mountQueue()
    useCommandQueueStore().add('M190 S60', 'dashboard.modules.temperatures')
    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.find('button').exists()).toBe(false)
  })

  /** An ordinary jog settles in tens of milliseconds and must not flash a button in and out. */
  it('appears only once a command has waited, and lists them in send order with their state', async () => {
    useCommandPreferencesStore().setShowQueue(true)
    const wrapper = mountQueue()
    const queue = useCommandQueueStore()
    queue.add('M190 S60', 'dashboard.modules.temperatures')
    queue.add(
      'SAVE_GCODE_STATE NAME=_alabaster_movement\nG91\nG1 Z-0.1 F600\nRESTORE_GCODE_STATE NAME=_alabaster_movement',
      'dashboard.modules.movement',
    )

    await vi.advanceTimersByTimeAsync(300)
    expect(wrapper.find('button').exists()).toBe(false)

    await vi.advanceTimersByTimeAsync(500)
    const trigger = wrapper.get('button')
    expect(trigger.attributes('aria-label')).toBe('Queued commands: 2')
    await trigger.trigger('click')
    await flushPromises()

    const rows = wrapper.findAll('.header-command-queue__row')
    expect(rows.map((row) => row.get('.header-command-queue__script').text())).toEqual([
      'M190 S60',
      'G91; G1 Z-0.1 F600',
    ])
    expect(rows.map((row) => row.get('.header-command-queue__state').text())).toEqual([
      'Running',
      'Waiting',
    ])
    expect(rows[1]?.text()).toContain('Movement')
  })

  it('hides the list while the reader waits for each command', async () => {
    const preferences = useCommandPreferencesStore()
    preferences.setShowQueue(true)
    preferences.setDispatch('wait')
    const wrapper = mountQueue()
    useCommandQueueStore().add('M190 S60', 'dashboard.modules.temperatures')
    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.find('button').exists()).toBe(false)
  })
})
