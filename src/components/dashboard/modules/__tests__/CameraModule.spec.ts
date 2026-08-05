import { createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import CameraModule from '@/components/dashboard/modules/CameraModule.vue'
import { i18n } from '@/i18n'
import { useWebcamsStore } from '@/stores/webcams'

describe('CameraModule', () => {
  it('recreates the stream after a transient image failure', async () => {
    const pinia = createPinia()
    const webcams = useWebcamsStore(pinia)
    webcams.webcams = [
      {
        name: 'Workshop camera',
        service: 'mjpegstreamer',
        enabled: true,
        stream_url: '/webcam/?action=stream',
        snapshot_url: '/webcam/?action=snapshot',
      },
    ]
    const refresh = vi.spyOn(webcams, 'refresh').mockResolvedValue()
    const wrapper = mount(CameraModule, { global: { plugins: [pinia, i18n] } })

    await nextTick()
    expect(wrapper.find('img').exists()).toBe(true)

    await wrapper.get('img').trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('Camera stream unavailable')

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(refresh).toHaveBeenCalledOnce()
    expect(wrapper.find('img').exists()).toBe(true)
  })
})
