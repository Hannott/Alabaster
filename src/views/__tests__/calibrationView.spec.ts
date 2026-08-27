import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { i18n } from '@/i18n'
import { useAvailabilityStore } from '@/stores/availability'
import { useBedMeshStore } from '@/stores/bedMesh'
import { useConsoleStore } from '@/stores/console'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'
import { useMacrosStore } from '@/stores/macros'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import { useShakeTuneStore, type ShakeTuneResult } from '@/stores/shakeTune'
import HeaterCalibrationPanel from '@/components/calibration/HeaterCalibrationPanel.vue'
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
 * by clicking its rail entry. There is no URL to mount straight onto: the stage
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
    const entry = view.findAll('.calibration-rail-button').find((b) => b.text() === label)
    if (!entry) throw new Error(`the rail offers no "${label}" stage on this machine`)
    await entry.trigger('click')
    await flushPromises()
  }
  return view
}

/** The rail's own entries, which are what the page offers this machine. */
function railLabels(view: Awaited<ReturnType<typeof mountView>>): string[] {
  return view.findAll('.calibration-rail-button').map((button) => button.text())
}

describe('Calibration view', () => {
  /**
   * The rail is the page's answer to "what is this destination for". The page
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

    expect(railLabels(view)).toEqual(['Axes & frame', 'Bed & probe', 'Extrusion'])
  })

  /**
   * The stage lives in the route query, so a link into the tuning graphs is a
   * link somebody can keep — and `replace` rather than `push`, so stepping
   * through five stages of one sitting leaves no trail for the back button to
   * walk out of.
   */
  it('shows only the selected stage and marks its rail entry current', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'hasBedMesh', 'get').mockReturnValue(true)

    const view = await mountView('bed')

    const current = view
      .findAll('.calibration-rail-button')
      .filter((button) => button.attributes('aria-current') === 'true')
    expect(current).toHaveLength(1)
    expect(current[0]!.text()).toBe('Bed & probe')
    expect(view.text()).toContain('Bed mesh profiles')
    expect(view.text()).not.toContain('Endstops')
  })

  /**
   * A stage whose hardware disappears mid-sitting — a Shake&Tune uninstall, a
   * config reload without `[bed_mesh]` — falls back rather than leaving the
   * canvas empty under a rail entry that no longer exists.
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

    expect(railLabels(view)).toEqual(['Axes & frame'])
    expect(view.text()).toContain('Endstops')
    expect(view.text()).not.toContain('Bed mesh profiles')
  })

  /**
   * The whole reason the console is on this page: Klipper answers
   * `SCREWS_TILT_CALCULATE`, `PROBE_ACCURACY` and a PID run as console text and
   * nothing else, so without it every command here sends the reader to another
   * route to find out what happened.
   */
  it('docks a real console on the page, and lets the heading put it away', async () => {
    const view = await mountView()

    expect(view.findComponent(ConsolePanel).exists()).toBe(true)

    const toggle = view.get('.page-heading button')
    expect(toggle.attributes('aria-pressed')).toBe('true')
    await toggle.trigger('click')

    expect(view.findComponent(ConsolePanel).exists()).toBe(false)
    expect(view.get('.page-heading button').attributes('aria-pressed')).toBe('false')
  })

  /**
   * The Console route's own console, not the dashboard card — which is what
   * decides whose filters and whose prompt position the reader gets. The card
   * reads one dashboard instance's configuration; the page and this bench share
   * `useConsoleSettings`, so a filter set up on either holds on the other.
   */
  it('reuses the console page panel, with the command browser and its settings', async () => {
    const view = await mountView()

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

  /**
   * A heater calibration used to be reachable only from behind the Temperatures
   * card's gear, on another route — which is exactly what sent somebody to the
   * Dashboard in the middle of their own calibration sitting.
   */
  it('offers heater calibration on its own stage, from the shared panel', async () => {
    const telemetry = await import('@/stores/telemetry')
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(telemetry.useTelemetryStore(pinia), 'sensors', 'get').mockReturnValue([
      { objectName: 'extruder', name: 'extruder', isSettable: true, target: 200 },
    ] as never)
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'controlKindFor').mockReturnValue('pid')

    const view = await mountView('heaters')

    expect(railLabels(view)).toContain('Heaters')
    expect(view.findComponent(HeaterCalibrationPanel).exists()).toBe(true)
  })

  it('reports each endstop with a word, not a colour alone', async () => {
    const view = await mountView()

    const rows = view.findAll('.calibration-endstop')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('x')
    expect(rows[0]!.text()).toContain('Triggered')
    expect(rows[1]!.text()).toContain('Open')

    // The state also carries a shape class, so the reading survives a display
    // that renders the accent and the muted colour indistinguishably.
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
   * has no bed job at all, so the rail never offers the stage rather than
   * offering one whose cards are all absent. A stage nobody can act on reads as
   * a broken page; a rail entry fewer reads as a machine without that hardware.
   */
  it('offers no bed stage at all on a printer that cannot mesh, probe or level', async () => {
    const view = await mountView()

    expect(railLabels(view)).toEqual(['Axes & frame'])
    expect(view.text()).not.toContain('Bed mesh profiles')
  })

  it('hides the mesh panel on a probe-only printer, which still has a bed stage', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'hasProbe', 'get').mockReturnValue(true)

    const view = await mountView('bed')

    expect(railLabels(view)).toContain('Bed & probe')
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
      .findAll('.calibration-panel__actions button')
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
      .findAll('.calibration-panel__actions button')
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
      .findAll('.calibration-panel__actions button')
      .find((button) => button.text().includes('Calibrate mesh'))
    expect(calibrate!.attributes('disabled')).toBeDefined()
  })

  /**
   * A thumbnail used to be a plain link to the PNG, which a browser either
   * downloads or opens in its own tab — neither lets Escape, an [x], or a
   * click outside get back to the gallery the way the file explorer's own
   * image preview does.
   */
  it('opens a tuning thumbnail in a lightbox instead of linking to the file', async () => {
    // Shake&Tune installed, so the resonance stage exists to be asked for. The
    // results themselves land after mount, because the panel's own `start()`
    // refreshes the directory as it mounts and would clear anything seeded
    // before it.
    vi.spyOn(useMacrosStore(pinia), 'hasMacro').mockImplementation(
      (name: string) => name === 'COMPARE_BELTS_RESPONSES',
    )
    const view = await mountView('resonance')

    const result: ShakeTuneResult = {
      name: 'belts_20260810_090000_x.png',
      path: 'K-ShakeTune_results/belts/belts_20260810_090000_x.png',
      modified: 10,
      url: 'https://printer.local/server/files/config/K-ShakeTune_results/belts/belts_20260810_090000_x.png',
    }
    useShakeTuneStore(pinia).resultsByCategory.belts = [result]
    await flushPromises()

    const thumb = view.find('.calibration-tuning-thumb')
    expect(thumb.exists()).toBe(true)
    expect(thumb.element.tagName).toBe('BUTTON')
    expect(thumb.attributes('href')).toBeUndefined()

    await thumb.trigger('click')

    const lightbox = view.get('dialog.image-lightbox')
    expect((lightbox.element as HTMLDialogElement).open).toBe(true)
    expect(lightbox.get('img').attributes('src')).toBe(result.url)

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

  it('runs a probe accuracy test and reports its result', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(printerConfig.usePrinterConfigStore(pinia), 'hasProbe', 'get').mockReturnValue(true)
    const probeAccuracy = vi.spyOn(usePrinterStore(pinia), 'probeAccuracy').mockResolvedValue(true)
    const view = await mountView('bed')

    const run = view
      .findAll('.calibration-panel__header button')
      .find((button) => button.text().includes('Run accuracy test'))
    await run?.trigger('click')
    expect(probeAccuracy).toHaveBeenCalled()

    useConsoleStore(pinia).consoleEntries = [
      { id: 'a', raw: 'PROBE_ACCURACY', kind: 'command', at: 0 },
      {
        id: 'b',
        raw:
          '// probe accuracy results: maximum 1.234000, minimum 1.100000, range 0.134000, ' +
          'average 1.167000, median 1.170000, standard deviation 0.045000',
        kind: 'response',
        at: 0,
      },
    ] as never
    await flushPromises()

    expect(view.text()).toContain('1.234 mm')
    expect(view.text()).toContain('0.134 mm')
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
    const probeAccuracy = vi.spyOn(printer, 'probeAccuracy').mockResolvedValue(true)

    const view = await mountView('bed')

    expect(view.text()).toContain("The probe's offset would carry it outside the bed")
    const run = view
      .findAll('.calibration-panel__header button')
      .find((button) => button.text().includes('Run accuracy test'))
    expect(run?.attributes('disabled')).toBeDefined()

    await run?.trigger('click')
    expect(probeAccuracy).not.toHaveBeenCalled()
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

    const view = await mountView('bed')

    expect(view.text()).not.toContain("The probe's offset would carry it outside the bed")
    const run = view
      .findAll('.calibration-panel__header button')
      .find((button) => button.text().includes('Run accuracy test'))
    expect(run?.attributes('disabled')).toBeUndefined()
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
  it('reports runout sensor states with a word, not a colour alone', async () => {
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

    expect(railLabels(view)).not.toContain('Extrusion')
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

    expect(railLabels(view)).not.toContain('Resonance')
    expect(view.text()).not.toContain('Tuning results')
  })

  /**
   * `MEASURE_AXES_NOISE` is a native Klipper command from `[resonance_tester]`,
   * not a Shake&Tune macro, so it is gated on the config section rather than
   * on `macros.hasMacro` — see `hasResonanceTester`'s own comment.
   */
  it('offers a quick accelerometer noise check on a printer with resonance testing configured', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    const config = printerConfig.usePrinterConfigStore(pinia)
    vi.spyOn(config, 'hasSection').mockImplementation((name: string) => name === 'resonance_tester')
    vi.spyOn(useMacrosStore(pinia), 'hasMacro').mockReturnValue(true)
    const measureAxesNoise = vi
      .spyOn(usePrinterStore(pinia), 'measureAxesNoise')
      .mockResolvedValue(true)

    const view = await mountView('resonance')

    const check = view
      .findAll('.calibration-tuning-noise button')
      .find((button) => button.text().includes('Check accelerometer noise'))
    expect(check).toBeDefined()
    await check?.trigger('click')
    expect(measureAxesNoise).toHaveBeenCalled()

    useConsoleStore(pinia).consoleEntries = [
      { id: 'a', raw: 'MEASURE_AXES_NOISE', kind: 'command', at: 0 },
      {
        id: 'b',
        raw: '// Axes noise for x-axis accelerometer: 0.000012 (x), 0.000008 (y), 0.000015 (z)',
        kind: 'response',
        at: 0,
      },
    ] as never
    await flushPromises()

    expect(view.text()).toContain('x-axis accelerometer')
    expect(view.text()).toContain('0.000012')
  })

  it('hides the noise check on a printer with no resonance testing configured', async () => {
    vi.spyOn(useMacrosStore(pinia), 'hasMacro').mockReturnValue(true)

    const view = await mountView('resonance')

    expect(view.text()).not.toContain('Check accelerometer noise')
  })

  /**
   * Dispatched through `macros.run`, not `printer.sendMacro` directly — `run`
   * is what tracks `runningMacros`, which the button's disabled state reads.
   * Mocking `isRunning` itself would prove nothing, since it bypasses the very
   * reactive state the button depends on; this drives the real mechanism by
   * holding the underlying RPC open.
   */
  it('runs a tuning macro and disables the button while it is pending', async () => {
    vi.spyOn(useMacrosStore(pinia), 'hasMacro').mockImplementation(
      (name: string) => name === 'AXES_SHAPER_CALIBRATION',
    )
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

    const run = view
      .findAll('.calibration-tuning-group__header button')
      .find((button) => button.text().includes('Run'))
    expect(run).toBeDefined()
    await run?.trigger('click')
    await flushPromises()

    expect(run?.attributes('disabled')).toBeDefined()

    resolveRpc?.()
    await flushPromises()

    expect(run?.attributes('disabled')).toBeUndefined()
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

    const beltsGroup = view
      .findAll('.calibration-tuning-group')
      .find((group) => group.text().includes('Belts comparison'))
    expect(beltsGroup?.find('button').exists()).toBe(false)
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

    expect(view.text()).toContain('Belts comparison')
  })

  /**
   * `EXCITATE_AXIS_AT_FREQ` defaults to `CREATE_GRAPH=0` — triggered bare it
   * produces nothing for the gallery to show, so it never gets a Run button
   * even though Shake&Tune registers it like every other dummy macro.
   */
  it('never offers to run the static frequency tool', async () => {
    vi.spyOn(useMacrosStore(pinia), 'hasMacro').mockReturnValue(true)
    const view = await mountView('resonance')

    const staticFrequencyGroup = view
      .findAll('.calibration-tuning-group')
      .find((group) => group.text().includes('Static frequency'))
    expect(staticFrequencyGroup?.find('button').exists()).toBe(false)
  })
})
