import { flushPromises, mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it } from 'vitest'

import ConfigExportDialog from '@/components/ConfigExportDialog.vue'
import { i18n } from '@/i18n'
import type { ConfigExportProgress } from '@/stores/machineFiles'

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

function mountDialog(progress: ConfigExportProgress | null, open = true) {
  return mount(ConfigExportDialog, {
    props: { open, progress },
    global: { plugins: [i18n] },
  })
}

function buttons(wrapper: ReturnType<typeof mountDialog>) {
  return wrapper.findAll('.config-export-dialog__actions button')
}

describe('ConfigExportDialog', () => {
  it('offers the two scopes and Cancel while no export is running', async () => {
    const wrapper = mountDialog(null)
    await flushPromises()

    const [all, configOnly, cancel] = buttons(wrapper)
    expect(all?.text()).toBe('Download all files')
    expect(configOnly?.text()).toBe('Download config files only')
    expect(cancel?.text()).toBe('Cancel')
    expect(all?.attributes('disabled')).toBeUndefined()
    expect(configOnly?.attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false)

    await configOnly?.trigger('click')
    expect(wrapper.emitted('export')).toEqual([['config']])
    await all?.trigger('click')
    expect(wrapper.emitted('export')).toEqual([['config'], ['all']])
  })

  /**
   * dialog-system.md: an action in a phase where there is nothing to act on is
   * disabled, not hidden, and the chosen one carries the shared pending
   * treatment. Cancel stays enabled because it now stops the export.
   */
  it('keeps both choices in place, disabled, with the chosen one pending', async () => {
    const wrapper = mountDialog({ scope: 'config', phase: 'listing' })
    await flushPromises()

    const [all, configOnly, cancel] = buttons(wrapper)
    expect(all?.attributes('disabled')).toBeDefined()
    expect(all?.attributes('data-pending')).toBeUndefined()
    expect(configOnly?.attributes('disabled')).toBeDefined()
    expect(configOnly?.attributes('data-pending')).toBe('true')
    expect(cancel?.attributes('disabled')).toBeUndefined()
  })

  /**
   * Progress is reported or it is not. The listing has no total yet, so that
   * phase is words and no bar — a bar pinned at zero would read as a stall.
   */
  it('shows words and no bar while the files are being listed', async () => {
    const wrapper = mountDialog({ scope: 'all', phase: 'listing' })
    await flushPromises()

    expect(wrapper.get('.config-export-dialog__status').text()).toBe('Listing the files')
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false)
  })

  it('names the file being read and counts it against the total', async () => {
    const wrapper = mountDialog({
      scope: 'all',
      phase: 'reading',
      read: 2,
      total: 8,
      path: 'macros/homing.cfg',
    })
    await flushPromises()

    expect(wrapper.get('.config-export-dialog__status').text()).toBe('Reading file 3 of 8')
    expect(wrapper.get('.config-export-dialog__path').text()).toBe('macros/homing.cfg')
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('25')
  })

  it('fills the bar through packing and the hand-off', async () => {
    const wrapper = mountDialog({ scope: 'all', phase: 'packing', total: 8 })
    await flushPromises()
    expect(wrapper.get('.config-export-dialog__status').text()).toBe('Packing the archive')
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('100')

    await wrapper.setProps({ progress: { scope: 'all', phase: 'handoff', total: 8 } })
    expect(wrapper.get('.config-export-dialog__status').text()).toBe('Starting the download')
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('100')
  })

  it('opens and closes with its prop, and cancels from its last action and from Escape', async () => {
    const wrapper = mountDialog({ scope: 'all', phase: 'listing' })
    await flushPromises()
    const dialog = wrapper.get('dialog').element as HTMLDialogElement
    expect(dialog.open).toBe(true)

    await buttons(wrapper).at(-1)?.trigger('click')
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }))
    expect(wrapper.emitted('cancel')).toHaveLength(2)

    await wrapper.setProps({ open: false, progress: null })
    await flushPromises()
    expect(dialog.open).toBe(false)
  })
})
