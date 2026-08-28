import { flushPromises, mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it } from 'vitest'

import MachineUpdateConsoleDialog from '@/components/MachineUpdateConsoleDialog.vue'
import { i18n } from '@/i18n'
import type { MachineUpdateOutputLine } from '@/stores/machineSystem'

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

function mountDialog(lines: MachineUpdateOutputLine[] = [], running = false, failed = false) {
  return mount(MachineUpdateConsoleDialog, {
    props: { open: true, lines, running, failed },
    global: { plugins: [i18n] },
  })
}

describe('MachineUpdateConsoleDialog', () => {
  it('is a plain read-only log: no input, focusable for keyboard scrolling', () => {
    const wrapper = mountDialog([{ id: 1, application: 'moonraker', message: 'Updating...' }])

    const log = wrapper.get('.update-console')
    expect(log.attributes('role')).toBe('log')
    expect(log.attributes('tabindex')).toBe('0')
    expect(log.findAll('input, textarea')).toHaveLength(0)
    expect(log.text()).toContain('Updating...')
  })

  it('shows an empty state when nothing has been reported yet', () => {
    const wrapper = mountDialog([])

    expect(wrapper.get('.update-console').text()).toContain('Output appears here')
  })

  it('states Running or Finished, and only disables Clear while running', async () => {
    const wrapper = mountDialog([{ id: 1, application: 'moonraker', message: 'line' }], true)

    expect(wrapper.get('.update-console-state').text()).toBe('Running')
    expect(wrapper.get('.update-console-state').attributes('data-tone')).toBe('accent')
    expect(wrapper.get('dialog').attributes('aria-busy')).toBe('true')
    // Clearing the scrollback mid-run would discard the transcript being written.
    expect(wrapper.get('.button--quiet').attributes('disabled')).toBeDefined()

    await wrapper.setProps({ running: false })

    expect(wrapper.get('.update-console-state').text()).toBe('Finished')
    expect(wrapper.get('.update-console-state').attributes('data-tone')).toBe('positive')
    expect(wrapper.get('dialog').attributes('aria-busy')).toBeUndefined()
    expect(wrapper.get('.button--quiet').attributes('disabled')).toBeUndefined()
  })

  it('states Failed, not Finished, once a completed run reported updateFailed/updateInterrupted', () => {
    const wrapper = mountDialog([{ id: 1, application: 'moonraker', message: 'line' }], false, true)

    expect(wrapper.get('.update-console-state').text()).toBe('Failed')
    expect(wrapper.get('.update-console-state').attributes('data-tone')).toBe('danger')
  })

  it('emits clear from its own button rather than mutating the transcript itself', async () => {
    const wrapper = mountDialog([{ id: 1, application: 'moonraker', message: 'line' }], false)

    await wrapper.get('.button--quiet').trigger('click')

    expect(wrapper.emitted('clear')).toHaveLength(1)
  })

  it('emits close from the [x] button and from Escape', async () => {
    const wrapper = mountDialog()

    await wrapper.get('.button--icon').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)

    await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.emitted('close')).toHaveLength(2)
  })

  it('cannot be dismissed while a run is in progress', async () => {
    const wrapper = mountDialog([{ id: 1, application: 'moonraker', message: 'line' }], true)
    const dialog = wrapper.get('dialog')

    // Disabled rather than hidden, so it still explains why nothing happens —
    // the same treatment `Clear` already gets while a run is in progress.
    expect(wrapper.get('.button--icon').attributes('disabled')).toBeDefined()

    await wrapper.get('.button--icon').trigger('click')
    await dialog.trigger('cancel')
    await dialog.trigger('click')

    expect(wrapper.emitted('close')).toBeUndefined()
  })

  /**
   * Header and transcript tile the dialog's box edge to edge with no
   * dialog-level padding, so a click's target can only be the `<dialog>`
   * element itself when it lands on the true backdrop.
   */
  it('emits close when the backdrop is clicked, but not when the header or transcript is', async () => {
    const wrapper = mountDialog([{ id: 1, application: 'moonraker', message: 'line' }])
    const dialog = wrapper.get('dialog')

    await dialog.get('.update-console-dialog__header').trigger('click')
    await dialog.get('.update-console').trigger('click')
    expect(wrapper.emitted('close')).toBeUndefined()

    await dialog.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('follows the newest line only while the reader is at the bottom', async () => {
    const wrapper = mountDialog([{ id: 1, application: 'system', message: 'first' }])

    const element = wrapper.get('.update-console').element as HTMLElement
    // jsdom reports zero-height layout, so the geometry is stubbed to describe a
    // reader who has scrolled back through a long transcript.
    Object.defineProperty(element, 'scrollHeight', { value: 1_000, configurable: true })
    Object.defineProperty(element, 'clientHeight', { value: 200, configurable: true })
    element.scrollTop = 0
    await wrapper.get('.update-console').trigger('scroll')

    await wrapper.setProps({
      lines: [
        { id: 1, application: 'system', message: 'first' },
        { id: 2, application: 'system', message: 'next' },
      ],
    })

    expect(element.scrollTop).toBe(0)

    element.scrollTop = 800
    await wrapper.get('.update-console').trigger('scroll')
    await wrapper.setProps({
      lines: [
        { id: 1, application: 'system', message: 'first' },
        { id: 2, application: 'system', message: 'next' },
        { id: 3, application: 'system', message: 'last' },
      ],
    })
    // The follow watcher awaits its own extra tick before scrolling, one
    // microtask beyond what `setProps` alone flushes.
    await flushPromises()

    expect(element.scrollTop).toBe(1_000)
  })

  it('scrolls to the newest line whenever the dialog is reopened', async () => {
    const wrapper = mountDialog([{ id: 1, application: 'system', message: 'first' }])
    const element = wrapper.get('.update-console').element as HTMLElement
    Object.defineProperty(element, 'scrollHeight', { value: 1_000, configurable: true })
    Object.defineProperty(element, 'clientHeight', { value: 200, configurable: true })

    // The reader scrolls away, then closes the dialog without scrolling back.
    element.scrollTop = 0
    await wrapper.get('.update-console').trigger('scroll')
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await flushPromises()

    expect(element.scrollTop).toBe(1_000)
  })
})
