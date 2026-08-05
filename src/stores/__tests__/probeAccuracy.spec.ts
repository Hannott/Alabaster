import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useConsoleStore } from '@/stores/console'
import { useProbeAccuracyStore } from '@/stores/probeAccuracy'

function setEntries(lines: readonly string[]): void {
  const gcodeConsole = useConsoleStore()
  gcodeConsole.consoleEntries = lines.map((raw, index) => ({
    id: `${index}`,
    raw,
    kind: index === 0 ? 'command' : 'response',
    at: index,
  })) as never
}

describe('probe accuracy store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('reports nothing before a run has been sent', () => {
    const store = useProbeAccuracyStore()

    expect(store.isRunning).toBe(false)
    expect(store.result).toBeNull()
  })

  it('is running once the command is sent and no result has arrived', () => {
    setEntries(['PROBE_ACCURACY'])
    const store = useProbeAccuracyStore()

    expect(store.isRunning).toBe(true)
    expect(store.result).toBeNull()
  })

  it('parses the one summary line Klipper prints', () => {
    setEntries([
      'PROBE_ACCURACY',
      // Klipper's own prefix for informational output, intact — see
      // `services/console/transcript.ts`. A regex anchored past this without
      // tolerating it is the bug this fixture exists to catch.
      '// probe accuracy results: maximum 5.026875, minimum 5.025000, range 0.001875, ' +
        'average 5.025900, median 5.025625, standard deviation 0.000572',
    ])
    const store = useProbeAccuracyStore()

    expect(store.isRunning).toBe(false)
    expect(store.result).toEqual({
      maximum: 5.026875,
      minimum: 5.025,
      range: 0.001875,
      average: 5.0259,
      median: 5.025625,
      standardDeviation: 0.000572,
    })
  })

  /**
   * A remembered array index would misattribute this, per `meshProbeRun.ts`'s
   * own warning about a trimmed transcript — so the run boundary is found fresh
   * from the current transcript every time, and only lines after it count.
   */
  it("never reads a previous run's result for a run still in progress", () => {
    setEntries([
      'PROBE_ACCURACY',
      // Klipper's own prefix for informational output, intact — see
      // `services/console/transcript.ts`. A regex anchored past this without
      // tolerating it is the bug this fixture exists to catch.
      '// probe accuracy results: maximum 5.026875, minimum 5.025000, range 0.001875, ' +
        'average 5.025900, median 5.025625, standard deviation 0.000572',
      'PROBE_ACCURACY',
    ])
    const store = useProbeAccuracyStore()

    expect(store.isRunning).toBe(true)
    expect(store.result).toBeNull()
  })

  it("picks up the second run's own result once it arrives", () => {
    setEntries([
      'PROBE_ACCURACY',
      // Klipper's own prefix for informational output, intact — see
      // `services/console/transcript.ts`. A regex anchored past this without
      // tolerating it is the bug this fixture exists to catch.
      '// probe accuracy results: maximum 5.026875, minimum 5.025000, range 0.001875, ' +
        'average 5.025900, median 5.025625, standard deviation 0.000572',
      'PROBE_ACCURACY',
      '// probe accuracy results: maximum 1.100000, minimum 1.000000, range 0.100000, ' +
        'average 1.050000, median 1.050000, standard deviation 0.050000',
    ])
    const store = useProbeAccuracyStore()

    expect(store.isRunning).toBe(false)
    expect(store.result?.maximum).toBe(1.1)
  })
})
