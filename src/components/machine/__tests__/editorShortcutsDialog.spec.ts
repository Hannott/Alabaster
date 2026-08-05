import { enableAutoUnmount, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import EditorShortcutsDialog from '@/components/machine/EditorShortcutsDialog.vue'
import { i18n } from '@/i18n'
import en from '@/locales/en.json'

enableAutoUnmount(afterEach)

beforeAll(() => {
  // jsdom ships <dialog> without its modal methods, so the shared dialog shell's
  // open/close watcher has nothing to call.
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

const shortcutItems = Object.keys(en.configuration.shortcuts.items)

function mountDialog(open = true) {
  return mount(EditorShortcutsDialog, { props: { open }, global: { plugins: [i18n] } })
}

describe('the editor’s keyboard reference', () => {
  it('opens and closes off its prop, not its own state', async () => {
    const wrapper = mountDialog(false)
    const dialog = wrapper.find('dialog').element as HTMLDialogElement
    expect(dialog.open).toBe(false)

    await wrapper.setProps({ open: true })
    await nextTick()
    expect(dialog.open).toBe(true)

    await wrapper.setProps({ open: false })
    await nextTick()
    expect(dialog.open).toBe(false)
  })

  /*
   * The guard against the list and the locale file drifting apart: a shortcut
   * given a translation but never added to a group would be documented nowhere
   * the reader can see, and a group naming a key that does not exist renders the
   * key path itself.
   */
  it('shows every shortcut the locale file describes, and nothing unnamed', () => {
    const wrapper = mountDialog()

    expect(wrapper.findAll('.editor-shortcuts__keys')).toHaveLength(shortcutItems.length)
    expect(wrapper.text()).not.toContain('configuration.shortcuts')
  })

  it('pairs every key combination with a description', () => {
    const wrapper = mountDialog()
    const rows = wrapper.findAll('.editor-shortcuts__list dd')

    expect(rows).toHaveLength(shortcutItems.length)
    for (const row of rows) expect(row.text().length).toBeGreaterThan(0)
  })

  it('names the commands the editor actually binds', () => {
    const text = mountDialog().text()

    expect(text).toContain('Ctrl + /')
    expect(text).toContain('Shift + Tab')
    expect(text).toContain('Ctrl + Alt + S')
  })

  /* Shape 3: nothing to decide, so all three close paths are open. */
  it('closes on the [x], on Escape, and on a click on the backdrop', async () => {
    const wrapper = mountDialog()

    await wrapper.find('button.button--icon').trigger('click')
    await wrapper.find('dialog').trigger('cancel')
    await wrapper.find('dialog').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(3)
  })

  /*
   * A click inside the dialog is not a click on the backdrop. The header and
   * body tile the box edge to edge so `event.target` can only equal the
   * `<dialog>` itself on a true backdrop click.
   */
  it('stays open when the click landed on its own content', async () => {
    const wrapper = mountDialog()

    await wrapper.find('.editor-shortcuts-dialog__body').trigger('click')

    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('is labelled by its own title for assistive technology', () => {
    const wrapper = mountDialog()
    const labelledBy = wrapper.find('dialog').attributes('aria-labelledby')

    expect(labelledBy).toBeTruthy()
    expect(wrapper.find(`#${labelledBy}`).exists()).toBe(true)
  })
})
