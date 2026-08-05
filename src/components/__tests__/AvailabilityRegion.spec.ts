import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'

import AvailabilityRegion from '@/components/AvailabilityRegion.vue'
import { i18n } from '@/i18n'
import { useAvailabilityStore } from '@/stores/availability'

describe('AvailabilityRegion', () => {
  it('keeps its content mounted while its availability changes', async () => {
    const pinia = createPinia()
    const wrapper = mount(AvailabilityRegion, {
      props: { requires: 'klipper' },
      slots: { default: '<button data-testid="control">Control</button>' },
      global: { plugins: [pinia, i18n] },
    })
    const control = wrapper.get('[data-testid="control"]').element
    const store = useAvailabilityStore(pinia)

    store.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    store.printerSnapshotSynchronized()
    await nextTick()
    expect(wrapper.attributes('data-availability')).toBe('available')

    store.handleKlipperNotification('notify_klippy_disconnected')
    await nextTick()

    expect(wrapper.attributes('data-availability')).toBe('recovering')
    expect(wrapper.get('[data-testid="control"]').element).toBe(control)
    expect(wrapper.attributes('aria-busy')).toBe('true')
    expect(wrapper.classes()).toContain('availability-region--recovering')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.text()).toBe('Control')
  })
})
