import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import BedScrewsDialog from '@/components/BedScrewsDialog.vue'
import { i18n } from '@/i18n'
import { useAvailabilityStore } from '@/stores/availability'
import { useBedScrewsStore } from '@/stores/bedScrews'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'

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

function readyKlipper(): void {
  const availability = useAvailabilityStore()
  availability.transportState = 'connected'
  availability.klipperState = 'ready'
  availability.subscriptionState = 'ready'
}

/**
 * Four screws, two of them named and two of them also visited on the fine pass —
 * enough to tell the two lists apart, since `current_screw` indexes into
 * whichever one is live.
 */
function configureScrews(): void {
  usePrinterConfigStore().settings = {
    bed_screws: {
      screw1: [30, 30],
      screw1_name: 'front left',
      screw1_fine_adjust: [30, 30],
      screw2: [270, 30],
      screw2_name: 'front right',
      screw3: [270, 270],
      screw4: [30, 270],
      screw4_fine_adjust: [30, 270],
    },
  }
}

function startRound(
  state: { pass?: 'adjust' | 'fine'; screw?: number; accepted?: number } = {},
): void {
  const bedScrews = useBedScrewsStore()
  bedScrews.isActive = true
  bedScrews.pass = state.pass ?? 'adjust'
  bedScrews.currentScrew = state.screw ?? 0
  bedScrews.acceptedScrews = state.accepted ?? 0
}

function mountDialog() {
  return mount(BedScrewsDialog, { attachTo: document.body, global: { plugins: [i18n] } })
}

describe('BedScrewsDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    readyKlipper()
  })

  /**
   * The procedure can be started from the console, a macro, the printer's own
   * screen or a second browser, so the prompt opens from the subscribed object
   * rather than from a click — and it is mounted at the application root, where
   * a reload mid-procedure sets the state before this component exists.
   */
  it('stays closed until a screw is waiting, and opens itself when one is', async () => {
    const wrapper = mountDialog()
    expect(wrapper.get('dialog').element.open).toBe(false)

    startRound()
    await nextTick()
    await nextTick()

    expect(wrapper.get('dialog').element.open).toBe(true)
  })

  it('names the screw the machine is standing at, from the configuration', async () => {
    configureScrews()
    const wrapper = mountDialog()
    startRound({ screw: 1, accepted: 1 })
    await nextTick()
    await nextTick()

    const readout = wrapper.get('.bed-screws-dialog__readout')
    expect(readout.text()).toContain('front right')
    // Counted in accepted screws, not in the index: ADJUSTED sends the round
    // back to the start, and an index would march on while Klipper started over.
    expect(readout.text()).toContain('1 of 4')
    expect(readout.text()).toContain('Coarse')
  })

  /**
   * The fine pass visits only the screws given a `screwN_fine_adjust`
   * coordinate, which is Klipper's own filter — so the same index means a
   * different screw, and a total read off the coarse list would be wrong too.
   */
  it('indexes the fine pass into the fine list, not the whole set', async () => {
    configureScrews()
    const wrapper = mountDialog()
    startRound({ pass: 'fine', screw: 1 })
    await nextTick()
    await nextTick()

    const readout = wrapper.get('.bed-screws-dialog__readout')
    expect(readout.text()).toContain('Fine')
    // screw4 is the second of the two with a fine coordinate, and it has no name.
    expect(readout.text()).toContain('X 30.0, Y 270.0')
    expect(readout.text()).toContain('0 of 2')
  })

  it('falls back to the screw number before the configuration has arrived', async () => {
    const wrapper = mountDialog()
    startRound({ screw: 2 })
    await nextTick()
    await nextTick()

    const readout = wrapper.get('.bed-screws-dialog__readout')
    expect(readout.text()).toContain('Screw 3')
    // "1 of 0" is worse than saying nothing at all.
    expect(readout.text()).toContain('Not reported yet')
  })

  it('sends each of Klipper’s three answers, and nothing else', async () => {
    const printer = usePrinterStore()
    const answer = vi.spyOn(printer, 'answerBedScrew').mockResolvedValue(true)
    const wrapper = mountDialog()
    startRound()
    await nextTick()
    await nextTick()

    const actions = wrapper.findAll('.confirm-dialog__actions button')
    expect(actions.map((button) => button.text())).toEqual(['Accept', 'Adjusted', 'Abort'])

    await actions[0]?.trigger('click')
    expect(answer).toHaveBeenLastCalledWith('accept')
    await actions[1]?.trigger('click')
    expect(answer).toHaveBeenLastCalledWith('adjusted')
    await actions[2]?.trigger('click')
    expect(answer).toHaveBeenLastCalledWith('abort')
  })

  /**
   * The procedure is machine state, not dialog state: closing the prompt must
   * not answer for a screw nobody has looked at. The header's own control is
   * what brings it back.
   */
  it('dismissing closes the prompt and answers nothing', async () => {
    const printer = usePrinterStore()
    const answer = vi.spyOn(printer, 'answerBedScrew').mockResolvedValue(true)
    const bedScrews = useBedScrewsStore()
    const wrapper = mountDialog()
    startRound()
    await nextTick()
    await nextTick()

    await wrapper.get('.bed-screws-dialog__header button').trigger('click')
    await nextTick()

    expect(answer).not.toHaveBeenCalled()
    expect(bedScrews.isActive).toBe(true)
    expect(wrapper.get('dialog').element.open).toBe(false)
  })

  /** One pending flag for all three, since each ends the same wait. */
  it('disables every answer while one is in flight', async () => {
    const printer = usePrinterStore()
    const wrapper = mountDialog()
    startRound()
    await nextTick()
    await nextTick()

    printer.pendingCommands.bedScrews = true
    await nextTick()

    for (const button of wrapper.findAll('.confirm-dialog__actions button')) {
      expect(button.attributes('disabled')).toBeDefined()
    }
  })

  it('closes when the round ends, wherever it was ended from', async () => {
    const bedScrews = useBedScrewsStore()
    const wrapper = mountDialog()
    startRound()
    await nextTick()
    await nextTick()
    expect(wrapper.get('dialog').element.open).toBe(true)

    bedScrews.isActive = false
    await nextTick()
    await nextTick()

    expect(wrapper.get('dialog').element.open).toBe(false)
  })
})
