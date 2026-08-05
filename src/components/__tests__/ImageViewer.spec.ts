import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ImageViewer from '@/components/ImageViewer.vue'
import { i18n } from '@/i18n'

function transformOf(wrapper: ReturnType<typeof mount>): string {
  return wrapper.get('.image-viewer-stage__image').attributes('style') ?? ''
}

describe('ImageViewer', () => {
  it('zooms in and out around the stage center using the toolbar buttons', async () => {
    const wrapper = mount(ImageViewer, {
      props: { src: 'https://example.test/bed-mesh.png', alt: 'bed-mesh.png' },
      global: { plugins: [i18n] },
    })

    const initialTransform = transformOf(wrapper)
    await wrapper.get('[title="Zoom in"]').trigger('click')
    expect(transformOf(wrapper)).not.toBe(initialTransform)
    expect(transformOf(wrapper)).toContain('scale(1.2)')

    await wrapper.get('[title="Zoom out"]').trigger('click')
    expect(transformOf(wrapper)).toContain('scale(1)')
  })

  it('pans the image while dragging with the primary pointer button', async () => {
    const wrapper = mount(ImageViewer, {
      props: { src: 'https://example.test/bed-mesh.png', alt: 'bed-mesh.png' },
      global: { plugins: [i18n] },
    })
    const stage = wrapper.get('.image-viewer-stage').element
    stage.setPointerCapture = () => {}
    stage.hasPointerCapture = () => true
    stage.releasePointerCapture = () => {}

    stage.dispatchEvent(
      new PointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 }),
    )
    stage.dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 1, clientX: 130, clientY: 150 }),
    )
    stage.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 130, clientY: 150 }))
    await wrapper.vm.$nextTick()

    expect(transformOf(wrapper)).toContain('translate(30px, 50px)')
  })

  it('shows an error message and hides zoom controls when the image fails to load', async () => {
    const wrapper = mount(ImageViewer, {
      props: { src: 'https://example.test/broken.png', alt: 'broken.png' },
      global: { plugins: [i18n] },
    })

    await wrapper.get('img').trigger('error')

    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.find('.image-viewer-controls').exists()).toBe(false)
  })
})
