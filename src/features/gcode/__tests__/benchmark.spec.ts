import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  frameIntervalStatistics,
  gcodeBenchmarkScripts,
  installGcodeViewerBenchmark,
  type GcodeBenchmarkHooks,
  type GcodeBenchmarkReport,
  type GcodeFrameStatistics,
} from '@/features/gcode/benchmark'

describe('frameIntervalStatistics', () => {
  it('summarizes intervals into rate and tail percentiles', () => {
    const statistics = frameIntervalStatistics([16, 32, 16, 16])

    expect(statistics.frames).toBe(4)
    expect(statistics.averageFramesPerSecond).toBeCloseTo(50)
    expect(statistics.medianMilliseconds).toBe(16)
    expect(statistics.percentile95Milliseconds).toBe(32)
    expect(statistics.worstMilliseconds).toBe(32)
  })

  it('takes the middle value of an odd run and survives an empty one', () => {
    expect(frameIntervalStatistics([30, 10, 20]).medianMilliseconds).toBe(20)
    expect(frameIntervalStatistics([]).frames).toBe(0)
    expect(frameIntervalStatistics([]).averageFramesPerSecond).toBe(0)
  })

  /**
   * An average alone hid the whole problem this harness exists to find: the old
   * renderer averaged acceptably on integrated graphics while stuttering
   * visibly, because the tail was where the long frames lived.
   */
  it('reports a tail that a single average would have hidden', () => {
    const statistics = frameIntervalStatistics([8, 8, 8, 8, 8, 8, 8, 8, 8, 400])

    expect(statistics.medianMilliseconds).toBe(8)
    expect(statistics.worstMilliseconds).toBe(400)
    expect(statistics.percentile95Milliseconds).toBe(400)
  })
})

/**
 * The harness is a measurement instrument, so what matters is that it measures
 * the same camera motion every time and refuses to produce a number it cannot
 * stand behind. Every hook here is faked; what is under test is the driving.
 */
describe('installGcodeViewerBenchmark', () => {
  const windowKey = '__alabasterGcodeViewerBenchmark'

  interface WindowApi {
    loadUrl: (url: string) => Promise<void>
    run: () => Promise<GcodeBenchmarkReport | null>
    frame: (script?: (typeof gcodeBenchmarkScripts)[number]) => Promise<GcodeFrameStatistics | null>
    capture: () => string | null
  }

  function installedApi(): WindowApi {
    return (window as unknown as Record<string, unknown>)[windowKey] as WindowApi
  }

  /**
   * The scripts await an animation frame a few hundred times each, so real
   * frames would make this suite take minutes. Running the callback at once
   * with a fixed 16 ms step keeps it instant and makes every reported interval
   * a number the assertions can name.
   */
  function driveFramesSynchronously(stepMilliseconds = 16): void {
    let timestamp = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      timestamp += stepMilliseconds
      callback(timestamp)
      return 0
    })
  }

  function harness(overrides: Partial<GcodeBenchmarkHooks> = {}) {
    const calls: string[] = []
    const hooks: GcodeBenchmarkHooks = {
      fileSummary: () => ({
        name: 'cube.gcode',
        bytes: 128,
        segments: 3,
        extrusions: 2,
        travels: 1,
        layers: 2,
      }),
      loadMilliseconds: () => 1234,
      qualityStep: () => 2,
      tier: () => 3,
      resolutionScale: () => 0.85,
      viewportSize: () => ({ width: 640, height: 480 }),
      resetView: () => calls.push('resetView'),
      orbitBy: () => calls.push('orbitBy'),
      zoomBy: () => calls.push('zoomBy'),
      screenshot: () => 'data:image/png;base64,',
      loadUrl: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    }
    return { hooks, calls }
  }

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)[windowKey]
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('installs the whole console API under one window handle', () => {
    const { hooks } = harness()

    installGcodeViewerBenchmark(hooks)

    const api = installedApi()
    expect(typeof api.loadUrl).toBe('function')
    expect(typeof api.run).toBe('function')
    expect(typeof api.frame).toBe('function')
    expect(typeof api.capture).toBe('function')
  })

  it('drives every script and reports them in one comparable block', async () => {
    driveFramesSynchronously()
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { hooks, calls } = harness()
    installGcodeViewerBenchmark(hooks)

    const report = await installedApi().run()

    expect(report).not.toBeNull()
    // The three script names are the comparison against the hand-written
    // renderer's numbers; reordering or renaming one breaks that comparison.
    expect(Object.keys(report!.scripts)).toEqual([...gcodeBenchmarkScripts])
    for (const script of gcodeBenchmarkScripts) {
      const statistics = report!.scripts[script]
      expect(statistics.frames).toBeGreaterThan(0)
      expect(statistics.medianMilliseconds).toBe(16)
    }
    // One block, so a run can be pasted somewhere whole rather than reassembled
    // out of a scrollback.
    expect(info).toHaveBeenCalledTimes(1)
    expect(JSON.parse((info.mock.calls[0]?.[0] as string) ?? '')).toEqual(report)
    expect(calls.filter((call) => call === 'resetView')).toHaveLength(gcodeBenchmarkScripts.length)
  })

  /**
   * A frame time means nothing without the settings it was measured under: the
   * same file at tier 2 and half resolution is a different measurement from the
   * same file at tier 5. So the report carries them, and a number taken without
   * them could not be compared to anything.
   */
  it('carries the file and the settings the numbers were measured under', async () => {
    driveFramesSynchronously()
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { hooks } = harness()
    installGcodeViewerBenchmark(hooks)

    const report = await installedApi().run()

    expect(report).toMatchObject({
      file: { name: 'cube.gcode', bytes: 128, layers: 2 },
      loadMilliseconds: 1234,
      tier: 3,
      qualityStep: 2,
      resolutionScale: 0.85,
      viewport: { width: 640, height: 480 },
    })
  })

  it('refuses to run without a loaded file instead of reporting nonsense', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    installGcodeViewerBenchmark(harness({ fileSummary: () => null }).hooks)

    await expect(installedApi().run()).resolves.toBeNull()
    await expect(installedApi().frame()).resolves.toBeNull()
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('runs a single script on request without touching the other two', async () => {
    driveFramesSynchronously()
    const { hooks, calls } = harness()
    installGcodeViewerBenchmark(hooks)

    const statistics = await installedApi().frame('zoom-sweep')

    expect(statistics?.frames).toBeGreaterThan(0)
    expect(calls.filter((call) => call === 'resetView')).toHaveLength(1)
    // A zoom sweep zooms and never orbits, so a script that quietly fell back
    // to the orbit path would show up here rather than as a plausible number.
    expect(calls).toContain('zoomBy')
    expect(calls).not.toContain('orbitBy')
  })

  /**
   * Close-orbit is the framing the old renderer was slowest at, because a
   * camera inside the model's own footprint defeats every bounds-based culling
   * scheme. It only measures that if it zooms in *before* it starts orbiting.
   */
  it('closes in before it orbits on the close-orbit script', async () => {
    driveFramesSynchronously()
    const { hooks, calls } = harness()
    installGcodeViewerBenchmark(hooks)

    await installedApi().frame('close-orbit')

    expect(calls.indexOf('zoomBy')).toBeGreaterThan(-1)
    expect(calls.indexOf('zoomBy')).toBeLessThan(calls.indexOf('orbitBy'))
  })

  it('forwards loading and capture straight to the viewer', async () => {
    const { hooks } = harness()
    installGcodeViewerBenchmark(hooks)

    await installedApi().loadUrl('/bench.gcode')

    expect(hooks.loadUrl).toHaveBeenCalledWith('/bench.gcode')
    expect(installedApi().capture()).toBe('data:image/png;base64,')
  })

  it('uninstalls its own handle without clobbering a newer one', () => {
    const first = installGcodeViewerBenchmark(harness().hooks)
    const second = installGcodeViewerBenchmark(harness().hooks)

    // A second viewer mounting before the first unmounts would otherwise lose
    // its own API to the older instance's teardown.
    first()
    expect(installedApi()).toBeDefined()
    second()
    expect(installedApi()).toBeUndefined()
  })
})
