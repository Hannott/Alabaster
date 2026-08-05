import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import type { NotificationHandler, ObjectSnapshotHandler } from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useBedMeshStore } from '@/stores/bedMesh'
import { useConsoleStore } from '@/stores/console'
import { useEndstopsStore } from '@/stores/endstops'
import { useAnnouncementsStore } from '@/stores/announcements'
import { useDevicePowerStore } from '@/stores/devicePower'
import { useExcludeObjectStore } from '@/stores/excludeObject'
import { useGcodeFilesStore } from '@/stores/gcodeFiles'
import { useHistoryStore } from '@/stores/history'
import { useJobQueueStore } from '@/stores/jobQueue'
import { useMachineFilesStore } from '@/stores/machineFiles'
import { useMachineSystemStore } from '@/stores/machineSystem'
import { useMacrosStore } from '@/stores/macros'
import { useMaintenanceStore } from '@/stores/maintenance'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { usePrintersStore } from '@/stores/printers'
import { useServerCapabilitiesStore } from '@/stores/serverCapabilities'
import { useShakeTuneStore } from '@/stores/shakeTune'
import { useTelemetryStore } from '@/stores/telemetry'
import { useTimelapseStore } from '@/stores/timelapse'
import { useWebcamsStore } from '@/stores/webcams'

/**
 * Pointing Alabaster at a second printer used to leave the first one's data in
 * place: its console transcript, its readings, its capability list, and the
 * reachability flags that decide whether a region reads as "never answered" or
 * as "answered once and dropped". Every assertion here is a value that was
 * previously carried across the switch and presented as the new printer's.
 *
 * The switch is exercised through `moonraker.connect`, because that is the
 * only real path: `connect` is where the printer-change resets registered via
 * `onPrinterChange` run. A store missing from the sweep test below is a store
 * that forgot to register — which is exactly the bug class the registry
 * replaced ad-hoc endpoint watches to end.
 */

interface MoonrakerHandlerCapture {
  snapshot?: ObjectSnapshotHandler
  status?: NotificationHandler
  gcodeResponse?: NotificationHandler
}

function stubTransport(capture: MoonrakerHandlerCapture = {}): MoonrakerHandlerCapture {
  const moonraker = useMoonrakerStore()
  vi.spyOn(moonraker, 'setObjectSubscription').mockResolvedValue(undefined)
  vi.spyOn(moonraker, 'removeObjectSubscription').mockResolvedValue(undefined)
  vi.spyOn(moonraker, 'onObjectSnapshot').mockImplementation((handler) => {
    capture.snapshot = handler
    return () => undefined
  })
  vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
    if (method === 'notify_status_update') capture.status = handler
    if (method === 'notify_gcode_response') capture.gcodeResponse = handler
    return () => undefined
  })
  return capture
}

describe('switching to another printer', () => {
  let realWebSocket: typeof WebSocket

  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
    realWebSocket = globalThis.WebSocket
    globalThis.WebSocket = class {
      static readonly CONNECTING = 0
      readyState = 0
      close(): void {}
      send(): void {}
    } as unknown as typeof WebSocket
  })

  afterEach(() => {
    globalThis.WebSocket = realWebSocket
  })

  it('stops reporting the previous printer as merely stale', () => {
    const availability = useAvailabilityStore()
    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    availability.printerSnapshotSynchronized()
    expect(availability.hasReachedMoonraker).toBe(true)
    expect(availability.hasReachedKlipper).toBe(true)

    availability.printerChanged()

    expect(availability.hasReachedMoonraker).toBe(false)
    expect(availability.hasReachedKlipper).toBe(false)
    expect(availability.transportState).toBe('disconnected')
    expect(availability.subscriptionState).toBe('inactive')
    // The distinction that matters: unavailable, not stale. Stale would dim the
    // previous printer's data as though it described this one.
    expect(availability.availabilityFor('klipper')).toEqual({
      phase: 'unavailable',
      reason: 'moonrakerDisconnected',
      isAvailable: false,
      isStale: false,
    })
  })

  it('reports the next connection as a first attempt rather than a retry', () => {
    const availability = useAvailabilityStore()
    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })

    availability.printerChanged()
    availability.beginConnection()

    expect(availability.transportState).toBe('connecting')
  })

  it('forgets the previous printer’s components without hiding the next one’s', () => {
    const capabilities = useServerCapabilitiesStore()
    capabilities.applyServerInfo({ components: ['spoolman'], registered_directories: ['gcodes'] })
    expect(capabilities.hasComponent('timelapse')).toBe(false)

    capabilities.reset()

    expect(capabilities.components).toBeNull()
    expect(capabilities.hasReported).toBe(false)
    // Back to optimistic: nothing is gated until the new printer has answered.
    expect(capabilities.hasComponent('timelapse')).toBe(true)
    expect(capabilities.hasRoot('config')).toBe(true)
  })

  it('drops the previous printer’s transcript, activities and print state', async () => {
    const capture = stubTransport()
    const moonraker = useMoonrakerStore()
    moonraker.connect('printer-a.local:7125')
    const printer = usePrinterStore()
    printer.start()
    // The transcript is the console store's; it registers its own reset.
    const gcodeConsole = useConsoleStore()
    gcodeConsole.start()

    capture.snapshot?.({
      eventtime: 1,
      status: {
        print_stats: {
          state: 'printing',
          filename: 'cube.gcode',
          print_duration: 60,
          total_duration: 70,
          filament_used: 10,
        },
        virtual_sdcard: { progress: 0.25, is_active: true, file_position: 100 },
        toolhead: { axis_minimum: [0, 0, 0], axis_maximum: [300, 300, 340] },
        display_status: { message: 'Printing', progress: 0.25 },
      },
    })
    capture.gcodeResponse?.({
      jsonrpc: '2.0',
      method: 'notify_gcode_response',
      params: ['// hello from printer A'],
    })

    expect(printer.printStats.filename).toBe('cube.gcode')
    expect(gcodeConsole.consoleEntries.length).toBeGreaterThan(0)

    moonraker.connect('printer-b.local:7125')
    await nextTick()

    expect(printer.printStats.filename).toBe('')
    expect(printer.printStats.state).toBe('standby')
    expect(printer.printStats.printDuration).toBe(0)
    expect(printer.virtualSdcard.progress).toBe(0)
    expect(gcodeConsole.consoleEntries).toEqual([])
    expect(printer.activities).toEqual([])
    expect(printer.buildVolume.maximum).toEqual([null, null, null])
    expect(printer.displayMessage).toBe('')
    expect(printer.displayProgress).toBeNull()
  })

  it('drops the previous printer’s readings and chart history', async () => {
    const capture = stubTransport()
    const moonraker = useMoonrakerStore()
    moonraker.connect('printer-a.local:7125')
    const telemetry = useTelemetryStore()
    telemetry.start()

    capture.snapshot?.({
      eventtime: 10,
      status: { extruder: { temperature: 210, target: 215, power: 0.5 } },
    })

    expect(telemetry.readings.extruder?.temperature).toBe(210)

    moonraker.connect('printer-b.local:7125')
    await nextTick()

    expect(telemetry.readings).toEqual({})
    expect(telemetry.fans).toEqual({})
    expect(telemetry.temperatureHistory).toEqual([])
    expect(telemetry.sensorObjects).toEqual([])
  })

  it('drops the previous printer’s mesh', async () => {
    const capture = stubTransport()
    const moonraker = useMoonrakerStore()
    moonraker.connect('printer-a.local:7125')
    const bedMesh = useBedMeshStore()
    bedMesh.start()

    capture.snapshot?.({
      eventtime: 1,
      status: {
        bed_mesh: {
          profile_name: 'default',
          mesh_min: [20, 20],
          mesh_max: [280, 280],
          probed_matrix: [
            [0.05, 0.1],
            [-0.02, 0.16],
          ],
          profiles: { default: {} },
        },
      },
    })

    expect(bedMesh.profileName).toBe('default')

    moonraker.connect('printer-b.local:7125')
    await nextTick()

    expect(bedMesh.profileName).toBe('')
    expect(bedMesh.probedMatrix).toEqual([])
    expect(bedMesh.profiles).toEqual([])
  })

  /**
   * One sweep over every store that registers a printer-change reset. Each is
   * seeded with a value that would misdescribe the next printer — a config
   * section gating capabilities, a macro vocabulary, a browsed path — and all
   * of it must be gone the moment the connection is retargeted, not when the
   * new printer eventually answers. A new store that reads printer data earns
   * a seed-and-assert pair here when it registers.
   */
  it('drops every other store’s previous-printer data at the switch itself', () => {
    stubTransport()
    const moonraker = useMoonrakerStore()
    moonraker.connect('printer-a.local:7125')

    const printerConfig = usePrinterConfigStore()
    const macros = useMacrosStore()
    const history = useHistoryStore()
    const maintenance = useMaintenanceStore()
    const jobQueue = useJobQueueStore()
    const webcams = useWebcamsStore()
    const gcodeFiles = useGcodeFilesStore()
    const machineFiles = useMachineFilesStore()
    const machineSystem = useMachineSystemStore()
    const timelapse = useTimelapseStore()
    const endstops = useEndstopsStore()
    const gcodeConsole = useConsoleStore()
    const excludeObject = useExcludeObjectStore()
    const devicePower = useDevicePowerStore()
    const announcements = useAnnouncementsStore()
    const shakeTune = useShakeTuneStore()
    for (const store of [
      printerConfig,
      macros,
      history,
      maintenance,
      jobQueue,
      webcams,
      gcodeFiles,
      machineFiles,
      machineSystem,
      timelapse,
      endstops,
      gcodeConsole,
      excludeObject,
      devicePower,
      announcements,
      shakeTune,
    ]) {
      store.start()
    }

    printerConfig.settings = { extruder: {} }
    printerConfig.hasSettings = true
    macros.discovered = ['LOAD_FILAMENT']
    macros.hasDiscovered = true
    history.jobs = [
      {
        id: '1',
        filename: 'cube.gcode',
        outcome: 'completed',
        startedAt: 1,
        endedAt: 2,
        printDuration: 1,
        totalDuration: 1,
        filamentUsed: 1,
        fileExists: true,
        auxiliaryData: [],
      },
    ]
    maintenance.addInterval('Belt tension', 'printtime', 100)
    jobQueue.jobs = [{ job_id: '1', filename: 'cube.gcode' } as never]
    jobQueue.queueState = 'paused'
    webcams.webcams = [{ name: 'bed', enabled: true, stream_url: '/webcam' } as never]
    gcodeFiles.currentPath = 'benchies'
    gcodeFiles.selectedPath = 'benchies/cube.gcode'
    gcodeFiles.isAnalysisReady = true
    gcodeFiles.processEstimateFailed = true
    machineFiles.currentPath = 'macros'
    machineSystem.systemInfo = { cpu_info: {} } as never
    machineSystem.updates = [{ id: 'klipper' } as never]
    timelapse.videos = [{ path: 'print.mp4' } as never]
    timelapse.selectedPath = 'print.mp4'
    endstops.readings = [{ name: 'x', state: 'open' }]
    endstops.readAt = 12345
    gcodeConsole.consoleEntries = [
      { id: 1, kind: 'response', raw: '// hello from printer A', message: 'hello', at: 1 },
    ]
    gcodeConsole.gcodeHelp = [{ command: 'LOAD_FILAMENT', help: '' }]
    excludeObject.objects = [{ name: 'cube_1', center: [10, 10] }]
    excludeObject.excludedNames = ['cube_1']
    excludeObject.currentObjectName = 'cube_2'
    devicePower.devices = [
      { device: 'psu', status: 'on', locked_while_printing: false, type: 'gpio' },
    ]
    devicePower.failed = true
    announcements.entries = [
      {
        entry_id: '1',
        url: '',
        title: 'Moonraker update',
        description: '',
        priority: 'normal',
        date: 1,
        dismissed: false,
        date_dismissed: null,
        dismiss_wake: null,
        source: 'moonlight',
        feed: 'moonraker',
      },
    ]
    shakeTune.resultsByCategory.belts = [
      {
        name: 'belts_20260810.png',
        path: 'K-ShakeTune_results/belts/belts_20260810.png',
        modified: 1,
        url: '',
      },
    ]

    moonraker.connect('printer-b.local:7125')

    expect(printerConfig.hasSettings).toBe(false)
    expect(printerConfig.hasSection('extruder')).toBe(false)
    expect(macros.hasDiscovered).toBe(false)
    expect(macros.discovered).toEqual([])
    expect(history.jobs).toEqual([])
    expect(history.windowJobs).toEqual([])
    expect(maintenance.intervals).toEqual([])
    expect(jobQueue.jobs).toEqual([])
    expect(jobQueue.queueState).toBe('ready')
    expect(webcams.webcams).toEqual([])
    expect(gcodeFiles.currentPath).toBe('')
    expect(gcodeFiles.selectedPath).toBeNull()
    // A binary readiness check and a failed process are both facts about the
    // machine we just left.
    expect(gcodeFiles.isAnalysisReady).toBe(false)
    expect(gcodeFiles.processEstimateFailed).toBe(false)
    expect(machineFiles.currentPath).toBe('')
    expect(machineSystem.systemInfo).toBeNull()
    expect(machineSystem.updates).toEqual([])
    expect(timelapse.videos).toEqual([])
    expect(timelapse.selectedPath).toBeNull()
    expect(endstops.readings).toEqual([])
    expect(endstops.readAt).toBeNull()
    // Another firmware's transcript and command vocabulary read as this one's.
    expect(gcodeConsole.consoleEntries).toEqual([])
    expect(gcodeConsole.gcodeHelp).toEqual([])
    // Another file's plate, or the same file before this printer's next load.
    expect(excludeObject.objects).toEqual([])
    expect(excludeObject.excludedNames).toEqual([])
    expect(excludeObject.currentObjectName).toBeNull()
    // Another machine's `moonraker.conf` declares different switches, or none.
    expect(devicePower.devices).toEqual([])
    expect(devicePower.failed).toBe(false)
    // Another machine's Moonraker follows its own announcement feeds.
    expect(announcements.entries).toEqual([])
    // Another machine's filesystem holds a different tuning history, or none.
    expect(shakeTune.resultsByCategory.belts).toEqual([])
  })
})

/**
 * `selectPrinter` reaches `connect` through the store's own closure, so a spy on
 * the exposed method never sees it. These assert the observable result instead —
 * which is the real contract anyway — with the socket stubbed so no test opens
 * one.
 */
describe('putting another saved printer in front', () => {
  let realWebSocket: typeof WebSocket

  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
    realWebSocket = globalThis.WebSocket
    globalThis.WebSocket = class {
      static readonly CONNECTING = 0
      readyState = 0
      close(): void {}
      send(): void {}
    } as unknown as typeof WebSocket
  })

  afterEach(() => {
    globalThis.WebSocket = realWebSocket
  })

  it('reconnects to the printer it selects', () => {
    const moonraker = useMoonrakerStore()
    const printers = usePrintersStore()
    printers.addPrinter('printer-a.local:7125')
    const b = printers.addPrinter('printer-b.local:7125')!
    printers.selectPrinter('printer')

    expect(moonraker.selectPrinter(b.id)).toBe(true)

    expect(printers.activeId).toBe(b.id)
    // Selecting without connecting would leave the socket, the readings and the
    // transcript on the previous printer while the list claimed otherwise.
    expect(moonraker.endpoint).toBe('ws://printer-b.local:7125/websocket')
  })

  it('does nothing when the printer is already in front', () => {
    const moonraker = useMoonrakerStore()
    const printers = usePrintersStore()
    const only = printers.addPrinter('voron.local:7125')!

    expect(moonraker.selectPrinter(only.id)).toBe(false)
  })

  it('refuses a printer that is not on the list', () => {
    const moonraker = useMoonrakerStore()
    const printers = usePrintersStore()
    printers.addPrinter('voron.local:7125')

    expect(moonraker.selectPrinter('printer-9')).toBe(false)
    expect(printers.activeId).toBe('printer')
  })
})

describe('the chosen name belongs to the printer', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('names one printer without naming the others', () => {
    stubTransport()
    const printers = usePrintersStore()
    const a = printers.addPrinter('printer-a.local:7125')!
    const b = printers.addPrinter('printer-b.local:7125')!
    const printer = usePrinterStore()

    printers.selectPrinter(a.id)
    expect(printer.setPrinterName('Voron 2.4')).toBe(true)
    expect(printer.printerName).toBe('Voron 2.4')

    printers.selectPrinter(b.id)
    expect(printer.customPrinterName).toBeNull()

    printers.selectPrinter(a.id)
    expect(printer.customPrinterName).toBe('Voron 2.4')
  })

  it('clears a name back to what the printer calls itself', () => {
    stubTransport()
    const printers = usePrintersStore()
    printers.addPrinter('voron.local:7125')
    const printer = usePrinterStore()

    printer.setPrinterName('Voron 2.4')
    printer.setPrinterName('')

    expect(printer.customPrinterName).toBeNull()
  })

  it('rescues a name chosen before the printer list existed', () => {
    // The state left by an upgrade that registered an entry from a connection
    // rather than from migration: an empty label beside the old key.
    window.localStorage.setItem(
      'alabaster.printers.v1',
      JSON.stringify({
        version: 1,
        activeId: 'printer',
        entries: [{ id: 'printer', label: '', endpoint: 'ws://voron.local:7125/websocket' }],
      }),
    )
    window.localStorage.setItem('alabaster.printer.name', 'Voron 2.4')

    const printers = usePrintersStore()

    expect(printers.activeEntry?.label).toBe('Voron 2.4')
    // Absorbed, so it cannot be handed to a second printer later.
    expect(window.localStorage.getItem('alabaster.printer.name')).toBeNull()

    setActivePinia(createPinia())
    expect(usePrintersStore().activeEntry?.label).toBe('Voron 2.4')
  })

  it('does not bring a cleared name back on the next load', () => {
    window.localStorage.setItem('alabaster.moonraker.endpoint', 'ws://voron.local:7125/websocket')
    window.localStorage.setItem('alabaster.printer.name', 'Voron 2.4')

    stubTransport()
    const printer = usePrinterStore()
    expect(printer.customPrinterName).toBe('Voron 2.4')

    printer.setPrinterName('')
    expect(printer.customPrinterName).toBeNull()

    // The old key must be gone, or an empty label would adopt it all over again.
    setActivePinia(createPinia())
    expect(usePrintersStore().activeEntry?.label).toBe('')
  })
})

describe('probe temperatures across printers', () => {
  const storageKey = 'alabaster.bedMesh.probeTemperatures.v1'

  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  /** Puts a profile called `default` on the machine, which is what collides. */
  function activateDefaultProfile(capture: MoonrakerHandlerCapture): void {
    capture.snapshot?.({
      eventtime: 1,
      status: {
        bed_mesh: {
          profile_name: 'default',
          mesh_min: [20, 20],
          mesh_max: [280, 280],
          probed_matrix: [[0.05, 0.1]],
          profiles: { default: {} },
        },
      },
    })
  }

  it('keeps one printer’s recorded temperature off another printer’s profile', async () => {
    const capture = stubTransport()
    const printers = usePrintersStore()
    const a = printers.addPrinter('printer-a.local:7125')!
    const b = printers.addPrinter('printer-b.local:7125')!
    printers.selectPrinter(a.id)

    const bedMesh = useBedMeshStore()
    bedMesh.start()
    activateDefaultProfile(capture)
    bedMesh.recordCalibration(60)
    bedMesh.commitProfileTemperature('', 'default')

    expect(bedMesh.activeProbeTemperature).toBe(60)

    printers.selectPrinter(b.id)
    await nextTick()

    // Both printers have a profile called `default`; only one was probed at 60.
    expect(bedMesh.activeProbeTemperature).toBeNull()

    printers.selectPrinter(a.id)
    await nextTick()

    expect(bedMesh.activeProbeTemperature).toBe(60)
  })

  it('follows a printer to a new address rather than starting it over', async () => {
    const capture = stubTransport()
    const printers = usePrintersStore()
    const entry = printers.addPrinter('voron.local:7125')!

    const bedMesh = useBedMeshStore()
    bedMesh.start()
    activateDefaultProfile(capture)
    bedMesh.recordCalibration(60)
    bedMesh.commitProfileTemperature('', 'default')

    // Same machine, reached by IP. Identity is unchanged, so what was measured
    // from this bed is still this bed's.
    printers.setEndpoint(entry.id, '192.168.1.50:7125')
    await nextTick()
    activateDefaultProfile(capture)

    expect(bedMesh.activeProbeTemperature).toBe(60)
  })

  it('adopts a pre-identity table for the printer in use, once', async () => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ 'ws://voron.local:7125/websocket': { default: 65 } }),
    )
    const capture = stubTransport()
    const printers = usePrintersStore()
    const entry = printers.addPrinter('voron.local:7125')!

    const bedMesh = useBedMeshStore()
    bedMesh.start()
    await nextTick()
    activateDefaultProfile(capture)
    expect(bedMesh.activeProbeTemperature).toBe(65)

    // Writing moves it under the identity and drops the endpoint key, so a later
    // printer reachable at that address cannot adopt it as its own.
    bedMesh.recordCalibration(65)
    bedMesh.commitProfileTemperature('', 'default')

    const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}') as Record<
      string,
      unknown
    >
    expect(stored[entry.id]).toEqual({ default: 65 })
    expect(stored['ws://voron.local:7125/websocket']).toBeUndefined()
  })
})
