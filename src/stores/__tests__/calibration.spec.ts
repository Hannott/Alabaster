import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { procedureById, type ProcedureContext } from '@/features/calibration/procedures'
import { useAvailabilityStore } from '@/stores/availability'
import { useCalibrationStore } from '@/stores/calibration'
import { useConsoleStore } from '@/stores/console'
import { useMoonrakerStore } from '@/stores/moonraker'

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
