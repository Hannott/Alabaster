import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AppSelect from '@/components/AppSelect.vue'

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo' },
  { value: 'c', label: 'Charlie' },
]

function mountSelect(modelValue = 'a') {
  return mount(AppSelect, {
    props: { modelValue, options, label: 'Pick one' },
  })
}

describe('AppSelect', () => {
  it('shows the label of the current value on the trigger', () => {
    const wrapper = mountSelect('b')
    expect(wrapper.find('.app-select__trigger').text()).toContain('Bravo')
  })

  it('opens the panel on click and closes it once a value is chosen', async () => {
    const wrapper = mountSelect()
    await wrapper.find('.app-select__trigger').trigger('click')
    // Teleported to `document.body` so a dashboard card's `overflow: hidden`
    // cannot clip it, so it is queried there rather than within `wrapper`.
    expect(document.body.querySelector('.app-select__panel')).not.toBeNull()

    document.body
      .querySelectorAll('.app-select__option')[1]
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['b'])
    // The panel must not still be open, or reappear a tick later — the exact
    // shape of the bug this guards: a wrapping `<label>` forwarded the same
    // click to the trigger a second time, reopening the panel the choice had
    // just closed.
    expect(document.body.querySelector('.app-select__panel')).toBeNull()
    await wrapper.vm.$nextTick()
    expect(document.body.querySelector('.app-select__panel')).toBeNull()
  })

  it('does not open for a click outside the trigger', async () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const wrapper = mountSelect()

    outside.click()
    await wrapper.vm.$nextTick()
    expect(document.body.querySelector('.app-select__panel')).toBeNull()

    outside.remove()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    // Focus only ever lands on an element that is actually attached to the
    // document, so this is the one case in the file that needs `attachTo`.
    const wrapper = mount(AppSelect, {
      props: { modelValue: 'a', options, label: 'Pick one' },
      attachTo: document.body,
    })
    await wrapper.find('.app-select__trigger').trigger('click')
    await wrapper.vm.$nextTick()
    document.body
      .querySelector('.app-select__panel')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(document.body.querySelector('.app-select__panel')).toBeNull()
    expect(document.activeElement).toBe(wrapper.find('.app-select__trigger').element)
    wrapper.unmount()
  })

  it('moves the active option with the arrow keys and selects it with Enter', async () => {
    const wrapper = mountSelect('a')
    await wrapper.find('.app-select__trigger').trigger('click')
    const panel = document.body.querySelector('.app-select__panel')
    panel?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    panel?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['b'])
  })

  it('never opens while disabled', async () => {
    const wrapper = mount(AppSelect, {
      props: { modelValue: 'a', options, label: 'Pick one', disabled: true },
    })
    await wrapper.find('.app-select__trigger').trigger('click')
    expect(wrapper.find('.app-select__panel').exists()).toBe(false)
  })

  it('escapes a clipping ancestor instead of rendering inside it', async () => {
    // A dashboard card sets `overflow: hidden` on exactly this kind of
    // wrapper; the panel has to leave it rather than render as a descendant,
    // or the card silently clips it at its own edge.
    const clipper = document.createElement('div')
    clipper.style.overflow = 'hidden'
    document.body.appendChild(clipper)
    const wrapper = mount(AppSelect, {
      props: { modelValue: 'a', options, label: 'Pick one' },
      attachTo: clipper,
    })

    await wrapper.find('.app-select__trigger').trigger('click')
    const panel = document.body.querySelector('.app-select__panel')
    expect(panel).not.toBeNull()
    expect(clipper.contains(panel)).toBe(false)

    wrapper.unmount()
    clipper.remove()
  })

  it('teleports into the closest open dialog instead of the body', async () => {
    // A native `<dialog>` paints in the browser's top layer ahead of anything
    // teleported to `document.body`, regardless of z-index — the panel has to
    // land inside the same dialog its trigger is docked in, or it renders
    // behind the dialog's own backdrop.
    const dialog = document.createElement('dialog')
    dialog.open = true
    document.body.appendChild(dialog)
    const wrapper = mount(AppSelect, {
      props: { modelValue: 'a', options, label: 'Pick one' },
      attachTo: dialog,
    })

    await wrapper.find('.app-select__trigger').trigger('click')
    const panel = document.body.querySelector('.app-select__panel')
    expect(panel).not.toBeNull()
    expect(dialog.contains(panel)).toBe(true)

    wrapper.unmount()
    dialog.remove()
  })
})
