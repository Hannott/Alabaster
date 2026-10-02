import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { resetCalibrationSelection } from '@/composables/useCalibrationSelection'
import { i18n } from '@/i18n'
import { useAvailabilityStore } from '@/stores/availability'
import { useBedMeshStore } from '@/stores/bedMesh'
import { useCalibrationStore } from '@/stores/calibration'
import { useConsoleStore } from '@/stores/console'
import { useScrewsTiltStore } from '@/stores/screwsTilt'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'
import { useMacrosStore } from '@/stores/macros'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import { useShakeTuneStore, type ShakeTuneResult } from '@/stores/shakeTune'
import BedMeshModule from '@/components/dashboard/modules/BedMeshModule.vue'
import ConsolePanel from '@/components/console/ConsolePanel.vue'
import MovementModule from '@/components/dashboard/modules/MovementModule.vue'
import CalibrationView from '@/views/CalibrationView.vue'

enableAutoUnmount(afterEach)

let pinia: Pinia

beforeAll(() => {
  // The tuning gallery's lightbox mounts a real `<dialog>`, and jsdom ships
  // one without its modal methods.
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

beforeEach(() => {
  vi.restoreAllMocks()
  resetCalibrationSelection()
  // The hosted bed-mesh module observes its stage; jsdom has no ResizeObserver.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  )
  pinia = createPinia()
  setActivePinia(pinia)
  const moonraker = useMoonrakerStore(pinia)
  moonraker.connectionPhase = 'connected'
  const availability = useAvailabilityStore(pinia)
  availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
  availability.printerSnapshotSynchronized()
  vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({ x: 'TRIGGERED', y: 'open' } as never)
})

function testRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'overview', component: { template: '<div />' } },
      { path: '/calibration', name: 'calibration', component: { template: '<div />' } },
      { path: '/console', name: 'console', component: { template: '<div />' } },
    ],
  })
}

/**
 * Mounts the page and, when asked, selects a stage the way a reader does —
 * by clicking its tab. There is no URL to mount straight onto: the stage
 * is component state on purpose, because `App.vue` keys the routed component on
 * `route.fullPath` and a query change would remount the page under the docked
 * console. Passing nothing is what somebody arriving from the sidebar gets.
 */
async function mountView(stage?: string) {
  const router = testRouter()
  await router.push('/calibration')
  const view = mount(CalibrationView, { global: { plugins: [i18n, pinia, router] } })
  await flushPromises()
  if (stage) {
    const label = i18n.global.t(`calibration.stages.${stage}`)
    const entry = stageTabs(view).find((b) => b.text() === label)
    if (!entry) throw new Error(`the strip offers no "${label}" stage on this machine`)
    await entry.trigger('click')
    await flushPromises()
  }
  return view
}

function stageTabs(view: VueWrapper) {
  return view.findAll('.calibration-stages [role="group"] .tab-select')
}

/** The strip's own tabs, which are what the page offers this machine. */
function stageLabels(view: VueWrapper): string[] {
  return stageTabs(view).map((button) => button.text())
}

function tuningResult(folder: string, stem: string, modified: number): ShakeTuneResult {
  const path = `K-ShakeTune_results/${folder}/${stem}.png`
  return {
    name: `${stem}.png`,
    path,
    modified,
    url: `https://printer.local/server/files/config/${path}`,
  }
}

/**
 * Shake&Tune installed, so the resonance stage exists to be asked for. Results
 * are seeded after mount, because the panel's own `start()` refreshes the
 * directory as it mounts and would clear anything seeded before it.
 */
async function mountResonance() {
  vi.spyOn(useMacrosStore(pinia), 'hasMacro').mockImplementation(
    (name: string) => name === 'AXES_SHAPER_CALIBRATION',
  )
  await withResonanceTester()
  return mountView('resonance')
}

/**
 * A `[resonance_tester]` section, which every accelerometer run requires:
 * before a query has answered, it is what says the chip is worth trusting.
 */
async function withResonanceTester(): Promise<void> {
  const printerConfig = await import('@/stores/printerConfig')
  const config = printerConfig.usePrinterConfigStore(pinia)
  config.settings = { ...config.settings, resonance_tester: {} } as never
}

function seedTuningResults(): void {
  const shakeTune = useShakeTuneStore(pinia)
  shakeTune.resultsByCategory.inputShaper = [
    tuningResult('input_shaper', 'shaper_x_new', 300),
    tuningResult('input_shaper', 'shaper_x_old', 100),
  ]
  shakeTune.resultsByCategory.belts = [tuningResult('belts', 'belts_mid', 200)]
}

/** Picks a procedure from the stage's list, the way a reader does. */
async function selectProcedure(view: VueWrapper, id: string): Promise<void> {
  const name = i18n.global.t(`calibration.procedure.${id}.name`)
  const row = view.findAll('.calibration-procedure').find((button) => button.text().includes(name))
  if (!row) throw new Error(`the stage offers no "${name}" procedure on this machine`)
  await row.trigger('click')
  await flushPromises()
}

function runButton(view: VueWrapper) {
  return view.get('.calibration-run button')
}

function procedureNames(view: VueWrapper): string[] {
  return view.findAll('.calibration-procedure__name').map((name) => name.text())
}

/** What the printer answered with, after the run's own start. */
function answer(lines: string[]): void {
  const gcodeConsole = useConsoleStore(pinia)
  const last = gcodeConsole.consoleEntries.at(-1)?.id ?? 0
  gcodeConsole.consoleEntries = [
    ...gcodeConsole.consoleEntries,
    ...lines.map((raw, index) => ({
      id: last + index + 1,
      raw,
      message: raw.replace(/^\/\/\s?/, ''),
      kind: 'response' as const,
      at: 0,
    })),
  ]
}

function homed(): void {
  usePrinterStore(pinia).motion.homedAxes = 'xyz'
}

describe('Calibration view', () => {
  /**
   * The stage strip is the page's answer to "what is this destination for". The page
   * heading may not carry a standing description — `interface-standards.md`
   * forbids one — so what tells a first-time visitor is the list of jobs itself,
   * and it has to be this machine's jobs rather than a menu of everything
   * Klipper can do.
   */
  it('names the calibration jobs this machine can actually do', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    const config = printerConfig.usePrinterConfigStore(pinia)
    vi.spyOn(config, 'hasBedMesh', 'get').mockReturnValue(true)
    vi.spyOn(config, 'hasSection').mockImplementation((name: string) => name === 'extruder')

    const view = await mountView()

    expect(stageLabels(view)).toEqual(['Axes & frame', 'Bed & probe', 'Extrusion'])
  })

  /**
   * A group of toggles rather than a tablist, per `button-system.md`'s
   * `tab-select` entry, so the selection is carried by `aria-pressed`.
   */
  it('shows only the selected stage and marks its tab pressed', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'hasBedMesh', 'get').mockReturnValue(true)

    const view = await mountView('bed')

    const current = stageTabs(view).filter((button) => button.attributes('aria-pressed') === 'true')
    expect(current).toHaveLength(1)
    expect(current[0]!.text()).toBe('Bed & probe')
    expect(view.text()).toContain('Bed mesh profiles')
    expect(view.text()).not.toContain('Endstops')
  })

  /**
   * Below 48rem CSS swaps the strip for a `<select>`, and both are always in
   * the DOM — so they have to offer the same stages and drive the same
   * selection, or the two representations of "pick a job" disagree.
   */
  it('offers the same stages in the narrow-screen select, and switches with it', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'hasBedMesh', 'get').mockReturnValue(true)

    const view = await mountView()
    const select = view.get('.calibration-stages__select')
    expect(select.findAll('option').map((option) => option.text())).toEqual(stageLabels(view))

    await select.setValue('bed')
    await flushPromises()

    const pressed = stageTabs(view).find((button) => button.attributes('aria-pressed') === 'true')
    expect(pressed?.text()).toBe('Bed & probe')
    expect(view.text()).toContain('Bed mesh profiles')
  })

  /**
   * A stage whose hardware disappears mid-sitting — a Shake&Tune uninstall, a
   * config reload without `[bed_mesh]` — falls back rather than leaving the
   * canvas empty under a tab that no longer exists.
   */
  it('falls back when the selected stage stops being available', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    const config = printerConfig.usePrinterConfigStore(pinia)
    // The real reactive source, not a mocked getter: `hasBedMesh` is derived
    // from `configfile.settings`, and only moving that actually re-runs the
    // stage list the way a config reload does.
    config.settings = { bed_mesh: { mesh_min: [10, 10] } } as never

    const view = await mountView('bed')
    expect(view.text()).toContain('Bed mesh profiles')

    config.settings = {} as never
    await flushPromises()

    expect(stageLabels(view)).toEqual(['Axes & frame'])
    expect(view.text()).toContain('Endstops')
    expect(view.text()).not.toContain('Bed mesh profiles')
  })

  /**
   * The whole reason the console is on this page: Klipper answers
   * `SCREWS_TILT_CALCULATE`, `PROBE_ACCURACY` and a PID run as console text and
   * nothing else, so without it every command here sends the reader to another
   * route to find out what happened.
   */
  /*
   * Closed until asked for, and the toggle is on the page rather than the
   * heading: a reader who hides page headers gets the heading's action folded
   * into a floating menu, which is how the console stopped being reachable.
   */
  it('docks a real console on the page, closed until its bar opens it', async () => {
    const view = await mountView()

    expect(view.findComponent(ConsolePanel).exists()).toBe(false)
    const toggle = view.get('.calibration-console-toggle')
    expect(toggle.attributes('aria-expanded')).toBe('false')

    await toggle.trigger('click')
    expect(view.findComponent(ConsolePanel).exists()).toBe(true)
    expect(view.get('.calibration-console-toggle').attributes('aria-expanded')).toBe('true')

    await view.get('.calibration-console-toggle').trigger('click')
    expect(view.findComponent(ConsolePanel).exists()).toBe(false)
  })

  /**
   * The Console route's own console, not the dashboard card — which is what
   * decides whose filters and whose prompt position the reader gets. The card
   * reads one dashboard instance's configuration; the page and this bench share
   * `useConsoleSettings`, so a filter set up on either holds on the other.
   */
  it('reuses the console page panel, with the command browser and its settings', async () => {
    const view = await mountView()
    await view.get('.calibration-console-toggle').trigger('click')

    const console_ = view.getComponent(ConsolePanel)
    // Not `fill`: this page has bounded nothing, so the console states its own
    // height in lines rather than taking a pane's.
    expect(console_.props('fill')).toBeFalsy()
    expect(console_.find('.console-workspace--sized').exists()).toBe(true)

    // The toolbar the card never had: the machine's command list, and the same
    // settings the Console page edits.
    const browse = console_
      .findAll('.console-toolbar__actions button')
      .find((button) => button.text().includes('Browse commands'))
    expect(browse).toBeDefined()
    await browse?.trigger('click')
    expect(console_.find('.console-aside').exists()).toBe(true)
  })

  /**
   * Hosting the module rather than reimplementing its controls is what puts
   * levelling, the screw-turn table and the Z offset on this page without a
   * second copy of the commands behind them — and jogging is not incidental:
   * `PROBE_ACCURACY` on the next stage probes wherever the toolhead sits, so
   * its own warning used to be advice with no control on the page to act on.
   */
  it('hosts the movement module itself on the axes stage', async () => {
    const view = await mountView()

    expect(view.findComponent(MovementModule).exists()).toBe(true)
    expect(view.text()).toContain('Homing & levelling')
  })

  it('lays a short choice out as rows rather than a dropdown', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'settings', 'get').mockReturnValue({
      stepper_x: {},
      stepper_y: {},
      extruder: {},
    })
    const view = await mountView()
    await selectProcedure(view, 'stepperBuzz')

    const rows = view.findAll('.calibration-choice__row')
    expect(rows.map((row) => row.text())).toEqual(['stepper_x', 'stepper_y', 'extruder'])
    await rows[1]!.get('input').setValue(true)
    expect(view.get('.calibration-run__script').text()).toBe('STEPPER_BUZZ STEPPER=stepper_y')
  })

  it('shows the stepper check result for the stepper chosen, not for the last one run', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'settings', 'get').mockReturnValue({
      stepper_x: {},
      stepper_y: {},
    })
    const calibration = (await import('@/stores/calibration')).useCalibrationStore(pinia)
    const view = await mountView()
    await selectProcedure(view, 'stepperBuzz')
    const rows = view.findAll('.calibration-choice__row')

    // Nothing has run yet.
    expect(view.find('.calibration-result').exists()).toBe(false)

    vi.spyOn(useMoonrakerStore(pinia), 'rpcCall').mockResolvedValue('ok' as never)
    await runButton(view).trigger('click')
    await flushPromises()
    expect(view.find('.calibration-result').text()).toContain('stepper_x')

    await rows[1]!.get('input').setValue(true)
    expect(view.find('.calibration-result').exists()).toBe(false)
    expect(calibration.runFor('stepperBuzz', 'stepper_x')).not.toBeNull()

    await rows[0]!.get('input').setValue(true)
    expect(view.find('.calibration-result').text()).toContain('stepper_x')
  })

  /**
   * The step angle is the part a Marlin habit gets wrong: it lives in its own
   * option and changes steps per mm, never rotation_distance, and a CoreXY's
   * two motors have to be written together or the axes stop agreeing.
   */
  it('works out an axis rotation distance from the belt and writes both CoreXY motors', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    const quickConfig = await import('@/stores/quickConfig')
    printerConfig.usePrinterConfigStore(pinia).settings = {
      printer: { kinematics: 'corexy' },
      stepper_x: { rotation_distance: 32, microsteps: 16 },
      stepper_y: { rotation_distance: 32, microsteps: 16 },
      stepper_z: { rotation_distance: 8, microsteps: 16 },
    }
    const persist = vi
      .spyOn(quickConfig.useQuickConfigStore(pinia), 'persistOption')
      .mockResolvedValue({ status: 'saved', path: 'printer.cfg' })
    const view = await mountView()
    await selectProcedure(view, 'axisRotation')

    // A GT2 belt on a 20-tooth pulley, the calculator's first guess for X.
    const cells = () =>
      view
        .findAll('.calibration-result__table tbody tr')
        .map((row) => row.findAll('th, td').map((cell) => cell.text()))
    expect(cells()[0]).toEqual(['rotation_distance', '32', '40'])
    expect(cells()).toContainEqual([i18n.global.t('calibration.drive.stepsPerMm'), '100', '80'])

    const fine = view
      .findAll('.calibration-choice__row')
      .find((row) => row.text() === i18n.global.t('calibration.drive.angle.400'))
    await fine!.get('input').setValue(true)
    expect(cells()[0]).toEqual(['rotation_distance', '32', '40'])
    expect(cells()).toContainEqual([i18n.global.t('calibration.drive.stepsPerMm'), '100', '160'])

    const write = view
      .findAll('button')
      .find((button) => button.text() === i18n.global.t('calibration.drive.write'))
    await write!.trigger('click')
    await flushPromises()

    expect(persist.mock.calls).toEqual([
      ['stepper_x', 'rotation_distance', '40'],
      ['stepper_x', 'full_steps_per_rotation', '400'],
      ['stepper_y', 'rotation_distance', '40'],
      ['stepper_y', 'full_steps_per_rotation', '400'],
    ])
  })

  it('reads a move that went half as far as a step-angle fault, not a pulley one', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    printerConfig.usePrinterConfigStore(pinia).settings = {
      printer: { kinematics: 'cartesian' },
      stepper_z: { rotation_distance: 8, microsteps: 16 },
    }
    const view = await mountView()
    await selectProcedure(view, 'axisRotation')

    const measure = view
      .findAll('.calibration-choice__row')
      .find((row) => row.text() === i18n.global.t('calibration.drive.methodMeasure'))
    await measure!.get('input').setValue(true)
    const moved = view
      .findAll('.app-field')
      .find((field) => field.text().includes(i18n.global.t('calibration.drive.measure.measured')))
    await moved!.get('input').setValue('5')
    await flushPromises()

    expect(view.text()).toContain(i18n.global.t('calibration.drive.measure.half', { steps: 400 }))
    const first = view.get('.calibration-result__table tbody tr').findAll('th, td')
    expect(first.map((cell) => cell.text())).toEqual(['rotation_distance', '8', '8'])
  })

  /**
   * A heater calibration used to be reachable only from behind the Temperatures
   * card's gear, on another route — which is exactly what sent somebody to the
   * Dashboard in the middle of their own calibration sitting.
   */
  it('offers the heater model as a procedure with the heater and target to choose', async () => {
    const telemetry = await import('@/stores/telemetry')
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(telemetry.useTelemetryStore(pinia), 'sensors', 'get').mockReturnValue([
      { objectName: 'extruder', name: 'extruder', isSettable: true, target: 200 },
    ] as never)
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'controlKindFor').mockReturnValue('pid')

    const view = await mountView('heaters')

    expect(stageLabels(view)).toContain('Heaters')
    expect(procedureNames(view)).toContain('Heater model')
    await selectProcedure(view, 'heaterModel')
    expect(view.get('.calibration-run__script').text()).toBe(
      'PID_CALIBRATE HEATER=extruder TARGET=200',
    )
  })

  it('reports each endstop with a word, not a color alone', async () => {
    const view = await mountView()

    const rows = view.findAll('.calibration-endstop')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('x')
    expect(rows[0]!.text()).toContain('Triggered')
    expect(rows[1]!.text()).toContain('Open')

    // The state also carries a shape class, so the reading survives a display
    // that renders the accent and the muted color indistinguishably.
    expect(rows[0]!.find('.calibration-endstop__state--triggered').exists()).toBe(true)
    expect(rows[1]!.find('.calibration-endstop__state--open').exists()).toBe(true)
  })

  /**
   * The poll stops while a print runs, because the query competes with the motion
   * queue for the same MCU. What is on screen then is old, and says so once for
   * the whole panel rather than once per row.
   */
  it('says the readings are paused while a print runs', async () => {
    const view = await mountView()
    expect(view.find('.calibration-notice').exists()).toBe(false)

    usePrinterStore(pinia).printStats.state = 'printing'
    await flushPromises()

    const notice = view.find('.calibration-notice')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain('paused while a print runs')
  })

  /**
   * The gate moved up a level: a printer that can neither mesh, probe, nor level
   * has no bed job at all, so the strip never offers the stage rather than
   * offering one whose cards are all absent. A stage nobody can act on reads as
   * a broken page; a tab fewer reads as a machine without that hardware.
   */
  it('offers no bed stage at all on a printer that cannot mesh, probe or level', async () => {
    const view = await mountView()

    expect(stageLabels(view)).toEqual(['Axes & frame'])
    expect(view.text()).not.toContain('Bed mesh profiles')
  })

  it('hides the mesh panel on a probe-only printer, which still has a bed stage', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'hasProbe', 'get').mockReturnValue(true)

    const view = await mountView('bed')

    expect(stageLabels(view)).toContain('Bed & probe')
    expect(view.text()).toContain('Probe accuracy')
    expect(view.text()).not.toContain('Bed mesh profiles')
  })

  /**
   * Every saved profile is listed with the spread Klipper reported for it, so the
   * comparison costs no trip to the printer. The point of the assertion is that
   * showing the list sends no command at all: the alternative design loads each
   * profile in turn, which changes the machine to answer a question about a file.
   */
  it('lists every mesh profile without loading any of them', async () => {
    const bedMesh = useBedMeshStore(pinia)
    bedMesh.$patch({ profileName: 'default', profiles: ['default', 'textured'] } as never)
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'hasBedMesh', 'get').mockReturnValue(true)
    const loadProfile = vi.spyOn(usePrinterStore(pinia), 'loadBedMeshProfile')

    const view = await mountView('bed')

    const profiles = view.findAll('.calibration-profile')
    expect(profiles.map((profile) => profile.text())).toEqual([
      expect.stringContaining('default'),
      expect.stringContaining('textured'),
    ])
    expect(profiles[0]!.text()).toContain('mm')
    expect(profiles[0]!.attributes('aria-current')).toBe('true')
    expect(profiles[1]!.attributes('aria-current')).toBeUndefined()
    expect(loadProfile).not.toHaveBeenCalled()
  })

  /**
   * The map is the dashboard's own module hosted at page size — the same component
   * and the same renderer, not a second one. The page provides the same real
   * `dashboardModuleContextKey` context a dashboard card would, bound to the
   * `'bedMesh'` instance the layout store already keeps for every registered
   * module, which is what makes hosting it here without a card work.
   */
  it('hosts the bed mesh module itself rather than a second renderer', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'hasBedMesh', 'get').mockReturnValue(true)

    const view = await mountView('bed')

    const map = view.find('.calibration-stage__map')
    expect(map.exists()).toBe(true)
    // The module component itself, not a copy of its markup. Its stage appears
    // once a mesh is loaded; what matters here is which component draws it.
    expect(view.findComponent(BedMeshModule).exists()).toBe(true)
  })

  it('shows no map at all on a printer without a bed mesh', async () => {
    const view = await mountView()

    expect(view.find('.calibration-stage__map').exists()).toBe(false)
  })

  /**
   * The live view is the page's, not the card's: a dashboard card is a glance
   * surface and a calibration is something you sit and watch. The card is left
   * untouched, which is what the opt-in prop is for.
   */
  it('opts the map into following a run, which the dashboard card never does', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'hasBedMesh', 'get').mockReturnValue(true)

    const view = await mountView('bed')

    expect(view.findComponent(BedMeshModule).props('liveProbing')).toBe(true)
  })

  /**
   * The dashboard card is exactly the narrow context the map's density
   * fallback to dots exists for; this page's stage is generously sized
   * enough that a mesh fitting its labels there almost always would, and the
   * page exists specifically to read those numbers.
   */
  it('forces the map to keep showing numbers rather than falling back to dots', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'hasBedMesh', 'get').mockReturnValue(true)

    const view = await mountView('bed')

    expect(view.findComponent(BedMeshModule).props('forceProbeLabels')).toBe(true)
  })

  it('counts the points as they arrive and calls the shape provisional', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'hasBedMesh', 'get').mockReturnValue(true)
    const view = await mountView('bed')

    const gcodeConsole = useConsoleStore(pinia)
    gcodeConsole.consoleEntries = [
      { id: 'a', raw: 'BED_MESH_CALIBRATE', kind: 'command', at: 0 },
      {
        id: 'b',
        raw: 'probe: at 10.000,10.000 bed will contact at z=1.000000',
        kind: 'response',
        at: 0,
      },
      {
        id: 'c',
        raw: 'probe: at 50.000,10.000 bed will contact at z=1.040000',
        kind: 'response',
        at: 0,
      },
    ] as never
    await flushPromises()

    expect(view.find('.calibration-map__running').text()).toContain('2 points')
    expect(view.text()).toContain('provisional')
  })

  /**
   * A sweeping probe emits no per-point line, so there is nothing to follow. The
   * page says why rather than showing a map that never fills in.
   */
  it('explains that a scanning probe cannot be followed', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    const config = printerConfig.usePrinterConfigStore(pinia)
    vi.spyOn(config, 'hasBedMesh', 'get').mockReturnValue(true)
    vi.spyOn(config, 'hasSection').mockImplementation((name: string) => name === 'beacon')

    const view = await mountView('bed')

    expect(view.text()).toContain('scanning probe')
    expect(view.find('.calibration-map__running').exists()).toBe(false)
  })

  /**
   * A first-ever calibration has no mesh to take an area from, and the module's
   * 200 mm fallback would plot a larger bed's points off the edge of it. The
   * viewer therefore appears once there is something to draw and fits itself to
   * the points being probed.
   */
  it('opens the viewer during a first calibration, once points exist', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'hasBedMesh', 'get').mockReturnValue(true)
    const view = await mountView('bed')
    const gcodeConsole = useConsoleStore(pinia)

    // No mesh has ever been saved, so nothing is drawn yet.
    gcodeConsole.consoleEntries = [
      { id: 'a', raw: 'BED_MESH_CALIBRATE', kind: 'command', at: 0 },
    ] as never
    await flushPromises()
    expect(view.find('.mesh-stage').exists()).toBe(false)

    gcodeConsole.consoleEntries = [
      ...gcodeConsole.consoleEntries,
      {
        id: 'b',
        raw: 'probe: at 10.000,10.000 bed will contact at z=1.000000',
        kind: 'response',
        at: 0,
      },
    ] as never
    await flushPromises()

    expect(view.find('.mesh-stage').exists()).toBe(true)
  })

  /**
   * Klipper names every anonymous calibration "default", so a printer that
   * already has a saved "default" profile is the exact case a blind
   * `profileName ?? 'default'` fallback would silently overwrite.
   */
  it('suggests a numbered variant rather than defaulting onto an existing profile', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'hasBedMesh', 'get').mockReturnValue(true)
    const bedMesh = useBedMeshStore(pinia)
    bedMesh.$patch({
      profileName: 'default',
      probedMatrix: [[0.1]],
      profiles: ['default'],
    } as never)

    const view = await mountView('bed')
    const saveButton = view
      .findAll('.calibration-card__aside button')
      .find((button) => button.text().includes('Save loaded mesh'))
    await saveButton?.trigger('click')
    await flushPromises()

    // The rename dialog sits earlier in the template and is always in the DOM
    // — only the dialog actually open is the one under test.
    const input = view.get('.confirm-dialog[open] .prompt-dialog__input')
    expect((input.element as HTMLInputElement).value).toBe('default2')
  })

  it('refuses to save the mesh under a name a different profile already has', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'hasBedMesh', 'get').mockReturnValue(true)
    const bedMesh = useBedMeshStore(pinia)
    bedMesh.$patch({
      profileName: 'default',
      probedMatrix: [[0.1]],
      profiles: ['default', 'cold'],
    } as never)
    const saveBedMeshProfile = vi
      .spyOn(usePrinterStore(pinia), 'saveBedMeshProfile')
      .mockResolvedValue(true)

    const view = await mountView('bed')
    const saveButton = view
      .findAll('.calibration-card__aside button')
      .find((button) => button.text().includes('Save loaded mesh'))
    await saveButton?.trigger('click')
    await flushPromises()

    const dialog = view.get('.confirm-dialog[open]')
    const input = dialog.get('.prompt-dialog__input')
    await input.setValue('cold')
    expect(dialog.text()).toContain('A profile with that name already exists')

    await input.setValue('warm')
    await dialog.get('form').trigger('submit')
    expect(saveBedMeshProfile).toHaveBeenCalledWith('warm')
  })

  it('refuses mesh commands while a print is running', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'hasBedMesh', 'get').mockReturnValue(true)
    usePrinterStore(pinia).printStats.state = 'printing'

    const view = await mountView('bed')

    const calibrate = view
      .findAll('.calibration-card__aside button')
      .find((button) => button.text().includes('Calibrate mesh'))
    expect(calibrate!.attributes('disabled')).toBeDefined()
  })

  /**
   * The rows name results and carry no image, and only the graph being read is
   * fetched: these PNGs are several megabytes each, served by the printer's own
   * host, and the thumbnail strip this replaced downloaded every one of them at
   * full size just to paint a crop.
   */
  it('lists tuning results as rows and fetches only the graph on screen', async () => {
    const view = await mountResonance()
    seedTuningResults()
    await flushPromises()

    const rows = view.findAll('.calibration-tuning-result')
    expect(rows.map((row) => row.find('.calibration-tuning-result__name').text())).toEqual([
      'shaper_x_new',
      'shaper_x_old',
      'belts_mid',
    ])
    expect(rows.every((row) => !row.find('img').exists())).toBe(true)

    const images = view.findAll('.calibration-tuning__pane img')
    expect(images).toHaveLength(1)
    expect(images[0]!.attributes('src')).toBe(tuningResult('input_shaper', 'shaper_x_new', 300).url)
    expect(view.findAll('.calibration-card img')).toHaveLength(1)
    expect(rows[0]!.attributes('aria-current')).toBe('true')
  })

  it('shows the graph for whichever row is picked', async () => {
    const view = await mountResonance()
    seedTuningResults()
    await flushPromises()

    const belts = view
      .findAll('.calibration-tuning-result')
      .find((row) => row.text().includes('belts_mid'))
    await belts!.trigger('click')

    expect(view.get('.calibration-tuning__pane img').attributes('src')).toBe(
      tuningResult('belts', 'belts_mid', 200).url,
    )
    expect(belts!.attributes('aria-current')).toBe('true')
  })

  /**
   * Any two rows, across categories: a belts graph beside an input shaper graph
   * is how "did tensioning the belts change the shaper result" gets read. The
   * second row says so in words, not only with a differently colored bar.
   */
  it('puts a second graph beside the first in compare mode', async () => {
    const view = await mountResonance()
    seedTuningResults()
    await flushPromises()

    const compare = view
      .findAll('.calibration-card__aside button')
      .find((button) => button.text() === 'Compare')
    await compare!.trigger('click')
    expect(compare!.attributes('aria-pressed')).toBe('true')
    expect(view.text()).toContain('Choose a graph to compare')

    const belts = view
      .findAll('.calibration-tuning-result')
      .find((row) => row.text().includes('belts_mid'))
    await belts!.trigger('click')

    const sources = view
      .findAll('.calibration-tuning__pane img')
      .map((img) => img.attributes('src'))
    expect(sources).toEqual([
      tuningResult('input_shaper', 'shaper_x_new', 300).url,
      tuningResult('belts', 'belts_mid', 200).url,
    ])
    expect(belts!.text()).toContain('Compared')

    await compare!.trigger('click')
    expect(view.findAll('.calibration-tuning__pane img')).toHaveLength(1)
    expect(belts!.text()).not.toContain('Compared')
  })

  /**
   * A run that finishes presents its own graph — but only a result newer than
   * the previous newest does, so deleting a file never yanks the pane away
   * from a graph the reader chose.
   */
  it('moves to a freshly written graph, and never to one that only became newest', async () => {
    const view = await mountResonance()
    seedTuningResults()
    await flushPromises()

    const old = view
      .findAll('.calibration-tuning-result')
      .find((row) => row.text().includes('shaper_x_old'))
    await old!.trigger('click')

    const shakeTune = useShakeTuneStore(pinia)
    shakeTune.resultsByCategory.inputShaper = shakeTune.resultsByCategory.inputShaper.filter(
      (result) => !result.name.startsWith('shaper_x_new'),
    )
    await flushPromises()
    expect(view.get('.calibration-tuning__pane img').attributes('src')).toBe(
      tuningResult('input_shaper', 'shaper_x_old', 100).url,
    )

    shakeTune.resultsByCategory.inputShaper = [
      tuningResult('input_shaper', 'shaper_y_fresh', 400),
      ...shakeTune.resultsByCategory.inputShaper,
    ]
    await flushPromises()
    expect(view.get('.calibration-tuning__pane img').attributes('src')).toBe(
      tuningResult('input_shaper', 'shaper_y_fresh', 400).url,
    )
  })

  /**
   * The run's actual product — a shaper and a frequency per axis — used to
   * exist only as console text somebody had to copy into a command by hand.
   */
  it('reopens the stage and calibration that were open after leaving the page', async () => {
    const first = await mountResonance()
    await selectProcedure(first, 'shakeTuneShaper')
    first.unmount()

    const view = await mountView()
    expect(view.get('.calibration-workspace').attributes('aria-label')).toBe(
      i18n.global.t('calibration.procedure.shakeTuneShaper.name'),
    )
  })

  it('lifts the shaper recommendation out of the run and applies it', async () => {
    homed()
    const view = await mountResonance()
    const rpcCall = vi.spyOn(useMoonrakerStore(pinia), 'rpcCall').mockResolvedValue('ok' as never)
    await selectProcedure(view, 'shakeTuneShaper')

    await runButton(view).trigger('click')
    await flushPromises()
    expect(rpcCall).toHaveBeenCalledWith(
      'printer.gcode.script',
      { script: 'AXES_SHAPER_CALIBRATION' },
      { timeoutMs: null },
    )
    answer([
      '// X axis frequency profile generation...',
      '//     -> For performance: MZV @ 48.2 Hz (with a damping ratio of 0.052)',
      '//     -> For low vibrations: EI @ 52.0 Hz (with a damping ratio of 0.052)',
    ])
    await flushPromises()

    const table = view.get('.calibration-result__table').text()
    expect(table).toContain('X · for performance')
    expect(table).toContain('mzv @ 48.2 Hz')
    expect(table).toContain('ei @ 52 Hz')

    const apply = view
      .findAll('.calibration-result__actions button')
      .find((button) => button.text() === 'Apply')
    await apply!.trigger('click')
    expect(rpcCall).toHaveBeenCalledWith('printer.gcode.script', {
      script: 'SET_INPUT_SHAPER SHAPER_TYPE_X=mzv SHAPER_FREQ_X=48.2',
    })
  })

  it('applies the shaper the reader chose, and shows and hides the run’s output', async () => {
    homed()
    const view = await mountResonance()
    const rpcCall = vi.spyOn(useMoonrakerStore(pinia), 'rpcCall').mockResolvedValue('ok' as never)
    await selectProcedure(view, 'shakeTuneShaper')
    await runButton(view).trigger('click')
    await flushPromises()
    answer([
      '// X axis frequency profile generation...',
      '//     -> For performance: MZV @ 48.2 Hz (with a damping ratio of 0.052)',
      '//     -> For low vibrations: EI @ 52.0 Hz (with a damping ratio of 0.052)',
    ])
    await flushPromises()

    const choices = view.findAll('.calibration-choice--stacked input[type="radio"]')
    expect(choices).toHaveLength(2)
    expect((choices[0]!.element as HTMLInputElement).checked).toBe(true)
    await choices[1]!.setValue(true)
    await view
      .findAll('.calibration-result__actions button')
      .find((button) => button.text() === 'Apply')!
      .trigger('click')
    expect(rpcCall).toHaveBeenCalledWith('printer.gcode.script', {
      script: 'SET_INPUT_SHAPER SHAPER_TYPE_X=ei SHAPER_FREQ_X=52',
    })

    const toggle = () =>
      view.findAll('.calibration-result button').find((button) => /output/i.test(button.text()))!
    expect(view.find('.calibration-result__output').exists()).toBe(false)
    await toggle().trigger('click')
    expect(view.get('.calibration-result__output').text()).toContain('For low vibrations')
    await toggle().trigger('click')
    expect(view.find('.calibration-result__output').exists()).toBe(false)
  })

  /**
   * The graph used to be reachable only as a plain link to the PNG, which a
   * browser either downloads or opens in its own tab — neither lets Escape, an
   * [x], or a click outside get back to the page.
   */
  it('opens the graph being read in a lightbox', async () => {
    const view = await mountResonance()
    seedTuningResults()
    await flushPromises()

    const graph = view.get('.calibration-tuning__graph')
    expect(graph.element.tagName).toBe('BUTTON')
    await graph.trigger('click')

    const lightbox = view.get('dialog.image-lightbox')
    expect((lightbox.element as HTMLDialogElement).open).toBe(true)
    expect(lightbox.get('img').attributes('src')).toBe(
      tuningResult('input_shaper', 'shaper_x_new', 300).url,
    )

    await lightbox.get('button').trigger('click')
    expect((lightbox.element as HTMLDialogElement).open).toBe(false)
  })

  /**
   * The side note this page shipped without: the ephemeral fallback
   * `useDashboardModule` returns outside a real provider has no button that
   * ever calls `openSettings`, so the gear below is new, not merely unhidden.
   */
  it('gives the mesh viewer a settings gear', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'hasBedMesh', 'get').mockReturnValue(true)
    const view = await mountView('bed')

    const gear = view.get('.calibration-stage__map button[aria-pressed]')
    expect(gear.attributes('aria-pressed')).toBe('false')
    await gear.trigger('click')
    expect(gear.attributes('aria-pressed')).toBe('true')
  })

  /**
   * The point of binding to the real `'bedMesh'` instance rather than an
   * ephemeral local copy: a setting changed from wherever — here, standing in
   * for the dashboard card reading and writing the same instance — is visible
   * here too, and vice versa.
   */
  it('reads the same saved configuration a dashboard card would', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'hasBedMesh', 'get').mockReturnValue(true)
    const bedMesh = useBedMeshStore(pinia)
    bedMesh.$patch({
      profileName: 'default',
      probedMatrix: [
        [0.1, 0.2],
        [0.1, 0.2],
      ],
    } as never)
    const view = await mountView('bed')

    expect(view.text()).toContain('2D view')

    useDashboardLayoutStore(pinia).updateConfig('bedMesh', { showSurface: false })
    await flushPromises()

    expect(view.text()).toContain('3D view')
  })

  /**
   * The popout link's whole purpose is to move a card out of a dashboard grid
   * into the settings surface beside it — meaningless for a viewer already
   * hosted at page size with no grid to leave, so `canOpenSurface: false`
   * keeps it from rendering a click that would go nowhere.
   */
  it('never offers to open a settings surface this page has nowhere to put', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'hasBedMesh', 'get').mockReturnValue(true)
    const view = await mountView('bed')

    await view.get('.calibration-stage__map button[aria-pressed]').trigger('click')

    expect(view.find('.module-settings__link').exists()).toBe(false)
  })

  it('says what each procedure is set to, from the log or else the file', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    const config = printerConfig.usePrinterConfigStore(pinia)
    vi.spyOn(config, 'hasProbe', 'get').mockReturnValue(true)
    vi.spyOn(config, 'hasBedMesh', 'get').mockReturnValue(true)
    config.settings = { probe: { z_offset: -0.85 }, bed_mesh: {} } as never
    useBedMeshStore(pinia).$patch({
      profileName: 'default',
      probedMatrix: [
        [0, 0.144],
        [0.02, 0.1],
      ],
    } as never)
    // The page loads the log from the printer's database as it mounts, so it is
    // seeded there rather than in the store, which the load would replace.
    const logged = {
      version: 1,
      procedures: {
        probeAccuracy: [
          {
            at: Date.now() - 3_600_000,
            values: {},
            rows: [
              { label: { key: 'calibration.probe.maximum' }, after: '1.234' },
              { label: { key: 'calibration.probe.minimum' }, after: '1.222' },
              { label: { key: 'calibration.probe.range' }, after: '0.012' },
              { label: { key: 'calibration.probe.average' }, after: '1.228' },
              { label: { key: 'calibration.probe.standardDeviation' }, after: '0.004' },
            ],
            outcome: 'measured',
          },
        ],
      },
    }
    vi.spyOn(useMoonrakerStore(pinia), 'rpcCall').mockImplementation(((method: string) =>
      Promise.resolve(
        method === 'server.database.get_item' ? { value: logged } : { x: 'TRIGGERED', y: 'open' },
      )) as never)

    const view = await mountView('bed')
    expect(useCalibrationStore(pinia).lastRunAt('probeAccuracy')).not.toBeNull()
    const rows = view.findAll('.calibration-procedure')
    const rowFor = (id: string) =>
      rows.find((row) => row.text().includes(i18n.global.t(`calibration.procedure.${id}.name`)))!

    // A probe test says its spread, not its extremes.
    expect(rowFor('probeAccuracy').get('.calibration-procedure__value').text()).toBe(
      'Range 0.012 · Standard deviation 0.004',
    )
    // Never run here, so the file's value, said to be the file's.
    expect(rowFor('probeZOffset').get('.calibration-procedure__value').text()).toBe(
      'z_offset -0.85 (in the file)',
    )
    expect(rowFor('probeZOffset').text()).toContain('Never run')
    // The loaded mesh's own numbers; a saved profile is in the file too.
    expect(rowFor('bedMesh').get('.calibration-procedure__value').text()).toBe(
      'default · 0.144 mm (in the file)',
    )
  })

  it('says a last run failed rather than dating it like a success', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    const config = printerConfig.usePrinterConfigStore(pinia)
    vi.spyOn(config, 'hasProbe', 'get').mockReturnValue(true)
    const measuredAt = Date.now() - 2 * 86_400_000
    const logged = {
      version: 1,
      procedures: {
        probeAccuracy: [
          {
            at: measuredAt,
            values: {},
            rows: [{ label: { key: 'calibration.probe.range' }, after: '0.012' }],
            outcome: 'measured',
          },
          { at: Date.now() - 3_600_000, values: {}, rows: [], outcome: 'failed' },
          { at: Date.now() - 1_800_000, values: {}, rows: [], outcome: 'running' },
        ],
      },
    }
    vi.spyOn(useMoonrakerStore(pinia), 'rpcCall').mockImplementation(((method: string) =>
      Promise.resolve(
        method === 'server.database.get_item' ? { value: logged } : { x: 'TRIGGERED', y: 'open' },
      )) as never)

    const view = await mountView('bed')
    const row = view
      .findAll('.calibration-procedure')
      .find((candidate) =>
        candidate.text().includes(i18n.global.t('calibration.procedure.probeAccuracy.name')),
      )!
    // The newest entry was never seen to finish; the one before it failed. Neither is "the last run".
    expect(row.get('.calibration-procedure__last').text()).toContain('not seen to finish')
    expect(row.get('.calibration-procedure__value').text()).toBe('Range 0.012')
    expect(useCalibrationStore(pinia).lastRunAt('probeAccuracy')).toBe(measuredAt)
  })

  it('opens an earlier run as the result, with what it found, and forgets one after asking', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    const config = printerConfig.usePrinterConfigStore(pinia)
    vi.spyOn(config, 'hasProbe', 'get').mockReturnValue(true)
    const older = Date.now() - 2 * 86_400_000
    const newer = Date.now() - 86_400_000
    const logged = {
      version: 1,
      procedures: {
        probeAccuracy: [
          {
            at: older,
            values: {},
            rows: [{ label: { key: 'calibration.probe.range' }, after: '0.031' }],
            outcome: 'measured',
          },
          {
            at: newer,
            values: {},
            rows: [{ label: { key: 'calibration.probe.range' }, after: '0.012' }],
            outcome: 'measured',
          },
        ],
      },
    }
    let stored: unknown = logged
    vi.spyOn(useMoonrakerStore(pinia), 'rpcCall').mockImplementation(((
      method: string,
      params?: { value?: unknown },
    ) => {
      if (method === 'server.database.get_item') return Promise.resolve({ value: stored })
      if (method === 'server.database.post_item') stored = params?.value
      return Promise.resolve({ x: 'TRIGGERED', y: 'open' })
    }) as never)

    const view = await mountView('bed')
    await selectProcedure(view, 'probeAccuracy')
    // No run this sitting: nothing is shown as the result until a row is opened.
    expect(view.find('.calibration-result').exists()).toBe(false)
    const rows = view.findAll('.calibration-history__open')
    expect(rows).toHaveLength(2)

    await rows[1]!.trigger('click')
    await flushPromises()
    expect(view.get('.calibration-result__title').text()).toBe('Earlier result')
    expect(view.get('.calibration-result__table').text()).toContain('0.031')
    expect(rows[1]!.classes()).toContain('selection-row--selected')

    // Back to latest closes it; with no live run there is nothing in its place.
    await view
      .findAll('.calibration-result button')
      .find((button) => button.text() === 'Back to latest')!
      .trigger('click')
    await flushPromises()
    expect(view.find('.calibration-result').exists()).toBe(false)

    // Forget asks first, then removes the run from the printer's record.
    const forget = view
      .findAll('.calibration-history__entry button')
      .find((button) => button.text() === 'Forget')!
    await forget.trigger('click')
    await flushPromises()
    const dialog = view.findAll('dialog').find((candidate) => candidate.text().includes('Forget'))!
    await dialog
      .findAll('button')
      .find((button) => button.text() === 'Forget')!
      .trigger('click')
    await flushPromises()
    expect(view.findAll('.calibration-history__open')).toHaveLength(1)
    const written = stored as { forgotten: { probeAccuracy: number[] } }
    expect(written.forgotten.probeAccuracy).toEqual([newer])
  })

  it('reads an accelerometer on its own board from the board, and says when it is unplugged', async () => {
    const machineSystem = (await import('@/stores/machineSystem')).useMachineSystemStore(pinia)
    const board = {
      id: 'mcu btt_lis2dw',
      name: 'mcu btt_lis2dw',
      isPrimary: false,
      chip: 'rp2040',
      app: null,
      version: 'v0.13',
      load: null,
      frequency: null,
      isDisconnected: false,
    }
    machineSystem.mcuModules = [board]
    const printerConfig = await import('@/stores/printerConfig')
    const config = printerConfig.usePrinterConfigStore(pinia)
    config.settings = { ...config.settings, lis2dw: { cs_pin: 'btt_lis2dw:gpio9' } } as never
    const view = await mountResonance()

    expect(view.get('.calibration-readiness').text()).toContain(
      'Accelerometer board btt_lis2dw connected',
    )
    // Klipper's own word for a non-critical MCU gone quiet outranks everything else.
    machineSystem.mcuModules = [{ ...board, isDisconnected: true }]
    await flushPromises()
    expect(view.get('.calibration-readiness').text()).toContain(
      'Accelerometer board btt_lis2dw is not connected.',
    )
    await selectProcedure(view, 'shakeTuneShaper')
    expect(runButton(view).attributes('disabled')).toBeDefined()
  })

  it('takes the accelerometer at the config’s word until it answers, and asks again after a Klipper restart', async () => {
    const view = await mountResonance()
    const availability = useAvailabilityStore(pinia)
    const configured = i18n.global.t('calibration.requirement.accelerometer.configured')
    const answering = i18n.global.t('calibration.requirement.accelerometer.met')
    expect(view.get('.calibration-readiness').text()).toContain(configured)

    // The check is offered beside a condition met only on the config's word.
    await selectProcedure(view, 'shakeTuneShaper')
    const check = view
      .findAll('.calibration-checks button')
      .find(
        (button) =>
          button.text() === i18n.global.t('calibration.requirement.fix.checkAccelerometer'),
      )
    expect(check).toBeDefined()
    await check!.trigger('click')
    await flushPromises()
    expect(view.get('.calibration-readiness').text()).toContain(answering)

    // A restart re-detects the board the chip hangs off; what it said before is no longer evidence.
    availability.handleKlipperNotification('notify_klippy_shutdown')
    availability.handleKlipperNotification('notify_klippy_ready')
    availability.printerSnapshotSynchronized()
    await flushPromises()
    expect(view.get('.calibration-readiness').text()).toContain(configured)
    expect(view.get('.calibration-readiness').text()).not.toContain(answering)
  })

  it('names the next step under a result, and draws what the log can show', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    const config = printerConfig.usePrinterConfigStore(pinia)
    vi.spyOn(config, 'hasProbe', 'get').mockReturnValue(true)
    vi.spyOn(config, 'hasBedMesh', 'get').mockReturnValue(true)
    config.settings = { probe: { z_offset: -0.85 }, bed_mesh: {} } as never
    const ranges = ['0.010', '0.012', '0.011', '0.015', '0.014', '0.018']
    const logged = {
      version: 1,
      procedures: {
        probeAccuracy: ranges.map((range, index) => ({
          at: Date.now() - (ranges.length - index) * 86_400_000,
          values: {},
          rows: [{ label: { key: 'calibration.probe.range' }, after: range }],
          outcome: 'measured',
        })),
      },
    }
    vi.spyOn(useMoonrakerStore(pinia), 'rpcCall').mockImplementation(((method: string) =>
      Promise.resolve(
        method === 'server.database.get_item' ? { value: logged } : { x: 'TRIGGERED', y: 'open' },
      )) as never)

    const view = await mountView('bed')
    // A stage arrives on its first procedure, however much of the rest is due.
    expect(view.get('.calibration-workspace .calibration-card__title').text()).toBe(
      i18n.global.t('calibration.procedure.probeAccuracy.name'),
    )
    await selectProcedure(view, 'probeAccuracy')
    expect(view.get('.calibration-next').text()).toContain(
      'Next: Probe Z offset, never run on this printer',
    )

    // Six logged runs: a line with a dot per run, five rows, and the rest behind one button.
    const sparklines = view.findAll('.calibration-sparkline')
    expect(sparklines).toHaveLength(1)
    expect(sparklines[0]!.findAll('circle')).toHaveLength(ranges.length)
    expect(view.findAll('.calibration-history__entry')).toHaveLength(5)
    const more = view
      .findAll('.calibration-history button')
      .find((button) => button.text() === 'Show all 6')!
    await more.trigger('click')
    expect(view.findAll('.calibration-history__entry')).toHaveLength(ranges.length)
    expect(view.get('.calibration-history__entry').text()).toContain('0.018')

    // Open goes to the procedure the line named.
    await view.get('.calibration-next button').trigger('click')
    await flushPromises()
    expect(view.get('.calibration-workspace .calibration-card__title').text()).toBe(
      i18n.global.t('calibration.procedure.probeZOffset.name'),
    )
  })

  it('runs a probe accuracy test and reports its result', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'hasProbe', 'get').mockReturnValue(true)
    homed()
    const view = await mountView('bed')
    const rpcCall = vi.spyOn(useMoonrakerStore(pinia), 'rpcCall').mockResolvedValue('ok' as never)
    await selectProcedure(view, 'probeAccuracy')

    await runButton(view).trigger('click')
    await flushPromises()
    expect(rpcCall).toHaveBeenCalledWith(
      'printer.gcode.script',
      { script: 'PROBE_ACCURACY' },
      { timeoutMs: null },
    )

    answer([
      '// probe accuracy results: maximum 1.234000, minimum 1.100000, range 0.134000, ' +
        'average 1.167000, median 1.170000, standard deviation 0.045000',
    ])
    await flushPromises()

    const table = view.get('.calibration-result__table').text()
    expect(table).toContain('1.234000')
    expect(table).toContain('0.134000')
  })

  /**
   * `PROBE_ACCURACY` probes wherever the toolhead currently is, and the probe
   * tip is not the nozzle — a probe with a real offset can carry past the
   * bed's edge from a nozzle position that is itself comfortably inside it.
   */
  it('refuses to run the accuracy test when the probe offset would carry it outside the bed', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    const config = printerConfig.usePrinterConfigStore(pinia)
    vi.spyOn(config, 'hasProbe', 'get').mockReturnValue(true)
    vi.spyOn(config, 'probeOffset', 'get').mockReturnValue({ x: 20, y: 0 })
    const printer = usePrinterStore(pinia)
    printer.buildVolume.minimum = [0, 0, 0]
    printer.buildVolume.maximum = [200, 200, 200]
    // A nozzle 10mm from the edge, with a probe 20mm further out than the
    // nozzle — the probe itself would land at x=210, past the 200mm limit.
    printer.motion.position = [190, 100, 5]
    homed()

    const view = await mountView('bed')
    await selectProcedure(view, 'probeAccuracy')

    expect(view.text()).toContain('The probe offset would carry it outside the bed')
    expect(runButton(view).attributes('disabled')).toBeDefined()
  })

  it('allows the accuracy test once the probe offset keeps it on the bed', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    const config = printerConfig.usePrinterConfigStore(pinia)
    vi.spyOn(config, 'hasProbe', 'get').mockReturnValue(true)
    vi.spyOn(config, 'probeOffset', 'get').mockReturnValue({ x: 20, y: 0 })
    const printer = usePrinterStore(pinia)
    printer.buildVolume.minimum = [0, 0, 0]
    printer.buildVolume.maximum = [200, 200, 200]
    // The same offset, but from the middle of the bed — well within range.
    printer.motion.position = [100, 100, 5]
    homed()

    const view = await mountView('bed')
    await selectProcedure(view, 'probeAccuracy')

    expect(view.text()).not.toContain('The probe offset would carry it outside the bed')
    expect(runButton(view).attributes('disabled')).toBeUndefined()
  })

  it('hides the probe accuracy panel on a mesh-only printer', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'hasBedMesh', 'get').mockReturnValue(true)

    const view = await mountView('bed')

    expect(view.text()).not.toContain('Probe accuracy')
  })

  /**
   * `useRunoutSensorsStore` is started from `main.ts`, not from this page —
   * see the store's own header comment — so the test starts it explicitly to
   * stand in for that, the same way production wiring would have by the time
   * anyone opened Calibration.
   */
  it('reports runout sensor states with a word, not a color alone', async () => {
    const moonraker = useMoonrakerStore(pinia)
    let snapshotHandler: ((snapshot: { eventtime: number; status: unknown }) => void) | undefined
    vi.spyOn(moonraker, 'rpcCall').mockImplementation(((method: string) => {
      if (method === 'printer.objects.list') {
        return Promise.resolve({
          objects: ['toolhead', 'filament_switch_sensor runout'],
        })
      }
      return Promise.resolve({ x: 'TRIGGERED', y: 'open' })
    }) as never)
    vi.spyOn(moonraker, 'onObjectSnapshot').mockImplementation(((handler: never) => {
      snapshotHandler = handler
      return () => undefined
    }) as never)
    vi.spyOn(moonraker, 'onNotification').mockReturnValue(() => undefined)
    vi.spyOn(moonraker, 'setObjectSubscription').mockResolvedValue(undefined)

    const runoutSensors = await import('@/stores/runoutSensors')
    runoutSensors.useRunoutSensorsStore(pinia).start()
    await flushPromises()

    const view = await mountView('extrusion')
    snapshotHandler?.({
      eventtime: 1,
      status: { 'filament_switch_sensor runout': { enabled: true, filament_detected: true } },
    })
    await flushPromises()

    const row = view.get('.calibration-sensor')
    expect(row.text()).toContain('runout')
    expect(row.text()).toContain('Filament loaded')
  })

  it('offers no extrusion stage on a printer with neither an extruder nor sensors', async () => {
    const view = await mountView()

    expect(stageLabels(view)).not.toContain('Extrusion')
    expect(view.text()).not.toContain('Runout sensors')
  })

  it('offers the tuning panel with nothing recorded yet, once Shake&Tune is discovered', async () => {
    vi.spyOn(useMacrosStore(pinia), 'hasMacro').mockImplementation(
      (name: string) => name === 'AXES_SHAPER_CALIBRATION',
    )
    const view = await mountView('resonance')

    expect(view.text()).toContain('Tuning results')
    expect(view.text()).toContain('Input shaper')
    expect(view.text()).toContain('Nothing recorded for this test yet.')
  })

  it('offers no resonance stage with neither results, an accelerometer, nor Shake&Tune', async () => {
    const view = await mountView()

    expect(stageLabels(view)).not.toContain('Resonance')
    expect(view.text()).not.toContain('Tuning results')
  })

  /**
   * `MEASURE_AXES_NOISE` is a native Klipper command from `[resonance_tester]`,
   * not a Shake&Tune macro, so it is gated on the config section rather than
   * on `macros.hasMacro`.
   */
  it('offers a quick accelerometer noise check on a printer with resonance testing configured', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    const config = printerConfig.usePrinterConfigStore(pinia)
    vi.spyOn(config, 'hasSection').mockImplementation((name: string) => name === 'resonance_tester')
    vi.spyOn(useMacrosStore(pinia), 'hasMacro').mockReturnValue(true)

    const view = await mountView('resonance')
    const rpcCall = vi.spyOn(useMoonrakerStore(pinia), 'rpcCall').mockResolvedValue('ok' as never)
    await selectProcedure(view, 'axesNoise')
    await runButton(view).trigger('click')
    await flushPromises()
    expect(rpcCall).toHaveBeenCalledWith(
      'printer.gcode.script',
      { script: 'MEASURE_AXES_NOISE' },
      { timeoutMs: null },
    )

    answer(['// Axes noise for x-axis accelerometer: 0.000012 (x), 0.000008 (y), 0.000015 (z)'])
    await flushPromises()

    expect(view.get('.calibration-result__table').text()).toContain(
      '0.000012 · 0.000008 · 0.000015',
    )
  })

  it('hides the noise check on a printer with no resonance testing configured', async () => {
    vi.spyOn(useMacrosStore(pinia), 'hasMacro').mockReturnValue(true)

    const view = await mountView('resonance')

    expect(procedureNames(view)).not.toContain('Accelerometer noise')
  })

  /**
   * Run holds its pending state for as long as the printer is still running
   * the command, by holding the underlying RPC open — mocking a running flag
   * would bypass the very state the button reads.
   */
  it('runs a tuning macro and disables Run while it is pending', async () => {
    vi.spyOn(useMacrosStore(pinia), 'hasMacro').mockImplementation(
      (name: string) => name === 'AXES_SHAPER_CALIBRATION',
    )
    await withResonanceTester()
    homed()
    let resolveRpc: (() => void) | undefined
    vi.spyOn(useMoonrakerStore(pinia), 'rpcCall').mockImplementation(
      (method: string) =>
        new Promise((resolve) => {
          if (method !== 'printer.gcode.script') {
            resolve({ x: 'TRIGGERED', y: 'open' } as never)
            return
          }
          resolveRpc = () => resolve('ok' as never)
        }) as never,
    )
    const view = await mountView('resonance')
    await selectProcedure(view, 'shakeTuneShaper')

    await runButton(view).trigger('click')
    await flushPromises()
    expect(runButton(view).attributes('disabled')).toBeDefined()

    resolveRpc?.()
    await flushPromises()

    expect(runButton(view).attributes('disabled')).toBeUndefined()
  })

  /**
   * `COMPARE_BELTS_RESPONSES` is registered unconditionally by Shake&Tune's own
   * dummy macros regardless of kinematics, so `hasMacro` alone cannot tell a
   * CoreXY printer from a cartesian one — only meaningful on the two Shake&Tune
   * itself documents it for. Checked against the group's own button, not
   * `view.text()`: the group's title stays in the DOM either way, since it is
   * `v-show`, not `v-if`, that hides an offered-nothing group.
   */
  it('never offers to run the belts comparison on a non-CoreXY/CoreXZ printer', async () => {
    vi.spyOn(useMacrosStore(pinia), 'hasMacro').mockImplementation(
      (name: string) => name === 'COMPARE_BELTS_RESPONSES',
    )
    const view = await mountView('resonance')

    expect(procedureNames(view)).not.toContain('Belt comparison')
  })

  it('offers the belts comparison on a CoreXY printer', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'section').mockImplementation(
      (name: string) => (name === 'printer' ? { kinematics: 'corexy' } : null),
    )
    vi.spyOn(useMacrosStore(pinia), 'hasMacro').mockImplementation(
      (name: string) => name === 'COMPARE_BELTS_RESPONSES',
    )
    const view = await mountView('resonance')

    expect(procedureNames(view)).toContain('Belt comparison')
  })

  /**
   * `EXCITATE_AXIS_AT_FREQ` defaults to `CREATE_GRAPH=0` — triggered bare it
   * produces nothing for the gallery to show, so it never gets a Run button
   * even though Shake&Tune registers it like every other dummy macro.
   */
  it('never offers to run the static frequency tool', async () => {
    vi.spyOn(useMacrosStore(pinia), 'hasMacro').mockReturnValue(true)
    const view = await mountView('resonance')

    expect(view.text()).not.toContain('EXCITATE_AXIS_AT_FREQ')
  })
  it('draws a screws run as the bed, from the status object, with a way to each screw', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    const config = printerConfig.usePrinterConfigStore(pinia)
    vi.spyOn(config, 'hasProbe', 'get').mockReturnValue(true)
    config.settings = {
      screws_tilt_adjust: {
        screw1: [30, 30],
        screw1_name: 'front left',
        screw2: [200, 30],
        screw2_name: 'front right',
        screw3: [200, 200],
        screw3_name: 'rear right',
        screw4: [30, 200],
        screw4_name: 'rear left',
      },
    } as never
    homed()
    const view = await mountView('bed')
    const rpcCall = vi.spyOn(useMoonrakerStore(pinia), 'rpcCall').mockResolvedValue('ok' as never)
    await selectProcedure(view, 'screwsTilt')

    await runButton(view).trigger('click')
    await flushPromises()
    useScrewsTiltStore(pinia).results = {
      screw1: { z: 2.329, sign: 'CW', adjust: '00:00', isBase: true },
      screw2: { z: 2.391, sign: 'CW', adjust: '00:15', isBase: false },
      screw3: { z: 2.351, sign: 'CCW', adjust: '00:05', isBase: false },
      screw4: { z: 2.412, sign: 'CW', adjust: '01:20', isBase: false },
    }
    await flushPromises()

    const screws = view.findAll('.calibration-screw')
    expect(screws.map((screw) => screw.get('.calibration-screw__name').text())).toEqual([
      'front left',
      'front right',
      'rear right',
      'rear left',
    ])
    expect(screws[0]!.text()).toContain('Base')
    expect(screws[1]!.text()).toContain('CW 00:15')
    expect(screws[2]!.text()).toContain('Level')
    // Rear row first: the grid reads the way the reader stands at the machine.
    expect(screws[2]!.attributes('style')).toContain('grid-row: 1')
    expect(screws[0]!.attributes('style')).toContain('grid-row: 2')
    expect(view.find('.calibration-result__table').exists()).toBe(false)

    await screws[1]!.get('button').trigger('click')
    await flushPromises()
    const move = rpcCall.mock.calls.find(
      ([method, params]) =>
        method === 'printer.gcode.script' &&
        String((params as { script?: string })?.script).includes('G1 X200.00 Y30.00'),
    )
    expect(move).toBeDefined()
  })

  it('offers to move the probe over the bed, and holds every fix while a procedure runs', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    const config = printerConfig.usePrinterConfigStore(pinia)
    vi.spyOn(config, 'hasProbe', 'get').mockReturnValue(true)
    vi.spyOn(config, 'probeOffset', 'get').mockReturnValue({ x: 20, y: 0 })
    config.settings = { probe: { z_offset: 0.5 } } as never
    const printer = usePrinterStore(pinia)
    printer.buildVolume.minimum = [0, 0, 0]
    printer.buildVolume.maximum = [200, 200, 200]
    printer.motion.position = [190, 100, 5]
    homed()
    let resolveRpc: (() => void) | undefined
    const rpcCall = vi.spyOn(useMoonrakerStore(pinia), 'rpcCall').mockImplementation(
      (method: string) =>
        new Promise((resolve) => {
          if (method !== 'printer.gcode.script') {
            resolve({ x: 'TRIGGERED', y: 'open' } as never)
            return
          }
          resolveRpc = () => resolve('ok' as never)
        }) as never,
    )
    const view = await mountView('bed')
    await selectProcedure(view, 'probeAccuracy')

    const fix = view
      .findAll('.calibration-check button')
      .find((button) => button.text().includes('Move over the bed'))!
    expect(fix.attributes('disabled')).toBeUndefined()
    await fix.trigger('click')
    await flushPromises()
    const move = rpcCall.mock.calls.find(
      ([method, params]) =>
        method === 'printer.gcode.script' &&
        String((params as { script?: string })?.script).includes('G1 X100.00 Y100.00 Z10.00'),
    )
    expect(move).toBeDefined()
    resolveRpc?.()
    await flushPromises()

    // A run under way: the fix waits, so it cannot move the toolhead out from under a probe.
    await selectProcedure(view, 'probeZOffset')
    await runButton(view).trigger('click')
    await flushPromises()
    await selectProcedure(view, 'probeAccuracy')
    const held = view
      .findAll('.calibration-check button')
      .find((button) => button.text().includes('Move over the bed'))!
    expect(held.attributes('disabled')).toBeDefined()
    resolveRpc?.()
    await flushPromises()
  })

  it('hosts only the sections a stage asked for, and the dashboard every one', async () => {
    const layout = useDashboardLayoutStore(pinia)
    layout.updateConfig('movement', { showZOffset: true, showSpeedFactor: true, showParking: true })
    const printer = usePrinterStore(pinia)
    printer.buildVolume.minimum = [0, 0, 0]
    printer.buildVolume.maximum = [200, 200, 200]
    homed()
    const view = await mountView('axes')

    const card = view.get('.calibration-stage__live, .calibration-bench__column--live')
    expect(card.find('.trim').exists()).toBe(false)
    expect(card.text()).not.toContain('Speed Factor')
    expect(card.text()).toContain('Park')

    const dashboardCard = mount(MovementModule, { global: { plugins: [i18n, pinia] } })
    await flushPromises()
    expect(dashboardCard.find('.trim').exists()).toBe(true)
    dashboardCard.unmount()
  })
})
