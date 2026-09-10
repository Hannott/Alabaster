/**
 * The viewer's measurement harness, in development builds only.
 *
 * It exists because every performance claim this viewer has ever made was
 * taken on one desktop GPU, and the architecture that resulted was unusable on
 * ordinary integrated graphics. A number nobody can reproduce on the machine
 * that matters is not a number. So the scripts below drive the camera the way
 * a person does — a slow orbit at the framing the file opens in, an orbit from
 * close in, and a zoom sweep — and report frame intervals rather than a single
 * average, because the tail is what reads as stutter.
 *
 * Run it from the console on the viewer page:
 *
 *     await __alabasterGcodeViewerBenchmark.loadUrl('/bench.gcode')
 *     await __alabasterGcodeViewerBenchmark.run()
 *
 * The three script names are unchanged from the harness that measured the
 * hand-written renderer, so numbers taken before and after the library swap
 * describe the same camera motion and can be compared.
 */

export interface GcodeFrameStatistics {
  frames: number
  averageFramesPerSecond: number
  medianMilliseconds: number
  percentile95Milliseconds: number
  worstMilliseconds: number
}

export function frameIntervalStatistics(intervalsMilliseconds: number[]): GcodeFrameStatistics {
  if (intervalsMilliseconds.length === 0) {
    return {
      frames: 0,
      averageFramesPerSecond: 0,
      medianMilliseconds: 0,
      percentile95Milliseconds: 0,
      worstMilliseconds: 0,
    }
  }
  const sorted = [...intervalsMilliseconds].sort((left, right) => left - right)
  const total = sorted.reduce((sum, interval) => sum + interval, 0)
  const middle = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0)
  const percentileIndex = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
  return {
    frames: sorted.length,
    averageFramesPerSecond: total > 0 ? (sorted.length / total) * 1_000 : 0,
    medianMilliseconds: median,
    percentile95Milliseconds: sorted[percentileIndex] ?? 0,
    worstMilliseconds: sorted[sorted.length - 1] ?? 0,
  }
}

export const gcodeBenchmarkScripts = ['fitted-orbit', 'close-orbit', 'zoom-sweep'] as const
export type GcodeBenchmarkScript = (typeof gcodeBenchmarkScripts)[number]

const scriptFrames = 240
const orbitStepPerFrame = 1_800 / scriptFrames
const zoomStepPerFrame = 1.012

export interface GcodeBenchmarkFileSummary {
  name: string
  bytes: number
  segments: number
  extrusions: number
  travels: number
  layers: number
}

export interface GcodeBenchmarkReport {
  file: GcodeBenchmarkFileSummary
  loadMilliseconds: number | null
  tier: number
  qualityStep: number
  resolutionScale: number
  viewport: { width: number; height: number }
  scripts: Record<GcodeBenchmarkScript, GcodeFrameStatistics>
}

export interface GcodeBenchmarkHooks {
  fileSummary: () => GcodeBenchmarkFileSummary | null
  loadMilliseconds: () => number | null
  qualityStep: () => number
  tier: () => number
  resolutionScale: () => number
  viewportSize: () => { width: number; height: number }
  resetView: () => void
  orbitBy: (deltaX: number, deltaY: number) => void
  zoomBy: (factor: number) => void
  screenshot: () => string | null
  loadUrl: (url: string) => Promise<void>
}

interface GcodeBenchmarkWindowApi {
  loadUrl: (url: string) => Promise<void>
  run: () => Promise<GcodeBenchmarkReport | null>
  frame: (script?: GcodeBenchmarkScript) => Promise<GcodeFrameStatistics | null>
  capture: () => string | null
}

const windowKey = '__alabasterGcodeViewerBenchmark'

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve))
}

/**
 * Drives one script and reports its frame intervals.
 *
 * Intervals come from the animation-frame clock rather than from the
 * renderer's own callback, deliberately: while the camera is moving the
 * renderer draws on every frame anyway, so the two agree — and this is the
 * clock the person watching the screen is on.
 */
async function runScript(
  script: GcodeBenchmarkScript,
  hooks: GcodeBenchmarkHooks,
): Promise<GcodeFrameStatistics> {
  hooks.resetView()
  if (script === 'close-orbit') {
    // Close in first, then orbit: the framing where the old renderer was
    // slowest, because a camera inside the model's own footprint defeats
    // every bounds-based culling scheme.
    for (let step = 0; step < 40; step += 1) hooks.zoomBy(1.06)
  }
  await nextFrame()

  const intervals: number[] = []
  let previous = await nextFrame()
  for (let frame = 0; frame < scriptFrames; frame += 1) {
    if (script === 'zoom-sweep') {
      // In for the first half, out for the second, so the sweep ends where it
      // started and the two directions are measured together.
      hooks.zoomBy(frame < scriptFrames / 2 ? zoomStepPerFrame : 1 / zoomStepPerFrame)
    } else {
      hooks.orbitBy(orbitStepPerFrame, 0)
    }
    const timestamp = await nextFrame()
    intervals.push(timestamp - previous)
    previous = timestamp
  }
  return frameIntervalStatistics(intervals)
}

export function installGcodeViewerBenchmark(hooks: GcodeBenchmarkHooks): () => void {
  const api: GcodeBenchmarkWindowApi = {
    loadUrl: (url) => hooks.loadUrl(url),
    capture: () => hooks.screenshot(),
    frame: async (script = 'fitted-orbit') => {
      if (!hooks.fileSummary()) {
        console.warn('[gcode benchmark] load a file first')
        return null
      }
      return runScript(script, hooks)
    },
    run: async () => {
      const file = hooks.fileSummary()
      if (!file) {
        console.warn('[gcode benchmark] load a file first')
        return null
      }
      const scripts = {} as Record<GcodeBenchmarkScript, GcodeFrameStatistics>
      for (const script of gcodeBenchmarkScripts) {
        scripts[script] = await runScript(script, hooks)
      }
      const report: GcodeBenchmarkReport = {
        file,
        loadMilliseconds: hooks.loadMilliseconds(),
        tier: hooks.tier(),
        qualityStep: hooks.qualityStep(),
        resolutionScale: hooks.resolutionScale(),
        viewport: hooks.viewportSize(),
        scripts,
      }
      console.info(JSON.stringify(report, null, 2))
      return report
    },
  }

  const target = window as unknown as Record<string, unknown>
  target[windowKey] = api
  return () => {
    // Only clears the handle if it is still ours: a second viewer mounting
    // before this one unmounts would otherwise lose its own API.
    if (target[windowKey] === api) delete target[windowKey]
  }
}
