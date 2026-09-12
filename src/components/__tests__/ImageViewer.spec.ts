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

  /**
   * jsdom reports every element as 0x0, which is exactly the state a viewer
   * inside a closed `<dialog>` is in — so this is the real case, not a test
   * artefact. Fitting against no stage used to leave `scale(1)` with the pan
   * offset half the image's width in the wrong direction: an image opened
   * full-size and pushed off its own stage.
   */
  it('leaves the view alone when the stage has no layout to fit against', async () => {
    const wrapper = mount(ImageViewer, {
      props: { src: 'https://example.test/bed-mesh.png', alt: 'bed-mesh.png' },
      global: { plugins: [i18n] },
    })
    const image = wrapper.get('img')
    Object.defineProperty(image.element, 'naturalWidth', { value: 800 })
    Object.defineProperty(image.element, 'naturalHeight', { value: 600 })

    await image.trigger('load')

    expect(transformOf(wrapper)).toContain('translate(0px, 0px)')
    expect(transformOf(wrapper)).toContain('scale(1)')
  })

  it('fits and centres the image on load once the stage has been laid out', async () => {
    const wrapper = mount(ImageViewer, {
      props: { src: 'https://example.test/bed-mesh.png', alt: 'bed-mesh.png' },
      global: { plugins: [i18n] },
    })
    const stage = wrapper.get('.image-viewer-stage').element
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400 }) as DOMRect
    const image = wrapper.get('img')
    Object.defineProperty(image.element, 'naturalWidth', { value: 800 })
    Object.defineProperty(image.element, 'naturalHeight', { value: 400 })

    await image.trigger('load')

    // 800x400 into a 400x400 stage fits at half size, leaving 200px of unused
    // height to split above and below it.
    expect(transformOf(wrapper)).toContain('scale(0.5)')
    expect(transformOf(wrapper)).toContain('translate(0px, 100px)')
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
