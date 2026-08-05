import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import MovementZAxis from '@/components/dashboard/modules/MovementZAxis.vue'
import { i18n } from '@/i18n'
import { usePrinterStore } from '@/stores/printer'

function mountAxis(
  options: { canMove?: boolean; swapDirection?: boolean; isMoving?: boolean } = {},
) {
  const pinia = createPinia()
  const printer = usePrinterStore(pinia)
  const wrapper = mount(MovementZAxis, {
    global: { plugins: [pinia, i18n] },
    props: {
      canMove: options.canMove ?? true,
      swapDirection: options.swapDirection ?? false,
      isMoving: options.isMoving ?? false,
    },
  })
  return { printer, wrapper }
}

function reportTravel(printer: ReturnType<typeof usePrinterStore>) {
  printer.buildVolume.minimum = [0, 0, 0]
  printer.buildVolume.maximum = [300, 200, 250]
}

function homed(printer: ReturnType<typeof usePrinterStore>) {
  printer.motion.homedAxes = 'xyz'
  printer.motion.position = [75, 150, 100]
  printer.motion.livePosition = [75, 150, 100]
  printer.motion.homingOrigin = [0, 0, 0]
}

/** jsdom reports no layout, so the slider's box is scripted. */
function sizeSlider(wrapper: ReturnType<typeof mountAxis>['wrapper'], height = 200) {
  const slider = wrapper.get('.z-axis__slider')
  slider.element.getBoundingClientRect = () => ({ top: 0, height }) as unknown as DOMRect
  return slider
}

/**
 * Dispatched rather than triggered: jsdom's MouseEvent exposes clientY as a
 * getter only, so the test-utils helper cannot assign it onto an event it has
 * already constructed.
 */
async function hoverSlider(wrapper: ReturnType<typeof mountAxis>['wrapper'], clientY: number) {
  sizeSlider(wrapper).element.dispatchEvent(
    new MouseEvent('pointermove', { clientY, bubbles: true, cancelable: true }),
  )
  await flushPromises()
}

describe('MovementZAxis', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('draws nothing until the printer has reported its Z travel', async () => {
    const { wrapper } = mountAxis()
    await flushPromises()
    expect(wrapper.find('.z-axis').exists()).toBe(false)
  })

  it('is a native slider spanning the reported Z travel', async () => {
    const { printer, wrapper } = mountAxis()
    reportTravel(printer)
    await flushPromises()

    const slider = wrapper.get('.z-axis__slider')
    expect(slider.attributes('type')).toBe('range')
    expect(slider.attributes('min')).toBe('0')
    expect(slider.attributes('max')).toBe('250')
  })

  it('reflects the live Z position until the user drags it', async () => {
    const { printer, wrapper } = mountAxis()
    reportTravel(printer)
    homed(printer)
    await flushPromises()

    const slider = wrapper.get('.z-axis__slider').element as HTMLInputElement
    expect(slider.value).toBe('100')
  })

  /**
   * Mirrors the fan and pin sliders exactly: dragging updates the value
   * locally, and only releasing commits a move — a drag that never lifts
   * never sends a command Klipper has to refuse mid-gesture.
   */
  it('commits on release, not on every value a drag passes through', async () => {
    const { printer, wrapper } = mountAxis()
    reportTravel(printer)
    homed(printer)
    await flushPromises()

    const slider = wrapper.get('.z-axis__slider')
    // `input` only, the way a browser fires it while a drag is in progress —
    // `setValue` fires `change` too, which is exactly the event under test.
    ;(slider.element as HTMLInputElement).value = '180'
    await slider.trigger('input')
    expect(wrapper.emitted('move')).toBeUndefined()

    await slider.trigger('change')
    expect(wrapper.emitted('move')?.[0]).toEqual([180])
  })

  /**
   * `moveTo` sends the draft straight through as a literal `G1 Z<value>`,
   * which lands in `gcode_position`. A bed mesh shifts `live_position` away
   * from that nominal value — syncing the draft from the live frame would
   * pull the thumb to a different height than the one just committed, which
   * reads as the slider having ignored the click.
   */
  it('does not snap to the mesh-corrected live position after a move settles', async () => {
    const { printer, wrapper } = mountAxis()
    reportTravel(printer)
    homed(printer)
    await flushPromises()

    printer.motion.livePosition = [75, 150, 100.3]
    await flushPromises()

    const slider = wrapper.get('.z-axis__slider').element as HTMLInputElement
    expect(slider.value).toBe('100')
  })

  it('disables the slider while the card cannot move the machine', async () => {
    const { printer, wrapper } = mountAxis({ canMove: false })
    reportTravel(printer)
    homed(printer)
    await flushPromises()

    expect(wrapper.get('.z-axis__slider').attributes('disabled')).toBeDefined()
  })

  /**
   * The card's own corner reading turns blue for whichever axis is hovered —
   * this is the raw value it reads that from, computed the same way `commit`
   * reads a height back from the native thumb.
   */
  it('reports a hovered height without moving anything', async () => {
    const { printer, wrapper } = mountAxis()
    reportTravel(printer)
    homed(printer)
    await flushPromises()

    await hoverSlider(wrapper, 50)

    // 50 of 200 tall, maximum at the top: 75% of 250 remains, i.e. Z 187.5,
    // floored to a whole millimetre.
    expect(wrapper.emitted('hover')?.at(-1)).toEqual([187])
    expect(wrapper.emitted('move')).toBeUndefined()
  })

  /**
   * A vertical `writing-mode` plus a flipped `direction` does not reliably
   * agree with a native range input's own drag-to-value mapping, so the
   * browser can settle the thumb on a different value than the one just
   * previewed — this is the mismatch a dragged Z slider was reported to
   * commit to the wrong height entirely. `commit` must trust the pointer
   * reading it already showed the user, not the input's own value.
   */
  it("commits the height last previewed rather than the native thumb's own value", async () => {
    const { printer, wrapper } = mountAxis()
    reportTravel(printer)
    homed(printer)
    await flushPromises()

    await hoverSlider(wrapper, 50) // previews 187, per the math above

    const slider = wrapper.get('.z-axis__slider')
    ;(slider.element as HTMLInputElement).value = '210'
    await slider.trigger('change')

    expect(wrapper.emitted('move')?.at(-1)).toEqual([187])
  })

  it('clears the hover once the pointer leaves the slider', async () => {
    const { printer, wrapper } = mountAxis()
    reportTravel(printer)
    homed(printer)
    await flushPromises()

    await hoverSlider(wrapper, 50)
    await wrapper.get('.z-axis__slider').trigger('pointerleave')

    expect(wrapper.emitted('hover')?.at(-1)).toEqual([null])
  })

  it('reports no hover while the card cannot move the machine', async () => {
    const { printer, wrapper } = mountAxis({ canMove: false })
    reportTravel(printer)
    homed(printer)
    await flushPromises()

    await hoverSlider(wrapper, 50)
    expect(wrapper.emitted('hover')).toBeUndefined()
  })

  /** A bed-slinger's Z 0 sits at the top of its travel rather than the bottom. */
  it('flips the hover reading when the direction is swapped', async () => {
    const { printer, wrapper } = mountAxis({ swapDirection: true })
    reportTravel(printer)
    homed(printer)
    await flushPromises()

    // 50 of 200 tall from the top is now 25% of the way to the maximum,
    // i.e. Z 62.5, floored to a whole millimetre.
    await hoverSlider(wrapper, 50)
    expect(wrapper.emitted('hover')?.at(-1)).toEqual([62])
  })

  /**
   * The X/Y dot tracks `toolheadPosition` continuously while the toolhead
   * moves; the Z slider stood still until a move settled. `isMoving` is
   * shared down from the card so the two never disagree on the threshold.
   */
  it('tracks the live position while the toolhead is moving', async () => {
    const { printer, wrapper } = mountAxis({ isMoving: true })
    reportTravel(printer)
    homed(printer)
    await flushPromises()

    printer.motion.livePosition = [75, 150, 120]
    await flushPromises()

    const slider = wrapper.get('.z-axis__slider').element as HTMLInputElement
    expect(slider.value).toBe('120')
  })
})
