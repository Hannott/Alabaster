import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import HeaderMenu from '@/components/HeaderMenu.vue'

function mountMenu() {
  return mount(HeaderMenu, {
    props: { label: 'Notifications' },
    slots: {
      trigger: '<span class="trigger-glyph">bell</span>',
      default: '<p class="panel-content">content</p>',
    },
    attachTo: document.body,
  })
}

describe('HeaderMenu', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('opens on trigger click and emits open only on the closed-to-open edge', async () => {
    const wrapper = mountMenu()

    await wrapper.find('button').trigger('click')
    expect(wrapper.find('.header-menu__panel').exists()).toBe(true)
    expect(wrapper.emitted('open')).toHaveLength(1)

    await wrapper.find('button').trigger('click')
    expect(wrapper.find('.header-menu__panel').exists()).toBe(false)
    expect(wrapper.emitted('open')).toHaveLength(1)

    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(2)

    wrapper.unmount()
  })

  it('closes on a click outside but not on a click inside the panel', async () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const wrapper = mountMenu()

    await wrapper.find('button').trigger('click')
    expect(wrapper.find('.header-menu__panel').exists()).toBe(true)

    wrapper.find('.panel-content').element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.header-menu__panel').exists()).toBe(true)

    outside.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.header-menu__panel').exists()).toBe(false)

    wrapper.unmount()
  })

  it('closes on Escape', async () => {
    const wrapper = mountMenu()

    await wrapper.find('button').trigger('click')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.header-menu__panel').exists()).toBe(false)

    wrapper.unmount()
  })

  /*
   * Guarded at the registration level because the failure it prevents cannot
   * be dispatched from a test: real browser clicks run a microtask checkpoint
   * between listeners, so the watcher that attaches this listener flushes
   * while the opening click is still propagating — and the same flush can
   * re-render the trigger slot (the notifications bell swaps its glyph when
   * opening marks warnings read), detaching the click's target. A
   * bubble-phase listener then fires for that very click, fails the
   * `root.contains(event.target)` check, and closes the menu it just opened.
   * Scripted dispatch is synchronous and never yields mid-event, so the only
   * thing a test can pin down is that the listener stays capture-phase, where
   * the mid-dispatch attach is inert for the current click. The full
   * reasoning lives on the watcher in HeaderMenu.vue.
   */
  it('hears outside clicks in the capture phase, not the bubble phase', async () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const wrapper = mountMenu()

    await wrapper.find('button').trigger('click')
    const clickRegistration = addSpy.mock.calls.find(([type]) => type === 'click')
    expect(clickRegistration?.[2]).toBe(true)

    addSpy.mockRestore()
    wrapper.unmount()
  })
})
