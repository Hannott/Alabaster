import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { procedureById, type ProcedureContext } from '@/features/calibration/procedures'
import { useAvailabilityStore } from '@/stores/availability'
import { useCalibrationStore } from '@/stores/calibration'
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
      return new Promise((resolve) => {
        releaseScript = () => resolve('ok')
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
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  setActivePinia(createPinia())
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

describe('the calibration log', () => {
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
    const run = calibration.run(procedureById('probeZOffset')!, {}, context)
    await flushPromises()
    await finish()
    await run
    say('// probe: z_offset: 1.535')
    await flushPromises()

    const stored = database.value as { procedures: { probeZOffset: Array<{ rows: unknown[] }> } }
    expect(stored.procedures.probeZOffset).toHaveLength(1)
    expect(stored.procedures.probeZOffset[0]!.rows).toHaveLength(1)
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
    vi.spyOn(useQuickConfigStore(), 'persistOption').mockResolvedValue({
      status: 'refused',
      reason: 'pending',
    })
    const printer = usePrinterStore()
    const save = vi.spyOn(printer, 'saveConfig').mockResolvedValue(true)
    expect(await useCalibrationStore().runAction({ ...shaper, restart: true })).toBe('restarting')
    expect(save).toHaveBeenCalledOnce()
  })

  it('stops at the first refused option rather than writing half a shaper', async () => {
    const persist = vi
      .spyOn(useQuickConfigStore(), 'persistOption')
      .mockResolvedValue({ status: 'refused', reason: 'autosave' })
    expect(await useCalibrationStore().runAction(shaper)).toBe('refused')
    expect(persist).toHaveBeenCalledTimes(1)
  })
})
