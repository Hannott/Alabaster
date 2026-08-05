import { fittedCamera } from '@/features/gcode/camera'
import type { GcodeBounds, GcodeCamera, ParsedGcodeGeometry } from '@/features/gcode/types'

/**
 * Development-only performance harness for the G-code viewer.
 *
 * The redesign work is judged against measured numbers, not impressions, so
 * every phase reruns the same scripted camera sweeps over the same file and
 * compares the resulting report. Nothing in this module renders by itself:
 * the view hands it hooks into the live renderer and camera, and the pure
 * helpers below stay unit-testable without a canvas.
 */

export interface GcodeFrameStatistics {
  frames: number
  seconds: number
  averageFps: number
  medianFrameMilliseconds: number
  p95FrameMilliseconds: number
  worstFrameMilliseconds: number
}

export function frameIntervalStatistics(intervalsMilliseconds: number[]): GcodeFrameStatistics {
  if (intervalsMilliseconds.length === 0) {
    return {
      frames: 0,
      seconds: 0,
      averageFps: 0,
      medianFrameMilliseconds: 0,
      p95FrameMilliseconds: 0,
      worstFrameMilliseconds: 0,
    }
  }
  const sorted = [...intervalsMilliseconds].sort((left, right) => left - right)
  const totalMilliseconds = sorted.reduce((sum, value) => sum + value, 0)
  const middle = sorted.length / 2
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[Math.floor(middle)] ?? 0)
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
  return {
    frames: sorted.length,
    seconds: totalMilliseconds / 1_000,
    averageFps: totalMilliseconds > 0 ? (sorted.length * 1_000) / totalMilliseconds : 0,
    medianFrameMilliseconds: median,
    p95FrameMilliseconds: sorted[p95Index] ?? 0,
    worstFrameMilliseconds: sorted[sorted.length - 1] ?? 0,
  }
}

export const gcodeBenchmarkScripts = ['fitted-orbit', 'close-orbit', 'zoom-sweep'] as const
export type GcodeBenchmarkScript = (typeof gcodeBenchmarkScripts)[number]

// How close the close-orbit and the middle of the zoom sweep get, as a share
// of the fitted distance. Close enough to exercise the full-detail path,
// far enough that a bed-sized model still fills the frame instead of clipping.
const closeDistanceShare = 0.15
const zoomSweepNearShare = 0.08

/**
 * The camera pose a script asks for at a normalized position through its run.
 * Poses are absolute functions of `progress`, never increments, so a slow
 * machine sweeps the same angles across fewer frames instead of orbiting less.
 */
export function benchmarkCameraPose(
  script: GcodeBenchmarkScript,
  bounds: GcodeBounds,
  progress: number,
  viewportWidth: number,
  viewportHeight: number,
): GcodeCamera {
  const clamped = Math.min(1, Math.max(0, progress))
  const base = fittedCamera(bounds, viewportWidth, viewportHeight)
  if (script === 'fitted-orbit') {
    return { ...base, yaw: base.yaw + clamped * Math.PI * 2 }
  }
  if (script === 'close-orbit') {
    return {
      ...base,
      distance: base.distance * closeDistanceShare,
      yaw: base.yaw + clamped * Math.PI * 2,
    }
  }
  // zoom-sweep: fitted at both ends, nearest at the middle.
  const nearness = 1 - Math.abs(2 * clamped - 1)
  const share = 1 - (1 - zoomSweepNearShare) * nearness
  return { ...base, distance: base.distance * share }
}

/**
 * Bytes the renderer uploads for this geometry. `sourceBytes` stays on the
 * CPU for playback synchronization, so it is deliberately not counted here.
 */
export function geometryGpuByteEstimate(geometry: ParsedGcodeGeometry): number {
  let tierBytes = 0
  for (const tier of Object.values(geometry.tiers)) {
    tierBytes += tier.segments.byteLength + tier.pathDetails.byteLength
  }
  return (
    geometry.segments.byteLength +
    geometry.pathDetails.byteLength +
    geometry.caps.byteLength +
    tierBytes
  )
}

export interface GcodeBenchmarkFileSummary {
  name: string
  bytes: number
  segments: number
  extrusions: number
  travels: number
  layers: number
}

export interface GcodeBenchmarkReport {
  generatedAt: string
  device: {
    userAgent: string
    devicePixelRatio: number
    hardwareConcurrency: number
    gpu: string | null
  }
  viewport: { width: number; height: number }
  file: GcodeBenchmarkFileSummary
  loadMilliseconds: number | null
  /**
   * How long after the load started the first batch of geometry reached the
   * GPU. This is what the user experiences as the model appearing, and it is
   * the metric streaming exists to improve; null for a non-streamed load.
   */
  firstGeometryMilliseconds: number | null
  streamedBatches: number
  /** Governor step the run settled on: 0 is full quality. */
  qualityStep: number
  gpuUploadBytes: number | null
  usedJsHeapBytes: number | null
  scripts: Record<GcodeBenchmarkScript, GcodeFrameStatistics>
}

export interface GcodeBenchmarkHooks {
  fileSummary(): GcodeBenchmarkFileSummary | null
  loadMilliseconds(): number | null
  firstGeometryMilliseconds(): number | null
  streamedBatches(): number
  qualityStep(): number
  frameDiagnostics(): { lod: string; instances: number; drawCalls: number } | null
  gpuUploadBytes(): number | null
  modelBounds(): GcodeBounds | null
  viewportSize(): { width: number; height: number }
  applyCamera(camera: GcodeCamera): void
  renderScene(): void
  resetView(): void
  loadUrl(url: string): Promise<void>
  captureRegion(region: GcodeCaptureRegion | undefined): string | null
}

/** A crop of the stage in CSS pixels, measured from its top-left corner. */
export interface GcodeCaptureRegion {
  x: number
  y: number
  width: number
  height: number
}

interface GcodeBenchmarkWindowApi {
  run(secondsPerScript?: number): Promise<GcodeBenchmarkReport>
  loadUrl(url: string): Promise<void>
  /** What the last rendered frame drew, for diagnosing a visual problem. */
  frame(): { lod: string; instances: number; drawCalls: number } | null
  /**
   * The current frame as a PNG data URL, at device resolution.
   *
   * Shading questions — is this bead aliasing, is that surface flat — cannot be
   * answered from a scaled screenshot, and they are the ones the viewer keeps
   * asking. Crop to a region so the result is small enough to move through a
   * console; the whole stage at device resolution is several megabytes.
   */
  capture(region?: GcodeCaptureRegion): string | null
}

const windowKey = '__alabasterGcodeViewerBenchmark'

function webglRendererName(): string | null {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    if (!gl) return null
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    return typeof name === 'string' ? name : null
  } catch {
    return null
  }
}

function runScript(
  script: GcodeBenchmarkScript,
  hooks: GcodeBenchmarkHooks,
  bounds: GcodeBounds,
  durationMilliseconds: number,
): Promise<GcodeFrameStatistics> {
  return new Promise((resolve) => {
    const intervals: number[] = []
    let started: number | null = null
    let previous = 0
    const frame = (timestamp: number): void => {
      if (started === null) {
        started = timestamp
      } else {
        intervals.push(timestamp - previous)
      }
      previous = timestamp
      const progress = Math.min(1, (timestamp - started) / durationMilliseconds)
      const { width, height } = hooks.viewportSize()
      hooks.applyCamera(benchmarkCameraPose(script, bounds, progress, width, height))
      hooks.renderScene()
      if (progress >= 1) resolve(frameIntervalStatistics(intervals))
      else requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
}

/**
 * Exposes the benchmark on `window` for the development console:
 *
 *   await __alabasterGcodeViewerBenchmark.loadUrl('/bench.gcode')
 *   await __alabasterGcodeViewerBenchmark.run()
 *
 * The caller guards this behind `import.meta.env.DEV`; the report is logged
 * as one copyable JSON block and also returned.
 */
export function installGcodeViewerBenchmark(hooks: GcodeBenchmarkHooks): () => void {
  const api: GcodeBenchmarkWindowApi = {
    loadUrl: (url) => hooks.loadUrl(url),
    frame: () => hooks.frameDiagnostics(),
    capture: (region) => hooks.captureRegion(region),
    async run(secondsPerScript = 6) {
      const file = hooks.fileSummary()
      const bounds = hooks.modelBounds()
      if (!file || !bounds) throw new Error('Load a G-code file before running the benchmark')
      const scripts = {} as Record<GcodeBenchmarkScript, GcodeFrameStatistics>
      for (const script of gcodeBenchmarkScripts) {
        scripts[script] = await runScript(script, hooks, bounds, secondsPerScript * 1_000)
      }
      hooks.resetView()
      const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory
      const report: GcodeBenchmarkReport = {
        generatedAt: new Date().toISOString(),
        device: {
          userAgent: navigator.userAgent,
          devicePixelRatio: window.devicePixelRatio || 1,
          hardwareConcurrency: navigator.hardwareConcurrency ?? 0,
          gpu: webglRendererName(),
        },
        viewport: hooks.viewportSize(),
        file,
        loadMilliseconds: hooks.loadMilliseconds(),
        firstGeometryMilliseconds: hooks.firstGeometryMilliseconds(),
        streamedBatches: hooks.streamedBatches(),
        qualityStep: hooks.qualityStep(),
        gpuUploadBytes: hooks.gpuUploadBytes(),
        usedJsHeapBytes: memory?.usedJSHeapSize ?? null,
        scripts,
      }
      console.log(JSON.stringify(report, null, 2))
      return report
    },
  }
  const host = window as typeof window & Partial<Record<typeof windowKey, GcodeBenchmarkWindowApi>>
  host[windowKey] = api
  return () => {
    if (host[windowKey] === api) delete host[windowKey]
  }
}
