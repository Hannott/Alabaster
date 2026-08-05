import { flushPromises, mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it } from 'vitest'

import SaveConfigDialog from '@/components/SaveConfigDialog.vue'
import { readPendingConfig } from '@/features/config/pendingConfig'
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

/**
 * Built through `readPendingConfig` rather than hand-shaped, so the component is
 * tested against the same structures the store actually produces — a fixture
 * that drifted from the reader would let a wrong assumption pass in both.
 */
const sections = readPendingConfig(
  {
    probe: { z_offset: '0.285' },
    extruder: {
      control: 'mpc',
      block_heat_capacity: '18.9012',
      fan_ambient_transfer: '0.07, 0.09, 0.11, 0.12, 0.13, 0.15, 0.16',
    },
    'bed_mesh default': { points: '0.02, 0.04, 0.03\n0.01, 0.02, 0.05', algo: 'bicubic' },
  },
  { probe: { z_offset: 0.3 }, extruder: { control: 'mpc', block_heat_capacity: 18.7534 } },
)

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(SaveConfigDialog, {
    props: { open: true, sections, ...props },
    global: { plugins: [i18n] },
  })
}

describe('SaveConfigDialog', () => {
  /**
   * `dialog-system.md` requires an authorized set to be listed rather than
   * totalled, and the section is the unit being authorized: the user is deciding
   * whether to rewrite `printer.cfg`, and "3 sections" does not say whether the
   * probe offset they just dialed in is one of them.
   */
  it('lists every staged section rather than counting them', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    const names = wrapper.findAll('.pending-section__name').map((name) => name.text())
    expect(names).toEqual(['[probe]', '[extruder]', '[bed_mesh default]'])
    expect(wrapper.text()).not.toContain('3 sections')
  })

  /** The whole reason both halves are read: what it was, and what it becomes. */
  it('shows what a value changes from and to', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    const probe = wrapper.findAll('.pending-section')[0]
    expect(probe?.get('.pending-row__previous').text()).toBe('0.3')
    expect(probe?.get('.pending-row__next').text()).toBe('0.285')
  })

  /**
   * A bed mesh stages 168 point measurements on a real printer. Printing them
   * would bury the one line that matters and push the actions off-screen, which
   * the same document forbids — so a value that is a list reports its size.
   */
  it('reports a list of numbers as a count instead of printing it', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    const mesh = wrapper.findAll('.pending-section')[2]
    expect(mesh?.text()).toContain('6 points')
    expect(mesh?.text()).not.toContain('0.02, 0.04')
  })

  /**
   * A calibration restages every option in its block, including ones it
   * recomputed to the same value. Those are still written, so they are still
   * listed — marked rather than dropped, because a list that hid them would
   * misdescribe the write.
   */
  it('marks an unchanged option without hiding it', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    const extruder = wrapper.findAll('.pending-section')[1]
    const control = extruder?.findAll('.pending-row').find((row) => row.text().includes('control'))
    expect(control?.classes()).toContain('pending-row--unchanged')
    // Still there, still saying what will be written.
    expect(control?.get('.pending-row__next').text()).toBe('mpc')
  })

  /**
   * Both write actions restart Klipper — `SAVE_CONFIG` is not separable from its
   * restart, and discarding is a restart because Klipper has no unstage command
   * — so a running print blocks both, and the dialog says why rather than
   * presenting two dead buttons.
   */
  it('offers neither write while a print is running, and says why', async () => {
    const wrapper = mountDialog({ isPrinting: true })
    await flushPromises()

    const actions = wrapper.findAll('.save-config-dialog__actions button')
    expect(actions[0]?.attributes('disabled')).toBeDefined()
    expect(actions[1]?.attributes('disabled')).toBeDefined()
    // Cancel is always available: leaving is never the dangerous option.
    expect(actions[2]?.attributes('disabled')).toBeUndefined()
    expect(wrapper.get('.save-config-dialog__blocked').text()).toContain('restarts Klipper')
  })

  it('reports each choice separately, and closes on cancel', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    const actions = wrapper.findAll('.save-config-dialog__actions button')
    await actions[0]?.trigger('click')
    expect(wrapper.emitted('save')).toHaveLength(1)

    await actions[1]?.trigger('click')
    expect(wrapper.emitted('discard')).toHaveLength(1)

    await actions[2]?.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  /**
   * The multi-choice layout the dialog system specifies: at most one primary and
   * one danger, stacked full width, with the dismissive action last and
   * quietest. Discarding is the destructive one — it throws away a calibration
   * result that cannot be recovered.
   */
  it('follows the multi-choice emphasis rules', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    const actions = wrapper.findAll('.save-config-dialog__actions button')
    expect(actions).toHaveLength(3)
    expect(actions.filter((button) => button.classes().includes('button--primary'))).toHaveLength(1)
    expect(actions.filter((button) => button.classes().includes('button--danger'))).toHaveLength(1)
    for (const button of actions) expect(button.classes()).toContain('button--block')
    expect(actions[2]?.classes()).toContain('button--quiet')
    expect(actions[2]?.text()).toBe('Cancel')
  })

  /** Both labels say the restart, because neither action can avoid one. */
  it('names the restart in both write labels', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    const actions = wrapper.findAll('.save-config-dialog__actions button')
    expect(actions[0]?.text()).toBe('Save and restart')
    expect(actions[1]?.text()).toBe('Discard and restart')
  })

  it('waits for a write already in flight', async () => {
    const wrapper = mountDialog({ busy: true })
    await flushPromises()

    const actions = wrapper.findAll('.save-config-dialog__actions button')
    expect(actions[0]?.attributes('disabled')).toBeDefined()
    expect(actions[0]?.attributes('data-pending')).toBe('true')
    expect(actions[1]?.attributes('disabled')).toBeDefined()
  })
})
