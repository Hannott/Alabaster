import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ExtruderModule from '@/components/dashboard/modules/ExtruderModule.vue'
import { dashboardModuleContextKey } from '@/dashboard/context'
import { i18n } from '@/i18n'
import { useMacrosStore } from '@/stores/macros'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { useSpoolStore } from '@/stores/spool'
import { useTelemetryStore } from '@/stores/telemetry'

function mountModule(initialConfig: Record<string, unknown> = {}) {
  const pinia = createPinia()
  const printer = usePrinterStore(pinia)
  const telemetry = useTelemetryStore(pinia)
  const macros = useMacrosStore(pinia)
  const printerConfig = usePrinterConfigStore(pinia)
  const spool = useSpoolStore(pinia)
  const config = ref<Record<string, unknown>>(initialConfig)
  const wrapper = mount(ExtruderModule, {
    global: {
      plugins: [pinia, i18n],
      provide: {
        [dashboardModuleContextKey as symbol]: {
          instanceId: 'extruder',
          moduleId: 'extruder',
          config: computed(() => config.value),
          updateConfig: (patch: Record<string, unknown>) => {
            config.value = { ...config.value, ...patch }
          },
          isSettingsOpen: computed(() => false),
          openSettings: () => undefined,
          closeSettings: () => undefined,
          isSurfaceOpen: computed(() => false),
          openSurface: () => undefined,
          closeSurface: () => undefined,
        },
      },
    },
  })
  return { printer, telemetry, macros, printerConfig, spool, wrapper }
}

function warmExtruder(telemetry: ReturnType<typeof useTelemetryStore>, temperature: number): void {
  telemetry.readings = {
    extruder: {
      objectName: 'extruder',
      name: 'extruder',
      kind: 'extruder',
      temperature,
      target: temperature,
      power: 0,
      speed: null,
      isSettable: true,
    },
  }
}

describe('ExtruderModule', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('refuses extrusion while the hotend is below the configured minimum', async () => {
    const { printer, telemetry, wrapper } = mountModule()
    const extrude = vi.spyOn(printer, 'extrudeFilament').mockResolvedValue(true)
    warmExtruder(telemetry, 27.5)
    printer.extruder.canExtrude = false
    await flushPromises()

    expect(wrapper.text()).toContain('Heat the hotend above 170°C to extrude')
    const buttons = wrapper.findAll('.extruder-feed__actions > button')
    expect(buttons).toHaveLength(2)
    expect(buttons.every((button) => button.attributes('disabled') !== undefined)).toBe(true)
    expect(extrude).not.toHaveBeenCalled()
  })

  it('extrudes and retracts the configured amount once the extruder is ready', async () => {
    const { printer, telemetry, wrapper } = mountModule()
    const extrude = vi.spyOn(printer, 'extrudeFilament').mockResolvedValue(true)
    warmExtruder(telemetry, 220)
    printer.extruder.canExtrude = true
    await flushPromises()

    expect(wrapper.text()).toContain('Ready to extrude')

    await wrapper.get('.button--primary').trigger('click')
    expect(extrude).toHaveBeenLastCalledWith(25, 5)

    await wrapper.findAll('.extruder-feed__actions > button').at(0)?.trigger('click')
    expect(extrude).toHaveBeenLastCalledWith(-25, 5)
  })

  it('sets the filament length from a preset chip, and both buttons use it', async () => {
    const { printer, telemetry, wrapper } = mountModule()
    const extrude = vi.spyOn(printer, 'extrudeFilament').mockResolvedValue(true)
    warmExtruder(telemetry, 220)
    printer.extruder.canExtrude = true
    await flushPromises()

    await wrapper.get('[aria-label="Set filament length to 10 mm"]').trigger('click')
    await flushPromises()

    await wrapper.get('.button--primary').trigger('click')
    expect(extrude).toHaveBeenLastCalledWith(10, 5)
  })

  it('sets the feedrate from a preset chip, and both buttons use it', async () => {
    const { printer, telemetry, wrapper } = mountModule()
    const extrude = vi.spyOn(printer, 'extrudeFilament').mockResolvedValue(true)
    warmExtruder(telemetry, 220)
    printer.extruder.canExtrude = true
    await flushPromises()

    await wrapper.get('[aria-label="Set feedrate to 2 mm/s"]').trigger('click')
    await flushPromises()

    await wrapper.get('.button--primary').trigger('click')
    expect(extrude).toHaveBeenLastCalledWith(25, 2)
  })

  /*
   * Volume is conserved between what the field feeds in and what the nozzle
   * pushes out, so 25 mm of 1.75 mm filament through a 0.4 mm nozzle is
   * 478.5 mm of bead — and 5 mm/s of that same filament is 12.0 mm³/s, the
   * units a hotend is rated in.
   */
  it('previews the bead length and flow the current length and feedrate would push through the nozzle', async () => {
    const { telemetry, spool, printerConfig, wrapper } = mountModule()
    warmExtruder(telemetry, 220)
    spool.activeSpool = { id: 1, filament: { id: 1, diameter: 1.75 } } as never
    printerConfig.settings = { extruder: { nozzle_diameter: 0.4 } }
    await flushPromises()

    expect(wrapper.text()).toContain('478.5 mm')
    expect(wrapper.text()).toContain('12 mm³/s')
    expect(wrapper.text()).toContain('0.4 mm')
  })

  /*
   * Assuming 1.75 mm filament through an unassessed nozzle would be a
   * fabricated bead length dressed as a measurement — the same refusal
   * `volumetricFlow` already takes for the live flow reading elsewhere on
   * this card.
   */
  it('omits the extrusion preview without a known nozzle diameter', async () => {
    const { spool, wrapper } = mountModule()
    spool.activeSpool = { id: 1, filament: { id: 1, diameter: 1.75 } } as never
    await flushPromises()

    expect(wrapper.find('.extruder-feed__note').exists()).toBe(false)
  })

  it('disables extrusion and the macro buttons while a print is active', async () => {
    const { printer, telemetry, macros, wrapper } = mountModule({ macros: ['LOAD_FILAMENT'] })
    const extrude = vi.spyOn(printer, 'extrudeFilament').mockResolvedValue(true)
    const run = vi.spyOn(macros, 'run').mockResolvedValue(true)
    warmExtruder(telemetry, 220)
    printer.extruder.canExtrude = true
    macros.discovered = ['LOAD_FILAMENT']
    macros.hasDiscovered = true
    printer.printStats.state = 'printing'
    await flushPromises()

    // The hotend is hot enough, so the status line still reads "ready" — a
    // running print owning the extruder is not a state this card explains,
    // since the disabled buttons already say so.
    expect(wrapper.text()).toContain('Ready to extrude')

    const buttons = wrapper.findAll('.extruder-feed__actions > button')
    expect(buttons.every((button) => button.attributes('disabled') !== undefined)).toBe(true)
    await buttons[0]?.trigger('click')
    expect(extrude).not.toHaveBeenCalled()

    const macroButton = wrapper.get('.macro-grid .button')
    expect(macroButton.attributes('disabled')).toBeDefined()
    await macroButton.trigger('click')
    expect(run).not.toHaveBeenCalled()

    printer.printStats.state = 'standby'
    await flushPromises()
    expect(wrapper.text()).toContain('Ready to extrude')
    expect(buttons.every((button) => button.attributes('disabled') === undefined)).toBe(true)
  })

  /*
   * This test used to assert that the card offered LOAD_FILAMENT and
   * UNLOAD_FILAMENT, and it passed — on a hardcoded pair that was one user's
   * `printer.cfg`. Klipper defines no filament macros, so what it was really
   * asserting is that the card guessed right about one machine.
   */
  it('offers the macros the user chose, whatever their printer calls them', async () => {
    const { printer, telemetry, macros, wrapper } = mountModule({ macros: ['M600', 'PURGE_LINE'] })
    const run = vi.spyOn(macros, 'run').mockResolvedValue(true)
    warmExtruder(telemetry, 220)
    printer.extruder.canExtrude = true
    macros.discovered = ['M600', 'PURGE_LINE', 'CALIBRATE_MESH']
    macros.hasDiscovered = true
    await flushPromises()

    const macroButtons = wrapper.findAll('.macro-grid .button')
    expect(macroButtons.map((button) => button.text())).toEqual(['M600', 'Purge Line'])

    await macroButtons[0]?.trigger('click')
    expect(run).toHaveBeenCalledWith('M600')
  })

  /*
   * The defect this block was rebuilt for: one silence covering three different
   * situations. Nothing configured, configured but gone from the printer, and
   * not discovered yet all rendered as the same blank space, and only one of
   * them was something the reader could act on.
   */
  it('invites a choice rather than rendering nothing when no macro is configured', async () => {
    const { macros, wrapper } = mountModule()
    macros.discovered = ['LOAD_FILAMENT']
    macros.hasDiscovered = true
    await flushPromises()

    expect(wrapper.find('.macro-grid').exists()).toBe(false)
    expect(wrapper.text()).toContain('No macros chosen yet')
    expect(wrapper.get('.text-action').text()).toContain('Choose macros')
  })

  it('keeps a configured macro the printer no longer defines, and says it is missing', async () => {
    const { printer, telemetry, macros, wrapper } = mountModule({ macros: ['LOAD_PLA'] })
    const run = vi.spyOn(macros, 'run').mockResolvedValue(true)
    warmExtruder(telemetry, 220)
    printer.extruder.canExtrude = true
    macros.discovered = ['CALIBRATE_MESH']
    macros.hasDiscovered = true
    await flushPromises()

    const button = wrapper.get('.macro-grid .button')
    expect(button.classes()).toContain('macro-control__run--missing')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('title')).toContain('no longer in the printer configuration')
    await button.trigger('click')
    expect(run).not.toHaveBeenCalled()
  })

  /*
   * Before discovery has run there is nothing to be missing from, so the card
   * shows its buttons rather than accusing a printer it has not yet asked.
   */
  it('does not mark a macro missing before the printer has been asked', async () => {
    const { printer, telemetry, wrapper } = mountModule({ macros: ['LOAD_PLA'] })
    warmExtruder(telemetry, 220)
    printer.extruder.canExtrude = true
    await flushPromises()

    const button = wrapper.get('.macro-grid .button')
    expect(button.classes()).not.toContain('macro-control__run--missing')
    expect(button.attributes('disabled')).toBeUndefined()
  })

  it('applies pressure advance with its smoothing time', async () => {
    const { printer, telemetry, wrapper } = mountModule({ showPressureAdvance: true })
    const setPressureAdvance = vi.spyOn(printer, 'setPressureAdvance').mockResolvedValue(true)
    warmExtruder(telemetry, 220)
    printer.extruder.canExtrude = true
    printer.extruder.smoothTime = 0.04
    await flushPromises()

    const inputs = wrapper.get('form').findAll('.app-field__input')
    await inputs[0]?.setValue('0.045')
    await inputs[1]?.setValue('0.03')
    await wrapper.get('form').trigger('submit')

    expect(setPressureAdvance).toHaveBeenCalledWith(0.045, 0.03)
  })

  /*
   * The block is a tuning control on a card whose primary action is two
   * buttons, and it was 41% of the body. Asserted rather than left to taste
   * because "on by default" is a one-word change away and reads as harmless.
   */
  it('keeps the pressure advance block off until it is asked for', async () => {
    const off = mountModule()
    await flushPromises()
    expect(off.wrapper.find('form').exists()).toBe(false)

    const on = mountModule({ showPressureAdvance: true })
    await flushPromises()
    expect(on.wrapper.find('form').exists()).toBe(true)
  })

  /*
   * The defect this replaced: `:value` bound to the live store, re-applied on
   * every render, against a printer pushing `extruder` status several times a
   * second. `Number('0.')` is 0, so the decimal point was eaten before the next
   * digit arrived — and no existing fixture pushed fast enough to catch it.
   */
  it('does not overwrite a pressure advance field while it is being edited', async () => {
    const { printer, wrapper } = mountModule({ showPressureAdvance: true })
    printer.extruder.pressureAdvance = 0.02
    await flushPromises()

    const advance = wrapper.get('form').findAll('.app-field__input')[0]
    await advance?.trigger('focus')
    await advance?.setValue('0.045')

    // The machine reports while the user is mid-edit, as a live one always does.
    printer.extruder.pressureAdvance = 0.021
    await flushPromises()
    expect((advance?.element as HTMLInputElement).value).toBe('0.045')

    // Once the field is released, the machine is authoritative again — which is
    // what keeps a value set from the console or another browser reaching here.
    await advance?.trigger('blur')
    printer.extruder.pressureAdvance = 0.033
    await flushPromises()
    expect((advance?.element as HTMLInputElement).value).toBe('0.033')
  })

  /*
   * Apply sends both values as one command, so a plausible-looking default in
   * the smoothing field is written over the printer's real one by someone who
   * only meant to change the advance. The store's argument is optional; leaving
   * it out keeps Klipper's own value.
   */
  it('omits a smoothing time the printer has never reported rather than guessing one', async () => {
    const { printer, wrapper } = mountModule({ showPressureAdvance: true })
    const setPressureAdvance = vi.spyOn(printer, 'setPressureAdvance').mockResolvedValue(true)
    await flushPromises()

    const smoothing = wrapper.get('form').findAll('.app-field__input')[1]
    expect((smoothing?.element as HTMLInputElement).value).toBe('')

    await wrapper.get('form').trigger('submit')
    expect(setPressureAdvance).toHaveBeenCalledWith(0, undefined)
  })

  it('steps the advance by 0.005 without letting binary addition drift', async () => {
    const { printer, wrapper } = mountModule({ showPressureAdvance: true })
    printer.extruder.pressureAdvance = 0.04
    await flushPromises()

    const advance = wrapper.get('form').findAll('.app-field__input')[0]
    const up = wrapper.get('[aria-label="Increase Advance"]')
    await up.trigger('click')
    await up.trigger('click')
    expect((advance?.element as HTMLInputElement).value).toBe('0.05')

    const down = wrapper.get('[aria-label="Decrease Advance"]')
    for (let index = 0; index < 12; index += 1) await down.trigger('click')
    // Clamped at zero rather than going negative, and still on three decimals.
    expect((advance?.element as HTMLInputElement).value).toBe('0')
  })

  /*
   * The live value beside the one being set, so an edit can be compared
   * against what the machine is actually running. This replaced a caption
   * that also spelled out that an applied advance is lost on the next
   * restart — true of every runtime `SET_` command, and so something the
   * reader already knows about their own firmware.
   */
  it('states the advance the machine is running, and nothing about restarts', async () => {
    const { printer, wrapper } = mountModule({ showPressureAdvance: true })
    printer.extruder.pressureAdvance = 0.045
    await flushPromises()

    const form = wrapper.get('form')
    expect(form.text()).toContain('Active: 0.045')
    expect(form.text()).not.toContain('restart')
  })

  it('drops the optional sections the card configuration turns off', async () => {
    const { printer, telemetry, macros, wrapper } = mountModule({
      showLoadMacros: false,
      showPressureAdvance: false,
    })
    warmExtruder(telemetry, 220)
    printer.extruder.canExtrude = true
    macros.discovered = ['LOAD_FILAMENT']
    macros.hasDiscovered = true
    await flushPromises()

    // What the module is for survives; what a tuning session added does not.
    // The macro block goes entirely, invitation included — turning a section
    // off has to mean off, not "replaced by a prompt to configure it".
    expect(wrapper.findAll('.extruder-feed__actions > button')).toHaveLength(2)
    expect(wrapper.find('.macro-grid').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('No macros chosen yet')
    expect(wrapper.find('form').exists()).toBe(false)
  })

  /*
   * Headed like every other optional block, so its rows are identified the
   * same way theirs are rather than from their own field labels alone.
   */
  it('heads the manual extrusion block and lets the card turn it off', async () => {
    const on = mountModule()
    await flushPromises()
    expect(on.wrapper.get('.manual-extrusion p').text()).toBe('Manual extrusion')
    expect(on.wrapper.findAll('.extruder-feed__value')).toHaveLength(2)

    /*
     * Off is a real state, not merely a smaller one: a printer whose filament
     * only ever moves by macro gets no fields and no buttons, and the block's
     * own caption goes with them rather than being left to explain rows that
     * are no longer there.
     */
    const off = mountModule({ showManualExtrusion: false })
    off.spool.activeSpool = { id: 1, filament: { id: 1, diameter: 1.75 } } as never
    off.printerConfig.settings = { extruder: { nozzle_diameter: 0.4 } }
    await flushPromises()
    expect(off.wrapper.find('.manual-extrusion').exists()).toBe(false)
    expect(off.wrapper.findAll('.extruder-feed__value')).toHaveLength(0)
    expect(off.wrapper.find('.extruder-feed__note').exists()).toBe(false)
    // The extrusion factor is not part of the block, and stays.
    expect(off.wrapper.find('.app-slider').exists()).toBe(true)
  })

  it('sends the extrusion factor from either half of one control, clamped as the store clamps', async () => {
    const { printer, wrapper } = mountModule()
    await flushPromises()

    const setExtrusionFactor = vi.spyOn(printer, 'setExtrusionFactor').mockResolvedValue(true)
    const slider = wrapper.get('.app-slider')
    const field = slider.get('input[type="number"]')
    const range = slider.get('input[type="range"]')

    /*
     * Typed, not committed until Enter — `AppSlider`'s entry field commits on
     * Enter rather than blur or a bare `change`, the same rule `AppField`
     * documents for its own draft: 5 on the way to 50 is a valid factor whose
     * dispatch would be a real command.
     */
    ;(field.element as HTMLInputElement).value = '9'
    await field.trigger('input')
    expect(setExtrusionFactor).not.toHaveBeenCalled()

    await field.trigger('keydown', { key: 'Enter' })
    expect(setExtrusionFactor).toHaveBeenLastCalledWith(50)

    ;(field.element as HTMLInputElement).value = '400'
    await field.trigger('input')
    await field.trigger('keydown', { key: 'Enter' })
    expect(setExtrusionFactor).toHaveBeenLastCalledWith(150)

    await range.setValue('90')
    await range.trigger('change')
    expect(setExtrusionFactor).toHaveBeenLastCalledWith(90)
  })

  it('follows the machine, so a factor changed elsewhere reaches both halves', async () => {
    const { printer, wrapper } = mountModule()
    printer.motion.extrusionFactor = 0.8
    await flushPromises()

    const slider = wrapper.get('.app-slider')
    expect((slider.get('input[type="number"]').element as HTMLInputElement).value).toBe('80')
    expect((slider.get('input[type="range"]').element as HTMLInputElement).value).toBe('80')
  })

  it('shows the factor reset only once the machine differs from 100%', async () => {
    const { printer, wrapper } = mountModule()
    await flushPromises()
    // `AppSlider`'s reset is absent, not merely disabled, while the committed
    // value already matches its reset target — the same contract `AppField`
    // documents for its own reset.
    expect(wrapper.find('.app-slider__reset').exists()).toBe(false)

    printer.motion.extrusionFactor = 0.9
    await flushPromises()
    expect(wrapper.find('.app-slider__reset').exists()).toBe(true)
  })

  /*
   * Kalico's non-linear extrusion, discovered from the one key that only exists
   * where the model does. No fixture here names a firmware, which is the point:
   * a version test off `software_version` breaks on a fork, a backport, a build
   * with the feature compiled out, and the next release.
   */
  it('reads the model and its coefficients where the firmware has them', async () => {
    const { printerConfig, wrapper } = mountModule({ showPressureAdvance: true })
    printerConfig.settings = {
      extruder: {
        nozzle_diameter: 0.4,
        pressure_advance: 0,
        pressure_advance_model: 'tanh',
        linear_advance: 0.01,
        nonlinear_offset: 0.245,
        linearization_velocity: 2,
        pressure_advance_time_offset: 0.002,
        pressure_advance_smooth_time: 0.02,
      },
    }
    await flushPromises()

    // Read, not edited: SET_PRESSURE_ADVANCE has no parameter for the model, so
    // a form offering to change one would be offering what it cannot send.
    expect(wrapper.find('form').exists()).toBe(false)
    const rows = wrapper.get('.pressure-advance-model').findAll('.app-field')
    expect(rows).toHaveLength(7)

    // The setting's own name, so the card and printer.cfg use the same words.
    expect(rows[0]?.get('.app-field__label').text()).toBe('Model')
    expect((rows[0]?.get('input').element as HTMLInputElement).value).toBe('tanh')
    expect(rows[3]?.get('.app-field__label').text()).toBe('Nonlinear Offset')
    expect((rows[3]?.get('input').element as HTMLInputElement).value).toBe('0.245')

    /*
     * `readonly`, never `disabled`: the value can be focused and selected to
     * copy back into printer.cfg, and only changing it is unavailable. Disabled
     * would claim a control that might later become usable.
     */
    for (const row of rows) {
      const field = row.get('input')
      expect(field.attributes('readonly')).toBeDefined()
      expect(field.attributes('disabled')).toBeUndefined()
    }

    // Nothing from the rest of the section leaks in.
    expect(wrapper.text()).not.toContain('nozzle')
  })

  it('keeps the editable form on a firmware with no model to read', async () => {
    const { printerConfig, wrapper } = mountModule({ showPressureAdvance: true })
    printerConfig.settings = {
      extruder: { pressure_advance: 0.045, pressure_advance_smooth_time: 0.04 },
    }
    await flushPromises()

    expect(wrapper.find('form').exists()).toBe(true)
    // The editable form's fields are real controls rather than readonly readings.
    expect(wrapper.findAll('input[readonly]')).toHaveLength(0)
  })

  /*
   * The configuration is fetched on Klipper ready and is empty before it, so
   * the card must not read "this printer has no model" during the gap — it
   * falls back to the form it can always offer rather than to a wrong claim.
   */
  it('offers the editable form before the configuration has loaded', async () => {
    const { wrapper } = mountModule({ showPressureAdvance: true })
    await flushPromises()
    expect(wrapper.find('form').exists()).toBe(true)
  })

  /*
   * The inert fields are the whole statement. A caption explaining that this
   * firmware sets the model in `printer.cfg` was cut: someone running such a
   * firmware put it there themselves, and a `readonly` field already reads as
   * one — asserted above, in the block that checks the attribute.
   */
  it('lets the read-only fields say the model is not editable, without a caption', async () => {
    const { printerConfig, wrapper } = mountModule({ showPressureAdvance: true })
    printerConfig.settings = { extruder: { pressure_advance_model: 'reciprocal' } }
    await flushPromises()

    const block = wrapper.get('.pressure-advance-model')
    expect(block.find('.app-field__input[readonly]').exists()).toBe(true)
    expect(block.text()).not.toContain('printer.cfg')
  })

  /*
   * `motion_report` carries `live_extruder_velocity` on the same object and at
   * the same rate as the toolhead's own. Without it a slow purge and an extrude
   * Klipper silently refused look identical.
   */
  it('says what the extruder is doing while it is doing it', async () => {
    const { printer, telemetry, wrapper } = mountModule()
    warmExtruder(telemetry, 220)
    printer.extruder.canExtrude = true
    await flushPromises()
    expect(wrapper.text()).toContain('Ready to extrude')

    printer.motion.liveExtruderVelocity = 4
    await flushPromises()
    // No spool, so no diameter, so the filament speed rather than a flow it
    // cannot derive.
    expect(wrapper.text()).toContain('4 mm/s')
  })

  it('states volumetric flow once the filament diameter is known', async () => {
    const { printer, telemetry, spool, wrapper } = mountModule()
    warmExtruder(telemetry, 220)
    printer.extruder.canExtrude = true
    spool.activeSpool = { id: 1, filament: { id: 1, diameter: 1.75 } } as never
    printer.motion.liveExtruderVelocity = 5
    await flushPromises()

    // 5 mm/s of 1.75 mm filament is 12.0 mm³/s, the units a hotend is rated in.
    expect(wrapper.text()).toContain('12 mm³/s')
    // Beside the state rather than instead of it: what the extruder is allowed
    // to do and what it is doing are different facts, and during a print the
    // second line is the only one that changes.
    expect(wrapper.findAll('.extruder-status p')).toHaveLength(2)
  })

  /*
   * Flow scales with the square of the diameter, so assuming 1.75 on a 2.85 mm
   * machine would show a number the real flow is 165% above — in exactly the
   * units someone compares against their hotend's limit.
   */
  it('falls back to filament speed rather than assuming a diameter', async () => {
    const { printer, telemetry, spool, wrapper } = mountModule()
    warmExtruder(telemetry, 220)
    printer.extruder.canExtrude = true
    spool.activeSpool = { id: 1, filament: { id: 1 } } as never
    printer.motion.liveExtruderVelocity = 5
    await flushPromises()

    expect(wrapper.text()).toContain('5 mm/s')
    expect(wrapper.text()).not.toContain('mm³/s')
  })

  it('ignores the tail of a settling move rather than flickering', async () => {
    const { printer, telemetry, wrapper } = mountModule()
    warmExtruder(telemetry, 220)
    printer.extruder.canExtrude = true
    printer.motion.liveExtruderVelocity = 0.01
    await flushPromises()

    // The speed row stays on screen at rest rather than disappearing — same
    // posture as Movement's own feed-rate readout — but a settling tail must
    // not read as "moving": the row is present and muted rather than sky.
    const rows = wrapper.findAll('.extruder-status p')
    expect(rows).toHaveLength(2)
    expect(rows[1]?.classes()).toContain('text-muted')
    expect(rows[1]?.classes()).not.toContain('text-data-sky')
    expect(wrapper.text()).toContain('Ready to extrude')
  })

  /*
   * `motion_report` reports a change only when the value actually changes, so
   * a spike that has already settled by the next push would otherwise flash
   * and vanish before anyone's eye reaches the number. Held over a rolling
   * second instead.
   */
  it('holds the highest reading from the last second rather than the newest', async () => {
    vi.useFakeTimers()
    try {
      const { printer, telemetry, wrapper } = mountModule()
      warmExtruder(telemetry, 220)
      printer.extruder.canExtrude = true
      await flushPromises()

      printer.motion.liveExtruderVelocity = 8
      await flushPromises()
      expect(wrapper.text()).toContain('8 mm/s')

      printer.motion.liveExtruderVelocity = 0
      await flushPromises()
      // Still inside the one-second window: the window's peak, not the
      // newest sample.
      expect(wrapper.text()).toContain('8 mm/s')

      await vi.advanceTimersByTimeAsync(1100)
      await flushPromises()
      expect(wrapper.text()).toContain('0 mm/s')
    } finally {
      vi.useRealTimers()
    }
  })

  /*
   * `motion_report` pushes a change only when the value changes, so a printer
   * holding one exact extrusion speed for several seconds — an ordinary long
   * straight segment — never re-fires the reading at all. A hold keyed to
   * "a sample arrived" read that silence as the flow having stopped and
   * decayed to zero after a second even though nothing had actually changed.
   */
  it('keeps crediting an unchanging reading rather than decaying it to zero', async () => {
    vi.useFakeTimers()
    try {
      const { printer, telemetry, wrapper } = mountModule()
      warmExtruder(telemetry, 220)
      printer.extruder.canExtrude = true
      printer.motion.liveExtruderVelocity = 6
      await flushPromises()
      expect(wrapper.text()).toContain('6 mm/s')

      // Several seconds pass with no change to the reported velocity at all —
      // the reading must still show the same steady speed, not zero.
      await vi.advanceTimersByTimeAsync(3000)
      await flushPromises()
      expect(wrapper.text()).toContain('6 mm/s')
    } finally {
      vi.useRealTimers()
    }
  })

  /*
   * Klipper reports a retract's tail-end velocity with the sign of its own
   * direction, so a settled retract can report exactly `-0` — a value
   * `Intl.NumberFormat` prints as "-0", a distinct-looking reading for
   * something that means precisely zero.
   */
  it('shows a settled retract as zero, never negative zero', async () => {
    const { printer, telemetry, wrapper } = mountModule()
    warmExtruder(telemetry, 220)
    printer.extruder.canExtrude = true
    printer.motion.liveExtruderVelocity = -0
    await flushPromises()

    expect(wrapper.text()).toContain('0 mm/s')
    expect(wrapper.text()).not.toContain('-0')
  })

  /*
   * A bare E-only move — retract or unretract, with no X/Y/Z component —
   * pulls filament back through the bowden tube rather than melting it
   * through the nozzle, so it can run far faster than any real print flow.
   * Credited at face value it reads as an absurd melt rate; excluded while
   * a print is running, since that is the only time an E-only move is
   * retraction rather than this card's own manual buttons.
   */
  it('excludes a stationary E-only spike from the reading while a print is running', async () => {
    const { printer, telemetry, spool, wrapper } = mountModule()
    warmExtruder(telemetry, 220)
    printer.extruder.canExtrude = true
    printer.printStats.state = 'printing'
    spool.activeSpool = { id: 1, filament: { id: 1, diameter: 1.75 } } as never

    printer.motion.liveVelocity = 0
    printer.motion.liveExtruderVelocity = 30
    await flushPromises()
    expect(wrapper.text()).toContain('0 mm³/s')

    // The same fast E move while the toolhead is genuinely moving is real
    // print flow, and is credited — 5 mm/s of 1.75 mm filament is 12 mm³/s.
    printer.motion.liveVelocity = 40
    printer.motion.liveExtruderVelocity = 5
    await flushPromises()
    expect(wrapper.text()).toContain('12 mm³/s')
  })

  /*
   * Firmware retraction exists only where the config declares
   * `[firmware_retraction]`, which is why the block is gated on the printer
   * reporting the settings rather than on a toggle alone.
   */
  it('draws no retraction block on a printer that has no firmware retraction', async () => {
    const { wrapper } = mountModule()
    await flushPromises()
    expect(wrapper.text()).not.toContain('Firmware retraction')
  })

  it('draws a field per retraction setting the printer reports', async () => {
    const { printer, wrapper } = mountModule()
    printer.retraction.hasSettings = true
    Object.assign(printer.retraction.settings, {
      retract_length: 0.5,
      retract_speed: 60,
      unretract_extra_length: 0,
      unretract_speed: 60,
      // Derived, so it must not become a field.
      unretract_length: 0.5,
    })
    await flushPromises()

    const rows = wrapper.get('.retraction-fields').findAll('.app-field')
    expect(rows.map((row) => row.get('.app-field__label').text())).toEqual([
      'Retract length',
      'Retract speed',
      'Unretract extra length',
      'Unretract speed',
    ])
    expect((rows[0]?.get('input').element as HTMLInputElement).value).toBe('0.5')
    // Each length carries mm and each speed mm/s as a suffix inside the outlined field.
    expect(rows[0]?.get('.app-field__unit').text()).toBe('mm')
    expect(rows[1]?.get('.app-field__unit').text()).toBe('mm/s')
    expect(rows[0]?.get('.app-field__box').find('.app-field__unit').exists()).toBe(true)
    expect(rows[1]?.get('.app-field__box').find('.app-field__unit').exists()).toBe(true)
  })

  it('grows a field for a firmware that reports one more, without being told which firmware', async () => {
    const { printer, wrapper } = mountModule()
    printer.retraction.hasSettings = true
    Object.assign(printer.retraction.settings, {
      retract_length: 0.5,
      retract_speed: 60,
      unretract_extra_length: 0,
      unretract_speed: 60,
      z_hop_height: 0.4,
    })
    await flushPromises()

    const rows = wrapper.get('.retraction-fields').findAll('.app-field')
    expect(rows).toHaveLength(5)
    expect(rows[4]?.get('.app-field__label').text()).toBe('Z hop height')
  })

  it('keeps the configured retraction value as the reset baseline after a runtime commit', async () => {
    const { printer, printerConfig, wrapper } = mountModule()
    const setRetraction = vi.spyOn(printer, 'setRetraction').mockResolvedValue(true)
    printerConfig.settings = {
      firmware_retraction: {
        retract_length: 0.5,
        retract_speed: 60,
        unretract_extra_length: 0,
        unretract_speed: 60,
      },
    }
    printer.retraction.hasSettings = true
    Object.assign(printer.retraction.settings, {
      retract_length: 0.5,
      retract_speed: 60,
      unretract_extra_length: 0,
      unretract_speed: 60,
    })
    await flushPromises()

    const speedField = wrapper
      .findAll('.app-field')
      .find((field) => field.get('.app-field__label').text() === 'Retract speed')
    const input = speedField?.get('input')
    expect(speedField?.find('.app-field__reset').exists()).toBe(false)

    await input?.trigger('focus')
    await input?.setValue('61')
    await input?.trigger('keydown', { key: 'Enter' })
    printer.retraction.settings.retract_speed = 61
    await flushPromises()

    expect(setRetraction).toHaveBeenLastCalledWith([
      'RETRACT_LENGTH=0.5',
      'RETRACT_SPEED=61',
      'UNRETRACT_EXTRA_LENGTH=0',
      'UNRETRACT_SPEED=60',
    ])
    expect(speedField?.find('.app-field__reset').exists()).toBe(true)

    await speedField?.get('.app-field__reset').trigger('click')
    expect(setRetraction).toHaveBeenLastCalledWith([
      'RETRACT_LENGTH=0.5',
      'RETRACT_SPEED=60',
      'UNRETRACT_EXTRA_LENGTH=0',
      'UNRETRACT_SPEED=60',
    ])
    expect((input?.element as HTMLInputElement).value).toBe('60')
  })

  it('sends every retraction setting in one command', async () => {
    const { printer, wrapper } = mountModule()
    const setRetraction = vi.spyOn(printer, 'setRetraction').mockResolvedValue(true)
    printer.retraction.hasSettings = true
    Object.assign(printer.retraction.settings, {
      retract_length: 0.5,
      retract_speed: 60,
      unretract_extra_length: 0,
      unretract_speed: 60,
    })
    await flushPromises()

    const input = wrapper.get('.retraction-fields').findAll('.app-field')[0]?.get('input')
    await input?.trigger('focus')
    await input?.setValue('0.8')
    await input?.trigger('keydown', { key: 'Enter' })

    // One command, because that is how Klipper takes them — committing one
    // field folds the printer's own current values for the rest in beside it,
    // rather than sending that field alone.
    expect(setRetraction).toHaveBeenCalledTimes(1)
    expect(setRetraction).toHaveBeenCalledWith([
      'RETRACT_LENGTH=0.8',
      'RETRACT_SPEED=60',
      'UNRETRACT_EXTRA_LENGTH=0',
      'UNRETRACT_SPEED=60',
    ])
  })

  /**
   * `AppField` commits on Enter, or a stepper press — never on blur, even
   * though a browser's own `change` event fires there too. Tabbing to the
   * next field is exactly how a reader moves through this row, and it must
   * stay a way to move focus rather than become a way to send
   * `SET_RETRACTION` a keystroke early.
   */
  it('does not send anything when a retraction field is left by tabbing out', async () => {
    const { printer, wrapper } = mountModule()
    const setRetraction = vi.spyOn(printer, 'setRetraction').mockResolvedValue(true)
    printer.retraction.hasSettings = true
    Object.assign(printer.retraction.settings, { retract_length: 0.5, retract_speed: 60 })
    await flushPromises()

    const field = wrapper.get('.retraction-fields').findAll('.app-field')[0]?.get('input')
    await field?.trigger('focus')
    await field?.setValue('0.9')
    await field?.trigger('blur')

    expect(setRetraction).not.toHaveBeenCalled()
  })

  it('does not overwrite a retraction field while it is being edited', async () => {
    const { printer, wrapper } = mountModule()
    printer.retraction.hasSettings = true
    Object.assign(printer.retraction.settings, { retract_length: 0.5, retract_speed: 60 })
    await flushPromises()

    const field = wrapper.get('.retraction-fields').findAll('.app-field')[0]?.get('input')
    await field?.trigger('focus')
    await field?.setValue('0.9')

    printer.retraction.settings.retract_length = 0.51
    await flushPromises()
    expect((field?.element as HTMLInputElement).value).toBe('0.9')

    await field?.trigger('blur')
    printer.retraction.settings.retract_length = 0.42
    await flushPromises()
    expect((field?.element as HTMLInputElement).value).toBe('0.42')
  })

  /*
   * `SET_RETRACTION` stages no config change, exactly like
   * `SET_PRESSURE_ADVANCE`, and the block used to say so under its fields.
   * Cut for the same reason: a runtime `SET_` command not surviving a restart
   * is how all of them behave, so the sentence told the reader what they
   * already know about their own firmware — twice on one card.
   */
  it('leaves the retraction fields uncaptioned', async () => {
    const { printer, wrapper } = mountModule()
    printer.retraction.hasSettings = true
    Object.assign(printer.retraction.settings, { retract_length: 0.5 })
    await flushPromises()

    const block = wrapper.get('.retraction-fields')
    expect(block.find('.app-field').exists()).toBe(true)
    expect(block.text()).not.toContain('restart')
  })

  it('drops the retraction block when the card configuration turns it off', async () => {
    const { printer, wrapper } = mountModule({ showRetraction: false })
    printer.retraction.hasSettings = true
    Object.assign(printer.retraction.settings, { retract_length: 0.5 })
    await flushPromises()
    expect(wrapper.text()).not.toContain('Firmware retraction')
  })
})
