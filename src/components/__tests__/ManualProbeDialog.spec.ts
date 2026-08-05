import { mount, type DOMWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import ManualProbeDialog from '@/components/ManualProbeDialog.vue'
import { i18n } from '@/i18n'
import { useAvailabilityStore } from '@/stores/availability'
import { useManualProbeStore } from '@/stores/manualProbe'
import { usePrinterStore } from '@/stores/printer'

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

function startProbe(
  position: { z: number | null; lower: number | null; upper: number | null } = {
    z: 4.997,
    lower: 4.95,
    upper: 5.05,
  },
): void {
  const manualProbe = useManualProbeStore()
  manualProbe.isActive = true
  manualProbe.zPosition = position.z
  manualProbe.zPositionLower = position.lower
  manualProbe.zPositionUpper = position.upper
}

function mountDialog() {
  return mount(ManualProbeDialog, {
    attachTo: document.body,
    global: { plugins: [i18n] },
  })
}

describe('ManualProbeDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    readyKlipper()
  })

  it('stays closed until a probe is waiting, and opens itself when one is', async () => {
    const wrapper = mountDialog()
    expect(wrapper.get('dialog').element.open).toBe(false)

    startProbe()
    await nextTick()
    await nextTick()

    expect(wrapper.get('dialog').element.open).toBe(true)
  })

  it('shows the reported height and the bracket either side of it', async () => {
    startProbe()
    const wrapper = mountDialog()
    await nextTick()

    expect(wrapper.get('.text-value-large').text()).toBe('4.997')
    const bounds = wrapper.findAll('.manual-probe-dialog__bound')
    expect(bounds[0]?.text()).toContain('4.950')
    expect(bounds[1]?.text()).toContain('5.050')
  })

  it('names an unreported bound instead of drawing one', async () => {
    startProbe({ z: 5, lower: null, upper: null })
    const wrapper = mountDialog()
    await nextTick()

    const bounds = wrapper.findAll('.manual-probe-dialog__bound')
    expect(bounds[0]?.text()).toContain('Nothing yet')
    expect(bounds[1]?.text()).toContain('Nothing yet')
  })

  it('sends a bisection for the halving pair, and every rung of the step ladder', async () => {
    startProbe()
    const printer = usePrinterStore()
    const testZ = vi.spyOn(printer, 'testZ').mockResolvedValue(true)
    const wrapper = mountDialog()
    await nextTick()

    const halve = wrapper.findAll('.manual-probe-dialog__halve')
    expect(halve).toHaveLength(2)
    for (const button of halve) await button.trigger('click')
    expect(testZ.mock.calls.map(([step]) => step)).toEqual(['+', '-'])

    testZ.mockClear()
    const steps = wrapper.findAll(
      '.manual-probe-dialog__row button:not(.manual-probe-dialog__halve)',
    )
    expect(steps).toHaveLength(10)
    for (const button of steps) await button.trigger('click')
    expect(testZ.mock.calls.map(([step]) => step)).toEqual([
      1, 0.1, 0.05, 0.01, 0.005, -1, -0.1, -0.05, -0.01, -0.005,
    ])
  })

  /*
   * The layout rule, not decoration: a column pairs one magnitude's two
   * directions, so the wrap to two rows is the layout rather than an accident of
   * it. The first arrangement mirrored the signs about the middle of one long
   * row, which wrapped into columns pairing `−1` with `+.005`.
   */
  it('pairs each magnitude in its own column, coarsest first, up above down', async () => {
    startProbe()
    const wrapper = mountDialog()
    await nextTick()

    const rows = wrapper.findAll('.manual-probe-dialog__row')
    expect(rows.map((row) => row.findAll('button').map((button) => button.text()))).toEqual([
      // Half of the 0.053mm gap up to 5.050, and half of the 0.047mm gap down to
      // 4.950 — both under Klipper's 0.2mm clamp, so both are the real halving.
      ['+.026'],
      ['−.023'],
      ['+1', '+.1', '+.05', '+.01', '+.005'],
      ['−1', '−.1', '−.05', '−.01', '−.005'],
    ])

    // The direction is in every sign and in the height above, so the legend that
    // used to bracket the grids is gone — unlike Movement's babystep row, where
    // the sign genuinely is ambiguous and the legend stays.
    expect(wrapper.text()).not.toContain('Toward the bed')
    expect(wrapper.text()).not.toContain('Away from the bed')
    expect(wrapper.find('.manual-probe-dialog__legend').exists()).toBe(false)
  })

  /*
   * The whole reason `++`/`--` could be dropped: what a halving press will move
   * is computable from the bracket, so the button can say it instead of naming a
   * Klipper notation. Clamped to `BISECT_MAX`, which is what makes the four
   * original words collapse to two.
   */
  it('labels the halving pair with the distance it will actually move', async () => {
    startProbe({ z: 5, lower: null, upper: null })
    const wrapper = mountDialog()
    await nextTick()

    // Nothing tried either way: Klipper's clamp is the whole answer.
    expect(wrapper.findAll('.manual-probe-dialog__halve').map((b) => b.text())).toEqual([
      '+.2',
      '−.2',
    ])

    // A bracket 0.01mm above and 1mm below: one side halves, the other clamps.
    startProbe({ z: 5, lower: 4, upper: 5.01 })
    const bracketed = mountDialog()
    await nextTick()
    expect(bracketed.findAll('.manual-probe-dialog__halve').map((b) => b.text())).toEqual([
      '+.005',
      '−.2',
    ])
  })

  it('gives up the halving control once there is nothing left to halve', async () => {
    startProbe({ z: 5, lower: 4.9999, upper: null })
    const wrapper = mountDialog()
    await nextTick()

    const [up, down] = wrapper.findAll('.manual-probe-dialog__halve')
    expect(up?.attributes('disabled')).toBeUndefined()
    expect(down?.attributes('disabled')).toBeDefined()
    // A dash, never `−0`: the button must not state a move it will not make.
    expect(down?.text()).toBe('—')
    expect(down?.attributes('title')).toBe(
      'Nothing left to halve — this is the nearest height already tried.',
    )
  })

  it('offers Accept first and Abort second on the shared equal-width track', async () => {
    startProbe()
    const printer = usePrinterStore()
    const accept = vi.spyOn(printer, 'acceptManualProbe').mockResolvedValue(true)
    const abort = vi.spyOn(printer, 'abortManualProbe').mockResolvedValue(true)
    const wrapper = mountDialog()
    await nextTick()

    const actions = wrapper.findAll('.confirm-dialog__actions button')
    expect(actions.map((action) => action.text())).toEqual(['Accept', 'Abort'])
    expect(actions[0]?.classes()).toContain('button--primary')
    expect(actions[1]?.classes()).toContain('button--danger')

    await actions[0]?.trigger('click')
    expect(accept).toHaveBeenCalledOnce()
    await actions[1]?.trigger('click')
    expect(abort).toHaveBeenCalledOnce()
  })

  it('closing and Escape put the prompt aside without touching the probe', async () => {
    startProbe()
    const printer = usePrinterStore()
    const abort = vi.spyOn(printer, 'abortManualProbe').mockResolvedValue(true)
    const manualProbe = useManualProbeStore()
    const wrapper = mountDialog()
    await nextTick()

    await wrapper.get('.manual-probe-dialog__header button').trigger('click')
    await nextTick()

    expect(manualProbe.isActive).toBe(true)
    expect(manualProbe.isPromptOpen).toBe(false)
    expect(wrapper.get('dialog').element.open).toBe(false)
    expect(abort).not.toHaveBeenCalled()

    manualProbe.reopen()
    await nextTick()
    await nextTick()
    expect(wrapper.get('dialog').element.open).toBe(true)

    await wrapper.get('dialog').trigger('cancel')
    await nextTick()
    expect(manualProbe.isPromptOpen).toBe(false)
    expect(manualProbe.isActive).toBe(true)
    expect(abort).not.toHaveBeenCalled()
  })

  it('a step in flight dims the ladder without disabling the two ways out', async () => {
    startProbe()
    const printer = usePrinterStore()
    printer.pendingCommands.manualProbe = true
    const wrapper = mountDialog()
    await nextTick()

    const isDisabled = (button: DOMWrapper<Element>) => button.attributes('disabled') !== undefined

    expect(wrapper.findAll('.manual-probe-dialog__row button').every(isDisabled)).toBe(true)
    expect(wrapper.findAll('.confirm-dialog__actions button').some(isDisabled)).toBe(false)
  })

  it('closes itself when the probe ends anywhere else', async () => {
    startProbe()
    const manualProbe = useManualProbeStore()
    const wrapper = mountDialog()
    await nextTick()
    expect(wrapper.get('dialog').element.open).toBe(true)

    manualProbe.isActive = false
    await nextTick()
    await nextTick()

    expect(wrapper.get('dialog').element.open).toBe(false)
  })
})
