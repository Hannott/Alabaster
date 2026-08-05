import { defineStore } from 'pinia'
import { computed } from 'vue'

import { useConsoleStore } from '@/stores/console'

export interface AxesNoiseReading {
  /** The accelerometer's configured axis, e.g. `x` or `y` — Klipper's own `chip_axis`. */
  chipAxis: string
  x: number
  y: number
  z: number
}

/**
 * `klippy/extras/resonance_tester.py`'s `cmd_MEASURE_AXES_NOISE` prints one
 * line per enabled accelerometer chip:
 *
 *   Axes noise for %s-axis accelerometer: %.6f (x), %.6f (y), %.6f (z)
 *
 * — informational output, so `consoleLines` (Klipper's text with its `// `
 * prefix intact, per `services/console/transcript.ts`) carries that prefix
 * on this line the same way it does on `PROBE_ACCURACY`'s summary. Tolerated
 * here for the same reason `stores/probeAccuracy.ts` tolerates it there: a
 * pattern anchored past it can never match the line Klipper actually sends.
 */
const resultPattern =
  /^\s*(?:\/\/\s*)?Axes noise for (\S+)-axis accelerometer: ([-\d.]+) \(x\), ([-\d.]+) \(y\), ([-\d.]+) \(z\)/i

function isMeasureAxesNoiseCommand(line: string): boolean {
  return /^\s*(?:>\s*)?MEASURE_AXES_NOISE\b/i.test(line)
}

function parseReading(line: string): AxesNoiseReading | null {
  const match = resultPattern.exec(line)
  if (!match) return null
  const [, chipAxis, x, y, z] = match
  return { chipAxis: chipAxis!, x: Number(x), y: Number(y), z: Number(z) }
}

/**
 * `MEASURE_AXES_NOISE`'s results, read from the console transcript the same
 * on-demand way `useProbeAccuracyStore` reads `PROBE_ACCURACY`'s — the run
 * boundary is found fresh from the current transcript every time, never
 * cached as an index that a trimmed buffer could invalidate.
 *
 * Unlike `PROBE_ACCURACY`, more than one line can belong to a single run —
 * one per accelerometer chip, on a machine with separate X/Y accelerometers
 * — so every matching line after the run's own command counts, not only the
 * last one.
 */
export const useAxesNoiseStore = defineStore('axesNoise', () => {
  const gcodeConsole = useConsoleStore()

  /** Index of the most recent `MEASURE_AXES_NOISE` command in the transcript, or -1. */
  const runStartIndex = computed(() => {
    const lines = gcodeConsole.consoleLines
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (isMeasureAxesNoiseCommand(lines[index]!)) return index
    }
    return -1
  })

  const readings = computed<AxesNoiseReading[]>(() => {
    const start = runStartIndex.value
    if (start < 0) return []
    return gcodeConsole.consoleLines
      .slice(start + 1)
      .map(parseReading)
      .filter((reading): reading is AxesNoiseReading => reading !== null)
  })

  const hasReadings = computed(() => readings.value.length > 0)
  /** A run has been sent and no chip has answered yet. */
  const isRunning = computed(() => runStartIndex.value >= 0 && readings.value.length === 0)

  return { readings, hasReadings, isRunning }
})
