import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import FilamentCatalogueDialog from '@/components/FilamentCatalogueDialog.vue'
import TemperaturesSettingsPane from '@/components/dashboard/modules/TemperaturesSettingsPane.vue'
import { consoleEntryFromResponse } from '@/services/console/transcript'
import { dashboardModuleContextKey } from '@/dashboard/context'
import { i18n } from '@/i18n'
import { useConsoleStore } from '@/stores/console'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { useServerCapabilitiesStore } from '@/stores/serverCapabilities'
import { useSpoolStore } from '@/stores/spool'
import { useTelemetryStore, type SensorReading } from '@/stores/telemetry'

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

function reading(overrides: Partial<SensorReading> & { objectName: string }): SensorReading {
  return {
    name: overrides.objectName,
    kind: 'sensor',
    temperature: 25,
    target: null,
    power: null,
    speed: null,
    isSettable: false,
    ...overrides,
  }
}

function mountPane(
  options: {
    config?: Record<string, unknown>
    configure?: (stores: {
      printer: ReturnType<typeof usePrinterStore>
      printerConfig: ReturnType<typeof usePrinterConfigStore>
    }) => void
  } = {},
) {
  const pinia = createPinia()
  const printer = usePrinterStore(pinia)
  const gcodeConsole = useConsoleStore(pinia)
  const telemetry = useTelemetryStore(pinia)
  const printerConfig = usePrinterConfigStore(pinia)
  telemetry.sensorObjects = ['extruder', 'heater_bed']
  telemetry.readings = {
    extruder: reading({ objectName: 'extruder', kind: 'extruder', isSettable: true, target: 0 }),
    heater_bed: reading({ objectName: 'heater_bed', kind: 'bed', isSettable: true, target: 60 }),
  }
  options.configure?.({ printer, printerConfig })

  const config = ref<Record<string, unknown>>(options.config ?? {})
  const wrapper = mount(TemperaturesSettingsPane, {
    global: {
      plugins: [pinia, i18n],
      provide: {
        [dashboardModuleContextKey as symbol]: {
          instanceId: 'temperatures',
          moduleId: 'temperatures',
          config: computed(() => config.value),
          updateConfig: (patch: Record<string, unknown>) => {
            config.value = { ...config.value, ...patch }
          },
          isSettingsOpen: computed(() => false),
          openSettings: () => undefined,
          closeSettings: () => undefined,
          isSurfaceOpen: computed(() => true),
          openSurface: () => undefined,
          closeSurface: () => undefined,
        },
      },
    },
  })
  return { printer, gcodeConsole, telemetry, printerConfig, wrapper, config, pinia }
}

describe('TemperaturesSettingsPane', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it.each([['Start a calibration without confirming', 'skipCalibrationWarning']])(
    'offers to skip its own confirmation: %s',
    async (text, key) => {
      const { wrapper, config } = mountPane()
      await flushPromises()

      const row = wrapper.findAll('.check-row').find((candidate) => candidate.text().includes(text))
      const checkbox = row?.get('input[type="checkbox"]')
      expect((checkbox?.element as HTMLInputElement).checked).toBe(false)

      await checkbox?.setValue(true)
      expect(config.value[key]).toBe(true)
    },
  )

  it('starts calibrating immediately, in the danger variant, once its confirmation is off', async () => {
    const { wrapper, printer } = mountPane({
      config: { skipCalibrationWarning: true },
      configure: ({ printerConfig }) => {
        vi.spyOn(printerConfig, 'controlKindFor').mockImplementation((name) =>
          name === 'extruder' ? 'pid' : null,
        )
      },
    })
    const calibrateHeater = vi.spyOn(printer, 'calibrateHeater').mockResolvedValue(true)
    await flushPromises()

    const button = wrapper.get('.temperature-calibrate-row button')
    expect(button.classes()).toContain('button--danger')
    await button.trigger('click')
    await flushPromises()

    const openDialog = () =>
      wrapper.findAll('dialog').find((dialog) => (dialog.element as HTMLDialogElement).open)
    // The target prompt still asks — only the follow-up "are you sure" is skipped.
    await wrapper.get('.prompt-dialog__input').setValue('210')
    await openDialog()?.get('form').trigger('submit')
    await flushPromises()

    expect(calibrateHeater).toHaveBeenCalledWith('pid', 'extruder', 210)
    expect(openDialog()).toBeUndefined()
  })

  it('writes the chart shape to the card configuration', async () => {
    const { wrapper, config } = mountPane()
    await flushPromises()

    const height = wrapper.findAll('.segmented button').find((b) => b.text() === 'Standard')
    await height?.trigger('click')
    expect(config.value.chartHeight).toBe('standard')

    const window = wrapper.findAll('.segmented button').find((b) => b.text() === '10 min')
    await window?.trigger('click')
    expect(config.value.chartWindowMinutes).toBe(10)
  })

  /*
   * `showChartTargets` shipped as a stored key with no control anywhere, so the
   * only way to turn the target lines off was to hand-edit a profile. A setting
   * nothing can reach is not a setting.
   */
  it('offers the target lines a control of their own', async () => {
    const { wrapper, config } = mountPane()
    await flushPromises()

    const row = wrapper
      .findAll('.settings-row')
      .find((candidate) => candidate.text().includes('Draw target temperatures'))
    expect(row).toBeDefined()
    expect((row?.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true)

    await row?.get('input[type="checkbox"]').trigger('change')
    expect(config.value.showChartTargets).toBe(false)
  })

  it('drops the chart shape settings when the card is not showing a chart, but keeps its own toggle', async () => {
    const { wrapper } = mountPane({ config: { showChart: false } })
    await flushPromises()

    // "Show the history chart" is what turns the rest back on, so it cannot
    // be one of the rows it hides — the toggle must always be reachable.
    // Counted within the chart's own section: every other section of the pane
    // is built from the same `.settings-row`, so counting the whole pane would
    // measure the confirmations below it too.
    const chartSection = wrapper.get('.surface-section')
    expect(chartSection.findAll('.settings-row')).toHaveLength(1)
    expect(chartSection.text()).not.toContain('Draw target temperatures')
    expect(chartSection.get('.settings-row').text()).toContain('Show the history chart')
  })

  /*
   * Add wrote a row with no name yet, and the editor was reading its rows back
   * through the card's own reader — which drops exactly that row, because a
   * nameless button is unpressable. The row never appeared, so Add looked like
   * a button wired to nothing.
   */
  it('shows the row Add creates, unnamed, and puts the caret in it', async () => {
    const { wrapper, config } = mountPane()
    await flushPromises()
    expect(wrapper.findAll('.preset-row')).toHaveLength(3)

    const add = wrapper.findAll('button').find((button) => button.text() === 'Add preset')
    await add?.trigger('click')
    await flushPromises()

    const rows = wrapper.findAll('.preset-row')
    expect(rows).toHaveLength(4)
    expect((rows[3]?.findAll('input')[0]?.element as HTMLInputElement).value).toBe('')
    expect(config.value.presets).toHaveLength(4)
  })

  /*
   * The pane lists sensors a live printer keeps updating, so it re-renders
   * several times a second — and Vue re-applies a `:value` binding on every
   * render whether or not the bound value changed. A field rendered from the
   * value it only commits on `change` was therefore reset mid-word: against a
   * connected machine, typing the second character of a new temperature was
   * impossible, while every fixture in this file was slow enough to pass.
   */
  it('keeps a half-typed preset through the re-renders a live printer causes', async () => {
    const { wrapper, telemetry, config } = mountPane()
    await flushPromises()

    const hotend = wrapper.findAll('.preset-row')[0]?.findAll('input')[1]
    const element = hotend?.element as HTMLInputElement
    // Typed, not yet left — `setValue` fires `change` too, which is the moment
    // this test exists to get in front of.
    element.value = '2'
    await hotend?.trigger('input')

    telemetry.readings = {
      ...telemetry.readings,
      extruder: { ...telemetry.readings.extruder!, temperature: 31.2 },
    }
    await flushPromises()
    expect(element.value).toBe('2')
    // And nothing is committed until the field is left, so the card keeps the
    // preset it can still apply rather than one that sets the hotend to 2°.
    expect(config.value.presets).toBeUndefined()

    element.value = '245'
    await hotend?.trigger('input')
    await hotend?.trigger('change')
    expect((config.value.presets as { extruder: number }[])[0]?.extruder).toBe(245)
  })

  it('opens the catalogue dialog and appends a preset from the picked filament', async () => {
    const { wrapper, config } = mountPane()
    await flushPromises()

    const searchButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Search catalogue')
    expect(searchButton).toBeDefined()
    await searchButton?.trigger('click')

    const dialog = wrapper.findComponent(FilamentCatalogueDialog)
    expect(dialog.props('open')).toBe(true)

    dialog.vm.$emit('select', { name: 'Prusament PLA', extruder: 215, bed: 60 })
    await flushPromises()

    expect(dialog.props('open')).toBe(false)
    const rows = wrapper.findAll('.preset-row')
    expect(rows).toHaveLength(4)
    const lastRowInputs = rows[3]
      ?.findAll('input')
      .map((input) => (input.element as HTMLInputElement).value)
    expect(lastRowInputs).toEqual(['Prusament PLA', '215', '60'])
    expect(config.value.presets).toHaveLength(4)
  })

  it('leaves a temperature blank when the catalogue entry does not report one', async () => {
    const { wrapper } = mountPane()
    await flushPromises()

    const dialog = wrapper.findComponent(FilamentCatalogueDialog)
    dialog.vm.$emit('select', { name: 'Mystery PLA', extruder: 200, bed: null })
    await flushPromises()

    const rows = wrapper.findAll('.preset-row')
    const lastRowInputs = rows[3]
      ?.findAll('input')
      .map((input) => (input.element as HTMLInputElement).value)
    expect(lastRowInputs).toEqual(['Mystery PLA', '200', ''])
  })

  /*
   * And the blank has to survive being written down. Stored as the zero it used
   * to become, the preset was a button that switched the bed off — which is a
   * different instruction from the one the catalogue failed to give.
   */
  it('stores an unreported catalogue temperature as null, not as zero', async () => {
    const { wrapper, config } = mountPane()
    await flushPromises()

    wrapper
      .findComponent(FilamentCatalogueDialog)
      .vm.$emit('select', { name: 'Mystery PLA', extruder: 200, bed: null })
    await flushPromises()

    expect((config.value.presets as unknown[])[3]).toEqual({
      name: 'Mystery PLA',
      extruder: 200,
      bed: null,
    })
  })

  /*
   * `max` bounds a stepper press rather than a typed value, so this is the
   * guide and `applyPreset` is the guard — but a column with no ceiling at all
   * invited a 400° preset on a 300° hotend in the first place.
   */
  it('bounds each preset column by what that heater is configured to reach', async () => {
    const { wrapper } = mountPane({
      configure: ({ printerConfig }) => {
        vi.spyOn(printerConfig, 'limitsFor').mockImplementation((objectName) =>
          objectName === 'extruder' ? { minimum: 0, maximum: 285 } : { minimum: 0, maximum: 110 },
        )
      },
    })
    await flushPromises()

    const inputs = wrapper.get('.preset-row').findAll('input')
    expect(inputs[1]?.attributes('max')).toBe('285')
    expect(inputs[2]?.attributes('max')).toBe('110')
  })

  it('hides the catalogue search button on a printer without the spoolman component', async () => {
    const { wrapper, pinia } = mountPane()
    useServerCapabilitiesStore(pinia).applyServerInfo({ components: ['history'] })
    await flushPromises()

    expect(
      wrapper.findAll('button').find((button) => button.text() === 'Search catalogue'),
    ).toBeUndefined()
  })

  it('hides the catalogue search button once Spoolman itself is reported disconnected', async () => {
    const { wrapper, pinia } = mountPane()
    useSpoolStore(pinia).spoolmanConnected = false
    await flushPromises()

    expect(
      wrapper.findAll('button').find((button) => button.text() === 'Search catalogue'),
    ).toBeUndefined()
  })

  it('removes the row the trash button belongs to', async () => {
    const { wrapper, config } = mountPane()
    await flushPromises()

    await wrapper.findAll('.preset-row')[1]?.get('button').trigger('click')
    await flushPromises()

    expect(
      wrapper
        .findAll('.preset-row')
        .map((row) => (row.findAll('input')[0]?.element as HTMLInputElement).value),
    ).toEqual(['PLA', 'ABS'])
    expect((config.value.presets as { name: string }[]).map((preset) => preset.name)).toEqual([
      'PLA',
      'ABS',
    ])
  })

  it('offers PID or MPC calibration only for a heater configured for it', async () => {
    const { wrapper } = mountPane({
      configure: ({ printerConfig }) => {
        vi.spyOn(printerConfig, 'controlKindFor').mockImplementation((name) => {
          if (name === 'extruder') return 'pid'
          if (name === 'heater_bed') return 'watermark'
          return null
        })
      },
    })
    await flushPromises()

    const rows = wrapper.findAll('.temperature-calibrate-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.text()).toContain('Hotend')
    expect(rows[0]?.text()).toContain('Calibrate PID')
  })

  /**
   * The calibration runs, reports, and says its result is staged — and stops
   * there. Writing the config is one printer-wide fact, offered once from the
   * header rather than by whichever surface staged it, so this pane no longer
   * carries a save button at all and no longer has to gate one on `isPrinting`
   * itself.
   */
  it('runs a calibration end to end and says the result is staged, without offering to write it', async () => {
    const { printer, gcodeConsole, wrapper } = mountPane({
      configure: ({ printerConfig }) => {
        vi.spyOn(printerConfig, 'controlKindFor').mockImplementation((name) =>
          name === 'extruder' ? 'pid' : null,
        )
      },
    })
    const calibrateHeater = vi.spyOn(printer, 'calibrateHeater').mockImplementation(async () => {
      gcodeConsole.consoleEntries = [
        ...gcodeConsole.consoleEntries,
        consoleEntryFromResponse('pid: Kp=22.2 Ki=1.08 Kd=114', 1, 0),
      ]
      return true
    })
    const saveConfig = vi.spyOn(printer, 'saveConfig').mockResolvedValue(true)
    await flushPromises()

    const openDialog = () =>
      wrapper.findAll('dialog').find((dialog) => (dialog.element as HTMLDialogElement).open)

    await wrapper.get('.temperature-calibrate-row button').trigger('click')
    await flushPromises()
    const promptInput = wrapper.get('.prompt-dialog__input')
    expect((promptInput.element as HTMLInputElement).value).toBe('200')
    await promptInput.setValue('210')
    await openDialog()?.get('form').trigger('submit')
    await flushPromises()

    const confirmDialog = openDialog()
    expect(confirmDialog?.text()).toContain('210')
    await confirmDialog?.get('.confirm-dialog__actions button').trigger('click')
    await flushPromises()

    expect(calibrateHeater).toHaveBeenCalledWith('pid', 'extruder', 210)
    const transcript = wrapper.get('.console-output')
    expect(transcript.text()).toContain('pid: Kp=22.2 Ki=1.08 Kd=114')
    // The PID constants are the whole point of running this, and text selection
    // is off by default — so the transcript opts in, like the two before it.
    expect(transcript.classes()).toContain('selectable')

    // It says the model is staged, and names where to make it permanent.
    expect(wrapper.text()).toContain('staged')
    expect(wrapper.text()).toContain('save the new config to keep it')
    // No save control anywhere in the pane, so nothing here can start a write.
    expect(wrapper.findAll('button').some((button) => /save/i.test(button.text()))).toBe(false)
    expect(saveConfig).not.toHaveBeenCalled()
  })

  /*
   * A calibration drives its heater through a multi-minute heat-up cycle, which
   * ends a paused print as surely as it ruins a running one. The button carried
   * no print gate at all while the section's hint and its confirmation both read
   * "do not start this while printing" — advice you could only ever read in
   * exactly the state where it applied.
   */
  it.each(['printing', 'paused'] as const)(
    'refuses to start a calibration while a job is %s, and says why',
    async (state) => {
      const { printer, wrapper } = mountPane({
        configure: ({ printerConfig }) => {
          vi.spyOn(printerConfig, 'controlKindFor').mockImplementation((name) =>
            name === 'extruder' ? 'pid' : null,
          )
        },
      })
      printer.printStats.state = state
      await flushPromises()

      const button = wrapper.get('.temperature-calibrate-row button')
      expect(button.attributes('disabled')).toBeDefined()
      expect(button.attributes('title')).toBe('Calibration cannot run while a job is loaded')

      printer.printStats.state = 'standby'
      await flushPromises()
      expect(
        wrapper.get('.temperature-calibrate-row button').attributes('disabled'),
      ).toBeUndefined()
    },
  )

  /*
   * The swatch's selected marker was a floppy disk: `save` is the icon every
   * real write in the product uses, and `check` — which existed and was
   * reached by nothing — is what a chosen colour means.
   */
  it('marks the chosen colour with a check rather than a save glyph', async () => {
    const { wrapper } = mountPane()
    await flushPromises()

    const chosen = wrapper
      .findAll('.palette-swatch')
      .find((swatch) => swatch.attributes('aria-pressed') === 'true')
    expect(chosen?.findComponent({ name: 'AppIcon' }).props('name')).toBe('check')
  })

  /*
   * Both `listSensors` and `chartSeries` treat an empty stored list as "never
   * customized, show everything" — right for an instance nobody has touched
   * yet, wrong once the user has actually unticked every row. Unticking the
   * last one used to write `[]`, which the reader then read back as "all of
   * them" and re-checked every box it had just cleared.
   */
  it('lets every sensor be unticked from the list and the chart, without reviving them', async () => {
    const { wrapper, config } = mountPane()
    await flushPromises()

    const listBoxes = () =>
      wrapper
        .findAll('input[type="checkbox"]')
        .filter((input) => (input.attributes('aria-label') ?? '').startsWith('Show '))
    const chartBoxes = () =>
      wrapper
        .findAll('input[type="checkbox"]')
        .filter((input) => (input.attributes('aria-label') ?? '').startsWith('Draw '))
    expect(listBoxes()).toHaveLength(2)
    expect(chartBoxes()).toHaveLength(2)

    for (const box of listBoxes()) {
      await box.setValue(false)
    }
    expect(config.value.listSensors).toEqual([])
    expect(listBoxes().every((box) => (box.element as HTMLInputElement).checked === false)).toBe(
      true,
    )

    for (const box of chartBoxes()) {
      await box.setValue(false)
    }
    expect(config.value.chartSeries).toEqual([])
    expect(chartBoxes().every((box) => (box.element as HTMLInputElement).checked === false)).toBe(
      true,
    )
  })
})
