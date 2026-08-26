import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import MovementModule from '@/components/dashboard/modules/MovementModule.vue'
import { consoleEntryFromResponse } from '@/services/console/transcript'
import { dashboardModuleContextKey } from '@/dashboard/context'
import { i18n } from '@/i18n'
import { useConfirmationsStore } from '@/stores/confirmations'
import { useConsoleStore } from '@/stores/console'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore, type LevelingMethod } from '@/stores/printerConfig'

beforeAll(() => {
  // jsdom ships <dialog> without its modal methods, so the shared dialog's
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

const levelingSectionNames: Record<LevelingMethod, string> = {
  quadGantryLevel: 'quad_gantry_level',
  zTilt: 'z_tilt',
  screwsTiltAdjust: 'screws_tilt_adjust',
  bedScrews: 'bed_screws',
  deltaCalibrate: 'delta_calibrate',
}

/**
 * A probe section, which is what makes "Save offset" a command this machine
 * actually has. Most tests here want one for the same reason most printers have
 * one; the three that are about the choice itself pass their own sections.
 */
const probeSection = { probe: { x_offset: 0, y_offset: 0 } }

function mountModule(
  options: {
    leveling?: LevelingMethod[]
    /**
     * Raw `configfile.settings` sections, merged over whatever `leveling`
     * implies. Capability questions — is there a probe, is there a Z endstop
     * position, which screws does `[bed_screws]` declare — are all read from
     * here, so a test about one of them stubs the section rather than the
     * computed that reads it.
     */
    sections?: Record<string, Record<string, unknown>>
    config?: Record<string, unknown>
    settingsOpen?: boolean
  } = {},
) {
  const pinia = createPinia()
  const printer = usePrinterStore(pinia)
  const gcodeConsole = useConsoleStore(pinia)
  const printerConfig = usePrinterConfigStore(pinia)
  // levelingMethods is a getter-backed computed, so discovery is stubbed at
  // its source rather than assigned.
  printerConfig.settings = {
    ...Object.fromEntries((options.leveling ?? []).map((m) => [levelingSectionNames[m], {}])),
    ...(options.sections ?? probeSection),
  }

  const config = ref<Record<string, unknown>>(options.config ?? {})
  const settingsOpen = ref(options.settingsOpen ?? false)
  const surfaceOpen = ref(false)
  const wrapper = mount(MovementModule, {
    global: {
      plugins: [pinia, i18n],
      provide: {
        [dashboardModuleContextKey as symbol]: {
          instanceId: 'movement',
          moduleId: 'movement',
          config: computed(() => config.value),
          updateConfig: (patch: Record<string, unknown>) => {
            config.value = { ...config.value, ...patch }
          },
          isSettingsOpen: computed(() => settingsOpen.value),
          openSettings: () => (settingsOpen.value = true),
          closeSettings: () => (settingsOpen.value = false),
          isSurfaceOpen: computed(() => surfaceOpen.value),
          openSurface: () => (surfaceOpen.value = true),
          closeSurface: () => (surfaceOpen.value = false),
        },
      },
    },
  })
  return { printer, gcodeConsole, printerConfig, wrapper, config, surfaceOpen, pinia }
}

/** A homed machine with a known volume, which parking and leveling both need. */
function readyToMove(printer: ReturnType<typeof usePrinterStore>) {
  printer.motion.homedAxes = 'xyz'
  printer.buildVolume.minimum = [0, 0, 0]
  printer.buildVolume.maximum = [300, 300, 340]
}

function buttonNamed(wrapper: ReturnType<typeof mountModule>['wrapper'], label: string) {
  return wrapper.findAll('button').find((button) => button.text() === label)
}

/**
 * An action on the card itself, found by accessible name and scoped to the
 * action rows. Both halves matter: the machine-state controls are icon-only or
 * icon-plus-abbreviation, so they have no text to match on, and a confirmation
 * dialog's own confirm button carries the same name as the control that opens
 * it — matching on text across the whole wrapper silently clicked the dialog's
 * button instead and made a test pass while skipping the confirmation entirely.
 */
function cardAction(wrapper: ReturnType<typeof mountModule>['wrapper'], label: string) {
  return wrapper
    .findAll('.movement-actions__row button, .jog-matrix--machine button')
    .find((button) => button.attributes('aria-label') === label || button.text() === label)
}

async function confirmOpenDialog(wrapper: ReturnType<typeof mountModule>['wrapper']) {
  const dialog = wrapper.findAll('dialog').find((d) => (d.element as HTMLDialogElement).open)
  await dialog?.get('.confirm-dialog__actions button').trigger('click')
}

describe('MovementModule', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('jogs directly from a step button, with no step to arm first', async () => {
    const { printer, wrapper } = mountModule()
    const moveAxis = vi.spyOn(printer, 'moveAxis').mockResolvedValue(true)
    readyToMove(printer)
    await flushPromises()

    const rows = wrapper.findAll('.jog-matrix:not(.jog-matrix--machine)')
    expect(rows).toHaveLength(3)
    // Three steps, the pivot, three steps.
    expect(rows[0]?.findAll('button')).toHaveLength(7)
    // Symmetric about the pivot: the largest movement sits at both outer edges.
    expect(rows[0]?.findAll('button').map((button) => button.text())).toEqual([
      '−100',
      '−10',
      '−1',
      'X',
      '+1',
      '+10',
      '+100',
    ])

    await rows[0]?.findAll('button').at(0)?.trigger('click')
    expect(moveAxis).toHaveBeenLastCalledWith('X', -100)

    await rows[0]?.findAll('button').at(6)?.trigger('click')
    expect(moveAxis).toHaveBeenLastCalledWith('X', 100)

    await rows[2]?.findAll('button').at(4)?.trigger('click')
    expect(moveAxis).toHaveBeenLastCalledWith('Z', 0.1)
  })

  it('states the not-homed precondition once for the card, not once per control', async () => {
    const { printer, wrapper } = mountModule()
    printer.motion.homedAxes = ''
    await flushPromises()

    expect(wrapper.findAll('.movement-chip')).toHaveLength(1)
    expect(wrapper.get('.movement-chip').text()).toBe('Not homed')
    // The old design repeated "Home first" beside every gated control.
    expect(wrapper.text()).not.toContain('Home first')
  })

  it('homes a single axis from its pivot, which also carries that axis homed state', async () => {
    const { printer, wrapper } = mountModule()
    const homeAxes = vi.spyOn(printer, 'homeAxes').mockResolvedValue(true)
    printer.motion.homedAxes = 'xy'
    await flushPromises()

    const pivots = wrapper.findAll('.jog-pivot:not(.jog-pivot--primary)')
    expect(pivots).toHaveLength(3)
    expect(pivots[0]?.classes()).toContain('jog-pivot--homed')
    expect(pivots[2]?.classes()).not.toContain('jog-pivot--homed')
    // A shape, so the state is not carried by colour alone.
    expect(pivots[0]?.find('.jog-pivot__dot').exists()).toBe(false)
    expect(pivots[2]?.find('.jog-pivot__dot').exists()).toBe(true)
    expect(pivots[2]?.attributes('aria-label')).toBe('Z is not homed — home it')

    await pivots[2]?.trigger('click')
    expect(homeAxes).toHaveBeenCalledWith('Z')
  })

  it('gates every motion control on homing, and enables them once homed', async () => {
    const { printer, wrapper } = mountModule({ leveling: ['screwsTiltAdjust'] })
    printer.buildVolume.minimum = [0, 0, 0]
    printer.buildVolume.maximum = [300, 300, 340]
    await flushPromises()

    const gated = () => [
      wrapper.findAll('.jog-matrix:not(.jog-matrix--machine)')[0]?.findAll('button').at(0),
      buttonNamed(wrapper, 'Park centre'),
      buttonNamed(wrapper, 'Check bed screws'),
      // Every offset control issues MOVE=1, which Klipper refuses on an
      // unhomed axis — these used to be enabled and fail with a command error.
      wrapper.findAll('.trim__steps button').at(0),
      wrapper.find('.trim__line [aria-label="Reset Z offset"]'),
    ]
    for (const control of gated()) expect(control?.attributes('disabled')).toBeDefined()

    printer.motion.homedAxes = 'xyz'
    await flushPromises()
    for (const control of gated()) expect(control?.attributes('disabled')).toBeUndefined()
  })

  it('keeps every control disabled while Home all is still homing a later axis', async () => {
    const { printer, wrapper } = mountModule({ leveling: ['screwsTiltAdjust'] })
    printer.buildVolume.minimum = [0, 0, 0]
    printer.buildVolume.maximum = [300, 300, 340]
    // homeAxes() homes sequentially: X and Y already report homed while the
    // overall command — Z is still moving — has not resolved yet.
    printer.motion.homedAxes = 'xy'
    printer.pendingCommands.home = true
    await flushPromises()

    const gated = [
      wrapper.findAll('.jog-matrix:not(.jog-matrix--machine)')[0]?.findAll('button').at(0), // X, already homed
      buttonNamed(wrapper, 'Park centre'),
      buttonNamed(wrapper, 'Check bed screws'),
      wrapper.findAll('.trim__steps button').at(0),
    ]
    for (const control of gated) expect(control?.attributes('disabled')).toBeDefined()

    printer.motion.homedAxes = 'xyz'
    printer.pendingCommands.home = false
    await flushPromises()
    for (const control of gated) expect(control?.attributes('disabled')).toBeUndefined()
  })

  /**
   * A jog, a home, or a probing routine issued over a running job is a crash
   * the same control is perfectly safe to run while idle — so the jog matrix
   * and every leveling button hide outright rather than merely disabling.
   * Park positions stay visible but disabled, since parking is still a
   * reasonable thing to want to see the option for. Z-offset babystepping is
   * unaffected either way: `SET_GCODE_OFFSET ... MOVE=1` is the one motion
   * command meant to run mid-print, to dial in a first layer.
   */
  it('hides the jog matrix and every leveling button while a print is active, but not Z-offset babystepping', async () => {
    const { printer, wrapper } = mountModule({ leveling: ['screwsTiltAdjust'] })
    readyToMove(printer)
    printer.printStats.state = 'printing'
    await flushPromises()

    expect(wrapper.findAll('.jog-matrix:not(.jog-matrix--machine)')).toHaveLength(0)
    expect(wrapper.find('.jog-matrix--machine').exists()).toBe(false)
    expect(buttonNamed(wrapper, 'Check bed screws')).toBeUndefined()

    const parkCentre = buttonNamed(wrapper, 'Park centre')
    expect(parkCentre?.attributes('disabled')).toBeDefined()

    const zOffsetControls = [
      wrapper.findAll('.trim__steps button').at(0),
      wrapper.find('.trim__line [aria-label="Reset Z offset"]'),
    ]
    for (const control of zOffsetControls) expect(control?.attributes('disabled')).toBeUndefined()

    printer.printStats.state = 'standby'
    await flushPromises()
    expect(wrapper.findAll('.jog-matrix:not(.jog-matrix--machine)')).toHaveLength(3)
    expect(wrapper.find('.jog-matrix--machine').exists()).toBe(true)
    expect(buttonNamed(wrapper, 'Check bed screws')).toBeDefined()
    expect(buttonNamed(wrapper, 'Park centre')?.attributes('disabled')).toBeUndefined()
  })

  /**
   * `showBedScrewsCheck` moves the button rather than duplicating it: the
   * same action reachable from two places would read as two different
   * actions to a screen reader, and a click on either has to run exactly the
   * one command either way.
   */
  it('replaces the leveling row\'s "Check bed screws" with the shortcut, rather than duplicating it', async () => {
    const { printer, wrapper } = mountModule({
      leveling: ['screwsTiltAdjust', 'zTilt'],
      config: { showBedScrewsCheck: true },
    })
    readyToMove(printer)
    await flushPromises()

    expect(buttonNamed(wrapper, 'Check bed screws')).toBeUndefined()
    expect(buttonNamed(wrapper, 'Adjust Z tilt')).toBeDefined()
    const shortcut = wrapper.find('.jog-leveling-shortcut')
    expect(shortcut.exists()).toBe(true)
    expect(shortcut.attributes('aria-label')).toBe('Check bed screws')
  })

  /** A machine with no `[screws_tilt_adjust]` gets nothing extra, setting or not. */
  it('offers no shortcut for a leveling method this printer does not report', async () => {
    const { printer, wrapper } = mountModule({
      leveling: ['zTilt'],
      config: { showBedScrewsCheck: true },
    })
    readyToMove(printer)
    await flushPromises()

    expect(wrapper.find('.jog-leveling-shortcut').exists()).toBe(false)
    expect(buttonNamed(wrapper, 'Adjust Z tilt')).toBeDefined()
  })

  it('shows a dash instead of a stale coordinate for an axis that is not homed', async () => {
    const { printer, wrapper } = mountModule()
    printer.motion.position = [299, 246, 300.1]
    printer.motion.homedAxes = 'x'
    await flushPromises()

    // The unit and the value are separate elements of the same field, so that
    // the three fields can share a column edge — read them apart rather than
    // as one run of text.
    const fields = wrapper.findAll('.movement-axis-row .app-field')
    expect(fields.map((field) => field.get('.app-field__unit').text())).toEqual(['X', 'Y', 'Z'])
    // A homed axis's field carries the commanded target; an unhomed one
    // carries the shared dash, since there is no known position to move from
    // and no `gcode_position` to type a new one into.
    expect(fields.map((field) => (field.get('input').element as HTMLInputElement).value)).toEqual([
      '299',
      // Klipper keeps reporting these, but they are the last value held rather
      // than a known position.
      '—',
      '—',
    ])
  })

  /**
   * Without a plan to tap, typing a coordinate is the only way left to reach
   * an exact position rather than adding up jog presses by eye.
   */
  it('types an absolute position and moves the axis there once the bed plan is off', async () => {
    const { printer, wrapper } = mountModule({ config: { showBedPlan: false } })
    const moveTo = vi.spyOn(printer, 'moveTo').mockResolvedValue(true)
    printer.motion.homedAxes = 'xyz'
    printer.motion.position = [100, 150, 30]
    await flushPromises()

    const input = wrapper.findAll('.movement-axis-row .app-field').at(0)?.get('input')
    expect((input?.element as HTMLInputElement).value).toBe('100')

    await input?.trigger('focus')
    await input?.setValue('205.5')
    await input?.trigger('keydown', { key: 'Enter' })

    expect(moveTo).toHaveBeenCalledWith({ x: 205.5 })
  })

  /*
   * `AppField` reports an emptied box as `null` rather than the `0` that
   * `Number('')` would give it — see its own doc comment — and the commit
   * handler has to treat that as nothing to send rather than a deliberate
   * move to zero.
   */
  it('sends nothing for an axis field emptied and submitted', async () => {
    const { printer, wrapper } = mountModule({ config: { showBedPlan: false } })
    const moveTo = vi.spyOn(printer, 'moveTo').mockResolvedValue(true)
    printer.motion.homedAxes = 'xyz'
    printer.motion.position = [100, 150, 30]
    await flushPromises()

    const input = wrapper.findAll('.movement-axis-row .app-field').at(0)?.get('input')
    await input?.trigger('focus')
    await input?.setValue('')
    await input?.trigger('keydown', { key: 'Enter' })

    expect(moveTo).not.toHaveBeenCalled()
  })

  /*
   * The reason there is no separate Set button: a value typed and abandoned
   * must not sit in a box that otherwise only ever reports the commanded
   * target.
   */
  it('restores the commanded target when an axis field is left, sending nothing', async () => {
    const { printer, wrapper } = mountModule({ config: { showBedPlan: false } })
    const moveTo = vi.spyOn(printer, 'moveTo').mockResolvedValue(true)
    printer.motion.homedAxes = 'xyz'
    printer.motion.position = [100, 150, 30]
    await flushPromises()

    const input = wrapper.findAll('.movement-axis-row .app-field').at(0)?.get('input')
    await input?.trigger('focus')
    await input?.setValue('205.5')
    await input?.trigger('blur')

    expect((input?.element as HTMLInputElement).value).toBe('100')
    expect(moveTo).not.toHaveBeenCalled()
  })

  /**
   * A slow Z move and a command that was silently refused looked identical
   * before this, and `motion_report.live_velocity` was already subscribed and
   * rendered nowhere. The readout is always visible — it mutes to the idle
   * colour rather than disappearing, so it never reads as broken.
   */
  it('says the toolhead is moving, and settles back to idle once it stops', async () => {
    const { printer, wrapper } = mountModule()
    readyToMove(printer)
    await flushPromises()
    expect(wrapper.get('.movement-position__rate').classes()).toContain(
      'movement-position__rate--idle',
    )

    printer.motion.liveVelocity = 42.4
    await flushPromises()
    const rate = wrapper.get('.movement-position__rate')
    expect(rate.classes()).not.toContain('movement-position__rate--idle')
    // The reading names itself for a screen reader without spending any width
    // on it: the icon is decorative and "mm/s" is only a unit, so read aloud
    // this was a number with nothing saying what it measured.
    expect(rate.get('.sr-only').text()).toBe('Toolhead speed')
    expect(rate.get('.text-value-slot').text()).toBe('42')
    expect(rate.text()).toContain('42 mm/s')

    // motion_report settles to a small non-zero value rather than exactly zero,
    // which a bare `> 0` test would blink the readout on and off against.
    printer.motion.liveVelocity = 0.2
    await flushPromises()
    expect(wrapper.get('.movement-position__rate').classes()).toContain(
      'movement-position__rate--idle',
    )
  })

  /**
   * `Z_OFFSET_APPLY_PROBE` only stages the change; without `SAVE_CONFIG` the
   * dialed-in offset is gone at the next restart, and nothing said so.
   *
   * The card states that and stops there. Writing the config is one
   * printer-wide fact — this card stages one, a heater calibration stages
   * another, a mesh saved from Calibration a third — so it is offered once from
   * the header rather than by whichever surface happened to stage it. A card
   * that also offered the write had to gate that write on `isPrinting` itself,
   * and only this one ever did.
   */
  it('says an applied offset is unwritten without offering to write it', async () => {
    const { printer, wrapper } = mountModule()
    vi.spyOn(printer, 'applyZOffset').mockResolvedValue(true)
    const saveConfig = vi.spyOn(printer, 'saveConfig').mockResolvedValue(true)
    readyToMove(printer)
    printer.motion.homingOrigin = [0, 0, -0.125]
    await flushPromises()

    expect(wrapper.find('.trim__pending').exists()).toBe(false)

    await wrapper.get('.trim__line [aria-label="Save offset"]').trigger('click')
    printer.saveConfigPending = true
    await flushPromises()

    const pending = wrapper.get('.trim__pending')
    expect(pending.text()).toContain('Save the new config')
    // The notice is a statement: no button, so nothing here can start a write.
    expect(pending.find('button').exists()).toBe(false)
    expect(saveConfig).not.toHaveBeenCalled()

    // Cleared by the subscribed flag, so saving from the header gate, the
    // console, or another browser takes the notice away here too.
    printer.saveConfigPending = false
    await flushPromises()
    expect(wrapper.find('.trim__pending').exists()).toBe(false)
  })

  it('carries no tooltip on controls that already show their own label', async () => {
    const { printer, wrapper } = mountModule()
    readyToMove(printer)
    await flushPromises()

    for (const label of ['Motors off', 'Park centre']) {
      expect(buttonNamed(wrapper, label)?.attributes('title')).toBeUndefined()
    }
    expect(
      wrapper
        .findAll('.jog-matrix:not(.jog-matrix--machine)')[0]
        ?.findAll('button')
        .at(0)
        ?.attributes('title'),
    ).toBe(undefined)
  })

  it('confirms before releasing the motors, since the machine forgets its position', async () => {
    const { printer, wrapper } = mountModule()
    const disableMotors = vi.spyOn(printer, 'disableMotors').mockResolvedValue(true)
    await flushPromises()

    await cardAction(wrapper, 'Motors off')?.trigger('click')
    await flushPromises()
    expect(disableMotors).not.toHaveBeenCalled()

    await confirmOpenDialog(wrapper)
    expect(disableMotors).toHaveBeenCalledOnce()
  })

  /**
   * Releasing the motors mid-print drops the toolhead the instant gravity or
   * momentum gets a vote — Z falls, a still-moving axis coasts into whatever
   * is in its path. It hides with the rest of the jog matrix rather than
   * merely disabling, since it lives in the same machine-actions row.
   */
  it('hides motors off while a print is active', async () => {
    const { printer, wrapper } = mountModule()
    const disableMotors = vi.spyOn(printer, 'disableMotors').mockResolvedValue(true)
    printer.printStats.state = 'printing'
    await flushPromises()

    expect(cardAction(wrapper, 'Motors off')).toBeUndefined()

    printer.printStats.state = 'standby'
    await flushPromises()
    expect(cardAction(wrapper, 'Motors off')?.attributes('disabled')).toBeUndefined()
    await cardAction(wrapper, 'Motors off')?.trigger('click')
    await confirmOpenDialog(wrapper)
    expect(disableMotors).toHaveBeenCalledOnce()
  })

  it('releases the motors immediately when the confirmation is turned off', async () => {
    const { printer, wrapper } = mountModule({ config: { skipMotorsOffWarning: true } })
    const disableMotors = vi.spyOn(printer, 'disableMotors').mockResolvedValue(true)
    await flushPromises()

    await cardAction(wrapper, 'Motors off')?.trigger('click')
    await flushPromises()
    expect(disableMotors).toHaveBeenCalledOnce()
    expect(
      wrapper.findAll('dialog').find((d) => (d.element as HTMLDialogElement).open),
    ).toBeUndefined()
  })

  /** The global override reaches a module's own confirmation setting too. */
  it('releases the motors immediately when the global override is on', async () => {
    const { printer, wrapper, pinia } = mountModule()
    useConfirmationsStore(pinia).setSkipAll(true)
    const disableMotors = vi.spyOn(printer, 'disableMotors').mockResolvedValue(true)
    await flushPromises()

    await cardAction(wrapper, 'Motors off')?.trigger('click')
    await flushPromises()
    expect(disableMotors).toHaveBeenCalledOnce()
  })

  /**
   * The dialog is what made a one-click release of the steppers safe. With it
   * turned off the consequence moves onto the control, so the control moves up
   * a variant — see "A control whose confirmation has been turned off moves up
   * a variant" in `button-system.md`. The user who switched the guard off is
   * the one with nothing else left to warn them.
   */
  it('wears the danger variant exactly when its confirmation is turned off', async () => {
    const guarded = mountModule()
    await flushPromises()
    expect(cardAction(guarded.wrapper, 'Motors off')?.classes()).not.toContain('button--danger')

    const unguarded = mountModule({ config: { skipMotorsOffWarning: true } })
    await flushPromises()
    expect(cardAction(unguarded.wrapper, 'Motors off')?.classes()).toContain('button--danger')
  })

  it('parks to coordinates derived from the reported volume', async () => {
    const { printer, wrapper } = mountModule()
    const moveTo = vi.spyOn(printer, 'moveTo').mockResolvedValue(true)
    readyToMove(printer)
    await flushPromises()

    await buttonNamed(wrapper, 'Park centre')?.trigger('click')
    expect(moveTo).toHaveBeenCalledWith({ x: 150, y: 150 })
  })

  it('offers exactly the leveling actions the printer reports, behind a confirmation', async () => {
    const { printer, wrapper } = mountModule({ leveling: ['quadGantryLevel'] })
    const runLeveling = vi.spyOn(printer, 'runLeveling').mockResolvedValue(true)
    readyToMove(printer)
    await flushPromises()

    expect(buttonNamed(wrapper, 'Check bed screws')).toBeUndefined()
    await buttonNamed(wrapper, 'Level gantry')?.trigger('click')
    await flushPromises()
    expect(runLeveling).not.toHaveBeenCalled()

    await confirmOpenDialog(wrapper)
    expect(runLeveling).toHaveBeenCalledWith('quadGantryLevel')
  })

  /**
   * `Z_OFFSET_APPLY_PROBE` is registered by Klipper's probe object, so on a
   * machine with no probe the command does not exist and the button's only
   * possible outcome is "Unknown command". The probe-less equivalent is
   * `Z_OFFSET_APPLY_ENDSTOP`, from `manual_probe`, and it exists only where
   * `[stepper_z]` declares a `position_endstop` or the kinematics are delta —
   * so a machine with neither gets no control at all rather than one that fails.
   */
  it('folds the offset into the probe where there is one', async () => {
    const { printer, wrapper } = mountModule()
    const apply = vi.spyOn(printer, 'applyZOffset').mockResolvedValue(true)
    readyToMove(printer)
    printer.motion.homingOrigin = [0, 0, -0.125]
    await flushPromises()

    const save = wrapper.get('.trim__line [aria-label="Save offset"]')
    expect(save.attributes('title')).toBe("Fold the current offset into the probe's own Z offset")
    await save.trigger('click')
    expect(apply).toHaveBeenCalledWith('probe')
  })

  it('folds the offset into the Z endstop on a printer with no probe', async () => {
    const { printer, wrapper } = mountModule({
      sections: { stepper_z: { position_endstop: 0.5 } },
    })
    const apply = vi.spyOn(printer, 'applyZOffset').mockResolvedValue(true)
    readyToMove(printer)
    printer.motion.homingOrigin = [0, 0, -0.125]
    await flushPromises()

    const save = wrapper.get('.trim__line [aria-label="Save offset"]')
    expect(save.attributes('title')).toBe('Fold the current offset into the Z endstop position')
    await save.trigger('click')
    expect(apply).toHaveBeenCalledWith('endstop')
  })

  it('offers no way to save the offset where the machine has nowhere to put it', async () => {
    const { printer, wrapper } = mountModule({ sections: { stepper_z: {} } })
    readyToMove(printer)
    printer.motion.homingOrigin = [0, 0, -0.125]
    await flushPromises()

    // The babystep row and its reset are still there — the offset itself works
    // fine, it just cannot be made permanent from here.
    expect(wrapper.findAll('.trim__steps button')).toHaveLength(8)
    expect(wrapper.find('.trim__line [aria-label="Reset Z offset"]').exists()).toBe(true)
    expect(wrapper.find('.trim__line [aria-label="Save offset"]').exists()).toBe(false)
  })

  /**
   * A delta adjusts its three tower endstops together, which is the second
   * condition Klipper registers `Z_OFFSET_APPLY_ENDSTOP` under — and a delta has
   * no `[stepper_z]` at all, so reading only that section would have missed it.
   */
  it('treats delta kinematics as having a Z endstop to write', async () => {
    const { printer, wrapper } = mountModule({ sections: { printer: { kinematics: 'delta' } } })
    readyToMove(printer)
    printer.motion.homingOrigin = [0, 0, -0.125]
    await flushPromises()

    expect(wrapper.get('.trim__line [aria-label="Save offset"]').attributes('title')).toBe(
      'Fold the current offset into the Z endstop position',
    )
  })

  /**
   * A paused job is still a job. Jogging a paused machine is ordinary — it is
   * often why it was paused — but `M84` forgets where the axes are and takes the
   * print with them, `G28 Z` on a probe-homed machine drives the nozzle at the
   * part, and every leveling procedure probes across the plate it is halfway
   * through building. All three were offered, enabled, on a paused print.
   */
  it('keeps jogging but not homing, motors off or leveling while a print is paused', async () => {
    const { printer, wrapper } = mountModule({ leveling: ['screwsTiltAdjust'] })
    readyToMove(printer)
    printer.printStats.state = 'paused'
    await flushPromises()

    // Jogging survives, which is the whole reason this is not `isPrinting`.
    const jogRows = wrapper.findAll('.jog-matrix:not(.jog-matrix--machine)')
    expect(jogRows).toHaveLength(3)
    expect(jogRows[0]?.findAll('button').at(0)?.attributes('disabled')).toBeUndefined()

    // The pivot cannot be removed — it is the axis of its own row — so it
    // disables and says why, in the one case the card's own chip does not cover.
    const pivot = wrapper.get('.jog-pivot:not(.jog-pivot--primary)')
    expect(pivot.attributes('disabled')).toBeDefined()
    expect(pivot.attributes('title')).toBe('X cannot be homed while a job is loaded')
    expect(pivot.attributes('aria-label')).toBe('X cannot be homed while a job is loaded')

    expect(wrapper.find('.jog-matrix--machine').exists()).toBe(false)
    expect(buttonNamed(wrapper, 'Check bed screws')).toBeUndefined()

    printer.printStats.state = 'standby'
    await flushPromises()
    expect(wrapper.find('.jog-matrix--machine').exists()).toBe(true)
    expect(buttonNamed(wrapper, 'Check bed screws')).toBeDefined()
    expect(wrapper.get('.jog-pivot:not(.jog-pivot--primary)').attributes('title')).toBeUndefined()
  })

  /**
   * `AppField`'s `readonly` is a value that cannot be edited anywhere: out of
   * the tab order, no pointer events, and deliberately undimmed. This box is a
   * control that is momentarily unusable, which is what `disabled` is for —
   * shipped as `readonly`, it looked editable, took no clicks and no focus, and
   * said nothing about why while the jog buttons beside it dimmed.
   */
  it('disables the axis target boxes rather than making them read-only', async () => {
    const { printer, wrapper } = mountModule({ config: { showBedPlan: false } })
    readyToMove(printer)
    printer.printStats.state = 'printing'
    await flushPromises()

    const boxes = wrapper.findAll('.movement-axis-row input')
    expect(boxes).toHaveLength(3)
    for (const box of boxes) {
      expect(box.attributes('disabled')).toBeDefined()
      expect(box.attributes('readonly')).toBeUndefined()
    }
    expect(wrapper.get('.movement-axis-row .app-field').classes()).toContain('app-field--disabled')
  })

  /**
   * Every axis reads as homed on a machine whose gantry is out of square, and
   * the first sign is otherwise a first layer thick at one end. Klipper reports
   * it and Alabaster rendered it nowhere. `null` — the object never seen at all
   * — must stay silent, or a printer with no `[quad_gantry_level]` would be told
   * its gantry is unlevelled.
   */
  it('says when the gantry has not been levelled this session, and only then', async () => {
    const { printer, wrapper } = mountModule({ leveling: ['quadGantryLevel'] })
    readyToMove(printer)
    await flushPromises()
    expect(wrapper.find('.movement-actions__notice').exists()).toBe(false)

    printer.leveling.quadGantryApplied = false
    await flushPromises()
    expect(wrapper.get('.movement-actions__notice').text()).toBe(
      'The gantry has not been levelled since the motors were last off.',
    )

    printer.leveling.quadGantryApplied = true
    await flushPromises()
    expect(wrapper.find('.movement-actions__notice').exists()).toBe(false)
  })

  /**
   * The notice exists to send the reader to the button beside it, so it goes
   * where that button goes: left standing over a loaded job it is a caution line
   * about something the card is simultaneously refusing to let them do.
   */
  it('says nothing about an unlevelled gantry while the leveling button is gone', async () => {
    const { printer, wrapper } = mountModule({ leveling: ['quadGantryLevel'] })
    readyToMove(printer)
    printer.leveling.quadGantryApplied = false
    await flushPromises()
    expect(wrapper.find('.movement-actions__notice').exists()).toBe(true)

    printer.printStats.state = 'paused'
    await flushPromises()
    expect(buttonNamed(wrapper, 'Level gantry')).toBeUndefined()
    expect(wrapper.find('.movement-actions__notice').exists()).toBe(false)
  })

  /**
   * An empty container is not free. Every mechanism that spaces a stack is
   * conditioned on sibling structure — the shell's `space-y-4` compiles to a
   * `:not(:last-child)` margin, and a `gap` counts a zero-height item as a track
   * just the same — so a wrapper whose rows are all gated off still collects a
   * full row of spacing around nothing. Measured: 16px per empty wrapper, and two
   * of them could be empty at once.
   */
  it('renders no empty row containers, which would still take their spacing', async () => {
    const { printer, wrapper } = mountModule({ config: { showParking: false } })
    readyToMove(printer)
    printer.printStats.state = 'printing'
    await flushPromises()

    // Printing hides the jog matrix, and the plan is off during a print by
    // default, so the row that holds them both has nothing left to hold.
    expect(wrapper.find('.movement-plan').exists()).toBe(false)
    expect(wrapper.find('.jog-matrix').exists()).toBe(false)
    expect(wrapper.find('.movement-layout').exists()).toBe(false)

    // Park is off, leveling is hidden by the print, and there is no notice.
    expect(wrapper.find('.movement-actions').exists()).toBe(false)

    printer.printStats.state = 'standby'
    await flushPromises()
    // Back the moment either has something in it — the jog rows here.
    expect(wrapper.find('.movement-layout').exists()).toBe(true)
    expect(wrapper.find('.movement-actions').exists()).toBe(false)
  })

  /**
   * The container's condition and its content's are the same flags, so they
   * cannot drift into disagreeing — which is the version of this that shows up as
   * a container vanishing with a row still inside it.
   */
  it('keeps the action row container for whichever of its three rows survives', async () => {
    const { printer, wrapper } = mountModule({
      leveling: ['screwsTiltAdjust'],
      config: { showParking: false },
    })
    readyToMove(printer)
    await flushPromises()

    // Leveling alone.
    expect(wrapper.find('.movement-actions').exists()).toBe(true)
    expect(wrapper.findAll('.movement-actions__row')).toHaveLength(1)

    // The notice alone: a job hides the leveling row, so only it is left, and it
    // is deliberately gone too — leaving the container empty again.
    printer.leveling.zTiltApplied = false
    printer.printStats.state = 'paused'
    await flushPromises()
    expect(wrapper.find('.movement-actions').exists()).toBe(false)
  })

  it('offers no leveling action on a printer configured for none', async () => {
    const { printer, wrapper } = mountModule()
    readyToMove(printer)
    await flushPromises()

    expect(buttonNamed(wrapper, 'Level gantry')).toBeUndefined()
    expect(buttonNamed(wrapper, 'Check bed screws')).toBeUndefined()
  })

  it('renders screw results as turn instructions rather than raw console text', async () => {
    const { printer, gcodeConsole, wrapper } = mountModule({ leveling: ['screwsTiltAdjust'] })
    vi.spyOn(printer, 'runLeveling').mockImplementation(async () => {
      gcodeConsole.consoleEntries = [
        ...gcodeConsole.consoleEntries,
        ...[
          '// 01:20 means 1 full turn and 20 minutes, CW=clockwise, CCW=counter-clockwise',
          '// front left screw (base) : x=-5.0, y=30.0, z=2.48750',
          '// front right screw : x=155.0, y=30.0, z=2.36000 : adjust CW 01:15',
          '// rear right screw : x=155.0, y=190.0, z=2.71500 : adjust CCW 00:50',
        ].map((raw, index) => consoleEntryFromResponse(raw, index + 1, index)),
      ]
      return true
    })
    readyToMove(printer)
    await flushPromises()

    await buttonNamed(wrapper, 'Check bed screws')?.trigger('click')
    await flushPromises()
    await confirmOpenDialog(wrapper)
    await flushPromises()

    // A table, not a list of pills: the instructions are read against each
    // other, so they share a column rather than each row sizing its own.
    const table = wrapper.get('.screw-table')
    expect(table.get('.module-table__head').text()).toContain('Adjustment')
    const rows = table.findAll('.module-table__row')
    expect(rows).toHaveLength(3)
    expect(rows[0]?.text()).toContain('Reference')
    // One turn is one turn: Klipper's own line reads "CW 1 turn 15 min", and a
    // single plural form rendered the commonest non-zero case as "1 turns".
    expect(rows[1]?.text()).toContain('CW 1 turn 15 min')
    expect(rows[2]?.text()).toContain('CCW 50 min')
  })

  /**
   * The rows are a reading of a console slice, and a slice stays parseable
   * long after its run is over — so a later run of a different method has to
   * clear them rather than leave them sitting under the new command's name.
   */
  it('drops a previous run’s screw results when a different leveling method starts', async () => {
    const { printer, gcodeConsole, wrapper } = mountModule({
      leveling: ['screwsTiltAdjust', 'zTilt'],
    })
    vi.spyOn(printer, 'runLeveling').mockImplementation(async () => {
      gcodeConsole.consoleEntries = [
        ...gcodeConsole.consoleEntries,
        ...['// front left screw (base) : x=-5.0, y=30.0, z=2.48750'].map((raw, index) =>
          consoleEntryFromResponse(raw, index + 1, index),
        ),
      ]
      return true
    })
    readyToMove(printer)
    await flushPromises()

    await buttonNamed(wrapper, 'Check bed screws')?.trigger('click')
    await flushPromises()
    await confirmOpenDialog(wrapper)
    await flushPromises()
    expect(wrapper.find('.screw-table').exists()).toBe(true)

    await buttonNamed(wrapper, 'Adjust Z tilt')?.trigger('click')
    await flushPromises()
    await confirmOpenDialog(wrapper)
    await flushPromises()
    expect(wrapper.find('.screw-table').exists()).toBe(false)
  })

  /**
   * The transcript is a bounded ring of the last thousand entries, so the run's
   * own slice is remembered by entry id rather than by index: an index stops
   * meaning the same place the moment the buffer trims from the front, and the
   * rows would quietly lose their beginning or reach back into whatever came
   * before the run.
   */
  it('keeps the screw results after the console buffer has trimmed older lines', async () => {
    const { printer, gcodeConsole, wrapper } = mountModule({ leveling: ['screwsTiltAdjust'] })
    // Chatter from before the run, which the slice must exclude and which is
    // also what the trim below removes.
    gcodeConsole.consoleEntries = Array.from({ length: 5 }, (_, index) =>
      consoleEntryFromResponse(`// B:60.0 /60.0 T0:210.0 /210.0`, index + 1, index),
    )
    vi.spyOn(printer, 'runLeveling').mockImplementation(async () => {
      gcodeConsole.consoleEntries = [
        ...gcodeConsole.consoleEntries,
        ...[
          '// front left screw (base) : x=-5.0, y=30.0, z=2.48750',
          '// front right screw : x=155.0, y=30.0, z=2.36000 : adjust CW 01:15',
        ].map((raw, index) => consoleEntryFromResponse(raw, 100 + index, index)),
      ]
      return true
    })
    readyToMove(printer)
    await flushPromises()

    await buttonNamed(wrapper, 'Check bed screws')?.trigger('click')
    await flushPromises()
    await confirmOpenDialog(wrapper)
    await flushPromises()
    expect(wrapper.findAll('.screw-table .module-table__row')).toHaveLength(2)

    // The ring buffer drops from the front, which is exactly what moves every
    // remaining entry to a lower index than the slice was taken at.
    gcodeConsole.consoleEntries = gcodeConsole.consoleEntries.slice(5)
    await flushPromises()
    expect(wrapper.findAll('.screw-table .module-table__row')).toHaveLength(2)
  })

  it('offers eight Z offset steps on their own row, with the value and its actions above', async () => {
    const { printer, wrapper } = mountModule()
    const adjust = vi.spyOn(printer, 'adjustZOffset').mockResolvedValue(true)
    const apply = vi.spyOn(printer, 'applyZOffset').mockResolvedValue(true)
    readyToMove(printer)
    printer.motion.homingOrigin = [0, 0, -0.125]
    await flushPromises()

    // Micrometres by default: whole numbers, so eight of them fit one row of a
    // 299px card with their padding intact.
    expect(wrapper.get('.trim__value').text()).toBe('−125')
    expect(wrapper.get('.trim__line').text()).toContain('µm')
    const steps = wrapper.findAll('.trim__steps button')
    expect(steps).toHaveLength(8)
    // Symmetric about the row's own middle, largest at both outer edges — the
    // same shape as the jog rows, so the break when it wraps lands on the sign.
    expect(steps.map((step) => step.text())).toEqual([
      '−50',
      '−25',
      '−10',
      '−5',
      '+5',
      '+10',
      '+25',
      '+50',
    ])

    // The unit is a way of writing, never a change of what is sent.
    await steps.at(3)?.trigger('click')
    expect(adjust).toHaveBeenCalledWith(-0.005)

    await wrapper.get('.trim__line [aria-label="Save offset"]').trigger('click')
    expect(apply).toHaveBeenCalledOnce()
  })

  /**
   * A babystep's sign does not say which way the gap goes, and getting it wrong
   * drives the nozzle into the bed. `SET_GCODE_OFFSET Z_ADJUST` moves the
   * toolhead by the delta, so negative closes the gap — while the probe's own
   * `z_offset`, which this value is folded into by `Z_OFFSET_APPLY_PROBE`, runs
   * the other way round. So the row states both directions, and every step
   * carries its own, for a control read one at a time.
   */
  /**
   * `M220` scales every move the machine makes, which is why it is on this card
   * and not filed under the job it happens to be scaling — its sibling `M221`
   * already sits on Extruder for the same reason. It commits on release rather
   * than per input, because a drag from 100 to 40 passes through every value
   * between and each one is a real command.
   */
  it('scales the machine speed from a slider that commits on release', async () => {
    const { printer, wrapper } = mountModule()
    const setSpeedFactor = vi.spyOn(printer, 'setSpeedFactor').mockResolvedValue(true)
    readyToMove(printer)
    printer.motion.speedFactor = 1.5
    await flushPromises()

    const speed = wrapper.get('.app-slider')
    expect(speed.text()).toContain('Speed factor')
    expect((speed.get('.app-slider__entry input').element as HTMLInputElement).value).toBe('150')

    // Driven by hand rather than with `setValue`, which fires `change` as well
    // as `input` — and `change` is precisely the commit boundary under test, so
    // the two have to be separated to prove a drag sends nothing on its own.
    const slider = speed.get('.app-slider__track')
    ;(slider.element as HTMLInputElement).value = '120'
    await slider.trigger('input')
    expect(setSpeedFactor).not.toHaveBeenCalled()

    await slider.trigger('change')
    expect(setSpeedFactor).toHaveBeenCalledWith(120)
  })

  /**
   * The trim band is deliberately outside the gate that hides the jog matrix.
   * Slowing a running print down is the whole point of this control, and unlike
   * a manual jog `M220` is designed to be changed mid-job.
   */
  it('keeps the speed factor usable while a print is running', async () => {
    const { printer, wrapper } = mountModule()
    readyToMove(printer)
    printer.printStats.state = 'printing'
    await flushPromises()

    // The jog matrix is gone; the speed factor slider is not.
    expect(wrapper.findAll('.jog-matrix:not(.jog-matrix--machine)')).toHaveLength(0)
    const slider = wrapper.get('.app-slider__track')
    expect(slider.attributes('disabled')).toBeUndefined()
  })

  /**
   * Klipper never clears the factor itself, so one left away from 100% carries
   * into whatever prints next. The reset is how it gets put back, and it
   * disables once there so it never claims work it has nothing to do.
   */
  it('resets the speed factor to 100%, and hides its reset once there', async () => {
    const { printer, wrapper } = mountModule()
    const setSpeedFactor = vi.spyOn(printer, 'setSpeedFactor').mockResolvedValue(true)
    readyToMove(printer)
    printer.motion.speedFactor = 1.5
    await flushPromises()

    // `AppSlider`'s reset is absent, not merely disabled, once the committed
    // value already matches its reset target.
    const reset = wrapper.get('.app-slider__reset')
    await reset.trigger('click')
    expect(setSpeedFactor).toHaveBeenCalledWith(100)

    printer.motion.speedFactor = 1
    await flushPromises()
    expect(wrapper.find('.app-slider__reset').exists()).toBe(false)
  })

  it('drops the speed factor when the card configuration turns it off', async () => {
    const { printer, wrapper } = mountModule({ config: { showSpeedFactor: false } })
    readyToMove(printer)
    await flushPromises()

    expect(wrapper.text()).not.toContain('Speed factor')
    // Scoped to the slider: the bed plan's Z slider is a range input too, and
    // it has nothing to do with this setting.
    expect(wrapper.find('.app-slider').exists()).toBe(false)
  })

  it('says which way each step moves the nozzle, on the row and on every step', async () => {
    const { printer, wrapper } = mountModule()
    readyToMove(printer)
    await flushPromises()

    // The legend is terse because it has one row's width to live in; the full
    // phrasing is on each step, where a screen reader meets it.
    const legend = wrapper.get('.trim__legend').text()
    expect(legend).toContain('closer to bed')
    expect(legend).toContain('away from bed')

    const steps = wrapper.findAll('.trim__steps button')
    expect(steps.at(0)?.attributes('aria-label')).toBe(
      'Adjust Z offset by −50 µm — nozzle closer to bed',
    )
    expect(steps.at(7)?.attributes('aria-label')).toBe(
      'Adjust Z offset by +50 µm — nozzle away from bed',
    )
  })

  /**
   * Millimetres are written with a literal `.` and no leading zero in every
   * locale — the row is sized against these exact labels, and `,005` is not a
   * form any locale writes. See `offsetMagnitude`.
   */
  it('writes millimetre steps with a dot and no leading zero, and still sends millimetres', async () => {
    const { printer, wrapper } = mountModule({ config: { zOffsetUnit: 'millimetre' } })
    const adjust = vi.spyOn(printer, 'adjustZOffset').mockResolvedValue(true)
    readyToMove(printer)
    printer.motion.homingOrigin = [0, 0, -0.125]
    await flushPromises()

    expect(wrapper.get('.trim__value').text()).toBe('−.125')
    expect(wrapper.get('.trim__line').text()).toContain('mm')
    expect(wrapper.findAll('.trim__steps button').map((step) => step.text())).toEqual([
      '−.05',
      '−.025',
      '−.01',
      '−.005',
      '+.005',
      '+.01',
      '+.025',
      '+.05',
    ])

    await wrapper.findAll('.trim__steps button').at(3)?.trigger('click')
    expect(adjust).toHaveBeenCalledWith(-0.005)
  })

  it('renders the step values its configuration selects', async () => {
    const { printer, wrapper } = mountModule({ config: { planarStepScale: 'fine' } })
    readyToMove(printer)
    await flushPromises()

    expect(
      wrapper.findAll('.jog-matrix:not(.jog-matrix--machine)')[0]?.findAll('button').at(0)?.text(),
    ).toBe('−10')
  })

  /**
   * The `min / centre / max` mode is gone: it asked a spatial question and
   * answered it with numbers that never fitted the buttons drawing them —
   * `235.0` is 33px of text in a 29.9px cell — and the bed plan answers the
   * same question for any coordinate. A configuration still holding it has to
   * fall back rather than render an axis row with no steps in it.
   */
  it('falls back to a step set for a configuration still holding the retired position mode', async () => {
    const { printer, wrapper } = mountModule({ config: { planarStepScale: 'position' } })
    readyToMove(printer)
    await flushPromises()

    const xRow = wrapper.findAll('.jog-matrix:not(.jog-matrix--machine)')[0]
    expect(xRow?.findAll('button').map((button) => button.text())).toEqual([
      '−100',
      '−10',
      '−1',
      'X',
      '+1',
      '+10',
      '+100',
    ])
  })

  /**
   * The readout appears exactly once whether or not the plan is drawn — in
   * the plan's own corner when it draws, in the axis-box row above the jog
   * rows when it does not.
   */
  it('keeps one readout whether or not the plan is drawn', async () => {
    const { printer, wrapper } = mountModule()
    readyToMove(printer)
    await flushPromises()

    expect(wrapper.find('.bed-plan').exists()).toBe(true)
    expect(wrapper.findAll('.movement-axis-row .app-field')).toHaveLength(0)
    expect(wrapper.get('.bed-plan').findAll('.bed-plan__readout-axis')).toHaveLength(3)

    const off = mountModule({ config: { showBedPlan: false } })
    readyToMove(off.printer)
    await flushPromises()

    expect(off.wrapper.find('.bed-plan').exists()).toBe(false)
    expect(off.wrapper.findAll('.movement-axis-row .app-field')).toHaveLength(3)
    expect(off.wrapper.findAll('.bed-plan__readout-axis')).toHaveLength(0)
  })

  /** A printer that has not reported a volume gets the readout row instead. */
  it('falls back to the readout row when the build volume is unknown', async () => {
    const { printer, wrapper } = mountModule()
    printer.motion.homedAxes = 'xyz'
    await flushPromises()

    expect(wrapper.find('.bed-plan').exists()).toBe(false)
    expect(wrapper.findAll('.movement-axis-row .app-field')).toHaveLength(3)
  })

  /**
   * `movement-layout--paired` is what lets the wide-card container query put
   * the plan and the jog rows in two columns. Without it a lone jog column
   * still only fills the query's "auto" first track, leaving the "1fr" track
   * beside it empty — the jog matrix crammed into less than half a wide card.
   * The class has to track whether a plan is actually drawn, not just the
   * `showBedPlan` setting: a printer that has not yet reported a build volume
   * leaves the setting on with nothing for `MovementBedPlan` to draw.
   */
  it('only asks for the two-column layout when the plan is actually drawn', async () => {
    const paired = mountModule()
    readyToMove(paired.printer)
    await flushPromises()
    expect(paired.wrapper.find('.movement-layout').classes()).toContain('movement-layout--paired')

    const settingOff = mountModule({ config: { showBedPlan: false } })
    readyToMove(settingOff.printer)
    await flushPromises()
    expect(settingOff.wrapper.find('.movement-layout').classes()).not.toContain(
      'movement-layout--paired',
    )

    const noVolume = mountModule()
    noVolume.printer.motion.homedAxes = 'xyz'
    await flushPromises()
    expect(noVolume.wrapper.find('.movement-layout').classes()).not.toContain(
      'movement-layout--paired',
    )
  })

  /**
   * The field holds `gcode_position` — the G-code frame's own idea of the
   * axis, and what a typed target actually addresses — before the motion
   * transform chain applies a probed mesh's Z correction. The bracket beside
   * it (the field's own notch) is `toolheadPosition`, sampled after that
   * chain — Z's own extra digit is exactly where this divergence would
   * otherwise round back out to looking like agreement. X and Y are never
   * touched by bed_mesh, so their brackets always agree with their fields.
   */
  it('shows the toolhead’s actual position beside the commanded target', async () => {
    const { printer, wrapper } = mountModule()
    printer.motion.homedAxes = 'xyz'
    printer.motion.position = [100, 150, 29.9]
    printer.motion.livePosition = [100, 150, 30.06]
    await flushPromises()

    const fields = wrapper.findAll('.movement-axis-row .app-field')
    expect(fields).toHaveLength(3)
    expect(fields.map((field) => (field.get('input').element as HTMLInputElement).value)).toEqual([
      '100',
      '150',
      '29.9',
    ])
    expect(fields.map((field) => field.get('.app-field__label').text())).toEqual([
      '[100.00]',
      '[150.00]',
      '[30.060]',
    ])
  })

  it('keeps only visibility toggles inline, and links the rest to the surface', async () => {
    const { wrapper } = mountModule({ settingsOpen: true })
    await flushPromises()

    const rows = wrapper.findAll('.check-row')
    expect(rows.map((row) => row.text())).toEqual(['Show park positions', 'Show Z offset controls'])
    // The step scales are judged by looking at the jog buttons, so they moved
    // to the surface, where the card is docked beside them.
    expect(wrapper.text()).not.toContain('0.1 / 1 / 10')
    expect(wrapper.get('.module-settings__link-row').text()).toBe('All settings')
  })
})
