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

const rendererInstances = vi.hoisted(
  () =>
    [] as Array<{
      canvas: HTMLCanvasElement
      streamedBatches: number
      finishedStreams: number
      begunStreams: number
      cleared: number
      disposed: boolean
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
    resize(): void {}
    desiredSampleScale(): number {
      return 1
    }
    render(): null {
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

    // Load, Layers and tracking, Colour, Rendering quality. View is gone: its
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
})
