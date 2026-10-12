import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { procedureById, type ProcedureContext } from '@/features/calibration/procedures'
import { useAvailabilityStore } from '@/stores/availability'
import { useManualProbeStore } from '@/stores/manualProbe'
import { calibrationTimings, useCalibrationStore } from '@/stores/calibration'
import { useConsoleStore } from '@/stores/console'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import { useQuickConfigStore } from '@/stores/quickConfig'

const context: ProcedureContext = {
  hasSection: () => true,
  sections: ['resonance_tester', 'probe'],
  hasCommand: () => false,
  hasMacro: () => false,
  settings: (section) => (section === 'probe' ? { z_offset: 1.4 } : null),
  kinematics: 'corexy',
  hasProbe: true,
  heaters: [],
  hasRunoutSensors: false,
  livePressureAdvance: null,
  liveSmoothTime: null,
  pendingItems: () => usePrinterStore().saveConfigPendingItems,
  mesh: () => null,
  newestGraph: () => null,
  screwsTilt: () => null,
  written: () => null,
}

function say(raw: string, kind: 'response' | 'command' = 'response'): void {
  const gcodeConsole = useConsoleStore()
  const last = gcodeConsole.consoleEntries.at(-1)?.id ?? 0
  gcodeConsole.consoleEntries = [
    ...gcodeConsole.consoleEntries,
    { id: last + 1, raw, message: raw, kind, at: 0 },
  ]
}

interface Database {
  value: unknown
}

function setup(database: Database = { value: undefined }) {
  useAvailabilityStore().moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
  const moonraker = useMoonrakerStore()
  let releaseScript: (() => void) | null = null
  let refuseScript: (() => void) | null = null
  const printerChangeResets: Array<() => void> = []
  vi.spyOn(moonraker, 'onPrinterChange').mockImplementation((reset) => {
    printerChangeResets.push(reset)
    return () => undefined
  })
  const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation(((
    method: string,
    params?: { value?: unknown },
  ) => {
    if (method === 'server.database.get_item') {
      return database.value === undefined
        ? Promise.reject(new Error('Key not found'))
        : Promise.resolve({ namespace: 'alabaster_calibration', key: 'log', value: database.value })
    }
    if (method === 'server.database.post_item') {
      database.value = params?.value
      return Promise.resolve({})
    }
    if (method === 'printer.gcode.script') {
      return new Promise((resolve, reject) => {
        releaseScript = () => resolve('ok')
        refuseScript = () => reject(new Error('Klipper refused it'))
      })
    }
    return Promise.resolve({})
  }) as never)
  return {
    calibration: useCalibrationStore(),
    rpcCall,
    finish: async () => {
      releaseScript?.()
      await flushPromises()
    },
    fail: async () => {
      refuseScript?.()
      await flushPromises()
    },
    /** What the Moonraker store does when another printer is selected. */
    switchPrinter: () => {
      for (const reset of printerChangeResets) reset()
    },
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  setActivePinia(createPinia())
  // A closed paper test waits for a late staging before it is read as aborted; not for 20 s here.
  calibrationTimings.lateResultMs = 20
})

describe('calibration runs', () => {
  it('reads only what the printer said after the run started', async () => {
    const { calibration, finish } = setup()
    say('// Axes noise for x-axis accelerometer: 9.0 (x), 9.0 (y), 9.0 (z)')
    const run = calibration.run(procedureById('axesNoise')!, {}, context)
    await flushPromises()
    say('// Axes noise for x-axis accelerometer: 1.0 (x), 2.0 (y), 3.0 (z)')
    await finish()
    await run

    expect(calibration.resultFor('axesNoise')?.rows.map((row) => row.after)).toEqual([
      '1.0 · 2.0 · 3.0',
    ])
  })

  it('does not count the echoed command as output', async () => {
    const { calibration, finish } = setup()
    const run = calibration.run(procedureById('axesNoise')!, {}, context)
    await flushPromises()

    expect(calibration.linesFor('axesNoise')).toEqual([])
    expect(calibration.resultFor('axesNoise')).toBeNull()
    await finish()
    await run
  })

  it('runs one procedure at a time', async () => {
    const { calibration, finish } = setup()
    const first = calibration.run(procedureById('axesNoise')!, {}, context)
    await flushPromises()

    await expect(calibration.run(procedureById('accelerometerQuery')!, {}, context)).resolves.toBe(
      false,
    )
    await finish()
    await first
  })

  it('compares against the settings as they were when the run started', async () => {
    const { calibration, finish } = setup()
    const run = calibration.run(procedureById('probeZOffset')!, {}, context)
    await flushPromises()
    await finish()
    await run
    say('// probe: z_offset: 1.535')

    expect(calibration.resultFor('probeZOffset')?.rows[0]).toMatchObject({
      before: '1.4',
      after: '1.535',
    })
  })
})

describe('what a run staged', () => {
  it('reads what the run staged for SAVE_CONFIG where its module printed nothing', async () => {
    const database: Database = { value: undefined }
    const { calibration, finish } = setup(database)
    const printer = usePrinterStore()
    // Staged before the run is somebody else's, and never counts as this run's.
    printer.saveConfigPendingItems = { probe: { z_offset: '-0.850' } }
    const run = calibration.run(procedureById('autoZ')!, {}, context)
    await flushPromises()
    say('// Z-CALIBRATION: ENDSTOP=-0.100 NOZZLE=-0.050 PROBE=1.400')
    await finish()
    await run
    expect(calibration.resultFor('autoZ')).toMatchObject({ rows: [], outcome: 'done' })

    // The status update trails the acknowledgement.
    printer.saveConfigPendingItems = {
      probe: { z_offset: '-0.850' },
      stepper_z: { position_endstop: '0.312' },
    }
    await flushPromises()
    expect(calibration.resultFor('autoZ')).toMatchObject({
      rows: [{ label: { literal: 'stepper_z · position_endstop' }, after: '0.312' }],
      outcome: 'staged',
    })

    // SAVE_CONFIG empties the pending list; the result keeps what it saw.
    printer.saveConfigPendingItems = {}
    await flushPromises()
    expect(calibration.resultFor('autoZ')?.rows).toHaveLength(1)
    const stored = database.value as { procedures: Record<string, { rows: unknown[] }[]> }
    expect(stored.procedures.autoZ?.[0]?.rows).toHaveLength(1)
  })

  it('keeps a parser’s own rows over the staged list', async () => {
    const { calibration, finish } = setup()
    const printer = usePrinterStore()
    const run = calibration.run(procedureById('probeZOffset')!, {}, context)
    await flushPromises()
    await finish()
    await run
    say('// probe: z_offset: 1.535')
    printer.saveConfigPendingItems = { probe: { z_offset: '1.535' } }
    await flushPromises()

    expect(calibration.resultFor('probeZOffset')?.rows).toEqual([
      { label: { literal: 'z_offset' }, before: '1.4', after: '1.535' },
    ])
  })
})

describe('what a finished run may still claim', () => {
  it('does not take what was staged after a command sent since it finished', async () => {
    const { calibration, finish } = setup()
    const printer = usePrinterStore()
    const run = calibration.run(procedureById('stepperBuzz')!, { STEPPER: 'stepper_x' }, context)
    await flushPromises()
    say('// ok')
    await finish()
    await run
    // A paper test started from the console, hours later, stages the probe offset.
    say('PROBE_CALIBRATE', 'command')
    say('// probe: z_offset: 0.480')
    printer.saveConfigPendingItems = { probe: { z_offset: '0.480' } }
    await flushPromises()

    expect(calibration.resultFor('stepperBuzz', 'stepper_x')).toMatchObject({
      rows: [],
      outcome: 'done',
    })
  })

  it('does not take what a later run staged', async () => {
    const { calibration, finish } = setup()
    const printer = usePrinterStore()
    const first = calibration.run(procedureById('axesNoise')!, {}, context)
    await flushPromises()
    say('// ok')
    await finish()
    await first
    const second = calibration.run(procedureById('autoZ')!, {}, context)
    await flushPromises()
    say('// Z-CALIBRATION: ENDSTOP=-0.100 NOZZLE=-0.050 PROBE=1.400')
    printer.saveConfigPendingItems = { probe: { z_offset: '0.480' } }
    await flushPromises()
    await finish()
    await second

    expect(calibration.resultFor('axesNoise')).toMatchObject({ rows: [], outcome: 'done' })
    expect(calibration.resultFor('autoZ')?.rows).toHaveLength(1)
  })

  it('re-logs a result that changed shape, not only one that grew', async () => {
    const database: Database = { value: undefined }
    const { calibration, finish } = setup(database)
    // A helper run watches Klipper's readiness, and ends on its first change otherwise.
    useAvailabilityStore().printerSnapshotSynchronized()
    const printer = usePrinterStore()
    const manualProbe = useManualProbeStore()
    const run = calibration.run(procedureById('probeZOffset')!, {}, context)
    await flushPromises()
    manualProbe.isActive = true
    await finish()
    // ACCEPT stages the offset; the line that names it trails the helper closing.
    printer.saveConfigPendingItems = { probe: { z_offset: '1.535' } }
    manualProbe.isActive = false
    await run
    await flushPromises()
    say('// probe: z_offset: 1.535')
    await flushPromises()

    const stored = database.value as {
      procedures: { probeZOffset: Array<{ rows: Array<{ label: unknown }> }> }
    }
    expect(stored.procedures.probeZOffset[0]!.rows).toEqual([
      { label: { literal: 'z_offset' }, before: '1.4', after: '1.535' },
    ])
  })
})

describe('a run the page or Klipper lost', () => {
  it('is on record from the moment it starts', async () => {
    const database: Database = { value: undefined }
    const { calibration, finish } = setup(database)
    const run = calibration.run(procedureById('axesNoise')!, {}, context)
    await flushPromises()

    type Stored = { procedures: { axesNoise: Array<{ outcome: string }> } }
    expect((database.value as Stored).procedures.axesNoise[0]!.outcome).toBe('running')
    expect(calibration.outcomeOf(calibration.latestEntry('axesNoise')!)).toBe('running')
    // Running is not having run: nothing is current until it completes.
    expect(calibration.lastRunAt('axesNoise')).toBeNull()

    say('// ok')
    await finish()
    await run
    await flushPromises()
    expect((database.value as Stored).procedures.axesNoise[0]!.outcome).toBe('done')
    expect(calibration.lastRunAt('axesNoise')).not.toBeNull()
  })

  it('reads a provisional entry with no live run behind it as interrupted', async () => {
    const at = Date.now() - 60_000
    const { calibration } = setup({
      value: {
        version: 1,
        procedures: { axesNoise: [{ at, values: {}, rows: [], outcome: 'running' }] },
      },
    })
    await calibration.loadLog()

    const entry = calibration.latestEntry('axesNoise')!
    expect(entry.outcome).toBe('running')
    expect(calibration.outcomeOf(entry)).toBe('interrupted')
    expect(calibration.lastRunAt('axesNoise')).toBeNull()
  })

  it('does not count a failed run as the last run', async () => {
    const { calibration, fail } = setup()
    const run = calibration.run(procedureById('axesNoise')!, {}, context)
    await flushPromises()
    await fail()
    await expect(run).resolves.toBe(false)

    expect(calibration.latestEntry('axesNoise')?.outcome).toBe('failed')
    expect(calibration.lastRunAt('axesNoise')).toBeNull()
  })

  it('ends a run when Klipper leaves ready, rather than waiting for an answer that never comes', async () => {
    const availability = useAvailabilityStore()
    const { calibration } = setup()
    availability.printerSnapshotSynchronized()
    const run = calibration.run(procedureById('axesNoise')!, {}, context)
    await flushPromises()
    expect(calibration.activeRun).not.toBeNull()

    availability.handleKlipperNotification('notify_klippy_shutdown')
    await expect(run).resolves.toBe(false)

    expect(calibration.activeRun).toBeNull()
    expect(calibration.runFor('axesNoise')?.interrupted).toBe(true)
    expect(calibration.latestEntry('axesNoise')?.outcome).toBe('interrupted')
    expect(calibration.lastRunAt('axesNoise')).toBeNull()
  })

  it('forgets everything on a printer switch, whether or not the page ever started the store', async () => {
    const { calibration, finish, switchPrinter } = setup()
    const run = calibration.run(procedureById('axesNoise')!, {}, context)
    await flushPromises()
    await finish()
    await run
    expect(calibration.lastRunAt('axesNoise')).not.toBeNull()

    switchPrinter()

    expect(calibration.lastRunAt('axesNoise')).toBeNull()
    expect(calibration.runFor('axesNoise')).toBeNull()
  })
})

describe('what the reader answered', () => {
  it('logs the answers as the run’s result, once', async () => {
    const database: Database = { value: undefined }
    const { calibration, finish } = setup(database)
    const run = calibration.run(procedureById('stepperBuzz')!, { STEPPER: 'stepper_x' }, context)
    await flushPromises()
    say('// ok')
    await finish()
    await run
    await flushPromises()

    calibration.answer(
      'stepperBuzz',
      [
        { label: { key: 'calibration.answer.moved' }, after: 'yes' },
        { label: { key: 'calibration.answer.direction' }, after: 'no' },
      ],
      'stepper_x',
    )
    await flushPromises()

    expect(calibration.resultFor('stepperBuzz', 'stepper_x')).toMatchObject({
      outcome: 'measured',
      rows: [{ after: 'yes' }, { after: 'no' }],
    })
    const stored = database.value as { procedures: Record<string, { rows: unknown[] }[]> }
    expect(stored.procedures.stepperBuzz).toHaveLength(1)
    expect(stored.procedures.stepperBuzz?.[0]?.rows).toHaveLength(2)
  })

  it('takes no answers for a run that is still going or failed', async () => {
    const { calibration, finish } = setup()
    const run = calibration.run(procedureById('stepperBuzz')!, { STEPPER: 'stepper_x' }, context)
    await flushPromises()
    calibration.answer(
      'stepperBuzz',
      [{ label: { key: 'calibration.answer.moved' }, after: 'yes' }],
      'stepper_x',
    )
    expect(calibration.resultFor('stepperBuzz', 'stepper_x')).toBeNull()
    await finish()
    await run
  })
})

describe('a procedure run once per stepper', () => {
  it('keeps a result and a history per stepper, so one is never shown for another', async () => {
    const { calibration, finish } = setup()
    const buzz = procedureById('stepperBuzz')!
    // A run's identity is when it started, so two runs need two different instants.
    let now = 1_000_000
    const runOn = async (stepper: string, line: string) => {
      vi.spyOn(Date, 'now').mockReturnValue((now += 1000))
      const started = calibration.run(buzz, { STEPPER: stepper }, context)
      await flushPromises()
      say(line)
      await finish()
      await started
      await flushPromises()
    }
    await runOn('stepper_x', '// x buzzed')
    calibration.answer(
      'stepperBuzz',
      [{ label: { key: 'calibration.answer.moved' }, after: 'yes' }],
      'stepper_x',
    )
    await runOn('stepper_y', '// y buzzed')

    expect(calibration.resultFor('stepperBuzz', 'stepper_x')?.rows).toEqual([
      { label: { key: 'calibration.answer.moved' }, after: 'yes' },
    ])
    // The second stepper has its own run, with no answers given yet.
    expect(calibration.runFor('stepperBuzz', 'stepper_y')?.answers).toEqual([])
    expect(calibration.resultFor('stepperBuzz', 'stepper_y')?.rows).toEqual([])
    // A stepper never run has nothing to show, whatever ran on the others.
    expect(calibration.runFor('stepperBuzz', 'extruder')).toBeNull()
    expect(calibration.historyFor('stepperBuzz', 'stepper_x')).toHaveLength(1)
    expect(calibration.historyFor('stepperBuzz', 'stepper_y')).toHaveLength(1)
    expect(calibration.historyFor('stepperBuzz', 'extruder')).toHaveLength(0)
    expect(calibration.historyFor('stepperBuzz')).toHaveLength(2)
  })
})

describe('the calibration log', () => {
  it('keeps a run that finished while the log was being read again', async () => {
    const database: Database = { value: undefined }
    const { calibration, finish } = setup(database)
    const run = calibration.run(procedureById('probeAccuracy')!, {}, context)
    await flushPromises()
    await finish()
    await run
    await flushPromises()
    expect(calibration.lastRunAt('probeAccuracy')).not.toBeNull()

    // The printer's copy has nothing yet, or has not been written at all.
    database.value = { version: 1, procedures: {} }
    await calibration.loadLog()
    expect(calibration.lastRunAt('probeAccuracy')).not.toBeNull()
    database.value = undefined
    await calibration.loadLog()
    expect(calibration.lastRunAt('probeAccuracy')).not.toBeNull()
  })

  it('records a finished run in the printer’s database', async () => {
    const database: Database = { value: undefined }
    const { calibration, finish } = setup(database)
    const run = calibration.run(procedureById('axesNoise')!, {}, context)
    await flushPromises()
    say('// Axes noise for x-axis accelerometer: 1.0 (x), 2.0 (y), 3.0 (z)')
    await finish()
    await run
    await flushPromises()

    const stored = database.value as { version: number; procedures: Record<string, unknown[]> }
    expect(stored.version).toBe(1)
    expect(stored.procedures.axesNoise).toHaveLength(1)
    expect(calibration.lastRunAt('axesNoise')).not.toBeNull()
  })

  /*
   * An interactive run returns before its result: the paper test's ACCEPT
   * is what prints the new offset, minutes after the command came back.
   */
  it('updates the entry as an interactive run’s result arrives', async () => {
    const database: Database = { value: undefined }
    const { calibration, finish } = setup(database)
    const manualProbe = useManualProbeStore()
    const run = calibration.run(procedureById('probeZOffset')!, {}, context)
    await flushPromises()
    manualProbe.isActive = true
    await finish()
    await flushPromises()
    // The command returned with the paper test still waiting: the run is not over.
    expect(calibration.activeRun?.procedureId).toBe('probeZOffset')

    say('// probe: z_offset: 1.535')
    manualProbe.isActive = false
    await run
    await flushPromises()

    expect(calibration.activeRun).toBeNull()
    const stored = database.value as { procedures: { probeZOffset: Array<{ rows: unknown[] }> } }
    expect(stored.procedures.probeZOffset).toHaveLength(1)
    expect(stored.procedures.probeZOffset[0]!.rows).toHaveLength(1)
  })

  it('logs a paper test closed without a value as failed', async () => {
    const database: Database = { value: undefined }
    const { calibration, finish } = setup(database)
    const manualProbe = useManualProbeStore()
    const run = calibration.run(procedureById('probeZOffset')!, {}, context)
    await flushPromises()
    manualProbe.isActive = true
    await finish()
    await flushPromises()
    manualProbe.isActive = false

    expect(await run).toBe(false)
    const stored = database.value as { procedures: { probeZOffset: Array<{ outcome: string }> } }
    expect(stored.procedures.probeZOffset[0]!.outcome).toBe('failed')
  })

  /*
   * Axis twist opens one paper test per point: the run lasts until the module
   * says the last point was taken, not until the first test closes.
   */
  it('keeps a run open between the paper tests of one sequence', async () => {
    const { calibration, finish } = setup({ value: undefined })
    // A connection that goes while it waits ends the run, so this one has to be fully up.
    useAvailabilityStore().printerSnapshotSynchronized()
    const manualProbe = useManualProbeStore()
    const run = calibration.run(procedureById('axisTwist')!, {}, context)
    await flushPromises()
    manualProbe.isActive = true
    await finish()
    await flushPromises()
    manualProbe.isActive = false
    await flushPromises()
    expect(calibration.activeRun?.procedureId).toBe('axisTwist')

    manualProbe.isActive = true
    await flushPromises()
    say('// The SAVE_CONFIG command will update the printer config file and restart the printer.')
    say('// AXIS_TWIST_COMPENSATION_CALIBRATE: Calibration complete, offsets: [0.01, -0.01]')
    manualProbe.isActive = false

    expect(await run).toBe(true)
    expect(calibration.activeRun).toBeNull()
  })

  it('stops a finished run’s output at the next command sent', async () => {
    const { calibration, finish } = setup({ value: undefined })
    const run = calibration.run(procedureById('probeAccuracy')!, {}, context)
    await flushPromises()
    say('// probe at 1,1 is z=1.000000')
    await finish()
    await run
    say('BED_MESH_CALIBRATE', 'command')
    say('// probe at 2,2 is z=1.100000')

    expect(calibration.linesFor('probeAccuracy')).toEqual(['// probe at 1,1 is z=1.000000'])
  })

  it('merges with runs another browser logged, rather than writing over them', async () => {
    const database: Database = {
      value: {
        version: 1,
        procedures: { bedMesh: [{ at: 1, values: {}, rows: [], outcome: 'done' }] },
      },
    }
    const { calibration, finish } = setup(database)
    const run = calibration.run(procedureById('axesNoise')!, {}, context)
    await flushPromises()
    await finish()
    await run
    await flushPromises()

    const stored = database.value as { procedures: Record<string, unknown[]> }
    expect(stored.procedures.bedMesh).toHaveLength(1)
    expect(stored.procedures.axesNoise).toHaveLength(1)
  })

  it('keeps a run’s actions, so an earlier shaper run can still be applied or saved', async () => {
    const database: Database = { value: undefined }
    const { calibration, finish } = setup(database)
    const run = calibration.run(procedureById('shakeTuneShaper')!, {}, context)
    await flushPromises()
    say('// X axis frequency profile generation...')
    say('//     -> Best shaper: MZV @ 48.2 Hz')
    say('// Y axis frequency profile generation...')
    say('//     -> Best shaper: EI @ 39.6 Hz')
    await finish()
    await run
    await flushPromises()

    const [entry] = calibration.historyFor('shakeTuneShaper')
    expect(entry?.rows).toHaveLength(2)
    expect(entry?.actions?.[0]).toMatchObject({
      command:
        'SET_INPUT_SHAPER SHAPER_TYPE_X=mzv SHAPER_FREQ_X=48.2 SHAPER_TYPE_Y=ei SHAPER_FREQ_Y=39.6',
    })
    expect(entry?.actions?.[1]).toMatchObject({ kind: 'persist', restart: true })
    expect(entry?.actions?.[1]?.kind === 'persist' && entry.actions[1].changes).toHaveLength(4)
  })

  it('drops a stored action that is not one line of G-code or a plain option value', async () => {
    const label = { key: 'calibration.result.applyShapers' }
    const { calibration } = setup({
      value: {
        version: 1,
        procedures: {
          shakeTuneShaper: [
            {
              at: 1,
              values: {},
              rows: [],
              outcome: 'measured',
              actions: [
                { kind: 'gcode', id: 'ok', label, command: 'SET_INPUT_SHAPER SHAPER_FREQ_X=48.2' },
                { kind: 'gcode', id: 'two-lines', label, command: 'M84\nFIRMWARE_RESTART' },
                {
                  kind: 'persist',
                  id: 'odd-value',
                  label,
                  section: 'input_shaper',
                  changes: [{ option: 'shaper_type_x', value: 'mzv\n[printer]' }],
                },
              ],
            },
          ],
        },
      },
    })
    calibration.start()
    await flushPromises()

    expect(
      calibration.historyFor('shakeTuneShaper')[0]?.actions?.map((action) => action.id),
    ).toEqual(['ok'])
  })

  it('ignores a stored log it does not recognise', async () => {
    const { calibration } = setup({ value: { version: 9, procedures: { axesNoise: [{ at: 1 }] } } })
    calibration.start()
    await flushPromises()

    expect(calibration.logLoaded).toBe(true)
    expect(calibration.lastRunAt('axesNoise')).toBeNull()
  })

  it('reads an empty log from a key never written', async () => {
    const { calibration } = setup()
    calibration.start()
    await flushPromises()

    expect(calibration.logLoaded).toBe(true)
    expect(calibration.log).toEqual({})
  })
})

describe('result actions', () => {
  const shaper = {
    kind: 'persist' as const,
    id: 'persist-x-best',
    label: { literal: 'save' },
    section: 'input_shaper',
    changes: [
      { option: 'shaper_type_x', value: 'mzv' },
      { option: 'shaper_freq_x', value: '48.2' },
    ],
  }

  it('writes every option of a persist action to its section', async () => {
    const persist = vi
      .spyOn(useQuickConfigStore(), 'persistOption')
      .mockResolvedValue({ status: 'saved', path: 'printer.cfg' })
    expect(await useCalibrationStore().runAction(shaper)).toBe('saved')
    expect(persist.mock.calls).toEqual([
      ['input_shaper', 'shaper_type_x', 'mzv', { intoAutosave: false }],
      ['input_shaper', 'shaper_freq_x', '48.2', { intoAutosave: false }],
    ])
  })

  it('runs SAVE_CONFIG once a restarting action is written to ordinary lines', async () => {
    vi.spyOn(useQuickConfigStore(), 'persistOption').mockResolvedValue({
      status: 'saved',
      path: 'printer.cfg',
    })
    const printer = usePrinterStore()
    const save = vi.spyOn(printer, 'saveConfig').mockResolvedValue(true)
    const restart = vi.spyOn(printer, 'firmwareRestart').mockResolvedValue(true)
    expect(await useCalibrationStore().runAction({ ...shaper, restart: true })).toBe('restarting')
    expect(save).toHaveBeenCalledOnce()
    expect(restart).not.toHaveBeenCalled()
  })

  /*
   * SAVE_CONFIG rewrites the #*# block from what Klipper loaded, which would
   * put the old shaper straight back over the one just written there.
   */
  it('firmware-restarts instead when the values went into the SAVE_CONFIG block', async () => {
    vi.spyOn(useQuickConfigStore(), 'persistOption').mockResolvedValue({
      status: 'saved',
      path: 'printer.cfg',
      autosave: true,
    })
    const printer = usePrinterStore()
    const save = vi.spyOn(printer, 'saveConfig').mockResolvedValue(true)
    const restart = vi.spyOn(printer, 'firmwareRestart').mockResolvedValue(true)
    expect(await useCalibrationStore().runAction({ ...shaper, restart: true })).toBe('restarting')
    expect(restart).toHaveBeenCalledOnce()
    expect(save).not.toHaveBeenCalled()
  })

  it('leaves a staged value to SAVE_CONFIG rather than writing it into the file', async () => {
    const persist = vi.spyOn(useQuickConfigStore(), 'persistOption')
    const printer = usePrinterStore()
    printer.saveConfigPendingItems = {
      input_shaper: { shaper_type_x: 'mzv', shaper_freq_x: '48.2' },
    }
    const save = vi.spyOn(printer, 'saveConfig').mockResolvedValue(true)
    expect(await useCalibrationStore().runAction({ ...shaper, restart: true })).toBe('restarting')
    expect(save).toHaveBeenCalledOnce()
    // The file writer is never asked about a staged option: SAVE_CONFIG is what writes it.
    expect(persist).not.toHaveBeenCalled()
  })

  /*
   * SAVE_CONFIG writes what Klipper staged. A shaper the reader chose over
   * the one Klipper recommended cannot be written by it, and saving would
   * silently keep Klipper's under the chosen one's name.
   */
  it('refuses to save a value Klipper staged differently, rather than saving Klipper’s', async () => {
    const persist = vi.spyOn(useQuickConfigStore(), 'persistOption')
    const printer = usePrinterStore()
    printer.saveConfigPendingItems = {
      input_shaper: { shaper_type_x: 'ei', shaper_freq_x: '61.0' },
    }
    const save = vi.spyOn(printer, 'saveConfig').mockResolvedValue(true)
    expect(await useCalibrationStore().runAction({ ...shaper, restart: true })).toBe(
      'stagedDiffers',
    )
    expect(save).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })

  it('stops at the first refused option rather than writing half a shaper', async () => {
    const persist = vi
      .spyOn(useQuickConfigStore(), 'persistOption')
      .mockResolvedValue({ status: 'refused', reason: 'autosave' })
    expect(await useCalibrationStore().runAction(shaper)).toBe('refused')
    expect(persist).toHaveBeenCalledTimes(1)
  })
})

describe('forgetting one run', () => {
  it('removes it on every browser, and a merge never brings it back', async () => {
    const database: Database = { value: undefined }
    const { calibration, finish } = setup(database)
    const run = calibration.run(procedureById('axesNoise')!, {}, context)
    await flushPromises()
    say('// Axes noise for x-axis accelerometer: 1.0 (x), 2.0 (y), 3.0 (z)')
    await finish()
    await run
    await flushPromises()
    const at = calibration.latestEntry('axesNoise')!.at

    calibration.forgetEntry('axesNoise', at)
    await flushPromises()
    expect(calibration.historyFor('axesNoise')).toHaveLength(0)
    expect(calibration.runFor('axesNoise')).toBeNull()
    type Stored = { procedures: { axesNoise?: unknown[] }; forgotten: { axesNoise?: number[] } }
    expect((database.value as Stored).procedures.axesNoise ?? []).toHaveLength(0)
    expect((database.value as Stored).forgotten.axesNoise).toEqual([at])

    // Another browser still holding the run writes it back; the tombstone wins.
    database.value = {
      version: 1,
      procedures: { axesNoise: [{ at, values: {}, rows: [], outcome: 'measured' }] },
      forgotten: { axesNoise: [at] },
    }
    await calibration.loadLog()
    expect(calibration.historyFor('axesNoise')).toHaveLength(0)
  })
})

describe('what a run sends', () => {
  it('sends a levelling command with its words, and the bare one through the card’s path', async () => {
    const { calibration, finish } = setup()
    const printer = usePrinterStore()
    const leveling = vi.spyOn(printer, 'runLeveling').mockResolvedValue(true)
    const gcode = vi.spyOn(printer, 'sendGcode').mockResolvedValue(true)
    const withDirection = calibration.run(
      procedureById('screwsTilt')!,
      { DIRECTION: 'CW' },
      { ...context, hasSection: (name) => name === 'screws_tilt_adjust' },
    )
    await flushPromises()
    await finish()
    await withDirection
    expect(gcode).toHaveBeenCalledWith('SCREWS_TILT_CALCULATE DIRECTION=CW', 'calibration')
    expect(leveling).not.toHaveBeenCalled()

    const bare = calibration.run(procedureById('screwsTilt')!, { DIRECTION: '' }, context)
    await flushPromises()
    await finish()
    await bare
    expect(leveling).toHaveBeenCalledWith('screwsTiltAdjust')
  })

  it('reads a paper test closed with nothing as aborted, not failed', async () => {
    const { calibration, finish } = setup()
    useAvailabilityStore().printerSnapshotSynchronized()
    const manualProbe = useManualProbeStore()
    const run = calibration.run(procedureById('probeZOffset')!, {}, context)
    await flushPromises()
    manualProbe.isActive = true
    await finish()
    manualProbe.isActive = false
    await expect(run).resolves.toBe(false)

    expect(calibration.runFor('probeZOffset')?.aborted).toBe(true)
    expect(calibration.latestEntry('probeZOffset')?.outcome).toBe('aborted')
    expect(calibration.lastRunAt('probeZOffset')).toBeNull()
  })

  it('waits for a staging that lands after the paper test closed', async () => {
    const { calibration, finish } = setup()
    useAvailabilityStore().printerSnapshotSynchronized()
    const printer = usePrinterStore()
    const manualProbe = useManualProbeStore()
    const run = calibration.run(
      procedureById('beacon')!,
      {},
      {
        ...context,
        hasCommand: (name) => name === 'BEACON_CALIBRATE',
      },
    )
    await flushPromises()
    manualProbe.isActive = true
    await finish()
    manualProbe.isActive = false
    await flushPromises()
    // Beacon scans for a while after ACCEPT, then stages its model.
    printer.saveConfigPendingItems = { beacon: { model: 'default' } }
    await expect(run).resolves.toBe(true)
    expect(calibration.resultFor('beacon')?.outcome).toBe('staged')
  })
})

describe('clearing a procedure log', () => {
  it('removes it from the printer copy too, rather than merging it back', async () => {
    const reading = { at: 1, values: { kind: 'reading' }, rows: [], outcome: 'measured' }
    const database: Database = {
      value: {
        version: 1,
        procedures: { nonlinearPressureAdvance: [reading], rotationDistance: [reading] },
      },
    }
    const { calibration } = setup(database)
    await calibration.loadLog()
    expect(calibration.historyFor('nonlinearPressureAdvance')).toHaveLength(1)

    calibration.clearLog('nonlinearPressureAdvance')
    await flushPromises()

    expect(calibration.historyFor('nonlinearPressureAdvance')).toHaveLength(0)
    const stored = database.value as { procedures: Record<string, unknown> }
    expect(stored.procedures.nonlinearPressureAdvance).toBeUndefined()
    expect(stored.procedures.rotationDistance).toHaveLength(1)
  })
})
