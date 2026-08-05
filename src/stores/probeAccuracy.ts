import { defineStore } from 'pinia'
import { computed } from 'vue'

import { useConsoleStore } from '@/stores/console'

export interface ProbeAccuracyResult {
  maximum: number
  minimum: number
  range: number
  average: number
  median: number
  standardDeviation: number
}

/**
 * `consoleLines` is Klipper's text with its prefixes intact — `services/console
 * /transcript.ts` keeps `// ` on `raw` deliberately, stripping it only for the
 * `message` the console displays — and `respond_info` is exactly the
 * informational output that prefix marks. The leading `(?:\/\/\s*)?` is not
 * decoration: without it this pattern can never match the line Klipper
 * actually sends, only the cleaned text nothing here reads. Copied from
 * `features/bedMesh/probeRun.ts`'s own probed-point pattern, which solved the
 * same problem first.
 */
const resultPattern =
  /^\s*(?:\/\/\s*)?probe accuracy results: maximum ([-\d.]+), minimum ([-\d.]+), range ([-\d.]+), average ([-\d.]+), median ([-\d.]+), standard deviation ([-\d.]+)/i

function parseResult(line: string): ProbeAccuracyResult | null {
  const match = resultPattern.exec(line)
  if (!match) return null
  const [, maximum, minimum, range, average, median, standardDeviation] = match
  return {
    maximum: Number(maximum),
    minimum: Number(minimum),
    range: Number(range),
    average: Number(average),
    median: Number(median),
    standardDeviation: Number(standardDeviation),
  }
}

/** The echoed command, never prefixed — but `>\s*` is tolerated for the same reason `isMeshCalibrateCommand` does. */
function isProbeAccuracyCommand(line: string): boolean {
  return /^\s*(?:>\s*)?PROBE_ACCURACY\b/i.test(line)
}

/**
 * `PROBE_ACCURACY`'s one result, read from the console transcript the same way
 * `useMeshProbeRunStore` reads a mesh calibration's points — derived from
 * `consoleLines` on demand rather than accumulated as the response arrives, so
 * navigating away and back never loses a run and a trimmed transcript never
 * leaves a stale bookmark. See that store's own header comment for why a
 * remembered array index is the wrong tool here: `runStartIndex` below is
 * recomputed from the current transcript every time, never cached.
 *
 * Unlike a mesh calibration, Klipper prints exactly one line for this command
 * and nothing per-sample — `klippy/extras/probe.py`'s `cmd_PROBE_ACCURACY`
 * only ever calls `respond_info` once, with the summary. That makes "done"
 * unambiguous: this store has nothing to accumulate, only one line to find.
 */
export const useProbeAccuracyStore = defineStore('probeAccuracy', () => {
  const gcodeConsole = useConsoleStore()

  /** Index of the most recent `PROBE_ACCURACY` command in the transcript, or -1. */
  const runStartIndex = computed(() => {
    const lines = gcodeConsole.consoleLines
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (isProbeAccuracyCommand(lines[index]!)) return index
    }
    return -1
  })

  /** The result for the most recent run, or null while none has answered yet. */
  const result = computed<ProbeAccuracyResult | null>(() => {
    const start = runStartIndex.value
    if (start < 0) return null
    const lines = gcodeConsole.consoleLines.slice(start + 1)
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const parsed = parseResult(lines[index]!)
      if (parsed) return parsed
    }
    return null
  })

  /** A run has been sent and its one result line has not arrived yet. */
  const isRunning = computed(() => runStartIndex.value >= 0 && result.value === null)

  return { result, isRunning }
})
