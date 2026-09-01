import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import MovementBedPlan from '@/components/dashboard/modules/MovementBedPlan.vue'
import { i18n } from '@/i18n'
import { usePrinterStore } from '@/stores/printer'

function mountPlan(
  options: {
    canMove?: boolean
    axesReadout?: { code: string; value: string; preview?: boolean }[]
    /**
     * Puts the plot in the document, which only a test about focus needs:
     * `focus()` on a detached element does nothing, so the assertion would read
     * as a missing call rather than as a test mounted the wrong way.
     */
    attach?: boolean
  } = {},
) {
  const pinia = createPinia()
  const printer = usePrinterStore(pinia)
  const wrapper = mount(MovementBedPlan, {
    ...(options.attach ? { attachTo: document.body } : {}),
    global: { plugins: [pinia, i18n] },
    props: {
      canMove: options.canMove ?? true,
      keyboardStep: 10,
      axesReadout: options.axesReadout ?? [],
    },
  })
  return { printer, wrapper }
}

/** A 300 x 200 bed, so a mistaken axis or a squared aspect both show up. */
function reportVolume(printer: ReturnType<typeof usePrinterStore>) {
  printer.buildVolume.minimum = [0, 0, 0]
  printer.buildVolume.maximum = [300, 200, 340]
}

function homed(printer: ReturnType<typeof usePrinterStore>) {
  printer.motion.homedAxes = 'xyz'
  printer.motion.livePosition = [75, 150, 10]
  printer.motion.homingOrigin = [0, 0, 0]
}

/** jsdom reports no layout, so the plot's box is scripted. */
function sizePlot(wrapper: ReturnType<typeof mountPlan>['wrapper'], width = 300, height = 200) {
  const plot = wrapper.get('.bed-plan__plot')
  plot.element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width, height }) as unknown as DOMRect
  return plot
}

/**
 * Dispatched rather than triggered: jsdom's MouseEvent exposes clientX and
 * clientY as getters only, so the test-utils helper cannot assign them onto an
 * event it has already constructed. The coordinates have to go in the
 * constructor, and they are the entire point of this event.
 */
async function tapPlot(
  wrapper: ReturnType<typeof mountPlan>['wrapper'],
  clientX: number,
  clientY: number,
) {
  sizePlot(wrapper).element.dispatchEvent(
    new MouseEvent('pointerdown', { clientX, clientY, bubbles: true, cancelable: true }),
  )
  await flushPromises()
}

/** A pointer move with a button held, which is what continues an aim. */
async function dragPlot(
  wrapper: ReturnType<typeof mountPlan>['wrapper'],
  clientX: number,
  clientY: number,
  buttons = 1,
) {
  sizePlot(wrapper).element.dispatchEvent(
    new MouseEvent('pointermove', { clientX, clientY, buttons, bubbles: true, cancelable: true }),
  )
  await flushPromises()
}

describe('MovementBedPlan', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  /**
   * The same rule parking follows: coordinates come from the reported volume
   * or they do not exist. A plan drawn to a guessed bed is a confident lie.
   */
  it('draws nothing until the printer has reported a build volume', async () => {
    const { wrapper } = mountPlan()
    await flushPromises()
    expect(wrapper.find('.bed-plan').exists()).toBe(false)
  })

  it('draws the plot at the bed’s own aspect rather than squaring it', async () => {
    const { printer, wrapper } = mountPlan()
    reportVolume(printer)
    await flushPromises()
    expect(wrapper.get('.bed-plan__plot').attributes('style')).toContain('aspect-ratio: 300 / 200')
  })

  /**
   * Klipper keeps reporting a position for an unhomed axis, but it is the last
   * value it happened to hold. Drawn on a picture of the bed that is a far more
   * confident lie than printing the number would be.
   */
  it('shows no nozzle marker until the machine knows where the nozzle is', async () => {
    const { printer, wrapper } = mountPlan()
    reportVolume(printer)
    await flushPromises()
    expect(wrapper.find('.bed-plan__nozzle').exists()).toBe(false)
    expect(wrapper.get('.bed-plan__plot').attributes('aria-label')).toContain('unknown')

    homed(printer)
    await flushPromises()
    const marker = wrapper.get('.bed-plan__nozzle')
    // X 75 of 300 is a quarter across; Y 150 of 200 is three quarters back,
    // which is a quarter *down* the plot. Translating a full-size box, so the
    // per-cent resolves against the plot and the move can be interpolated.
    expect(marker.attributes('style')).toContain('translate(25%, 25%)')
  })

  /**
   * The commit rule: a press aims and nothing else. Without it a mis-aim is a
   * full-bed traverse, and a full-bed traverse over a printed part is a crash.
   */
  it('aims on a press and sends nothing', async () => {
    const { printer, wrapper } = mountPlan()
    reportVolume(printer)
    homed(printer)
    await flushPromises()

    await tapPlot(wrapper, 150, 50)

    expect(wrapper.emitted('move')).toBeUndefined()
    expect(wrapper.find('.bed-plan__target').exists()).toBe(true)
  })

  /**
   * Nothing stands beside the plot — that is what keeps the picture from paying
   * for its own chrome — but there is a visible way to send an aimed target, and
   * it lives inside the plot's own box. Without one the commit gesture was
   * undiscoverable: a double-click is not guessable, nothing on the card said it,
   * and the accessible name did not mention it either.
   */
  it('shows a way to send an aimed target, and nothing before one is aimed', async () => {
    const { printer, wrapper } = mountPlan()
    reportVolume(printer)
    homed(printer)
    await flushPromises()
    expect(wrapper.findAll('button')).toHaveLength(0)

    await tapPlot(wrapper, 150, 50)
    const go = wrapper.get('.bed-plan__go')
    // Inside the plot, so it costs the card no width at all.
    expect(wrapper.get('.bed-plan__plot').find('.bed-plan__go').exists()).toBe(true)
    expect(go.attributes('aria-label')).toContain('Move to')

    await go.trigger('click')
    expect(wrapper.emitted('move')?.[0]).toEqual([{ x: 150, y: 150 }])
    // Sent and cleared, so the control goes with the target it was aiming at.
    await flushPromises()
    expect(wrapper.find('.bed-plan__go').exists()).toBe(false)
  })

  /**
   * The plot aims on every press that reaches it, and this control sits on top
   * of the plot — so a press that bubbled would re-aim at the button's own
   * corner and send the toolhead there instead of to the crosshair.
   */
  it('does not let a press on the send control re-aim the plot underneath it', async () => {
    const { printer, wrapper } = mountPlan()
    reportVolume(printer)
    homed(printer)
    await flushPromises()

    await tapPlot(wrapper, 150, 50)
    const go = wrapper.get('.bed-plan__go')
    go.element.dispatchEvent(
      // The top-right corner of the plot, which is where this control is drawn
      // and is nowhere near the aimed target.
      new MouseEvent('pointerdown', { clientX: 295, clientY: 5, bubbles: true, cancelable: true }),
    )
    await flushPromises()
    await go.trigger('click')

    expect(wrapper.emitted('move')?.[0]).toEqual([{ x: 150, y: 150 }])
  })

  /**
   * Sending clears the target, which unmounts the control that was just pressed
   * — so without this a keyboard user who reaches `Go` and activates it is left
   * on `<body>`, with the plot they were aiming at no longer in the tab position
   * they had reached. The plot is where they were, so it is where focus returns.
   */
  it('returns focus to the plot after the send control has sent', async () => {
    const { printer, wrapper } = mountPlan({ attach: true })
    reportVolume(printer)
    homed(printer)
    await flushPromises()

    await tapPlot(wrapper, 150, 50)
    await wrapper.get('.bed-plan__go').trigger('click')
    await flushPromises()

    expect(document.activeElement).toBe(wrapper.get('.bed-plan__plot').element)
  })

  /**
   * Every pointer move over the plot previews a coordinate in the corner
   * reading, and this control is not a place on the bed — left alone, resting on
   * it previewed the bed corner behind it as though that were the destination.
   */
  it('clears the hover preview when the pointer rests on the send control', async () => {
    const { printer, wrapper } = mountPlan()
    reportVolume(printer)
    homed(printer)
    await flushPromises()

    await tapPlot(wrapper, 150, 50)
    await wrapper.get('.bed-plan__go').trigger('pointerenter')

    expect(wrapper.emitted('hover')?.at(-1)).toEqual([null])
  })

  /**
   * The target follows the pointer while the button is held, so a destination
   * can be corrected without lifting and trying again.
   */
  it('lets the aim follow the pointer while it is held down', async () => {
    const { printer, wrapper } = mountPlan()
    reportVolume(printer)
    homed(printer)
    await flushPromises()

    await tapPlot(wrapper, 150, 50)
    await dragPlot(wrapper, 75, 150)
    await wrapper.get('.bed-plan__plot').trigger('dblclick')

    // A quarter across is X 75; three quarters down is a quarter back.
    expect(wrapper.emitted('move')?.[0]).toEqual([{ x: 75, y: 50 }])
  })

  /** A move with no button held is the pointer merely passing over. */
  it('ignores pointer movement once the button is released', async () => {
    const { printer, wrapper } = mountPlan()
    reportVolume(printer)
    homed(printer)
    await flushPromises()

    await tapPlot(wrapper, 150, 50)
    await dragPlot(wrapper, 75, 150, 0)
    await wrapper.get('.bed-plan__plot').trigger('dblclick')

    expect(wrapper.emitted('move')?.[0]).toEqual([{ x: 150, y: 150 }])
  })

  it('ignores a tap while the card cannot move the machine', async () => {
    const { printer, wrapper } = mountPlan({ canMove: false })
    reportVolume(printer)
    homed(printer)
    await flushPromises()

    await tapPlot(wrapper, 150, 50)
    expect(wrapper.find('.bed-plan__target').exists()).toBe(false)
  })

  /** A placed target is meaningless once the machine can no longer be moved. */
  it('drops a placed target if the machine stops being movable', async () => {
    const { printer, wrapper } = mountPlan()
    reportVolume(printer)
    homed(printer)
    await flushPromises()

    await tapPlot(wrapper, 150, 50)
    expect(wrapper.find('.bed-plan__target').exists()).toBe(true)

    await wrapper.setProps({ canMove: false })
    await flushPromises()
    expect(wrapper.find('.bed-plan__target').exists()).toBe(false)
  })

  /**
   * Arrow keys step in millimetres, so one press is the same distance whatever
   * size the card is — the same reason the jog buttons are labeled with
   * distances rather than proportions of an axis.
   */
  it('nudges from the nozzle by the keyboard step, and commits on Enter', async () => {
    const { printer, wrapper } = mountPlan()
    reportVolume(printer)
    homed(printer)
    await flushPromises()

    const plot = wrapper.get('.bed-plan__plot')
    await plot.trigger('keydown.right')
    await plot.trigger('keydown.up')
    await plot.trigger('keydown.enter')

    expect(wrapper.emitted('move')?.[0]).toEqual([{ x: 85, y: 160 }])
  })

  /**
   * The second click of a double-click has already aimed, so this means
   * "there, now" without ever separating the aim from the commit. The
   * single-click path is unchanged — a lone tap still only aims.
   */
  it('sends on a double-click, at the point double-clicked', async () => {
    const { printer, wrapper } = mountPlan()
    reportVolume(printer)
    homed(printer)
    await flushPromises()

    await tapPlot(wrapper, 150, 50)
    expect(wrapper.emitted('move')).toBeUndefined()

    await wrapper.get('.bed-plan__plot').trigger('dblclick')
    expect(wrapper.emitted('move')?.[0]).toEqual([{ x: 150, y: 150 }])
    expect(wrapper.find('.bed-plan__target').exists()).toBe(false)
  })

  it('sends nothing on a double-click that aimed at nothing', async () => {
    const { printer, wrapper } = mountPlan({ canMove: false })
    reportVolume(printer)
    homed(printer)
    await flushPromises()

    await wrapper.get('.bed-plan__plot').trigger('dblclick')
    expect(wrapper.emitted('move')).toBeUndefined()
  })

  /**
   * The card hands the plot its formatted coordinates rather than the plot
   * reading the store itself, and the plot draws them in its own corner
   * rather than needing a side gutter.
   */
  it('draws the handed-in axes readout in its own corner', async () => {
    const { printer, wrapper } = mountPlan({
      axesReadout: [
        { code: 'X', value: '75.0' },
        { code: 'Y', value: '150.0' },
        { code: 'Z', value: '10.0' },
      ],
    })
    reportVolume(printer)
    await flushPromises()

    const readout = wrapper.get('.bed-plan__readout')
    expect(readout.text()).toContain('X75.0')
    expect(readout.text()).toContain('Z10.0')
  })

  it('draws no readout when the card is showing coordinates elsewhere', async () => {
    const { printer, wrapper } = mountPlan({ axesReadout: [] })
    reportVolume(printer)
    await flushPromises()

    expect(wrapper.find('.bed-plan__readout').exists()).toBe(false)
  })

  it('marks a previewed axis so the card can color it apart from a live reading', async () => {
    const { printer, wrapper } = mountPlan({
      axesReadout: [
        { code: 'X', value: '75.0', preview: true },
        { code: 'Y', value: '150.0' },
      ],
    })
    reportVolume(printer)
    await flushPromises()

    const axes = wrapper.findAll('.bed-plan__readout-axis')
    expect(axes[0].classes()).toContain('bed-plan__readout-axis--preview')
    expect(axes[1].classes()).not.toContain('bed-plan__readout-axis--preview')
  })

  /**
   * A lighter-weight relative of aiming: it answers "what would this be"
   * without placing a target or sending anything, on every pointer move over
   * the plot rather than only while a button is held.
   */
  it('reports a hovered coordinate without aiming or sending anything', async () => {
    const { printer, wrapper } = mountPlan()
    reportVolume(printer)
    homed(printer)
    await flushPromises()

    await dragPlot(wrapper, 150, 50, 0)

    // A half across is X 150; a quarter down is three quarters back, Y 150.
    expect(wrapper.emitted('hover')?.at(-1)).toEqual([{ x: 150, y: 150 }])
    expect(wrapper.find('.bed-plan__target').exists()).toBe(false)
    expect(wrapper.emitted('move')).toBeUndefined()
  })

  it('clears the hover once the pointer leaves the plot', async () => {
    const { printer, wrapper } = mountPlan()
    reportVolume(printer)
    homed(printer)
    await flushPromises()

    await dragPlot(wrapper, 150, 50, 0)
    await wrapper.get('.bed-plan__plot').trigger('pointerleave')

    expect(wrapper.emitted('hover')?.at(-1)).toEqual([null])
  })

  it('reports no coordinate while the card cannot move the machine', async () => {
    const { printer, wrapper } = mountPlan({ canMove: false })
    reportVolume(printer)
    homed(printer)
    await flushPromises()

    await dragPlot(wrapper, 150, 50, 0)
    expect(wrapper.emitted('hover')?.at(-1)).toEqual([null])
  })

  it('abandons a target on Escape', async () => {
    const { printer, wrapper } = mountPlan()
    reportVolume(printer)
    homed(printer)
    await flushPromises()

    await tapPlot(wrapper, 150, 50)
    await wrapper.get('.bed-plan__plot').trigger('keydown.esc')

    expect(wrapper.find('.bed-plan__target').exists()).toBe(false)
    expect(wrapper.emitted('move')).toBeUndefined()
  })
})
