import { mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it } from 'vitest'

import IconPickerDialog from '@/components/IconPickerDialog.vue'
import { i18n } from '@/i18n'

beforeAll(() => {
  // jsdom ships <dialog> without its modal methods, so the shared shell's
  // open/close watcher has nothing to call — copied from SettingsView.spec.ts.
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

const options = [
  { name: 'fan' as const, label: 'Fan' },
  { name: 'bulb' as const, label: 'Light bulb' },
  { name: 'probe' as const, label: 'Probe' },
]

function mountDialog(selected: 'fan' | 'bulb' | 'probe' = 'fan') {
  return mount(IconPickerDialog, {
    props: { open: true, title: 'Choose an icon — Interior Light', options, selected },
    global: { plugins: [i18n] },
  })
}

describe('IconPickerDialog', () => {
  it('renders one tile per option, with the current selection marked', () => {
    const wrapper = mountDialog('bulb')
    const tiles = wrapper.findAll('.icon-picker-dialog__grid button')

    expect(tiles).toHaveLength(3)
    expect(tiles.map((tile) => tile.attributes('aria-label'))).toEqual([
      'Fan',
      'Light bulb',
      'Probe',
    ])
    expect(tiles[1]?.attributes('aria-pressed')).toBe('true')
    expect(tiles[0]?.attributes('aria-pressed')).toBe('false')
    expect(tiles[2]?.attributes('aria-pressed')).toBe('false')
  })

  it('picking a tile is the decision — no confirm/cancel action track', () => {
    const wrapper = mountDialog()
    expect(wrapper.find('.confirm-dialog__actions').exists()).toBe(false)
  })

  it('emits select with the clicked option, and cancel from the close button and Escape', async () => {
    const wrapper = mountDialog('fan')

    await wrapper.findAll('.icon-picker-dialog__grid button')[2]?.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['probe']])

    await wrapper.get('button[aria-label="Close"]').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)

    await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.emitted('cancel')).toHaveLength(2)
  })

  it('names the decision in the dialog title', () => {
    const wrapper = mountDialog()
    expect(wrapper.get('.text-dialog-title').text()).toBe('Choose an icon — Interior Light')
  })

  it('focuses the currently-selected tile on open, not always the first one', async () => {
    const wrapper = mount(IconPickerDialog, {
      props: { open: false, title: 'Choose an icon — Probe Enable', options, selected: 'probe' },
      global: { plugins: [i18n] },
      attachTo: document.body,
    })

    await wrapper.setProps({ open: true })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const tiles = wrapper.findAll('.icon-picker-dialog__grid button')
    expect(document.activeElement).toBe(tiles[2]?.element)
    wrapper.unmount()
  })
})
