import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'
import { GcodeFileTooLargeError, parseGcodeFile } from '@/features/gcode/loader'
import { GcodeParser } from '@/features/gcode/parser'
import type { GcodeBounds, ParsedGcodeSummary } from '@/features/gcode/types'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import GcodeViewerView from '@/views/GcodeViewerView.vue'

enableAutoUnmount(afterEach)

/**
 * The page-level net under the viewer: cards, empty and error states, and the
 * streaming load flow that phase 1 introduced. WebGL and the parser worker do
 * not exist in jsdom, so the renderer and loader modules are replaced at their
 * boundaries; the parser between them is real, so batches carry true geometry.
 */

/**
 * The four things that separate the camera moves from each other: an orbit
 * turns, a dolly closes in, a pan looks somewhere else, and re-anchoring the
 * pivot moves the target and the distance together while the eye stands still.
 */
interface GcodeCameraSnapshot {
  distance: number
  yaw: number
  pitch: number
  targetX: number
  targetY: number
  targetZ: number
}

const rendererInstances = vi.hoisted(
  () =>
    [] as Array<{
      canvas: HTMLCanvasElement
      streamedBatches: number
      finishedStreams: number
      begunStreams: number
      cleared: number
      disposed: boolean
      /**
       * A snapshot of the camera per frame, not the live object: the view keeps
       * one reactive camera and mutates it, so holding the reference would only
       * ever report where it ended up.
       */
      cameras: Array<GcodeCameraSnapshot>
    }>,
)

vi.mock('@/features/gcode/renderer', () => ({
  GcodeRenderer: class {
    streamedBatches = 0
    finishedStreams = 0
    begunStreams = 0
    cleared = 0
    disposed = false
    constructor(public canvas: HTMLCanvasElement) {
      rendererInstances.push(this)
    }
    cameras: GcodeCameraSnapshot[] = []
    resize(): void {}
    desiredSampleScale(): number {
      return 1
    }
    render(camera: GcodeCameraSnapshot): null {
      const { distance, yaw, pitch, targetX, targetY, targetZ } = camera
      this.cameras.push({ distance, yaw, pitch, targetX, targetY, targetZ })
      return null
    }
    load(): void {}
    beginStreamedLoad(): void {
      this.begunStreams += 1
    }
    appendGeometryBatch(): void {
      this.streamedBatches += 1
    }
    finishStreamedLoad(): void {
      this.finishedStreams += 1
    }
    setBedBounds(): void {}
    sceneBounds(): GcodeBounds {
      return { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 }
    }
    bedBounds(): GcodeBounds {
      return { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 }
    }
    pickSurfacePoint(): null {
      return null
    }
    clear(): void {
      this.cleared += 1
    }
    dispose(): void {
      this.disposed = true
    }
  },
}))

vi.mock('@/features/gcode/loader', async () => {
  const actual =
    await vi.importActual<typeof import('@/features/gcode/loader')>('@/features/gcode/loader')
  return {
    GcodeFileTooLargeError: actual.GcodeFileTooLargeError,
    parseGcodeFile: vi.fn(),
    fetchAndParseGcode: vi.fn(),
  }
})

const smallPrint = `G90
M83
;LAYER:0
G1 X10 Y10 Z0.2 E1 F1200
G1 X20 Y10 E1
G1 X20 Y20
;LAYER:1
G1 X10 Y20 Z0.4 E1
`

let pinia: Pinia

beforeAll(() => {
  // jsdom ships <dialog> without its modal methods, so the shared dialog's
  // open/close watcher has nothing to call.
  const dialogPrototype = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>
  if (typeof dialogPrototype.showModal !== 'function') {
    dialogPrototype.showModal = function showModal(this: HTMLDialogElement): void {
      this.open = true
    }
    dialogPrototype.close = function close(this: HTMLDialogElement): void {
      this.open = false
    }
  }
})

async function mountView() {
  const view = mount(GcodeViewerView, { global: { plugins: [i18n, pinia] } })
  await flushPromises()
  return view
}

/**
 * Runs the real streaming parser over `contents` and replays its batches and
 * summary through the mocked loader, so the view sees the same message order a
 * worker would produce. `batchSegments` of 1 forces a batch per safe cut.
 */
function streamThroughParser(contents: string, batchSegments = 1) {
  vi.mocked(parseGcodeFile).mockImplementation(async (file, options) => {
    options.onProgress({ loaded: file.size, total: file.size })
    const parser = new GcodeParser(Math.max(1, file.size))
    parser.pushText(contents)
    let batch = parser.drainBatch(batchSegments)
    while (batch) {
      options.onBatch?.(batch)
      batch = parser.drainBatch(batchSegments)
    }
    const { batch: last, summary } = parser.finishStream()
    if (last) options.onBatch?.(last)
    return summary
  })
}

async function chooseLocalFile(
  view: Awaited<ReturnType<typeof mountView>>,
  contents: string,
  name = 'cube.gcode',
  size?: number,
) {
  const input = view.find('input[type="file"]')
  const file = new File([contents], name, { type: 'text/plain' })
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size, configurable: true })
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await flushPromises()
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  rendererInstances.length = 0
  window.localStorage.clear()
  // jsdom implements neither; the stage observes its size and the view reads
  // the reduced-motion query the moment setup runs.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  )
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  pinia = createPinia()
  setActivePinia(pinia)
  const moonraker = useMoonrakerStore(pinia)
  moonraker.connectionPhase = 'connected'
  useAvailabilityStore(pinia).moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
  const printer = usePrinterStore(pinia)
  vi.spyOn(printer, 'refreshFiles').mockResolvedValue(true)
})

describe('G-code viewer view', () => {
  it('shows the control cards and the empty stage before any file loads', async () => {
    const view = await mountView()

    // Load, Layers and tracking, Color, Rendering quality. View is gone: its
    // reset and zoom live on the stage now. File statistics appears with a file.
    expect(view.findAll('.gcode-control-card').length).toBe(4)
    expect(view.find('.gcode-viewer-empty').exists()).toBe(true)
    expect(view.find('.gcode-viewer-legend').exists()).toBe(false)
    expect(view.find('.gcode-statistics').exists()).toBe(false)
    expect(rendererInstances).toHaveLength(1)
  })

  it('loads a local file into statistics, legend, and the layer slider', async () => {
    const view = await mountView()
    streamThroughParser(smallPrint)

    await chooseLocalFile(view, smallPrint)

    // The statistics describe the loaded file, so they sit behind a disclosure
    // on their own card rather than taking four always-open rows.
    expect(view.find('.gcode-statistics').exists()).toBe(false)
    await view.find('.gcode-statistics-toggle').trigger('click')
    const statistics = view.find('.gcode-statistics')
    expect(statistics.exists()).toBe(true)
    // 4 parsed moves: 3 extrusions and 1 travel across 2 layers.
    expect(statistics.text()).toContain('4')
    expect(view.find('.gcode-viewer-legend').exists()).toBe(true)
    expect(view.find('.gcode-viewer-loaded-file').text()).toContain('cube.gcode')
    const slider = view.find('.app-slider__track')
    expect(slider.attributes('max')).toBe('1')
    expect(slider.attributes('disabled')).toBeUndefined()
    expect(view.find('.gcode-viewer-empty').exists()).toBe(false)
  })

  /**
   * A toolhead marker asserts "the machine is here, in this model", so it may
   * only appear when its position and the geometry under it describe the same
   * job. The printer always reports a position, and drawing it over a file
   * someone opened merely to inspect puts a nozzle in a model the machine is not
   * making — which is what this once did for every loaded file.
   */
  it('keeps the toolhead off a file the machine is not printing', async () => {
    const view = await mountView()
    streamThroughParser(smallPrint)

    await chooseLocalFile(view, smallPrint)

    // Live tracking is on by default and the printer has a position; neither is
    // enough on its own, because this file is not the one being printed.
    expect(view.find('.gcode-viewer-legend').exists()).toBe(true)
    expect(view.find('.gcode-legend-toolhead').exists()).toBe(false)
    expect(view.find('.gcode-viewer-stage').attributes('data-toolhead-mode')).toBeUndefined()
  })

  it('shows the toolhead once a simulation is playing that same file', async () => {
    const view = await mountView()
    streamThroughParser(smallPrint)
    await chooseLocalFile(view, smallPrint)

    const enter = view
      .findAll('button')
      .find(
        (button) =>
          button.attributes('aria-pressed') === 'false' && /simulation/i.test(button.text()),
      )
    expect(enter, 'simulation cannot be entered').toBeDefined()
    await enter!.trigger('click')
    await flushPromises()

    expect(view.find('.gcode-legend-toolhead').exists()).toBe(true)
    expect(view.find('.gcode-viewer-stage').attributes('data-toolhead-mode')).toBe('simulation')
  })

  /**
   * The point of phase 1: geometry reaches the GPU in batches during the parse
   * and the summary only finalizes what is already there. A load that uploads
   * everything in one shot at the end would pass every other test here.
   */
  it('streams geometry to the renderer in batches, then finalizes once', async () => {
    const view = await mountView()
    streamThroughParser(smallPrint)

    await chooseLocalFile(view, smallPrint)

    const renderer = rendererInstances[0]
    expect(renderer?.begunStreams).toBe(1)
    expect(renderer?.streamedBatches).toBeGreaterThan(1)
    expect(renderer?.finishedStreams).toBe(1)
  })

  it('states on the loading card that follow and simulation wait for the parse', async () => {
    const view = await mountView()
    let release: (() => void) | null = null
    vi.mocked(parseGcodeFile).mockImplementation(
      () =>
        new Promise<ParsedGcodeSummary>((resolve) => {
          release = () => resolve(undefined as unknown as ParsedGcodeSummary)
        }),
    )

    const input = view.find('input[type="file"]')
    const file = new File([smallPrint], 'cube.gcode', { type: 'text/plain' })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises()

    const card = view.find('.gcode-loading-card')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('Live follow and simulation unlock when processing completes.')
    expect(release).not.toBeNull()
  })

  it('asks before committing a very large file, and loads nothing until confirmed', async () => {
    const view = await mountView()
    streamThroughParser(smallPrint)

    await chooseLocalFile(view, smallPrint, 'huge.gcode', 200 * 1_048_576)

    const dialog = view.find('.confirm-dialog')
    expect(dialog.exists()).toBe(true)
    expect(dialog.text()).toContain('huge.gcode')
    expect(parseGcodeFile).not.toHaveBeenCalled()

    await dialog.find('.button--primary').trigger('click')
    await flushPromises()

    expect(parseGcodeFile).toHaveBeenCalledTimes(1)
    expect(view.find('.gcode-statistics-toggle').exists()).toBe(true)
  })

  it('abandons a large file when the confirmation is declined', async () => {
    const view = await mountView()
    streamThroughParser(smallPrint)

    await chooseLocalFile(view, smallPrint, 'huge.gcode', 200 * 1_048_576)
    await view.find('.confirm-dialog .button:not(.button--primary)').trigger('click')
    await flushPromises()

    expect(parseGcodeFile).not.toHaveBeenCalled()
    expect(view.find('.confirm-dialog[open]').exists()).toBe(false)
  })

  it('reports an empty file instead of rendering a blank scene', async () => {
    const view = await mountView()
    streamThroughParser('; comments only\n')

    await chooseLocalFile(view, '; comments only\n')

    expect(view.find('.gcode-viewer-empty[role="alert"]').exists()).toBe(true)
    expect(view.find('.gcode-statistics-toggle').exists()).toBe(false)
  })

  it('names the byte-table limit when a file is too large to map', async () => {
    const view = await mountView()
    vi.mocked(parseGcodeFile).mockRejectedValue(new GcodeFileTooLargeError())

    await chooseLocalFile(view, smallPrint)

    expect(view.find('.gcode-viewer-empty[role="alert"]').text()).toContain('File too large')
  })

  it('surfaces a failed load as the download error state', async () => {
    const view = await mountView()
    vi.mocked(parseGcodeFile).mockRejectedValue(new Error('boom'))

    await chooseLocalFile(view, smallPrint, 'broken.gcode')

    expect(view.find('.gcode-viewer-empty[role="alert"]').exists()).toBe(true)
    expect(rendererInstances[0]?.cleared).toBeGreaterThan(0)
  })

  it('keeps an aborted load out of the error state', async () => {
    const view = await mountView()
    vi.mocked(parseGcodeFile).mockRejectedValue(new DOMException('Aborted', 'AbortError'))

    await chooseLocalFile(view, smallPrint, 'slow.gcode')

    expect(view.find('.gcode-viewer-empty[role="alert"]').exists()).toBe(false)
    expect(view.find('.gcode-viewer-empty').exists()).toBe(true)
  })

  /**
   * A lost context takes every GPU buffer with it and the CPU keeps no copy of
   * the upload-only arrays, so recovery has to re-run the last load. Before
   * this, a driver reset left a permanently blank canvas.
   */
  it('rebuilds the renderer and reloads the file after a lost WebGL context', async () => {
    const view = await mountView()
    streamThroughParser(smallPrint)
    await chooseLocalFile(view, smallPrint)
    expect(parseGcodeFile).toHaveBeenCalledTimes(1)

    const canvas = view.find('canvas').element
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    await flushPromises()

    expect(rendererInstances).toHaveLength(2)
    expect(rendererInstances[0]?.disposed).toBe(true)
    expect(parseGcodeFile).toHaveBeenCalledTimes(2)
    expect(view.find('.gcode-statistics-toggle').exists()).toBe(true)
  })

  it('installs the development benchmark for the console and removes it on unmount', async () => {
    const view = await mountView()

    const host = window as unknown as Record<string, unknown>
    expect(host.__alabasterGcodeViewerBenchmark).toBeDefined()

    view.unmount()
    expect(host.__alabasterGcodeViewerBenchmark).toBeUndefined()
  })

  describe('two fingers on the stage', () => {
    /**
     * The stage renders on an animation frame, so a test that only dispatched
     * events would assert against the camera as it stood before them. Running
     * the callback at once is enough: nothing here depends on real time.
     */
    function renderSynchronously(): void {
      // Returning 0 rather than a handle, because the view uses 0 as "no frame
      // pending" and assigns this return value *after* the callback has already
      // cleared it — a truthy handle latches the guard shut and nothing renders
      // again for the rest of the test.
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        callback(0)
        return 0
      })
      vi.stubGlobal('cancelAnimationFrame', () => undefined)
    }

    /**
     * The stage has no layout in jsdom, so both the pointer arithmetic and the
     * canvas sizing need a box — and the sizing happens at mount, which is why
     * this goes on the prototype before the view is mounted rather than on the
     * element afterwards.
     */
    function giveEveryElementABox(): void {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      } as DOMRect)
    }

    function finger(
      type: 'pointerdown' | 'pointermove' | 'pointerup',
      pointerId: number,
      clientX: number,
      clientY: number,
    ): PointerEvent {
      return new PointerEvent(type, {
        button: 0,
        pointerType: 'touch',
        pointerId,
        clientX,
        clientY,
        bubbles: true,
        cancelable: true,
      })
    }

    async function loadedStage() {
      renderSynchronously()
      giveEveryElementABox()
      const view = await mountView()
      streamThroughParser(smallPrint)
      await chooseLocalFile(view, smallPrint)
      const stage = view.get('.gcode-viewer-stage').element as HTMLElement
      stage.setPointerCapture = () => undefined
      stage.releasePointerCapture = () => undefined
      stage.hasPointerCapture = () => false
      const renderer = rendererInstances[0]
      renderer?.cameras.splice(0)
      return { view, stage, renderer }
    }

    /**
     * A finger reporting the position it is already at. Landing a finger
     * re-anchors the pivot, which moves the target without redrawing anything,
     * so this is what puts a frame on the record to measure the gesture from.
     */
    function settle(stage: HTMLElement, pointerId: number, clientX: number, clientY: number) {
      stage.dispatchEvent(finger('pointermove', pointerId, clientX, clientY))
    }

    function traveled(before?: GcodeCameraSnapshot, after?: GcodeCameraSnapshot): number {
      return Math.hypot(
        (after?.targetX ?? 0) - (before?.targetX ?? 0),
        (after?.targetY ?? 0) - (before?.targetY ?? 0),
        (after?.targetZ ?? 0) - (before?.targetZ ?? 0),
      )
    }

    it('pinches to zoom rather than orbiting', async () => {
      const { stage, renderer } = await loadedStage()
      stage.dispatchEvent(finger('pointerdown', 1, 300, 300))
      stage.dispatchEvent(finger('pointerdown', 2, 500, 300))
      settle(stage, 1, 300, 300)
      const before = renderer?.cameras.at(-1)

      // Fingers spread from 200 px apart to 400 px, about the same midpoint.
      stage.dispatchEvent(finger('pointermove', 1, 200, 300))
      stage.dispatchEvent(finger('pointermove', 2, 600, 300))

      const after = renderer?.cameras.at(-1)
      // Spreading the fingers closes in, and turns nothing.
      expect(after?.distance).toBeCloseTo((before?.distance ?? 0) / 2, 4)
      expect(after?.yaw).toBeCloseTo(before?.yaw ?? 0, 6)
      expect(after?.pitch).toBeCloseTo(before?.pitch ?? 0, 6)
    })

    it('drags two fingers to pan, without turning the model', async () => {
      const { stage, renderer } = await loadedStage()
      stage.dispatchEvent(finger('pointerdown', 1, 300, 300))
      stage.dispatchEvent(finger('pointerdown', 2, 500, 300))
      settle(stage, 1, 300, 300)
      const before = renderer?.cameras.at(-1)

      // Both fingers 120 px to the right: the shape between them never changes,
      // so the camera looks somewhere else from the same distance and angle.
      stage.dispatchEvent(finger('pointermove', 1, 420, 300))
      stage.dispatchEvent(finger('pointermove', 2, 620, 300))

      const after = renderer?.cameras.at(-1)
      expect(traveled(before, after)).toBeGreaterThan(0)
      expect(after?.distance).toBeCloseTo(before?.distance ?? 0, 4)
      expect(after?.yaw).toBeCloseTo(before?.yaw ?? 0, 6)
      expect(after?.pitch).toBeCloseTo(before?.pitch ?? 0, 6)
    })

    it('keeps panning on the finger left down as the pinch is released', async () => {
      // Fingers never leave the glass together, so the last one has to keep
      // panning: handed back to the one-finger drag it orbited the model a few
      // degrees at the end of every pinch.
      const { stage, renderer } = await loadedStage()
      stage.dispatchEvent(finger('pointerdown', 1, 300, 300))
      stage.dispatchEvent(finger('pointerdown', 2, 500, 300))
      stage.dispatchEvent(finger('pointerup', 2, 500, 300))
      settle(stage, 1, 300, 300)
      const before = renderer?.cameras.at(-1)

      stage.dispatchEvent(finger('pointermove', 1, 360, 300))

      const after = renderer?.cameras.at(-1)
      expect(traveled(before, after)).toBeGreaterThan(0)
      expect(after?.yaw).toBeCloseTo(before?.yaw ?? 0, 6)
      expect(after?.pitch).toBeCloseTo(before?.pitch ?? 0, 6)
    })

    it('orbits from one finger, which is the gesture a mouse makes too', async () => {
      const { stage, renderer } = await loadedStage()
      stage.dispatchEvent(finger('pointerdown', 1, 300, 300))
      stage.dispatchEvent(finger('pointermove', 1, 340, 300))
      const before = renderer?.cameras.at(-1)

      stage.dispatchEvent(finger('pointermove', 1, 420, 300))

      const after = renderer?.cameras.at(-1)
      expect(after?.yaw).not.toBeCloseTo(before?.yaw ?? 0, 6)
    })
  })
})
