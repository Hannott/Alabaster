import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  JsonRpcNotification,
  NotificationHandler,
  ObjectSnapshotHandler,
} from '@/services/moonraker'
import { useBedMeshStore } from '@/stores/bedMesh'
import { useConsoleStore } from '@/stores/console'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'
import { useMoonrakerStore } from '@/stores/moonraker'
import { parseScrewsTiltResults, usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { useTelemetryStore } from '@/stores/telemetry'

describe('printer store', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('merges print and movement snapshots with partial live updates', () => {
    const moonraker = useMoonrakerStore()
    let snapshotHandler: ObjectSnapshotHandler | undefined
    let statusHandler: NotificationHandler | undefined
    const setObjectSubscription = vi
      .spyOn(moonraker, 'setObjectSubscription')
      .mockResolvedValue(undefined)
    vi.spyOn(moonraker, 'onObjectSnapshot').mockImplementation((handler) => {
      snapshotHandler = handler
      return () => undefined
    })
    vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
      if (method === 'notify_status_update') statusHandler = handler
      return () => undefined
    })

    const printer = usePrinterStore()
    printer.start()
    expect(setObjectSubscription).toHaveBeenCalledWith(
      'alabaster.printer',
      expect.objectContaining({
        toolhead: expect.arrayContaining(['axis_minimum', 'axis_maximum']),
      }),
    )
    snapshotHandler?.({
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
        gcode_move: {
          gcode_position: [10, 20, 3.5],
          homing_origin: [1, 2, 0.5],
          speed_factor: 1.1,
          extrude_factor: 0.95,
        },
        motion_report: { live_position: [12, 24, 4.5], live_velocity: 80 },
        toolhead: {
          homed_axes: 'xyz',
          axis_minimum: [-1, -1, -1, 0],
          axis_maximum: [301, 251, 305, 0],
        },
      },
    })

    expect(printer.printStats.filename).toBe('cube.gcode')
    expect(printer.progress).toBe(0.25)
    expect(printer.remainingSeconds).toBe(180)
    expect(printer.motion.position).toEqual([10, 20, 3.5])
    expect(printer.toolheadPosition).toEqual([11, 22, 4])
    expect(printer.motion.liveVelocity).toBe(80)
    expect(printer.motion.livePositionEventtime).toBe(1)
    expect(printer.motion.homedAxes).toBe('xyz')
    expect(printer.buildVolume.minimum).toEqual([-1, -1, -1])
    expect(printer.buildVolume.maximum).toEqual([301, 251, 305])

    const update: JsonRpcNotification = {
      jsonrpc: '2.0',
      method: 'notify_status_update',
      params: [{ virtual_sdcard: { progress: 0.5 }, gcode_move: { gcode_position: [11, 20, 4] } }],
    }
    statusHandler?.(update)

    expect(printer.progress).toBe(0.5)
    expect(printer.motion.position).toEqual([11, 20, 4])
  })

  /**
   * Klipper's own `motion_report` answers a live-position query with a bare
   * zero position at zero velocity whenever its move queue holds nothing at
   * that instant — the gap right as a jog is queued, once the previous move
   * has aged out of the queue's short history. Left unfiltered, that reads as
   * the toolhead teleporting to the origin and back, exactly the moment a jog
   * button is pressed.
   */
  it('ignores a zero position and velocity from an empty motion queue', () => {
    const moonraker = useMoonrakerStore()
    let snapshotHandler: ObjectSnapshotHandler | undefined
    let statusHandler: NotificationHandler | undefined
    vi.spyOn(moonraker, 'setObjectSubscription').mockResolvedValue(undefined)
    vi.spyOn(moonraker, 'onObjectSnapshot').mockImplementation((handler) => {
      snapshotHandler = handler
      return () => undefined
    })
    vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
      if (method === 'notify_status_update') statusHandler = handler
      return () => undefined
    })

    const printer = usePrinterStore()
    printer.start()
    snapshotHandler?.({
      eventtime: 1,
      status: {
        motion_report: { live_position: [75, 150, 10, 0], live_velocity: 0 },
        gcode_move: { homing_origin: [0, 0, 0] },
        toolhead: { homed_axes: 'xyz' },
      },
    })
    expect(printer.motion.livePosition).toEqual([75, 150, 10])

    // The sentinel: exactly zero on every axis, at exactly zero velocity.
    statusHandler?.({
      jsonrpc: '2.0',
      method: 'notify_status_update',
      params: [{ motion_report: { live_position: [0, 0, 0, 0], live_velocity: 0 } }],
    })
    expect(printer.motion.livePosition).toEqual([75, 150, 10])

    // A genuine reading — nonzero, or paired with real velocity — still lands.
    statusHandler?.({
      jsonrpc: '2.0',
      method: 'notify_status_update',
      params: [{ motion_report: { live_position: [76, 150, 10, 0], live_velocity: 12 } }, 2],
    })
    expect(printer.motion.livePosition).toEqual([76, 150, 10])
    expect(printer.motion.livePositionEventtime).toBe(2)
  })

  it('builds bounded commands and never retries failed mutations', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockRejectedValue(new Error('offline'))
    const printer = usePrinterStore()

    await expect(printer.moveAxis('X', 10)).resolves.toBe(false)
    expect(rpcCall).toHaveBeenCalledOnce()
    expect(rpcCall).toHaveBeenCalledWith('printer.gcode.script', {
      script:
        'SAVE_GCODE_STATE NAME=_alabaster_movement\nG91\nG1 X10 F6000\nRESTORE_GCODE_STATE NAME=_alabaster_movement',
    })
    expect(printer.lastCommandError).toBe('move')

    rpcCall.mockClear()
    await expect(printer.moveAxis('X', 101)).resolves.toBe(false)
    expect(rpcCall).not.toHaveBeenCalled()
  })

  it('echoes any mutating command sent outside the console, except a jog', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
    const gcodeConsole = useConsoleStore()
    const printer = usePrinterStore()

    // A card button is as much a command the user sent as one typed into the
    // prompt: Moonraker's own gcode_store already records it, so the console
    // going silent until the next reload would disagree with its own history.
    // The transcript itself is the console store's; the echo policy under test
    // is `sendGcode`'s.
    await expect(printer.turnOffHeaters()).resolves.toBe(true)
    expect(gcodeConsole.consoleEntries.map((entry) => [entry.kind, entry.message])).toEqual([
      ['command', 'TURN_OFF_HEATERS'],
    ])

    // A jog wraps the requested motion in SAVE_GCODE_STATE/RESTORE_GCODE_STATE
    // housekeeping nobody typed and fires on every arrow click, so it stays
    // out of the transcript.
    await expect(printer.moveAxis('X', 10)).resolves.toBe(true)
    expect(gcodeConsole.consoleEntries).toHaveLength(1)
  })

  /**
   * The defect this guards: a mesh calibration takes minutes and Klipper answers
   * the script only when it finishes, so with the default deadline the transport
   * gave up part way through a perfectly healthy run and the interface reported a
   * failed command. Leveling and heater calibration already opted out; this did
   * not.
   */
  it('probes a mesh without the transport local deadline, for the same reason', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
    const printer = usePrinterStore()

    await expect(printer.calibrateBedMesh()).resolves.toBe(true)
    expect(rpcCall).toHaveBeenCalledWith(
      'printer.gcode.script',
      { script: 'BED_MESH_CALIBRATE' },
      { timeoutMs: null },
    )

    rpcCall.mockClear()
    await expect(printer.calibrateBedMesh('textured')).resolves.toBe(true)
    expect(rpcCall).toHaveBeenCalledWith(
      'printer.gcode.script',
      { script: 'BED_MESH_CALIBRATE PROFILE="textured"' },
      { timeoutMs: null },
    )
  })

  /**
   * `PROBE_ACCURACY` answers only once all ten samples are in, the same reason
   * `BED_MESH_CALIBRATE` opts out above.
   */
  it('runs a probe accuracy test without the transport local deadline, for the same reason', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
    const printer = usePrinterStore()

    await expect(printer.probeAccuracy()).resolves.toBe(true)
    expect(rpcCall).toHaveBeenCalledWith(
      'printer.gcode.script',
      { script: 'PROBE_ACCURACY' },
      { timeoutMs: null },
    )
  })

  /**
   * Unlike `PROBE_ACCURACY`, this only dwells for its own `MEAS_TIME` (2
   * seconds by default) and moves nothing — nowhere near the transport's
   * default deadline, so it keeps that deadline rather than opting out.
   */
  it('runs the accelerometer noise check with the ordinary transport deadline', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
    const printer = usePrinterStore()

    await expect(printer.measureAxesNoise()).resolves.toBe(true)
    expect(rpcCall).toHaveBeenCalledWith('printer.gcode.script', { script: 'MEASURE_AXES_NOISE' })
  })

  /**
   * Two commands, from two different Klipper objects, and exactly one of them
   * exists on any given printer: the probe object registers
   * `Z_OFFSET_APPLY_PROBE`, and `manual_probe` registers
   * `Z_OFFSET_APPLY_ENDSTOP` only where there is a Z endstop position or delta
   * kinematics. Sending the wrong one is "Unknown command", not a refusal, so
   * the target is the caller's — `printerConfig` answers which.
   */
  it('applies the Z offset to whichever of the two targets the caller names', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
    const printer = usePrinterStore()

    await expect(printer.applyZOffset('probe')).resolves.toBe(true)
    expect(rpcCall).toHaveBeenCalledWith('printer.gcode.script', {
      script: 'Z_OFFSET_APPLY_PROBE',
    })

    rpcCall.mockClear()
    await expect(printer.applyZOffset('endstop')).resolves.toBe(true)
    expect(rpcCall).toHaveBeenCalledWith('printer.gcode.script', {
      script: 'Z_OFFSET_APPLY_ENDSTOP',
    })
  })

  /**
   * `BED_SCREWS_ADJUST`'s own three words. All three opt out of the transport
   * deadline: Klipper answers once it has moved the toolhead up, over and down
   * to the next screw, and on the last one once the whole procedure has lifted
   * away — both longer than the default sixty seconds on a slow lift speed.
   */
  it('answers a bed-screw prompt with Klipper’s own three words, without a deadline', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
    const printer = usePrinterStore()

    for (const [answer, script] of [
      ['accept', 'ACCEPT'],
      ['adjusted', 'ADJUSTED'],
      ['abort', 'ABORT'],
    ] as const) {
      rpcCall.mockClear()
      await expect(printer.answerBedScrew(answer)).resolves.toBe(true)
      expect(rpcCall).toHaveBeenCalledWith('printer.gcode.script', { script }, { timeoutMs: null })
    }
  })

  /**
   * Whether the gantry has actually been aligned since the motors were last off,
   * which nothing else can answer: every axis reads as homed on a machine whose
   * gantry is out of square. `null` until the object reports — a printer with
   * neither section never does, and that has to stay distinguishable from one
   * that has not levelled yet.
   */
  it('reads the alignment state of whichever leveling object the machine has', () => {
    const moonraker = useMoonrakerStore()
    let snapshotHandler: ObjectSnapshotHandler | undefined
    vi.spyOn(moonraker, 'setObjectSubscription').mockResolvedValue(undefined)
    vi.spyOn(moonraker, 'onObjectSnapshot').mockImplementation((handler) => {
      snapshotHandler = handler
      return () => undefined
    })
    vi.spyOn(moonraker, 'onNotification').mockImplementation(() => () => undefined)

    const printer = usePrinterStore()
    printer.start()
    expect(printer.leveling.quadGantryApplied).toBeNull()
    expect(printer.leveling.zTiltApplied).toBeNull()

    snapshotHandler?.({ eventtime: 1, status: { quad_gantry_level: { applied: false } } })
    expect(printer.leveling.quadGantryApplied).toBe(false)
    // An update carrying neither object leaves both alone: Moonraker sends only
    // what changed, so resetting here would erase a live reading every second.
    snapshotHandler?.({ eventtime: 2, status: { toolhead: { homed_axes: 'xyz' } } })
    expect(printer.leveling.quadGantryApplied).toBe(false)

    snapshotHandler?.({ eventtime: 3, status: { quad_gantry_level: { applied: true } } })
    expect(printer.leveling.quadGantryApplied).toBe(true)
    expect(printer.leveling.zTiltApplied).toBeNull()
  })

  /**
   * The defect this guards: a slow probe or multiple homing samples can take
   * longer than the transport's default sixty-second deadline, and Klipper
   * answers `printer.gcode.script` only once the move finishes — so a homing
   * command sent under the default deadline reports a false failure part way
   * through a perfectly healthy home. `homeAxes` is one caller, but the same
   * exemption has to apply to `G28` typed straight into the console, since
   * that goes through the same `sendGcode` with no options of its own.
   */
  it('homes without the transport local deadline, no matter which control sent it', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
    const printer = usePrinterStore()

    await expect(printer.homeAxes()).resolves.toBe(true)
    expect(rpcCall).toHaveBeenCalledWith(
      'printer.gcode.script',
      { script: 'G28' },
      { timeoutMs: null },
    )

    rpcCall.mockClear()
    await expect(printer.homeAxes('xz')).resolves.toBe(true)
    expect(rpcCall).toHaveBeenCalledWith(
      'printer.gcode.script',
      { script: 'G28 X Z' },
      { timeoutMs: null },
    )

    // The console prompt reaches `printer.gcode.script` through `sendGcode`
    // too, with no options of its own — the exemption has to come from the
    // script text, not from a flag only the button passes.
    rpcCall.mockClear()
    await expect(printer.sendGcode('g28', 'console')).resolves.toBe(true)
    expect(rpcCall).toHaveBeenCalledWith(
      'printer.gcode.script',
      { script: 'g28' },
      { timeoutMs: null },
    )

    // An unrelated command keeps the default deadline.
    rpcCall.mockClear()
    await expect(printer.sendGcode('M117 hello', 'console')).resolves.toBe(true)
    expect(rpcCall).toHaveBeenCalledWith('printer.gcode.script', { script: 'M117 hello' })
  })

  it('calibrates a heater without the transport local deadline, since the macro runs for minutes', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
    const printer = usePrinterStore()

    await expect(printer.calibrateHeater('pid', 'extruder', 210)).resolves.toBe(true)
    expect(rpcCall).toHaveBeenCalledWith(
      'printer.gcode.script',
      { script: 'PID_CALIBRATE HEATER=extruder TARGET=210' },
      { timeoutMs: null },
    )

    rpcCall.mockClear()
    await expect(printer.calibrateHeater('mpc', 'heater_generic chamber', 60)).resolves.toBe(true)
    expect(rpcCall).toHaveBeenCalledWith(
      'printer.gcode.script',
      { script: 'MPC_CALIBRATE HEATER=chamber TARGET=60' },
      { timeoutMs: null },
    )

    rpcCall.mockClear()
    await expect(printer.calibrateHeater('pid', 'extruder', 0)).resolves.toBe(false)
    expect(rpcCall).not.toHaveBeenCalled()
  })

  it('moves to an absolute coordinate, clamped to the reported build volume', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
    const printer = usePrinterStore()
    printer.buildVolume.minimum = [0, 0, 0]
    printer.buildVolume.maximum = [300, 300, 340]

    await expect(printer.moveTo({ x: 150, y: 150 })).resolves.toBe(true)
    expect(rpcCall).toHaveBeenCalledWith('printer.gcode.script', {
      script:
        'SAVE_GCODE_STATE NAME=_alabaster_movement\nG90\nG1 X150.00 Y150.00 F6000\nRESTORE_GCODE_STATE NAME=_alabaster_movement',
    })

    // Beyond the volume is clamped rather than refused: the intent is clear.
    rpcCall.mockClear()
    await expect(printer.moveTo({ x: 999, y: -50 })).resolves.toBe(true)
    expect(rpcCall).toHaveBeenCalledWith('printer.gcode.script', {
      script:
        'SAVE_GCODE_STATE NAME=_alabaster_movement\nG90\nG1 X300.00 Y0.00 F6000\nRESTORE_GCODE_STATE NAME=_alabaster_movement',
    })

    // A Z-only move uses the slower vertical feedrate, like jogging does.
    rpcCall.mockClear()
    await expect(printer.moveTo({ z: 20 })).resolves.toBe(true)
    expect(rpcCall).toHaveBeenCalledWith('printer.gcode.script', {
      script:
        'SAVE_GCODE_STATE NAME=_alabaster_movement\nG90\nG1 Z20.00 F600\nRESTORE_GCODE_STATE NAME=_alabaster_movement',
    })

    rpcCall.mockClear()
    await expect(printer.moveTo({})).resolves.toBe(false)
    expect(rpcCall).not.toHaveBeenCalled()
  })

  it('runs leveling without the transport local deadline, since probing takes minutes', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
    const printer = usePrinterStore()

    await expect(printer.runLeveling('quadGantryLevel')).resolves.toBe(true)
    expect(rpcCall).toHaveBeenCalledWith(
      'printer.gcode.script',
      { script: 'QUAD_GANTRY_LEVEL' },
      { timeoutMs: null },
    )

    rpcCall.mockClear()
    await expect(printer.runLeveling('screwsTiltAdjust')).resolves.toBe(true)
    expect(rpcCall).toHaveBeenCalledWith(
      'printer.gcode.script',
      { script: 'SCREWS_TILT_CALCULATE' },
      { timeoutMs: null },
    )
  })

  it('releases the steppers with one command', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
    const printer = usePrinterStore()

    await expect(printer.disableMotors()).resolves.toBe(true)
    expect(rpcCall).toHaveBeenCalledWith('printer.gcode.script', { script: 'M84' })
  })

  it('saves configuration and restarts without opting out of the local deadline', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
    const printer = usePrinterStore()

    await expect(printer.saveConfig()).resolves.toBe(true)
    expect(rpcCall).toHaveBeenCalledWith('printer.gcode.script', { script: 'SAVE_CONFIG' })
  })

  it('only starts files returned by Moonraker', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall')
    rpcCall.mockResolvedValueOnce([
      { path: 'cube.gcode', modified: 20, size: 10 },
      { path: 'notes.txt', modified: 30, size: 5 },
    ] as never)
    rpcCall.mockResolvedValueOnce('ok' as never)
    const printer = usePrinterStore()

    await expect(printer.refreshFiles()).resolves.toBe(true)
    expect(printer.files.map((file) => file.path)).toEqual(['cube.gcode'])
    await expect(printer.startPrint('not-returned.gcode')).resolves.toBe(false)
    await expect(printer.startPrint('cube.gcode')).resolves.toBe(true)
    expect(rpcCall).toHaveBeenLastCalledWith('printer.print.start', { filename: 'cube.gcode' })
  })

  it('uploads to the gcodes root and refreshes the list so the file can be started', async () => {
    const moonraker = useMoonrakerStore()
    moonraker.endpoint = 'ws://printer.local:7125/websocket'
    const rpcCall = vi
      .spyOn(moonraker, 'rpcCall')
      .mockResolvedValueOnce([{ path: 'vase.gcode', modified: 1, size: 500 }] as never)
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ item: { path: 'vase.gcode', root: 'gcodes' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const printer = usePrinterStore()
    const file = new File(['G1 X10'], 'vase.gcode')

    await expect(printer.uploadPrintFile(file)).resolves.toBe('vase.gcode')
    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData
    expect(body.get('root')).toBe('gcodes')
    // Uploading refreshes the same list startPrint checks, so the file the user
    // just sent is immediately a valid target rather than requiring a second trip.
    expect(rpcCall).toHaveBeenCalledWith('server.files.list', { root: 'gcodes' })
    expect(printer.files.map((entry) => entry.path)).toEqual(['vase.gcode'])
  })

  it('reports a failed upload without touching the file list', async () => {
    const moonraker = useMoonrakerStore()
    moonraker.endpoint = 'ws://printer.local:7125/websocket'
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 500 })),
    )
    const printer = usePrinterStore()

    await expect(printer.uploadPrintFile(new File(['x'], 'vase.gcode'))).resolves.toBeNull()
    expect(printer.lastCommandError).toBe('uploadFile')
    expect(printer.files).toEqual([])
  })

  /** Puts the store into a print in progress with speed and flow away from 100%. */
  function startPrintingAwayFromDefaults() {
    const moonraker = useMoonrakerStore()
    let snapshotHandler: ObjectSnapshotHandler | undefined
    let statusHandler: NotificationHandler | undefined
    vi.spyOn(moonraker, 'setObjectSubscription').mockResolvedValue(undefined)
    vi.spyOn(moonraker, 'onObjectSnapshot').mockImplementation((handler) => {
      snapshotHandler = handler
      return () => undefined
    })
    vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
      if (method === 'notify_status_update') statusHandler = handler
      return () => undefined
    })

    const printer = usePrinterStore()
    printer.start()
    snapshotHandler?.({
      eventtime: 1,
      status: {
        print_stats: { state: 'printing', filename: 'cube.gcode' },
        gcode_move: { speed_factor: 1.5, extrude_factor: 1.2 },
      },
    })

    const endPrint = (state: string) =>
      statusHandler?.({
        jsonrpc: '2.0',
        method: 'notify_status_update',
        params: [{ print_stats: { state } }],
      })
    return { printer, moonraker, endPrint }
  }

  it('resets speed and flow on the print-end states the card is configured to reset on', () => {
    const layout = useDashboardLayoutStore()
    layout.updateConfig('print', { resetOnComplete: true, resetOnCancelled: false })
    const { printer, moonraker, endPrint } = startPrintingAwayFromDefaults()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)

    endPrint('cancelled')
    // Not configured for cancelled: the values the user was relying on stay put.
    expect(rpcCall).not.toHaveBeenCalled()
    expect(printer.motion.speedFactor).toBe(1.5)

    endPrint('printing') // a fresh attempt at the same file
    endPrint('complete')
    expect(rpcCall).toHaveBeenCalledWith('printer.gcode.script', { script: 'M220 S100' })
    expect(rpcCall).toHaveBeenCalledWith('printer.gcode.script', { script: 'M221 S100' })
  })

  it('leaves speed and flow alone on every end state by default', () => {
    const { moonraker, endPrint } = startPrintingAwayFromDefaults()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)

    for (const state of ['complete', 'cancelled', 'error']) {
      endPrint(state)
      endPrint('printing')
    }

    expect(rpcCall).not.toHaveBeenCalled()
  })

  it('resets only the limits that drifted from printer.cfg, on the states Machine is configured to reset on', () => {
    const layout = useDashboardLayoutStore()
    layout.updateConfig('machine', { resetOnComplete: true, resetOnCancelled: false })
    usePrinterConfigStore().settings = {
      printer: {
        max_velocity: 300,
        max_accel: 3000,
        square_corner_velocity: 5,
        minimum_cruise_ratio: 0.5,
      },
    } as never

    const moonraker = useMoonrakerStore()
    let snapshotHandler: ObjectSnapshotHandler | undefined
    let statusHandler: NotificationHandler | undefined
    vi.spyOn(moonraker, 'setObjectSubscription').mockResolvedValue(undefined)
    vi.spyOn(moonraker, 'onObjectSnapshot').mockImplementation((handler) => {
      snapshotHandler = handler
      return () => undefined
    })
    vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
      if (method === 'notify_status_update') statusHandler = handler
      return () => undefined
    })

    const printer = usePrinterStore()
    printer.start()
    // Only velocity has drifted from printer.cfg; the other three already
    // match what a reset would send.
    snapshotHandler?.({
      eventtime: 1,
      status: {
        print_stats: { state: 'printing', filename: 'cube.gcode' },
        toolhead: {
          max_velocity: 500,
          max_accel: 3000,
          square_corner_velocity: 5,
          minimum_cruise_ratio: 0.5,
        },
      },
    })

    const endPrint = (state: string) =>
      statusHandler?.({
        jsonrpc: '2.0',
        method: 'notify_status_update',
        params: [{ print_stats: { state } }],
      })
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)

    endPrint('cancelled')
    // Not configured for cancelled: the drifted value stays put.
    expect(rpcCall).not.toHaveBeenCalled()
    expect(printer.motion.maxVelocity).toBe(500)

    endPrint('printing') // a fresh attempt at the same file
    endPrint('complete')
    expect(rpcCall).toHaveBeenCalledWith('printer.gcode.script', {
      script: 'SET_VELOCITY_LIMIT VELOCITY=300',
    })
  })

  it('leaves the limits alone on every end state by default', () => {
    usePrinterConfigStore().settings = {
      printer: { max_velocity: 300 },
    } as never
    const { moonraker, endPrint } = startPrintingAwayFromDefaults()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)

    for (const state of ['complete', 'cancelled', 'error']) {
      endPrint(state)
      endPrint('printing')
    }

    expect(rpcCall).not.toHaveBeenCalled()
  })

  it('reports only the layer counters the slicer provided', () => {
    const printer = usePrinterStore()

    printer.printStats.state = 'printing'
    printer.printStats.currentLayer = 42
    printer.printStats.totalLayer = 100
    expect(printer.layer).toEqual({ current: 42, total: 100 })

    // Without a reported total, the slicer's own count from metadata stands in.
    printer.printStats.totalLayer = null
    printer.currentMetadata = { filename: 'cube.gcode', layer_count: 78 }
    expect(printer.layer).toEqual({ current: 42, total: 78 })
  })

  it('never invents a layer from Z, whatever the layer heights say', () => {
    const printer = usePrinterStore()

    printer.printStats.state = 'printing'
    printer.printStats.currentLayer = null
    printer.printStats.totalLayer = null
    printer.motion.position = [0, 0, 2.3]
    printer.currentMetadata = {
      filename: 'cube.gcode',
      // Everything the arithmetic would need is present, and it is still not
      // used: layer_height is a nominal setting, and Z-hop moves the nozzle a
      // layer or two on every travel.
      layer_height: 0.2,
      first_layer_height: 0.3,
      object_height: 10.3,
      layer_count: 51,
    }

    expect(printer.layer).toEqual({ current: null, total: 51 })
    // Height answers the same question without the assumption.
    expect(printer.heightProgress?.fraction).toBeCloseTo(2.3 / 10.3)
  })

  it('measures height progress in the G-code frame, not the mesh-corrected one', () => {
    const printer = usePrinterStore()

    printer.printStats.state = 'printing'
    printer.currentMetadata = { filename: 'cube.gcode', object_height: 10.3 }

    // The slicer commanded Z2.3. The live position carries a G-code offset of
    // -0.05 from babystepping and +0.24 of bed mesh correction on top, which is
    // more than a whole layer of error at a 0.2 mm layer height.
    printer.motion.position = [0, 0, 2.3]
    printer.motion.livePosition = [0, 0, 2.49]
    printer.motion.homingOrigin = [0, 0, -0.05]

    expect(printer.heightProgress).toEqual({
      current: 2.3,
      total: 10.3,
      fraction: 2.3 / 10.3,
    })
  })

  it('reports no height progress without an object height or an active print', () => {
    const printer = usePrinterStore()

    printer.motion.position = [0, 0, 5.15]
    printer.currentMetadata = { filename: 'adaptive.gcode', object_height: 10.3 }
    expect(printer.heightProgress).toBeNull()

    printer.printStats.state = 'printing'
    expect(printer.heightProgress?.fraction).toBeCloseTo(0.5)

    printer.currentMetadata = { filename: 'handwritten.gcode' }
    expect(printer.heightProgress).toBeNull()
  })

  it('clears a finished job by unloading the file', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
    const printer = usePrinterStore()

    await expect(printer.clearPrintStats()).resolves.toBe(true)
    expect(rpcCall).toHaveBeenCalledWith('printer.gcode.script', {
      script: 'SDCARD_RESET_FILE',
    })
  })

  it('reports slicer progress only once the printer has sent M73', () => {
    const printer = usePrinterStore()

    // Absent, rather than zero: a file sliced without M73 output must not read
    // as a print stuck at 0%.
    expect(printer.slicerProgress).toBeNull()

    printer.displayProgress = 0.42
    expect(printer.slicerProgress).toBeCloseTo(0.42)
  })

  it('measures progress against the G-code, not the thumbnails at the head of the file', () => {
    const printer = usePrinterStore()
    printer.printStats.state = 'printing'

    // A 1 MB file whose first 290 KB are base64 thumbnails and slicer comments,
    // and whose last 10 KB are the trailing configuration block. Klipper streams
    // past the head in milliseconds, so file_position sits at 290,000 before the
    // first move — and Moonraker's own ratio calls that 29%.
    printer.virtualSdcard.filePosition = 290_000
    printer.virtualSdcard.progress = 0.29
    expect(printer.progress).toBeCloseTo(0.29)

    printer.currentMetadata = {
      filename: 'cube.gcode',
      gcode_start_byte: 290_000,
      gcode_end_byte: 990_000,
    }

    // Nothing has been printed yet, and now the reading says so.
    expect(printer.progress).toBe(0)

    // Halfway through the printable range is halfway through the print.
    printer.virtualSdcard.filePosition = 640_000
    expect(printer.progress).toBeCloseTo(0.5)

    // The trailing configuration block is not the last half percent of printing.
    printer.virtualSdcard.filePosition = 990_000
    expect(printer.progress).toBe(1)
    printer.virtualSdcard.filePosition = 1_000_000
    expect(printer.progress).toBe(1)
  })

  it('keeps the remaining time and drift free of the same inflation', () => {
    const printer = usePrinterStore()
    printer.printStats.state = 'printing'
    printer.printStats.printDuration = 600
    printer.currentMetadata = {
      filename: 'cube.gcode',
      estimated_time: 3600,
      gcode_start_byte: 290_000,
      gcode_end_byte: 990_000,
    }

    // Ten minutes into an hour's estimate, exactly a sixth of the G-code done:
    // this print is running precisely to plan.
    printer.virtualSdcard.filePosition = 290_000 + 700_000 / 6
    // Moonraker's own ratio calls the same position 40.7%, because 290 KB of
    // thumbnails and comments count as printed.
    printer.virtualSdcard.progress = 0.407

    expect(printer.progress).toBeCloseTo(1 / 6)
    // On plan means no drift and half an hour left.
    expect(printer.estimateDrift).toBeCloseTo(0)
    expect(printer.timeEstimates.file).toBeCloseTo(3000)

    // The raw ratio would have projected a 25-minute total against an hour's
    // estimate and reported the print as 59% ahead of schedule.
    expect(600 / printer.virtualSdcard.progress / 3600 - 1).toBeCloseTo(-0.59, 2)
  })

  it('offers every time estimate a source can answer and drifts against the slicer', () => {
    const printer = usePrinterStore()

    printer.printStats.state = 'printing'
    printer.printStats.printDuration = 600
    printer.printStats.filamentUsed = 100
    printer.virtualSdcard.progress = 0.25
    printer.currentMetadata = {
      filename: 'cube.gcode',
      estimated_time: 3000,
      filament_total: 500,
    }

    // The slicer promised 3000s and 600 have passed.
    expect(printer.timeEstimates.slicer).toBe(2400)
    // A quarter done after 600s extrapolates to 2400s left.
    expect(printer.timeEstimates.file).toBe(1800)
    // A fifth of the filament after 600s extrapolates to 2400s left.
    expect(printer.timeEstimates.filament).toBe(2400)
    // The slicer's own number leads when it exists.
    expect(printer.remainingSeconds).toBe(2400)

    // Projected total is 600 / 0.25 = 2400 against a promise of 3000: 20% ahead.
    expect(printer.estimateDrift).toBeCloseTo(-0.2)

    // Too early in the print for extrapolation to mean anything.
    printer.printStats.printDuration = 30
    expect(printer.estimateDrift).toBeNull()
    expect(printer.timeEstimates.filament).toBeNull()
  })

  it('exposes filament progress and a parameterized drift so Print can keep its four readouts in agreement', () => {
    const printer = usePrinterStore()

    printer.printStats.state = 'printing'
    printer.printStats.printDuration = 600
    printer.printStats.filamentUsed = 100
    printer.virtualSdcard.progress = 0.25
    printer.currentMetadata = {
      filename: 'cube.gcode',
      estimated_time: 3000,
      filament_total: 500,
    }

    expect(printer.filamentProgress).toBeCloseTo(0.2)
    // `estimateDrift` is `driftFor` applied to the byte-position fraction —
    // the same figure a caller gets by passing it explicitly.
    expect(printer.driftFor(printer.progress)).toBeCloseTo(printer.estimateDrift as number)
    // A different fraction — filament's 20% rather than the file's 25% —
    // reads as more behind, since the same elapsed time bought less of it.
    expect(printer.driftFor(printer.filamentProgress)).toBeGreaterThan(
      printer.estimateDrift as number,
    )
    expect(printer.driftFor(null)).toBeNull()
  })

  it('caches file metadata and reports no thumbnail when the file has none', async () => {
    const moonraker = useMoonrakerStore()
    moonraker.endpoint = 'ws://printer.local:7125/websocket'
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({
      filename: 'parts/cube.gcode',
      thumbnails: [
        { width: 32, height: 32, size: 100, relative_path: '.thumbs/cube-32x32.png' },
        { width: 300, height: 300, size: 900, relative_path: '.thumbs/cube-300x300.png' },
      ],
    } as never)
    const printer = usePrinterStore()

    await printer.loadMetadata('parts/cube.gcode')
    await printer.loadMetadata('parts/cube.gcode')
    expect(rpcCall).toHaveBeenCalledOnce()
    expect(rpcCall).toHaveBeenCalledWith('server.files.metadata', {
      filename: 'parts/cube.gcode',
    })

    printer.printStats.filename = 'parts/cube.gcode'
    await printer.loadMetadata('parts/cube.gcode')
    // The largest thumbnail wins, resolved against the file's own directory.
    expect(printer.thumbnailUrl).toBe(
      'http://printer.local:7125/server/files/gcodes/parts/.thumbs/cube-300x300.png',
    )

    printer.currentMetadata = { filename: 'parts/cube.gcode' }
    expect(printer.thumbnailUrl).toBeNull()
  })

  it('does not report a metadata read as a failed command', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockRejectedValue(new Error('no metadata'))
    const printer = usePrinterStore()

    await expect(printer.loadMetadata('handwritten.gcode')).resolves.toBeNull()
    expect(printer.lastCommandError).toBeNull()
  })

  it('drops cached metadata once the file list reports it was rewritten', async () => {
    const moonraker = useMoonrakerStore()
    let filelistHandler: NotificationHandler | undefined
    vi.spyOn(moonraker, 'setObjectSubscription').mockResolvedValue(undefined)
    vi.spyOn(moonraker, 'onObjectSnapshot').mockImplementation(() => () => undefined)
    vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
      if (method === 'notify_filelist_changed') filelistHandler = handler
      return () => undefined
    })
    const rpcCall = vi
      .spyOn(moonraker, 'rpcCall')
      .mockResolvedValueOnce({ filename: 'cube.gcode', estimated_time: 1000 } as never)
      .mockResolvedValueOnce({ filename: 'cube.gcode', estimated_time: 2000 } as never)

    const printer = usePrinterStore()
    printer.start()

    await printer.loadMetadata('cube.gcode')
    expect(rpcCall).toHaveBeenCalledTimes(1)

    // Same filename, no root/action match: a delete or a config-root change
    // must not evict a gcode file's cache entry.
    filelistHandler?.({
      jsonrpc: '2.0',
      method: 'notify_filelist_changed',
      params: [{ action: 'delete_file', item: { root: 'gcodes', path: 'cube.gcode' } }],
    })
    await printer.loadMetadata('cube.gcode')
    expect(rpcCall).toHaveBeenCalledTimes(1)

    filelistHandler?.({
      jsonrpc: '2.0',
      method: 'notify_filelist_changed',
      params: [{ action: 'modify_file', item: { root: 'gcodes', path: 'cube.gcode' } }],
    })
    await printer.loadMetadata('cube.gcode')
    expect(rpcCall).toHaveBeenCalledTimes(2)
  })

  it('reloads the active print file metadata as soon as a rewrite is reported', async () => {
    const moonraker = useMoonrakerStore()
    let filelistHandler: NotificationHandler | undefined
    vi.spyOn(moonraker, 'setObjectSubscription').mockResolvedValue(undefined)
    vi.spyOn(moonraker, 'onObjectSnapshot').mockImplementation(() => () => undefined)
    vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
      if (method === 'notify_filelist_changed') filelistHandler = handler
      return () => undefined
    })
    const rpcCall = vi
      .spyOn(moonraker, 'rpcCall')
      .mockResolvedValueOnce({ filename: 'cube.gcode', estimated_time: 1000 } as never)
      .mockResolvedValueOnce({ filename: 'cube.gcode', estimated_time: 2000 } as never)

    const printer = usePrinterStore()
    printer.start()
    printer.printStats.filename = 'cube.gcode'

    await printer.loadMetadata('cube.gcode')
    expect(printer.currentMetadata?.estimated_time).toBe(1000)

    filelistHandler?.({
      jsonrpc: '2.0',
      method: 'notify_filelist_changed',
      params: [{ action: 'create_file', item: { root: 'gcodes', path: 'cube.gcode' } }],
    })

    await vi.waitFor(() => expect(rpcCall).toHaveBeenCalledTimes(2))
    expect(printer.currentMetadata?.estimated_time).toBe(2000)
  })
})

describe('bed mesh probe temperature bookkeeping', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('records the bed temperature a fresh calibration ran at, under Klipper\'s own "default" name', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
    const telemetry = useTelemetryStore()
    telemetry.readings.heater_bed = {
      objectName: 'heater_bed',
      name: 'heater_bed',
      kind: 'bed',
      temperature: 61.2,
      target: 60,
      power: 0.4,
      speed: null,
      isSettable: true,
    }
    const bedMesh = useBedMeshStore()
    const printer = usePrinterStore()

    await printer.calibrateBedMesh()
    // Klipper itself saves an unnamed calibration under "default" — Alabaster
    // has to commit under that same name, or the mismatch warning can never
    // fire for a mesh made from the plain "Calibrate" button.
    bedMesh.profileName = 'default'
    expect(bedMesh.activeProbeTemperature).toBe(61.2)

    await printer.saveBedMeshProfile('fresh')
    bedMesh.profileName = 'fresh'
    expect(bedMesh.activeProbeTemperature).toBe(61.2)
  })

  it('commits the calibration temperature directly when a profile name is given', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
    const telemetry = useTelemetryStore()
    telemetry.readings.heater_bed = {
      objectName: 'heater_bed',
      name: 'heater_bed',
      kind: 'bed',
      temperature: 45,
      target: 45,
      power: 0.1,
      speed: null,
      isSettable: true,
    }
    const bedMesh = useBedMeshStore()
    const printer = usePrinterStore()

    await printer.calibrateBedMesh('named-in-one-shot')
    bedMesh.profileName = 'named-in-one-shot'
    expect(bedMesh.activeProbeTemperature).toBe(45)
  })

  it('carries a temperature through a rename and drops the old name', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
    const telemetry = useTelemetryStore()
    telemetry.readings.heater_bed = {
      objectName: 'heater_bed',
      name: 'heater_bed',
      kind: 'bed',
      temperature: 55,
      target: 55,
      power: 0.2,
      speed: null,
      isSettable: true,
    }
    const bedMesh = useBedMeshStore()
    const printer = usePrinterStore()

    await printer.calibrateBedMesh('before')
    await printer.renameBedMeshProfile('before', 'after')

    bedMesh.profileName = 'after'
    expect(bedMesh.activeProbeTemperature).toBe(55)
    bedMesh.profileName = 'before'
    expect(bedMesh.activeProbeTemperature).toBeNull()
  })

  it('drops the recorded temperature when the profile is removed', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
    const telemetry = useTelemetryStore()
    telemetry.readings.heater_bed = {
      objectName: 'heater_bed',
      name: 'heater_bed',
      kind: 'bed',
      temperature: 50,
      target: 50,
      power: 0.2,
      speed: null,
      isSettable: true,
    }
    const bedMesh = useBedMeshStore()
    const printer = usePrinterStore()

    await printer.calibrateBedMesh('doomed')
    await printer.removeBedMeshProfile('doomed')

    bedMesh.profileName = 'doomed'
    expect(bedMesh.activeProbeTemperature).toBeNull()
  })

  it('records nothing when the command itself fails', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockRejectedValue(new Error('offline'))
    const telemetry = useTelemetryStore()
    telemetry.readings.heater_bed = {
      objectName: 'heater_bed',
      name: 'heater_bed',
      kind: 'bed',
      temperature: 70,
      target: 70,
      power: 0.5,
      speed: null,
      isSettable: true,
    }
    const bedMesh = useBedMeshStore()
    const printer = usePrinterStore()

    await printer.calibrateBedMesh('never-saved')
    bedMesh.profileName = 'never-saved'
    expect(bedMesh.activeProbeTemperature).toBeNull()
  })
})

describe('screws tilt results', () => {
  // Klipper's own documented sample, including the malformed coordinate list
  // on the third screw ("y=155.0, y=190.0") that a coordinate-matching parser
  // would silently drop.
  const output = [
    '// 01:20 means 1 full turn and 20 minutes, CW=clockwise, CCW=counter-clockwise',
    '// front left screw (base) : x=-5.0, y=30.0, z=2.48750',
    '// front right screw : x=155.0, y=30.0, z=2.36000 : adjust CW 01:15',
    '// rear right screw : y=155.0, y=190.0, z=2.71500 : adjust CCW 00:50',
    '// rear left screw : x=-5.0, y=190.0, z=2.47250 : adjust CW 00:02',
  ]

  it('reads every screw, and the header line is not one of them', () => {
    expect(parseScrewsTiltResults(output)).toEqual([
      { name: 'front left screw', isBase: true, direction: null, turns: 0, minutes: 0 },
      { name: 'front right screw', isBase: false, direction: 'CW', turns: 1, minutes: 15 },
      { name: 'rear right screw', isBase: false, direction: 'CCW', turns: 0, minutes: 50 },
      { name: 'rear left screw', isBase: false, direction: 'CW', turns: 0, minutes: 2 },
    ])
  })

  it('ignores unrelated console traffic entirely', () => {
    expect(parseScrewsTiltResults(['ok', '// Klipper state: Ready', 'B:60.0 /60.0'])).toEqual([])
  })
})
