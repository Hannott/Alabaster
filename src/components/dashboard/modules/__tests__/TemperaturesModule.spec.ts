import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import TemperaturesModule from '@/components/dashboard/modules/TemperaturesModule.vue'
import { dashboardModuleContextKey } from '@/dashboard/context'
import { i18n } from '@/i18n'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'
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

function mountModule(
  options: {
    settingsOpen?: boolean
    config?: Record<string, unknown>
    /** Puts the card in the document, for the tests that assert where focus went. */
    attach?: boolean
    configure?: (stores: {
      printer: ReturnType<typeof usePrinterStore>
      telemetry: ReturnType<typeof useTelemetryStore>
      printerConfig: ReturnType<typeof usePrinterConfigStore>
    }) => void
  } = {},
) {
  const pinia = createPinia()
  const printer = usePrinterStore(pinia)
  const telemetry = useTelemetryStore(pinia)
  const printerConfig = usePrinterConfigStore(pinia)
  telemetry.sensorObjects = ['extruder', 'heater_bed', 'temperature_sensor y_stepper']
  telemetry.readings = {
    extruder: reading({ objectName: 'extruder', kind: 'extruder', isSettable: true, target: 0 }),
    heater_bed: reading({
      objectName: 'heater_bed',
      kind: 'bed',
      isSettable: true,
      target: 60,
      power: 0.42,
    }),
    'temperature_sensor y_stepper': reading({
      objectName: 'temperature_sensor y_stepper',
      name: 'y stepper',
      temperature: 27.3,
    }),
  }
  // Spies must be attached before the initial render, since the template calls
  // these directly rather than through a reactive getter — mounting first
  // would render with the store's real implementation once already.
  options.configure?.({ printer, telemetry, printerConfig })

  const config = ref<Record<string, unknown>>(options.config ?? {})
  const settingsOpen = ref(options.settingsOpen ?? false)
  const wrapper = mount(TemperaturesModule, {
    ...(options.attach ? { attachTo: document.body } : {}),
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
          isSettingsOpen: computed(() => settingsOpen.value),
          openSettings: () => (settingsOpen.value = true),
          closeSettings: () => (settingsOpen.value = false),
        },
      },
    },
  })
  return { printer, telemetry, printerConfig, wrapper, config }
}

describe('TemperaturesModule', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('renders every reported sensor and only offers targets for heaters', async () => {
    const { wrapper } = mountModule()
    await flushPromises()

    const rows = wrapper.findAll('.module-table__row')
    expect(rows).toHaveLength(3)
    expect(rows[0]?.text()).toContain('Hotend')
    expect(rows[1]?.text()).toContain('Bed')
    expect(rows[1]?.text()).toContain('42%')
    expect(rows[2]?.text()).toContain('y stepper')
    // A sensor that only reports still gets a field, because the reading is
    // what the box holds — it is read-only, which is the whole difference.
    expect(rows[2]?.get('input').attributes('readonly')).toBeDefined()
    expect(rows[0]?.get('input').attributes('readonly')).toBeUndefined()
  })

  /*
   * The columns are the whole point of the table: one grid, rows that are
   * `subgrid` boxes over its tracks, so a column is as wide as the widest cell
   * anywhere in the card rather than in its own row. jsdom does no layout, so
   * what is asserted here is the structure that makes that true — every row a
   * direct child of the one grid, rather than laying its own cells out inside
   * a box of its own, which is what the previous per-row flex container did.
   */
  it('lays every sensor out as rows of one shared grid', async () => {
    const { wrapper } = mountModule()
    await flushPromises()

    expect(wrapper.findAll('.module-table')).toHaveLength(1)
    for (const row of wrapper.findAll('.module-table__row')) {
      expect(row.findAll('.module-table__name')).toHaveLength(1)
      expect(row.element.parentElement).toBe(wrapper.get('.module-table').element)
    }
  })

  /*
   * The reading and the setpoint are one field, so the two numeric headings
   * name nothing the row does not already say: the notch is the reading,
   * bracketed so it reads as one rather than as the box's name, and the unit is
   * the field's own rather than a column's. `Name` went the same way, for the
   * same reason — a label restating a column of names, costing a row of caps at
   * the top of the densest card on the dashboard. So the table has no head row
   * at all, and the scrub caption it used to hold moved onto the chart.
   */
  it('states the reading in the field that sets the target, under no heading', async () => {
    const { wrapper } = mountModule()
    await flushPromises()

    expect(wrapper.find('.module-table__head').exists()).toBe(false)

    const hotend = wrapper.findAll('.module-table__row').at(0)?.get('.temperature-cell--value')
    expect(hotend?.get('.app-field__label').text()).toBe('[25.0]')
    expect(hotend?.get('.app-field__unit').text()).toBe('°C')
    // The notch is a reading, so the accessible name says what typing does —
    // and carries the reading, which is otherwise only in the border.
    expect(hotend?.get('input').attributes('aria-label')).toBe(
      'Target temperature for Hotend, now 25.0°C',
    )
  })

  /*
   * The track is cut to the field now that no heading sits over it, and the
   * notch is the widest thing in that field — not the digits below it. Cut to
   * the digits, a passive sensor's `Reports only` shipped as `Report…`.
   */
  it('sizes the value column to the widest notch, not to its digits', () => {
    const styles = readFileSync(join(process.cwd(), 'src', 'styles', 'components.css'), 'utf8')
    const [, tracks] =
      styles.match(/\.temperature-table\s*{\s*grid-template-columns:([^;]*);/) ?? []
    expect(tracks).toBeDefined()

    // `Reports only` measures 100px at the notch's size and keeps 4px of
    // padding on each side, and the notch is inset 8px from each edge of the
    // box it is cut into — 124px before the field holds a digit.
    const rems = [...(tracks ?? '').matchAll(/([\d.]+)rem/g)].map((match) => Number(match[1]))
    expect((rems.at(-1) ?? 0) * 16).toBeGreaterThanOrEqual(124)
  })

  /*
   * The breakpoint is a measured minimum, not a round number, and it has to stay
   * under the widths the dashboard actually hands this card. It shipped at
   * 34rem, and an L column at a 1920px viewport gives the card a 542px content
   * box — two pixels short — so a row with 60px of slack in it stacked its
   * controls onto a second line and paid 39px of height for 394px of empty name
   * track. Read the number rather than the layout because jsdom resolves no
   * container query: what regresses here is the threshold, not the tracks.
   */
  it('flips to the wide row below the width an L dashboard column produces', () => {
    const styles = readFileSync(join(process.cwd(), 'src', 'styles', 'components.css'), 'utf8')
    const [, breakpoint] =
      styles.match(/@container temperature-card \(min-width: ([\d.]+)rem\)/) ?? []
    expect(breakpoint).toBeDefined()

    // 542px is the narrowest L column measured on the real dashboard, and the
    // wide row's own tracks stop overflowing at 30rem, so the threshold lives
    // between the two.
    expect(Number(breakpoint) * 16).toBeLessThanOrEqual(542)
    expect(Number(breakpoint)).toBeGreaterThanOrEqual(30)
  })

  /*
   * The cell is placed by its class, never by counting. The wide layout adds
   * two control columns that come *after* the field in the markup — source
   * order is reading-first so the field keeps its place in the tab sequence —
   * and auto-placement put the field in the first of them. That is invisible to
   * any test that only reads text, which is why this asserts the mechanism.
   */
  it('places the value cell by class rather than by source order', async () => {
    const { wrapper } = mountModule()
    await flushPromises()

    for (const row of wrapper.findAll('.module-table__row')) {
      expect(row.findAll('.temperature-cell--value')).toHaveLength(1)
    }

    const styles = readFileSync(join(process.cwd(), 'src', 'styles', 'components.css'), 'utf8')
    expect(styles).toMatch(/\.temperature-cell--value\s*{\s*grid-column: 5;/)
  })

  /*
   * The readout rewrites itself every second while a heater climbs. Sharing a
   * track with the buttons meant every rewrite resized the track and slid them
   * sideways, so they get separate cells rather than one flex row.
   */
  it('keeps the nudge controls out of the track the readout resizes', async () => {
    const { wrapper } = mountModule()
    await flushPromises()

    const bedRow = wrapper.findAll('.module-table__row').at(1)
    const controls = bedRow?.get('.temperature-controls')
    const stat = bedRow?.get('.temperature-stat')

    expect(controls?.findAll('button')).toHaveLength(3)
    expect(controls?.find('.temperature-stat').exists()).toBe(false)
    expect(stat?.findAll('button')).toHaveLength(0)
  })

  it('keeps a typed draft while a live status push would otherwise overwrite it', async () => {
    const { telemetry, wrapper } = mountModule()
    await flushPromises()

    const input = wrapper.findAll('.module-table__row').at(0)?.get('input')
    await input?.trigger('focus')
    await input?.setValue('215')

    // A real printer pushes a status update several times a second, regardless
    // of whether the user has finished typing yet — the value must actually
    // change, since the watch is a deep comparison against the previous push.
    telemetry.readings = {
      ...telemetry.readings,
      extruder: { ...telemetry.readings.extruder!, target: 5 },
    }
    await flushPromises()
    expect((input?.element as HTMLInputElement).value).toBe('215')
  })

  /*
   * Another sensor moving must not touch this row. A status push reports every
   * sensor at once, so a field that re-seeded on any of them would snap a
   * hotend value that has been sent but not yet confirmed back to the old
   * target for as long as the printer took to answer.
   */
  it('leaves an unconfirmed target alone while a different sensor moves', async () => {
    const { printer, telemetry, wrapper } = mountModule()
    vi.spyOn(printer, 'setHeaterTarget').mockResolvedValue(true)
    await flushPromises()

    const row = wrapper.findAll('.module-table__row').at(0)
    await row?.get('input').trigger('focus')
    await row?.get('input').setValue('215')
    await row?.get('input').trigger('keydown.enter')
    await flushPromises()

    telemetry.readings = {
      ...telemetry.readings,
      heater_bed: { ...telemetry.readings.heater_bed!, target: 75 },
    }
    await flushPromises()

    expect((row?.get('input').element as HTMLInputElement).value).toBe('215')
  })

  it('sets a heater target on Enter, with no button to press', async () => {
    const { printer, wrapper } = mountModule()
    const setHeaterTarget = vi.spyOn(printer, 'setHeaterTarget').mockResolvedValue(true)
    await flushPromises()

    const row = wrapper.findAll('.module-table__row').at(0)
    expect(row?.findAll('button')).toHaveLength(0)

    await row?.get('input').setValue('215')
    await row?.get('input').trigger('keydown.enter')

    expect(setHeaterTarget).toHaveBeenCalledWith('extruder', 215)
  })

  /*
   * `max_temp` bounds a typed target, not only a nudge. `min` and `max` on a
   * number input constrain a stepper press and nothing else, so a typed 500
   * reached a 300° hotend and earned a Klipper error where the buttons beside
   * the field have always clamped.
   */
  it('clamps a typed target to the heater’s configured maximum', async () => {
    const { printer, wrapper } = mountModule()
    const setHeaterTarget = vi.spyOn(printer, 'setHeaterTarget').mockResolvedValue(true)
    await flushPromises()

    const input = wrapper.findAll('.module-table__row').at(0)?.get('input')
    await input?.setValue('500')
    await input?.trigger('keydown.enter')

    expect(setHeaterTarget).toHaveBeenCalledWith('extruder', 300)
  })

  /*
   * The reason the Set button could be dropped at all. Without this, a value
   * typed and abandoned sits in the column that reports what the printer is
   * aiming for, indistinguishable from one that was actually sent.
   */
  it('restores the printer’s own target when the field is left, sending nothing', async () => {
    const { printer, wrapper } = mountModule()
    const setHeaterTarget = vi.spyOn(printer, 'setHeaterTarget').mockResolvedValue(true)
    await flushPromises()

    const input = wrapper.findAll('.module-table__row').at(1)?.get('input')
    expect((input?.element as HTMLInputElement).value).toBe('60')

    await input?.trigger('focus')
    await input?.setValue('120')
    await input?.trigger('blur')

    expect((input?.element as HTMLInputElement).value).toBe('60')
    expect(setHeaterTarget).not.toHaveBeenCalled()
  })

  /*
   * A sent target stays in the box until the printer confirms it. The field
   * keeps the caret — Enter commits without leaving, which is `AppField`'s own
   * rule — so the value has to survive the status pushes arriving between the
   * command and its confirmation rather than snapping back to the old target
   * for as long as the printer takes to answer.
   */
  it('keeps a sent target in the box while the printer catches up', async () => {
    const { printer, wrapper } = mountModule({ attach: true })
    const setHeaterTarget = vi.spyOn(printer, 'setHeaterTarget').mockResolvedValue(true)
    await flushPromises()

    const field = wrapper.findAll('.module-table__row').at(0)?.get('input')
    const element = field?.element as HTMLInputElement
    element.focus()
    await field?.trigger('focus')
    await field?.setValue('215')

    await field?.trigger('keydown.enter')
    await flushPromises()

    expect(setHeaterTarget).toHaveBeenCalledWith('extruder', 215)
    expect(element.value).toBe('215')
    wrapper.unmount()
  })

  /*
   * A refused command leaves the printer on its old target, and the box has to
   * agree with the printer rather than with what was asked for — the failure
   * line above says why. The field owns its own draft, so nothing here can
   * assign the old value back into it; rebuilding it is what re-seeds the box
   * from the setpoint the printer still holds.
   */
  it('puts a refused target back to what the printer still has', async () => {
    const { printer, wrapper } = mountModule()
    vi.spyOn(printer, 'setHeaterTarget').mockResolvedValue(false)
    await flushPromises()

    const field = () => wrapper.findAll('.module-table__row').at(1)?.get('input')
    await field()?.trigger('focus')
    await field()?.setValue('120')
    await field()?.trigger('keydown.enter')
    await flushPromises()

    expect((field()?.element as HTMLInputElement).value).toBe('60')
  })

  it('applies a material preset to the hotend and bed together', async () => {
    const { printer, wrapper } = mountModule()
    const setHeaterTarget = vi.spyOn(printer, 'setHeaterTarget').mockResolvedValue(true)
    await flushPromises()

    await wrapper.findAll('.temperature-presets .button').at(1)?.trigger('click')
    await flushPromises()

    expect(setHeaterTarget).toHaveBeenNthCalledWith(1, 'extruder', 240)
    expect(setHeaterTarget).toHaveBeenNthCalledWith(2, 'heater_bed', 80)
  })

  /*
   * The same clamp a typed target gets, and for the same reason: a preset of
   * 400° on a 300° hotend was sent verbatim and earned a Klipper error, on a
   * card whose typed field has always clamped rather than failing.
   */
  it('clamps a preset to the heater the machine actually configured', async () => {
    const { printer, wrapper } = mountModule({
      config: { presets: [{ name: 'Too hot', extruder: 400, bed: 400 }] },
      configure: ({ printerConfig }) => {
        vi.spyOn(printerConfig, 'limitsFor').mockImplementation((objectName) =>
          objectName === 'extruder' ? { minimum: 0, maximum: 300 } : { minimum: 0, maximum: 120 },
        )
      },
    })
    const setHeaterTarget = vi.spyOn(printer, 'setHeaterTarget').mockResolvedValue(true)
    await flushPromises()

    await wrapper.get('.temperature-presets .button').trigger('click')
    await flushPromises()

    expect(setHeaterTarget).toHaveBeenNthCalledWith(1, 'extruder', 300)
    expect(setHeaterTarget).toHaveBeenNthCalledWith(2, 'heater_bed', 120)
  })

  /*
   * A filament from the catalogue may carry a hotend temperature and no bed
   * temperature. Read as zero, applying it switched the bed off; null means the
   * preset leaves that heater where it is, and the button's title says so
   * rather than letting the user find out by pressing it.
   */
  it('leaves a heater alone where the preset names no temperature for it', async () => {
    const { printer, wrapper } = mountModule({
      config: { presets: [{ name: 'Hotend only', extruder: 240, bed: null }] },
    })
    const setHeaterTarget = vi.spyOn(printer, 'setHeaterTarget').mockResolvedValue(true)
    await flushPromises()

    const button = wrapper.get('.temperature-presets .button')
    expect(button.attributes('title')).toBe('Hotend 240°C, bed unchanged')

    await button.trigger('click')
    await flushPromises()

    expect(setHeaterTarget).toHaveBeenCalledOnce()
    expect(setHeaterTarget).toHaveBeenCalledWith('extruder', 240)
  })

  /*
   * Klipper runs a `temperature_fan` whenever its sensor reads above the
   * target, so `TARGET=0` is not "stop" — it is a fan pinned on forever. The
   * card shipped an Off doing exactly that. The nudge buttons stay: moving a
   * fan's threshold is a real thing to want.
   */
  it('offers no off for a temperature fan, whose target zero means always on', async () => {
    const { wrapper } = mountModule({
      configure: ({ telemetry }) => {
        telemetry.sensorObjects = ['heater_bed', 'temperature_fan chamber']
        telemetry.readings = {
          heater_bed: reading({
            objectName: 'heater_bed',
            kind: 'bed',
            isSettable: true,
            target: 60,
          }),
          'temperature_fan chamber': reading({
            objectName: 'temperature_fan chamber',
            name: 'chamber',
            kind: 'temperatureFan',
            isSettable: true,
            target: 40,
          }),
        }
      },
    })
    await flushPromises()

    const fanRow = wrapper.findAll('.module-table__row').at(1)
    expect(fanRow?.text()).toContain('chamber')
    expect(fanRow?.find('[aria-label="Turn off chamber"]').exists()).toBe(false)
    expect(fanRow?.find('[aria-label="Adjust chamber target by +5°"]').exists()).toBe(true)
  })

  /*
   * Cooldown sends `TURN_OFF_HEATERS`, which does not touch a
   * `temperature_fan`. Counting a fan's target as something to cool left the
   * button enabled on a machine where the press could only ever do nothing.
   */
  it('does not offer a cooldown for a temperature fan it cannot turn off', async () => {
    const { wrapper } = mountModule({
      configure: ({ telemetry }) => {
        telemetry.sensorObjects = ['temperature_fan chamber']
        telemetry.readings = {
          'temperature_fan chamber': reading({
            objectName: 'temperature_fan chamber',
            name: 'chamber',
            kind: 'temperatureFan',
            isSettable: true,
            target: 40,
          }),
        }
      },
    })
    await flushPromises()

    const cooldown = wrapper.get('.temperature-presets .button:last-child')
    expect(cooldown.attributes('disabled')).toBeDefined()
    expect(cooldown.attributes('title')).toBe('Nothing is heating.')
  })

  it('cools the machine down with one command', async () => {
    const { printer, wrapper } = mountModule()
    const turnOffHeaters = vi.spyOn(printer, 'turnOffHeaters').mockResolvedValue(true)
    await flushPromises()

    await wrapper.get('.temperature-presets .button:last-child').trigger('click')
    expect(turnOffHeaters).toHaveBeenCalledOnce()
  })

  /*
   * The card hands the chart its data; what the chart does with it is the
   * chart's own spec, and the arithmetic behind it is `chartGeometry`. What
   * matters here is that the recorded target reaches the chart at all — reading
   * the live target instead would draw a flat line at whatever the setpoint is
   * now, which is a claim about the past the printer never made.
   */
  it('hands the chart each series with the targets that were recorded with it', async () => {
    const { telemetry, wrapper } = mountModule()
    telemetry.temperatureHistory = [
      {
        eventtime: 1,
        values: { extruder: 25, heater_bed: 24 },
        targets: { extruder: 0, heater_bed: 60 },
      },
      {
        eventtime: 2,
        values: { extruder: 60, heater_bed: 40 },
        targets: { extruder: 215, heater_bed: 60 },
      },
    ]
    await flushPromises()

    const chart = wrapper.findComponent({ name: 'TemperatureChart' })
    expect(chart.exists()).toBe(true)

    const series = chart.props('series') as Array<{
      objectName: string
      points: unknown[]
      targetPoints: Array<{ value: number }>
    }>
    expect(series.map((entry) => entry.objectName)).toEqual(['extruder', 'heater_bed'])
    expect(series[0]?.points).toHaveLength(2)
    expect(series[0]?.targetPoints.map((point) => point.value)).toEqual([0, 215])
  })

  /*
   * With scaling off the axis becomes the machine's own ceiling, so every frame
   * is the same frame and a reading can be compared against one seen an hour
   * ago. The ceiling comes from the printer's configuration rather than a
   * constant — a bed that stops at 120 and a hotend that reaches 300 are not
   * the same chart.
   */
  it('hands the chart the machine ceiling when scaling is switched off', async () => {
    const scaled = mountModule()
    await flushPromises()
    expect(
      scaled.wrapper.findComponent({ name: 'TemperatureChart' }).props('fixedMaximum'),
    ).toBeNull()

    const fixed = mountModule({
      config: { chartAutoScale: false },
      configure: ({ printerConfig }) => {
        vi.spyOn(printerConfig, 'limitsFor').mockImplementation((objectName) =>
          objectName === 'extruder' ? { minimum: 0, maximum: 300 } : { minimum: 0, maximum: 120 },
        )
      },
    })
    await flushPromises()
    expect(fixed.wrapper.findComponent({ name: 'TemperatureChart' }).props('fixedMaximum')).toBe(
      300,
    )
  })

  /*
   * Fitted by default. Zero is a real reference and a floor that never moves,
   * but on an idle printer it spends the plot on nothing — readings of 29 and
   * 35 drew a 0–50 axis and used an eighth of its height.
   */
  it('fits the chart floor to the readings unless the card asks for zero', async () => {
    const byDefault = mountModule()
    await flushPromises()
    expect(byDefault.wrapper.findComponent({ name: 'TemperatureChart' }).props('lockToZero')).toBe(
      false,
    )

    const anchored = mountModule({ config: { chartZeroBaseline: true } })
    await flushPromises()
    expect(anchored.wrapper.findComponent({ name: 'TemperatureChart' }).props('lockToZero')).toBe(
      true,
    )
  })

  /*
   * The chart reports a moment and the table reads it out, rather than a
   * tooltip floating over the plot it describes. Every row follows the same
   * moment — including sensors the chart is not even drawing — because the
   * lookup goes to the recorded history rather than to the chart's series.
   */
  it('reads the whole table out at the moment the chart is scrubbed to', async () => {
    const { telemetry, wrapper } = mountModule()
    telemetry.temperatureHistory = [
      {
        eventtime: 100,
        values: { extruder: 25, heater_bed: 24, 'temperature_sensor y_stepper': 20 },
      },
      {
        eventtime: 200,
        values: { extruder: 210, heater_bed: 60, 'temperature_sensor y_stepper': 30 },
      },
    ]
    await flushPromises()

    // A heater's reading is the notch above its target; a sensor that only
    // reports holds its reading in the box itself.
    const notches = () =>
      wrapper.findAll('.temperature-cell--value .app-field__label').map((label) => label.text())
    const passiveReading = () =>
      (wrapper.findAll('.module-table__row').at(2)?.get('input').element as HTMLInputElement).value
    const cells = () => wrapper.findAll('.module-table__row .temperature-cell--value')
    const caption = () => wrapper.get('.temperature-reading-at')

    // Live: the readings themselves, with nothing naming a moment.
    expect(notches().slice(0, 2)).toEqual(['[25.0]', '[25.0]'])
    expect(passiveReading()).toBe('27.3')
    // Mounted and empty, so the live region exists before it has anything to
    // announce — and unpainted, so it is not a smudge on the plot corner.
    expect(caption().text()).toBe('')
    expect(caption().attributes('role')).toBe('status')
    expect(caption().classes()).not.toContain('temperature-reading-at--active')

    wrapper.findComponent({ name: 'TemperatureChart' }).vm.$emit('update:cursorEventtime', 100)
    await flushPromises()

    // One caption names the moment for the whole table, and every row follows
    // it — including the passive sensor, which the chart does not draw.
    expect(caption().text()).toMatch(/^Reading at \d{2}:\d{2}$/)
    expect(caption().classes()).toContain('temperature-reading-at--active')
    expect(notches().slice(0, 2)).toEqual(['[25.0]', '[24.0]'])
    expect(passiveReading()).toBe('20.0')

    // A reading read out of the past takes its own sensor's color, not the
    // shared accent the caption uses — so three simultaneous readings stay told
    // apart the same way the chart already tells its lines apart. Which part of
    // the field that colors is the modifier's job: coloring the notch on both
    // kinds tinted a passive row's `Reports only` as though the phrase were
    // itself a reading from four minutes ago.
    for (const cell of cells()) expect(cell.classes()).toContain('temperature-cell--scrubbed')
    expect(cells().at(0)?.classes()).toContain('temperature-reading--notch')
    expect(cells().at(2)?.classes()).toContain('temperature-reading--box')
    expect(cells().at(0)?.attributes('style')).toContain('var(--color-data-orange)')
    expect(cells().at(1)?.attributes('style')).toContain('var(--color-data-sky)')

    wrapper.findComponent({ name: 'TemperatureChart' }).vm.$emit('update:cursorEventtime', null)
    await flushPromises()
    expect(caption()?.text()).toBe('')
    expect(cells().at(0)?.classes()).not.toContain('temperature-cell--scrubbed')
  })

  /*
   * The detail line's power figure is the one other number on the card that
   * comes from telemetry rather than from the row's own state, so scrubbing
   * the chart has to rewrite it too — leaving it pinned to the live duty would
   * make it disagree with a Current column reading out four minutes ago right
   * next to it.
   */
  it('reads the detail line’s power figure out at the scrubbed moment too', async () => {
    const { telemetry, wrapper } = mountModule()
    telemetry.temperatureHistory = [
      { eventtime: 100, values: { heater_bed: 55 }, powers: { heater_bed: 0.1 } },
    ]
    await flushPromises()

    const bedStat = () =>
      wrapper.findAll('.module-table__row').at(1)?.get('.temperature-stat__value')
    const bedPowerFigure = () => bedStat()?.get('span')
    expect(bedStat()?.text()).toContain('42%')
    expect(bedPowerFigure()?.attributes('style')).toBeUndefined()

    wrapper.findComponent({ name: 'TemperatureChart' }).vm.$emit('update:cursorEventtime', 100)
    await flushPromises()
    expect(bedStat()?.text()).toContain('10%')
    // The same substitution the Current column gets: the figure takes the
    // sensor's own color while it is reading out a moment from the chart,
    // rather than staying the plain text color it is while live.
    expect(bedPowerFigure()?.attributes('style')).toContain('var(--color-data-sky)')

    wrapper.findComponent({ name: 'TemperatureChart' }).vm.$emit('update:cursorEventtime', null)
    await flushPromises()
    expect(bedStat()?.text()).toContain('42%')
    expect(bedPowerFigure()?.attributes('style')).toBeUndefined()
  })

  /*
   * Acting on a reading from four minutes ago is the one thing this must not
   * invite, so the field that commands the printer never follows the cursor.
   */
  it('never lets the target field follow the cursor into the past', async () => {
    const { telemetry, wrapper } = mountModule()
    telemetry.temperatureHistory = [
      { eventtime: 100, values: { extruder: 25 }, targets: { extruder: 0, heater_bed: 0 } },
      { eventtime: 200, values: { extruder: 210 }, targets: { extruder: 215, heater_bed: 60 } },
    ]
    await flushPromises()

    const bedTarget = () =>
      (wrapper.findAll('.module-table__row').at(1)?.get('input').element as HTMLInputElement).value
    expect(bedTarget()).toBe('60')

    wrapper.findComponent({ name: 'TemperatureChart' }).vm.$emit('update:cursorEventtime', 100)
    await flushPromises()

    expect(bedTarget()).toBe('60')
  })

  /*
   * A printer reports its MCU and host temperatures beside the ones anyone
   * watches, and a card that cannot drop those spends rows on numbers nobody
   * reads. Empty means all of them, so an untouched card lists everything.
   */
  it('lists only the sensors the card was told to list', async () => {
    const all = mountModule()
    await flushPromises()
    expect(all.wrapper.findAll('.module-table__row')).toHaveLength(3)

    const some = mountModule({ config: { listSensors: ['extruder', 'heater_bed'] } })
    await flushPromises()
    const names = some.wrapper.findAll('.module-table__name').map((cell) => cell.text())
    expect(names).toEqual(['Hotend', 'Bed'])
  })

  it('draws each sensor in its own color, and the card may choose it', async () => {
    const byDefault = mountModule()
    await flushPromises()
    const rails = () =>
      byDefault.wrapper.findAll('.temperature-rail').map((rail) => rail.attributes('style') ?? '')
    expect(rails()[0]).toContain('var(--color-data-orange)')
    expect(rails()[1]).toContain('var(--color-data-sky)')

    const chosen = mountModule({ config: { sensorColors: { extruder: 'purple' } } })
    await flushPromises()
    expect(chosen.wrapper.findAll('.temperature-rail').at(0)?.attributes('style')).toContain(
      'var(--color-data-purple)',
    )
  })

  it('hides the chart entirely when the card is configured without one', async () => {
    const { wrapper } = mountModule({ config: { showChart: false } })
    await flushPromises()

    expect(wrapper.findComponent({ name: 'TemperatureChart' }).exists()).toBe(false)
  })

  /*
   * Nudging or switching off a heater that is already off is meaningless, so
   * the whole detail line is absent rather than disabled — which is also what
   * keeps an idle card one line per sensor.
   */
  it('carries no detail line at all without an active target', async () => {
    const { wrapper } = mountModule()
    await flushPromises()

    const extruderRow = wrapper.findAll('.module-table__row').at(0)
    expect(extruderRow?.find('.temperature-detail').exists()).toBe(false)
    expect(extruderRow?.findAll('button')).toHaveLength(0)

    const bedRow = wrapper.findAll('.module-table__row').at(1)
    expect(bedRow?.find('.temperature-detail').exists()).toBe(true)
  })

  it('refuses a cooldown that would do nothing, and says why', async () => {
    const { printer, telemetry, wrapper } = mountModule()
    await flushPromises()

    const cooldown = () => wrapper.get('.temperature-presets .button:last-child')
    expect(cooldown().attributes('disabled')).toBeUndefined()

    telemetry.readings = {
      ...telemetry.readings,
      heater_bed: { ...telemetry.readings.heater_bed!, target: 0 },
    }
    await flushPromises()

    expect(cooldown().attributes('disabled')).toBeDefined()
    expect(cooldown().attributes('title')).toBe('Nothing is heating.')
    expect(printer.pendingCommands.temperature).toBe(false)
  })

  it('turns off a single heater without touching the others', async () => {
    const { printer, wrapper } = mountModule()
    const setHeaterTarget = vi.spyOn(printer, 'setHeaterTarget').mockResolvedValue(true)
    await flushPromises()

    const bedRow = wrapper.findAll('.module-table__row').at(1)
    await bedRow?.get('[aria-label="Turn off Bed"]').trigger('click')

    expect(setHeaterTarget).toHaveBeenCalledOnce()
    expect(setHeaterTarget).toHaveBeenCalledWith('heater_bed', 0)
  })

  /*
   * Switching a heater off, applying a different material's preset, or cooling
   * the whole machine down all ruin a job in progress the same way a toolhead
   * move would — so they gain the guard too. Nudging a target by a few degrees
   * does not: it is a legitimate mid-print adjustment, so it stays enabled.
   *
   * A *paused* print is the case worth asserting twice. The gate was
   * `isPrinting` alone, so the moment a print paused the card offered all three
   * enabled, and each ends the paused job rather than interrupting it — the part
   * cools off the plate and resuming reheats from cold into a print that has
   * already moved on. `hasActivePrint` is the line, the same one
   * `MovementModule` draws for homing and motors-off.
   */
  it.each(['printing', 'paused'] as const)(
    'disables heater-off, presets, and cooldown while a job is %s, but not the nudge buttons',
    async (state) => {
      const { printer, wrapper } = mountModule()
      await flushPromises()
      printer.printStats.state = state
      await flushPromises()

      const bedRow = () => wrapper.findAll('.module-table__row').at(1)
      expect(
        bedRow()
          ?.get('[aria-label="Bed cannot be turned off while a job is loaded"]')
          .attributes('disabled'),
      ).toBeDefined()
      expect(
        bedRow()?.get('[aria-label="Adjust Bed target by +5°"]').attributes('disabled'),
      ).toBeUndefined()

      const presetButtons = wrapper.findAll('.temperature-presets .button')
      for (const button of presetButtons) expect(button.attributes('disabled')).toBeDefined()
      // A disabled control whose reason is nowhere on the card is where a title
      // earns the noise — the same judgement Movement's blocked pivot makes.
      expect(presetButtons.at(0)?.attributes('title')).toBe(
        'A preset cannot be applied while a job is loaded',
      )
      expect(presetButtons.at(-1)?.attributes('title')).toBe(
        'The machine cannot be cooled down while a job is loaded',
      )

      printer.printStats.state = 'standby'
      await flushPromises()
      expect(bedRow()?.get('[aria-label="Turn off Bed"]').attributes('disabled')).toBeUndefined()
      for (const button of wrapper.findAll('.temperature-presets .button')) {
        expect(button.attributes('disabled')).toBeUndefined()
      }
    },
  )

  it('nudges an active target immediately by five degrees', async () => {
    const { printer, wrapper } = mountModule()
    const setHeaterTarget = vi.spyOn(printer, 'setHeaterTarget').mockResolvedValue(true)
    await flushPromises()

    const bedRow = wrapper.findAll('.module-table__row').at(1)
    await bedRow?.get('[aria-label="Adjust Bed target by +5°"]').trigger('click')
    await bedRow?.get('[aria-label="Adjust Bed target by −5°"]').trigger('click')

    expect(setHeaterTarget).toHaveBeenNthCalledWith(1, 'heater_bed', 65)
    expect(setHeaterTarget).toHaveBeenNthCalledWith(2, 'heater_bed', 55)
  })

  it('fills the rail to the heater’s power, and marks a passive sensor differently', async () => {
    const { wrapper } = mountModule()
    await flushPromises()

    const bedRail = wrapper.findAll('.module-table__row').at(1)?.get('.temperature-rail')
    expect(bedRail?.get('.temperature-rail__fill').attributes('style')).toContain(
      '--meter-value: 42%',
    )

    // A sensor with no power to report gets no stem — a meter it cannot fill —
    // but keeps the bulb, same as every other row.
    const passiveRail = wrapper.findAll('.module-table__row').at(2)?.get('.temperature-rail')
    expect(passiveRail?.classes()).toContain('temperature-rail--passive')
    expect(passiveRail?.find('.temperature-rail__stem').exists()).toBe(false)
    expect(passiveRail?.find('.temperature-rail__bulb').exists()).toBe(true)
  })

  /*
   * The bulb is the one part of the rail that never goes blank: a heater
   * sitting at 0% power (the extruder here, with no target and no reported
   * power) still needs its color on screen, or the card loses its key to
   * that line the moment the heater is off — the exact moment someone is
   * most likely to be scanning the rails to tell two heaters apart.
   */
  it('keeps the bulb colored even when a heater is off and its stem is empty', async () => {
    const { wrapper } = mountModule()
    await flushPromises()

    const extruderRow = wrapper.findAll('.module-table__row').at(0)
    const rail = extruderRow?.get('.temperature-rail')
    expect(rail?.get('.temperature-rail__fill').attributes('style')).toContain('--meter-value: 0%')
    expect(rail?.find('.temperature-rail__bulb').exists()).toBe(true)
  })

  it('shows an ETA once the store has a reliable one, and hides the rate readout beside it', async () => {
    const { wrapper } = mountModule({
      configure: ({ telemetry }) => {
        vi.spyOn(telemetry, 'timeToTarget').mockImplementation((name) =>
          name === 'heater_bed' ? 125 : null,
        )
        vi.spyOn(telemetry, 'rateOfChange').mockReturnValue(3)
      },
    })
    await flushPromises()

    const bedRow = wrapper.findAll('.module-table__row').at(1)
    expect(bedRow?.get('.temperature-stat__value').text()).toBe('42% · ~2m')
  })

  it('falls back to a rate readout while there is no reliable ETA', async () => {
    const { wrapper } = mountModule({
      configure: ({ telemetry }) => {
        vi.spyOn(telemetry, 'timeToTarget').mockReturnValue(null)
        vi.spyOn(telemetry, 'rateOfChange').mockImplementation((name) =>
          name === 'heater_bed' ? 2.3 : null,
        )
      },
    })
    await flushPromises()

    const bedRow = wrapper.findAll('.module-table__row').at(1)
    expect(bedRow?.get('.temperature-stat__value').text()).toBe('42% · +2.3°/min')
  })

  /*
   * Arrival used to render as "~0s" and then disappear, leaving an absence
   * where the useful reading is that the heater has settled and is holding.
   */
  it('says a heater is holding at target rather than counting down to nothing', async () => {
    const { wrapper } = mountModule({
      configure: ({ telemetry }) => {
        vi.spyOn(telemetry, 'timeToTarget').mockReturnValue(0)
      },
    })
    await flushPromises()

    const bedRow = wrapper.findAll('.module-table__row').at(1)
    expect(bedRow?.get('.temperature-stat__value').text()).toBe('42% · At target')
  })

  /*
   * An estimate of a few seconds appears, counts down through a handful of
   * frames and vanishes, which is noise where the useful reading is that the
   * heater is nearly there. The tail of every climb passes through this, not
   * only a heater fast enough to arrive inside one push.
   */
  it('does not flash a countdown that would be gone before it is read', async () => {
    const { wrapper } = mountModule({
      configure: ({ telemetry }) => {
        vi.spyOn(telemetry, 'timeToTarget').mockReturnValue(4)
      },
    })
    await flushPromises()

    const bedRow = wrapper.findAll('.module-table__row').at(1)
    expect(bedRow?.get('.temperature-stat__value').text()).toBe('42% · Almost there')
  })

  /*
   * The warning and the estimate answer the same question at different
   * confidence, so only one of them is ever up. Showing both meant the warning
   * arriving shoved the estimate sideways in a readout the user was reading.
   */
  it('drops the estimate while the stall warning is up, keeping the power figure', async () => {
    const { wrapper } = mountModule({
      configure: ({ telemetry }) => {
        vi.spyOn(telemetry, 'timeToTarget').mockReturnValue(600)
        vi.spyOn(telemetry, 'rateOfChange').mockReturnValue(4.2)
        vi.spyOn(telemetry, 'isStalled').mockImplementation((name) => name === 'heater_bed')
      },
    })
    await flushPromises()

    const stat = wrapper.findAll('.module-table__row').at(1)?.get('.temperature-stat')
    expect(stat?.get('.temperature-stat__value').text()).toBe('42%')
    expect(stat?.text()).not.toContain('~10m')
    expect(stat?.text()).not.toContain('/min')
    expect(stat?.get('.temperature-stat__stall').text()).toContain('Not climbing')
  })

  it('surfaces a stall warning without color as the only cue', async () => {
    const { wrapper } = mountModule({
      configure: ({ telemetry }) => {
        vi.spyOn(telemetry, 'timeToTarget').mockReturnValue(null)
        vi.spyOn(telemetry, 'rateOfChange').mockReturnValue(null)
        vi.spyOn(telemetry, 'isStalled').mockImplementation((name) => name === 'heater_bed')
      },
    })
    await flushPromises()

    const bedRow = wrapper.findAll('.module-table__row').at(1)
    const detail = bedRow?.find('.temperature-detail')
    expect(detail?.text()).toContain('Not climbing')
    expect(detail?.find('svg').exists()).toBe(true)
  })

  it('limits the chart to the configured time window', async () => {
    const { telemetry, wrapper } = mountModule()
    // A hundred seconds apart, so the window's floor and the samples kept
    // below it are easy to tell apart by eye.
    telemetry.temperatureHistory = Array.from({ length: 12 }, (_, index) => ({
      eventtime: index * 100,
      values: { extruder: 25 + index, heater_bed: 24 + index },
    }))
    await flushPromises()

    const drawn = (candidate: typeof wrapper): number[] => {
      const chart = candidate.findComponent({ name: 'TemperatureChart' })
      const series = chart.props('series') as Array<{ points: Array<{ eventtime: number }> }>
      return series[0]?.points.map((point) => point.eventtime) ?? []
    }

    // Newest is 1100, so the default five-minute window floors at 800.
    expect(wrapper.findComponent({ name: 'TemperatureChart' }).props('windowSeconds')).toBe(300)
    const narrow = drawn(wrapper)
    expect(narrow.filter((eventtime) => eventtime >= 800)).toEqual([800, 900, 1000, 1100])

    // Plus a bounded run of samples below the floor, so the trace carries on
    // past the plot's clipped left edge instead of ending inside it while the
    // axis scrolls — never the whole history.
    const bleed = narrow.filter((eventtime) => eventtime < 800)
    expect(bleed.length).toBeGreaterThan(0)
    expect(bleed.length).toBeLessThanOrEqual(3)

    // A wider window keeps strictly more of the same history.
    const wide = mountModule({ config: { chartWindowMinutes: 10 } })
    wide.telemetry.temperatureHistory = telemetry.temperatureHistory
    await flushPromises()
    expect(drawn(wide.wrapper).length).toBeGreaterThan(narrow.length)
  })

  it('holds the chart axis offset steady while both clocks advance together', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2024-01-01T12:00:00.100Z'))
      const { telemetry, wrapper } = mountModule()
      telemetry.temperatureHistory = [{ eventtime: 100, values: { extruder: 25, heater_bed: 24 } }]
      await flushPromises()
      const offset = () =>
        wrapper
          .findComponent({ name: 'TemperatureChart' })
          .props('wallClockOffsetSeconds') as number
      const before = offset()

      // Both clocks advance half a second, inside the *same* wall-clock second.
      // `Date#getSeconds()` truncates, so an offset built from whole seconds
      // alone would jump here rather than hold — a mismatch against the
      // continuously advancing eventtime that swings every gridline by up to a
      // full second, once a second, on an axis whose job is to slide evenly.
      vi.setSystemTime(new Date('2024-01-01T12:00:00.600Z'))
      telemetry.temperatureHistory = [
        ...telemetry.temperatureHistory,
        { eventtime: 100.5, values: { extruder: 25, heater_bed: 24 } },
      ]
      await flushPromises()

      expect(offset()).toBeCloseTo(before, 5)
    } finally {
      vi.useRealTimers()
    }
  })

  /*
   * The labels name the clock on the wall in the room with the printer. Read
   * from `Date.now()` instead of the local-time accessors, the axis is a whole
   * timezone out and still renders perfectly well-formed times, so nothing
   * about the chart looks wrong until someone compares it with a watch.
   */
  it('registers the axis against local time rather than UTC', async () => {
    vi.useFakeTimers()
    try {
      const at = new Date('2024-06-01T12:34:56.000Z')
      vi.setSystemTime(at)
      const { telemetry, wrapper } = mountModule()
      telemetry.temperatureHistory = [{ eventtime: 500, values: { extruder: 25, heater_bed: 24 } }]
      await flushPromises()

      const offset = wrapper
        .findComponent({ name: 'TemperatureChart' })
        .props('wallClockOffsetSeconds') as number
      // `offset + eventtime` is what the chart labels, so it must land on the
      // *local* seconds past midnight — computed here from the same instant so
      // the assertion holds in whatever zone the suite runs in.
      const localSecondsToday = at.getHours() * 3600 + at.getMinutes() * 60 + at.getSeconds()
      expect(offset + 500).toBeCloseTo(localSecondsToday, 3)
    } finally {
      vi.useRealTimers()
    }
  })

  /*
   * The ladder was 4/7/10rem when the chart was three unlabeled gridlines. A
   * value axis and a row of times do not fit in 4rem, and the compact card is
   * the one that has to stay readable.
   */
  it('gives the chart a height with room for its axes', async () => {
    const { wrapper } = mountModule()
    await flushPromises()
    expect(wrapper.findComponent({ name: 'TemperatureChart' }).props('heightRem')).toBe(6)

    const tall = mountModule({ config: { chartHeight: 'tall' } })
    await flushPromises()
    expect(tall.wrapper.findComponent({ name: 'TemperatureChart' }).props('heightRem')).toBe(13)
  })
})
