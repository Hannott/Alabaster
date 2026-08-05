import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  benchmarkCameraPose,
  frameIntervalStatistics,
  geometryGpuByteEstimate,
  installGcodeViewerBenchmark,
  type GcodeBenchmarkHooks,
} from '@/features/gcode/benchmark'
import { fittedCamera } from '@/features/gcode/camera'
import { parseGcode } from '@/features/gcode/parser'
import type { GcodeBounds } from '@/features/gcode/types'

const bounds: GcodeBounds = { minX: 0, maxX: 200, minY: 0, maxY: 200, minZ: 0, maxZ: 100 }

describe('frameIntervalStatistics', () => {
  it('summarizes intervals into rate and tail percentiles', () => {
    const statistics = frameIntervalStatistics([16, 32, 16, 16])

    expect(statistics.frames).toBe(4)
    expect(statistics.seconds).toBeCloseTo(0.08)
    expect(statistics.averageFps).toBeCloseTo(50)
    expect(statistics.medianFrameMilliseconds).toBe(16)
    expect(statistics.p95FrameMilliseconds).toBe(32)
    expect(statistics.worstFrameMilliseconds).toBe(32)
  })

  it('takes the middle value of an odd run and survives an empty one', () => {
    expect(frameIntervalStatistics([30, 10, 20]).medianFrameMilliseconds).toBe(20)
    expect(frameIntervalStatistics([]).frames).toBe(0)
    expect(frameIntervalStatistics([]).averageFps).toBe(0)
  })
})

describe('benchmarkCameraPose', () => {
  const fitted = fittedCamera(bounds, 1920, 1200)

  it('sweeps a full orbit as an absolute function of progress', () => {
    const start = benchmarkCameraPose('fitted-orbit', bounds, 0, 1920, 1200)
    const end = benchmarkCameraPose('fitted-orbit', bounds, 1, 1920, 1200)

    expect(start).toEqual(fitted)
    expect(end.yaw).toBeCloseTo(fitted.yaw + Math.PI * 2)
    expect(end.distance).toBeCloseTo(fitted.distance)
    expect(end.pitch).toBeCloseTo(fitted.pitch)
    expect(end.targetX).toBeCloseTo(fitted.targetX)
  })

  it('orbits close at a fixed share of the fitted distance', () => {
    const pose = benchmarkCameraPose('close-orbit', bounds, 0.5, 1920, 1200)

    expect(pose.distance).toBeCloseTo(fitted.distance * 0.15)
    expect(pose.yaw).toBeCloseTo(fitted.yaw + Math.PI)
  })

  it('zoom-sweeps from fitted to nearest and back', () => {
    expect(benchmarkCameraPose('zoom-sweep', bounds, 0, 1920, 1200).distance).toBeCloseTo(
      fitted.distance,
    )
    expect(benchmarkCameraPose('zoom-sweep', bounds, 0.5, 1920, 1200).distance).toBeCloseTo(
      fitted.distance * 0.08,
    )
    expect(benchmarkCameraPose('zoom-sweep', bounds, 1, 1920, 1200).distance).toBeCloseTo(
      fitted.distance,
    )
  })

  it('clamps progress so a long frame cannot overshoot the script', () => {
    const overshoot = benchmarkCameraPose('fitted-orbit', bounds, 1.4, 1920, 1200)

    expect(overshoot.yaw).toBeCloseTo(fitted.yaw + Math.PI * 2)
  })
})

describe('geometryGpuByteEstimate', () => {
  it('counts the uploaded buffers and not the CPU-side byte table', () => {
    const geometry = parseGcode(`G90
M83
G1 X10 Z0.2 E1 F1200
G1 Y10 E1
G1 X0 Z0.4
`)

    const tierBytes = Object.values(geometry.tiers).reduce(
      (total, tier) => total + tier.segments.byteLength + tier.pathDetails.byteLength,
      0,
    )
    expect(geometryGpuByteEstimate(geometry)).toBe(
      geometry.segments.byteLength +
        geometry.pathDetails.byteLength +
        geometry.caps.byteLength +
        tierBytes,
    )
    expect(geometry.sourceBytes.byteLength).toBeGreaterThan(0)
  })
})

describe('installGcodeViewerBenchmark', () => {
  const windowKey = '__alabasterGcodeViewerBenchmark'

  function hooks(overrides: Partial<GcodeBenchmarkHooks> = {}): GcodeBenchmarkHooks {
    return {
      fileSummary: () => ({
        name: 'cube.gcode',
        bytes: 128,
        segments: 3,
        extrusions: 2,
        travels: 1,
        layers: 2,
      }),
      loadMilliseconds: () => 1234,
      firstGeometryMilliseconds: () => 820,
      streamedBatches: () => 12,
      qualityStep: () => 0,
      frameDiagnostics: () => ({ lod: 'full', instances: 3, drawCalls: 1 }),
      gpuUploadBytes: () => 4096,
      modelBounds: () => bounds,
      viewportSize: () => ({ width: 640, height: 480 }),
      applyCamera: vi.fn(),
      renderScene: vi.fn(),
      resetView: vi.fn(),
      loadUrl: vi.fn().mockResolvedValue(undefined),
      captureRegion: () => 'data:image/png;base64,',
      ...overrides,
    }
  }

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)[windowKey]
    vi.restoreAllMocks()
  })

  it('drives every script through the render hooks and reports one JSON block', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    // jsdom has no WebGL; keep its "not implemented" warning out of the run.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const scripted = hooks()
    installGcodeViewerBenchmark(scripted)

    const api = (window as unknown as Record<string, unknown>)[windowKey] as {
      run(seconds?: number): Promise<{ scripts: Record<string, { frames: number }> }>
    }
    const report = await api.run(0.05)

    expect(Object.keys(report.scripts)).toEqual(['fitted-orbit', 'close-orbit', 'zoom-sweep'])
    expect(scripted.renderScene).toHaveBeenCalled()
    expect(scripted.applyCamera).toHaveBeenCalled()
    expect(scripted.resetView).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledTimes(1)
    expect(JSON.parse((log.mock.calls[0]?.[0] as string) ?? '')).toMatchObject({
      file: { name: 'cube.gcode' },
      loadMilliseconds: 1234,
      firstGeometryMilliseconds: 820,
      streamedBatches: 12,
      gpuUploadBytes: 4096,
    })
  })

  it('refuses to run without a loaded file instead of reporting nonsense', async () => {
    installGcodeViewerBenchmark(hooks({ fileSummary: () => null }))

    const api = (window as unknown as Record<string, unknown>)[windowKey] as {
      run(): Promise<unknown>
    }
    await expect(api.run()).rejects.toThrow('Load a G-code file')
  })

  it('uninstalls its own handle without clobbering a newer one', () => {
    const first = installGcodeViewerBenchmark(hooks())
    const second = installGcodeViewerBenchmark(hooks())

    first()
    expect((window as unknown as Record<string, unknown>)[windowKey]).toBeDefined()
    second()
    expect((window as unknown as Record<string, unknown>)[windowKey]).toBeUndefined()
  })
})
