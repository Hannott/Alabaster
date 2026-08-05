import { mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it } from 'vitest'

import ImageLightbox from '@/components/ImageLightbox.vue'
import { i18n } from '@/i18n'

beforeAll(() => {
  // jsdom ships <dialog> without its modal methods, so the shared shell's
  // open/close watcher has nothing to call — copied from MachineView.spec.ts.
  const dialogPrototype = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>
  if (typeof dialogPrototype.showModal !== 'function') {
    dialogPrototype.showModal = function showModal(this: HTMLDialogElement): void {
      this.open = true
    }
    dialogPrototype.close = function close(this: HTMLDialogElement): void {
      this.open = false
    }
  }
})

function mountLightbox() {
  return mount(ImageLightbox, {
    props: { open: true, src: 'https://example.test/belts.png', alt: 'belts.png' },
    global: { plugins: [i18n] },
  })
}

describe('ImageLightbox', () => {
  it('emits close when the [x] button is clicked', async () => {
    const wrapper = mountLightbox()

    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('emits close on the dialog cancel event, which Escape dispatches natively', async () => {
    const wrapper = mountLightbox()

    await wrapper.get('dialog').trigger('cancel')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  /**
   * The header and viewer tile the dialog's box edge to edge with no dialog-level
   * padding, so a click's target can only be the `<dialog>` element itself when it
   * lands on the true backdrop — never on the header, the close button, or the image.
   */
  it('emits close when the backdrop is clicked, but not when the image or header is', async () => {
    const wrapper = mountLightbox()
    const dialog = wrapper.get('dialog')

    await dialog.get('img').trigger('click')
    await dialog.get('.image-lightbox__header').trigger('click')
    expect(wrapper.emitted('close')).toBeUndefined()

    await dialog.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('shows the image with the given src and alt', () => {
    const wrapper = mountLightbox()

    const img = wrapper.get('img')
    expect(img.attributes('src')).toBe('https://example.test/belts.png')
    expect(img.attributes('alt')).toBe('belts.png')
  })
})
