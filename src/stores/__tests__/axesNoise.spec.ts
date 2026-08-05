import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useAxesNoiseStore } from '@/stores/axesNoise'
import { useConsoleStore } from '@/stores/console'

function setEntries(lines: readonly string[]): void {
  const gcodeConsole = useConsoleStore()
  gcodeConsole.consoleEntries = lines.map((raw, index) => ({
    id: `${index}`,
    raw,
    kind: index === 0 ? 'command' : 'response',
    at: index,
  })) as never
}

describe('axes noise store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('reports nothing before a run has been sent', () => {
    const store = useAxesNoiseStore()

    expect(store.isRunning).toBe(false)
    expect(store.readings).toEqual([])
  })

  it('is running once the command is sent and no chip has answered yet', () => {
    setEntries(['MEASURE_AXES_NOISE'])
    const store = useAxesNoiseStore()

    expect(store.isRunning).toBe(true)
    expect(store.readings).toEqual([])
  })

  it('parses one line per accelerometer chip, Klipper\'s own "// " prefix intact', () => {
    setEntries([
      'MEASURE_AXES_NOISE',
      '// Axes noise for x-axis accelerometer: 0.000012 (x), 0.000008 (y), 0.000015 (z)',
      '// Axes noise for y-axis accelerometer: 0.000010 (x), 0.000014 (y), 0.000011 (z)',
    ])
    const store = useAxesNoiseStore()

    expect(store.isRunning).toBe(false)
    expect(store.readings).toEqual([
      { chipAxis: 'x', x: 0.000012, y: 0.000008, z: 0.000015 },
      { chipAxis: 'y', x: 0.00001, y: 0.000014, z: 0.000011 },
    ])
  })

  /**
   * A remembered array index would misattribute this once the transcript
   * grows past it — see `probeAccuracy.spec.ts`'s identical case — so the run
   * boundary is found fresh from the current transcript every time.
   */
  it("never reads a previous run's readings for a run still in progress", () => {
    setEntries([
      'MEASURE_AXES_NOISE',
      '// Axes noise for x-axis accelerometer: 0.000012 (x), 0.000008 (y), 0.000015 (z)',
      'MEASURE_AXES_NOISE',
    ])
    const store = useAxesNoiseStore()

    expect(store.isRunning).toBe(true)
    expect(store.readings).toEqual([])
  })
})
