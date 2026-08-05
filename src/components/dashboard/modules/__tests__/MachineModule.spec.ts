import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import MachineModule from '@/components/dashboard/modules/MachineModule.vue'
import { i18n } from '@/i18n'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'

function mountModule() {
  const pinia = createPinia()
  const printer = usePrinterStore(pinia)
  const printerConfig = usePrinterConfigStore(pinia)
  const wrapper = mount(MachineModule, { global: { plugins: [pinia, i18n] } })
  return { printer, printerConfig, wrapper }
}

describe('MachineModule', () => {
  it('starts from what the machine currently reports, not from zero', async () => {
    const { printer, wrapper } = mountModule()
    printer.motion.maxVelocity = 320.4
    printer.motion.maxAccel = 6000
    printer.motion.squareCornerVelocity = 8
    printer.motion.minimumCruiseRatio = 0.5
    await flushPromises()

    const values = wrapper
      .findAll('.app-field__input')
      .map((input) => (input.element as HTMLInputElement).value)
    // The last field is the minimum cruise ratio, read and edited as a
    // percentage — 0.5 as a fraction is 50, not 0.5.
    expect(values).toEqual(['320', '8', '6000', '50'])
    expect(wrapper.findAll('.app-field__label')).toHaveLength(4)
    expect(wrapper.findAll('.app-field__box')).toHaveLength(4)
    expect(wrapper.findAll('.app-field__box .app-field__unit')).toHaveLength(4)
  })

  /*
   * `SET_VELOCITY_LIMIT` leaves out what it was not given, so a committed
   * field is sent by itself rather than folded in with three values this card
   * would otherwise re-assert over whatever the console or another browser had
   * changed them to since.
   */
  it('sends only the limit that was committed', async () => {
    const { printer, wrapper } = mountModule()
    const setVelocityLimits = vi.spyOn(printer, 'setVelocityLimits').mockResolvedValue(true)
    printer.motion.maxVelocity = 300
    printer.motion.maxAccel = 3000
    printer.motion.squareCornerVelocity = 5
    printer.motion.minimumCruiseRatio = 0.5
    await flushPromises()

    const accel = wrapper.findAll('.app-field__input').at(2)
    await accel?.trigger('focus')
    await accel?.setValue('4500')
    await accel?.trigger('keydown', { key: 'Enter' })

    expect(setVelocityLimits).toHaveBeenCalledTimes(1)
    expect(setVelocityLimits).toHaveBeenCalledWith({ accel: 4500 })
  })

  /*
   * There is no Apply button to press, so leaving a field is how an edit is
   * abandoned — and abandoning it has to put the machine's own value back. A
   * number left sitting in the box would read as the printer's state while
   * being nothing but something somebody typed.
   */
  it('abandons an edit left without Enter and shows the machine value again', async () => {
    const { printer, wrapper } = mountModule()
    const setVelocityLimits = vi.spyOn(printer, 'setVelocityLimits').mockResolvedValue(true)
    printer.motion.maxVelocity = 300
    await flushPromises()

    const velocity = wrapper.findAll('.app-field__input').at(0)
    await velocity?.trigger('focus')
    await velocity?.setValue('450')
    await velocity?.trigger('blur')

    expect(setVelocityLimits).not.toHaveBeenCalled()
    expect((velocity?.element as HTMLInputElement).value).toBe('300')
  })

  /*
   * The card used to restate printer.cfg's own limits under the fields, so a
   * limit raised for one job could be put back without opening the file. On any
   * machine whose limits have not been changed this session those are the same
   * three numbers the fields already show, so the card said them twice — and
   * only one of the two could be acted on.
   */
  it('says each limit once, in the field that sets it', async () => {
    const { printer, printerConfig, wrapper } = mountModule()
    printerConfig.settings = {
      printer: { max_velocity: 300, max_accel: 3000, square_corner_velocity: 5 },
    }
    printer.motion.maxVelocity = 300
    printer.motion.maxAccel = 3000
    printer.motion.squareCornerVelocity = 5
    await flushPromises()

    expect(wrapper.text()).not.toContain('Configured')
    expect(wrapper.findAll('.app-field__box')).toHaveLength(4)
  })

  it('resets a changed runtime limit to printer.cfg and commits that value', async () => {
    const { printer, printerConfig, wrapper } = mountModule()
    const setVelocityLimits = vi.spyOn(printer, 'setVelocityLimits').mockResolvedValue(true)
    printerConfig.settings = {
      printer: {
        max_velocity: 300,
        max_accel: 3000,
        square_corner_velocity: 5,
        minimum_cruise_ratio: 0.5,
      },
    }
    printer.motion.maxVelocity = 450
    printer.motion.maxAccel = 3000
    printer.motion.squareCornerVelocity = 5
    printer.motion.minimumCruiseRatio = 0.5
    await flushPromises()

    const reset = wrapper.get(
      `[aria-label="${i18n.global.t('field.reset', { field: 'Velocity' })}"]`,
    )
    await reset.trigger('click')

    expect(setVelocityLimits).toHaveBeenCalledTimes(1)
    expect(setVelocityLimits).toHaveBeenCalledWith({ velocity: 300 })
    expect((wrapper.findAll('.app-field__input').at(0)?.element as HTMLInputElement).value).toBe(
      '300',
    )
  })

  /*
   * A stepper press is a whole edit rather than a keystroke on the way to one,
   * so each press sends its own command — the same as Extruder's retraction
   * steppers, and the reason the fields disable themselves while one is in
   * flight instead of queueing a nudge per press.
   */
  it('nudges velocity by its step through the paired up/down buttons', async () => {
    const { printer, wrapper } = mountModule()
    const setVelocityLimits = vi.spyOn(printer, 'setVelocityLimits').mockResolvedValue(true)
    printer.motion.maxVelocity = 300
    await flushPromises()

    const [increase, decrease] = wrapper.findAll(
      `[aria-label="${i18n.global.t('field.increase', { field: 'Velocity' })}"], ` +
        `[aria-label="${i18n.global.t('field.decrease', { field: 'Velocity' })}"]`,
    )
    await increase?.trigger('click')
    expect((wrapper.findAll('.app-field__input').at(0)?.element as HTMLInputElement).value).toBe(
      '301',
    )
    expect(setVelocityLimits).toHaveBeenLastCalledWith({ velocity: 301 })

    await decrease?.trigger('click')
    await decrease?.trigger('click')
    expect((wrapper.findAll('.app-field__input').at(0)?.element as HTMLInputElement).value).toBe(
      '299',
    )
    expect(setVelocityLimits).toHaveBeenLastCalledWith({ velocity: 299 })
  })

  it('keeps the minimum cruise ratio a fraction internally while its field reads a percent', async () => {
    const { printer, wrapper } = mountModule()
    const setVelocityLimits = vi.spyOn(printer, 'setVelocityLimits').mockResolvedValue(true)
    printer.motion.maxVelocity = 300
    printer.motion.maxAccel = 3000
    printer.motion.squareCornerVelocity = 5
    printer.motion.minimumCruiseRatio = 0.5
    await flushPromises()

    const ratio = wrapper.findAll('.app-field__input').at(3)
    await ratio?.trigger('focus')
    await ratio?.setValue('75')
    await ratio?.trigger('keydown', { key: 'Enter' })

    expect(setVelocityLimits).toHaveBeenCalledWith({ minimumCruiseRatio: 0.75 })
  })
})
