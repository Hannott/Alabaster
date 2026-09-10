import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { useGcodeViewerSettings } from '@/composables/useGcodeViewerSettings'
import { GcodeFileTooLargeError, parseGcodeFile } from '@/features/gcode/loader'
import { parseGcode } from '@/features/gcode/parser'
import { i18n } from '@/i18n'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import GcodeViewerView from '@/views/GcodeViewerView.vue'

enableAutoUnmount(afterEach)

/**
 * The page-level net under the viewer.
 *
 * The renderer is replaced at the seam — `createGcodeSceneRenderer` — rather
 * than deeper, which is the point of having a seam: these tests describe what
 * the page asks a renderer to do, and would still hold if the library behind
 * it changed again. The parser between the loader and the page is real, so the
 * byte table, layer heights and feature inventory a test asserts on are the
 * ones a real file would produce.
 */

interface RecordedRenderer {
  canvas: HTMLCanvasElement
  tier: number
  travelsAvailable: boolean
  recoveredFromFailedLoad: boolean
  loads: string[]
  progressBytes: Array<number | null>
  revealAhead: boolean[]
  layerRanges: Array<[number | null, number | null]>
  travels: boolean[]
  colorModes: string[]
  tiers: number[]
  resolutionScales: number[]
  colorApplications: number
  disposed: number
  cleared: number
  cancelled: number
}

const renderers = vi.hoisted(() => [] as RecordedRenderer[])
const featureColor = vi.hoisted(() => vi.fn<(labels: readonly string[]) => string | null>())
const changeTier = vi.hoisted(() => vi.fn())

vi.mock('@/features/gcode/scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/gcode/scene')>()
  return {
    ...actual,
    createGcodeSceneRenderer: vi.fn(
      async (canvas: HTMLCanvasElement, options: { tier: number; resolutionScale: number }) => {
        const recorded: RecordedRenderer = {
          canvas,
          tier: options.tier,
          travelsAvailable: options.tier >= 3,
          recoveredFromFailedLoad: false,
          loads: [],
          progressBytes: [],
          revealAhead: [],
          layerRanges: [],
          travels: [],
          colorModes: [],
          tiers: [],
          resolutionScales: [options.resolutionScale],
          colorApplications: 0,
          disposed: 0,
          cleared: 0,
          cancelled: 0,
        }
        renderers.push(recorded)
        return {
          get recoveredFromFailedLoad() {
            return recorded.recoveredFromFailedLoad
          },
          get tier() {
            return recorded.tier
          },
          get travelsAvailable() {
            return recorded.travelsAvailable
          },
          load: async (text: string) => {
            recorded.loads.push(text)
          },
          cancelLoad: () => {
            recorded.cancelled += 1
          },
          clear: () => {
            recorded.cleared += 1
          },
          setProgressBytes: (bytes: number | null) => {
            recorded.progressBytes.push(bytes)
          },
          setRevealAhead: (reveal: boolean) => {
            recorded.revealAhead.push(reveal)
          },
          setLayerRange: (bottom: number | null, top: number | null) => {
            recorded.layerRanges.push([bottom, top])
          },
          setTravels: (visible: boolean) => {
            recorded.travels.push(visible)
          },
          setColorMode: async (mode: string) => {
            recorded.colorModes.push(mode)
          },
          setFeedrateRange: () => {},
          setTier: async (tier: number) => {
            recorded.tiers.push(tier)
            await changeTier(recorded, tier)
          },
          setResolutionScale: (scale: number) => {
            recorded.resolutionScales.push(scale)
          },
          applyColors: () => {
            recorded.colorApplications += 1
          },
          setBedBounds: () => {},
          featureColor,
          resetCamera: () => {},
          frameBounds: () => {},
          orbitBy: () => {},
          panBy: () => {},
          zoomBy: () => {},
          cameraPosition: (): [number, number, number] => [0, 0, 100],
          project: (): [number, number] => [10, 10],
          screenshot: () => null,
          resize: () => {},
          dispose: () => {
            recorded.disposed += 1
          },
        }
      },
    ),
  }
})

vi.mock('@/features/gcode/loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/gcode/loader')>()),
  parseGcodeFile: vi.fn(),
  fetchAndParseGcode: vi.fn(),
}))

const cubeGcode = `;TYPE:External perimeter
G1 X0 Y0 Z0.2 F1200
G1 X10 Y0 Z0.2 E1 F1800
G1 X10 Y10 Z0.2 E1
;TYPE:Internal infill
G1 X0 Y10 Z0.2 E1
;LAYER:1
G1 X0 Y0 Z0.4 E1
G1 X10 Y0 Z0.4 E1
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

function loadThroughParser(contents: string): void {
  vi.mocked(parseGcodeFile).mockImplementation(async (file, options) => {
    options.onProgress({ loaded: file.size, total: file.size })
    return { text: contents, summary: parseGcode(contents) }
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

function latest(): RecordedRenderer {
  const renderer = renderers.at(-1)
  if (!renderer) throw new Error('no renderer was created')
  return renderer
}

beforeEach(() => {
  vi.clearAllMocks()
  renderers.length = 0
  featureColor.mockReturnValue(null)
  changeTier.mockImplementation(async (recorded: RecordedRenderer, tier: number) => {
    recorded.tier = tier
    recorded.travelsAvailable = tier >= 3
  })
  window.localStorage.clear()
  // The settings composable is module-scoped, so each test resets it through
  // its own setters rather than relying on a fresh import.
  const settings = useGcodeViewerSettings()
  settings.setQualityMode('auto')
  settings.setTierCeiling(4)
  settings.setColorMode('single')
  settings.setShowTravels(false)
  settings.setFollowByDefault(true)
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
  vi.spyOn(printer, 'loadMetadata').mockResolvedValue(null)
})

describe('G-code viewer view', () => {
  it('offers a way in and nothing else before a file loads', async () => {
    const view = await mountView()

    expect(view.text()).toContain(i18n.global.t('gcodeViewer.empty.title'))
    // The file chip is the only control on the stage until there is something
    // to control; a colour mode for no model is a control that does nothing.
    expect(view.find('.gcode-chip--file').exists()).toBe(true)
    expect(view.find('.gcode-transport').exists()).toBe(false)
    expect(view.find('.gcode-rail').exists()).toBe(false)
    expect(view.find('.gcode-legend').exists()).toBe(false)
  })

  it('puts the model, its controls and its readings on the stage once loaded', async () => {
    const view = await mountView()
    loadThroughParser(cubeGcode)
    await chooseLocalFile(view, cubeGcode)

    expect(latest().loads).toEqual([cubeGcode])
    expect(view.find('.gcode-transport').exists()).toBe(true)
    expect(view.find('.gcode-rail').exists()).toBe(true)
    expect(view.find('.gcode-legend').exists()).toBe(true)
    // The old sidebar is gone rather than hidden.
    expect(view.find('.gcode-viewer-controls').exists()).toBe(false)
    expect(view.find('.gcode-control-card').exists()).toBe(false)
  })

  /**
   * The whole file is shown, and geometry ahead of a frontier is only hidden
   * when there is a frontier. A viewer that opened a file already clipped
   * would look like it had failed to load half of it.
   */
  it('shows a freshly opened file whole', async () => {
    const view = await mountView()
    loadThroughParser(cubeGcode)
    await chooseLocalFile(view, cubeGcode)

    expect(latest().progressBytes.at(-1)).toBeNull()
    expect(latest().revealAhead.at(-1)).toBe(true)
  })

  /**
   * Dragging the scrubber is what enters simulation — there is no separate
   * button for it any more — and the cursor reaches the renderer as a byte
   * offset with the reveal rule engaged.
   */
  it('turns a scrub into a byte frontier with nothing drawn ahead of it', async () => {
    const view = await mountView()
    loadThroughParser(cubeGcode)
    await chooseLocalFile(view, cubeGcode)

    const scrubber = view.find('.gcode-transport__input')
    ;(scrubber.element as HTMLInputElement).value = '3'
    await scrubber.trigger('input')
    await flushPromises()

    expect(latest().revealAhead.at(-1)).toBe(false)
    const frontier = latest().progressBytes.at(-1)
    expect(typeof frontier).toBe('number')
    expect(frontier as number).toBeGreaterThan(0)
    // A byte offset inside the file, not a segment index dressed up as one.
    expect(frontier as number).toBeLessThanOrEqual(cubeGcode.length)
  })

  it('clips to a layer range from the rail, and lifts the clip while playing', async () => {
    const view = await mountView()
    loadThroughParser(cubeGcode)
    await chooseLocalFile(view, cubeGcode)

    const bottom = view.findAll('.gcode-rail__input')[1]
    if (!bottom) throw new Error('the rail is missing its second thumb')
    ;(bottom.element as HTMLInputElement).value = '1'
    await bottom.trigger('input')
    await flushPromises()

    const clipped = latest().layerRanges.at(-1)
    expect(clipped?.[0]).toBeGreaterThan(0)

    // Entering simulation hands the decision to the frontier: clipping to the
    // active layer as well would hide the completed model below it.
    const scrubber = view.find('.gcode-transport__input')
    ;(scrubber.element as HTMLInputElement).value = '2'
    await scrubber.trigger('input')
    await flushPromises()

    expect(latest().layerRanges.at(-1)).toEqual([null, null])
  })

  /**
   * Feature colour belongs to the renderer, which chooses it per slicer while
   * parsing. The legend asks for it rather than naming a theme token, so the
   * swatch and the canvas cannot disagree — and a feature the renderer has no
   * colour for is left out rather than guessed at.
   */
  it('colours the feature legend from the renderer, and omits what it cannot answer', async () => {
    // The renderer knows this file's perimeters and nothing about its infill,
    // which is the real case: a slicer names features in its own words and the
    // renderer's palette may not carry all of them.
    featureColor.mockImplementation((labels) =>
      labels.includes('external perimeter') ? 'rgb(1, 2, 3)' : null,
    )
    useGcodeViewerSettings().setColorMode('feature')
    const view = await mountView()
    loadThroughParser(cubeGcode)
    await chooseLocalFile(view, cubeGcode)

    const swatches = view.findAll('.gcode-legend__swatch')
    // One row, not two: the category the renderer could not colour is left
    // out rather than shown in a colour the canvas is not using.
    expect(swatches).toHaveLength(1)
    expect(swatches[0]?.attributes('style')).toContain('rgb(1, 2, 3)')
    expect(view.find('.gcode-legend').text()).toContain(
      i18n.global.t('gcodeViewer.legend.features.perimeterOuter'),
    )
  })

  it('asks before committing a very large file, and loads nothing until confirmed', async () => {
    const view = await mountView()
    loadThroughParser(cubeGcode)
    await chooseLocalFile(view, cubeGcode, 'huge.gcode', 400 * 1_048_576)

    expect(view.text()).toContain(i18n.global.t('gcodeViewer.confirmLoad.title'))
    expect(latest().loads).toEqual([])
  })

  it('reports an empty file instead of rendering a blank scene', async () => {
    const view = await mountView()
    loadThroughParser('; nothing but a comment\n')
    await chooseLocalFile(view, '; nothing but a comment\n')

    expect(view.text()).toContain(i18n.global.t('gcodeViewer.errors.empty.title'))
  })

  it('names the byte-table limit when a file is too large to map', async () => {
    const view = await mountView()
    vi.mocked(parseGcodeFile).mockRejectedValue(new GcodeFileTooLargeError())
    await chooseLocalFile(view, cubeGcode)

    expect(view.text()).toContain(i18n.global.t('gcodeViewer.errors.tooLarge.title'))
  })

  it('surfaces a failed load as the download error state', async () => {
    const view = await mountView()
    vi.mocked(parseGcodeFile).mockRejectedValue(new Error('network'))
    await chooseLocalFile(view, cubeGcode)

    expect(view.text()).toContain(i18n.global.t('gcodeViewer.errors.download.title'))
  })

  it('keeps an aborted load out of the error state', async () => {
    const view = await mountView()
    vi.mocked(parseGcodeFile).mockRejectedValue(new DOMException('aborted', 'AbortError'))
    await chooseLocalFile(view, cubeGcode)

    expect(view.text()).not.toContain(i18n.global.t('gcodeViewer.errors.download.title'))
  })

  /**
   * The library keeps its engine, its scene, every mesh and the whole file
   * text alive until something disposes them, and it has no disposer of its
   * own. Leaving the page has to be that something, or a session that visits
   * the viewer twice holds two of everything.
   */
  it('disposes the renderer when the page is left', async () => {
    const view = await mountView()
    loadThroughParser(cubeGcode)
    await chooseLocalFile(view, cubeGcode)

    expect(latest().disposed).toBe(0)
    view.unmount()
    expect(latest().disposed).toBe(1)
  })

  /**
   * A tier is a vertex budget the renderer meets by rebuilding every mesh, so
   * it is chosen once per load from the mode and this device's own ceiling —
   * never dragged, and never moved by the frame-rate governor.
   */
  it('chooses the detail tier from the quality mode at load time', async () => {
    // Set through the composable rather than through storage: it reads its
    // keys once at import, so a test that seeded storage would be describing
    // whatever the previous test left behind.
    useGcodeViewerSettings().setQualityMode('quality')
    const view = await mountView()
    loadThroughParser(cubeGcode)
    await chooseLocalFile(view, cubeGcode)

    // Quality asks for the richest tier the renderer offers.
    expect(latest().tier).toBe(5)
  })

  it('serializes rapid quality changes and finishes at the latest mode', async () => {
    const view = await mountView()
    loadThroughParser(cubeGcode)
    await chooseLocalFile(view, cubeGcode)

    let releaseQuality!: () => void
    const qualityBlocked = new Promise<void>((resolve) => {
      releaseQuality = resolve
    })
    let activeChanges = 0
    let maximumActiveChanges = 0
    changeTier.mockImplementation(async (recorded: RecordedRenderer, tier: number) => {
      activeChanges += 1
      maximumActiveChanges = Math.max(maximumActiveChanges, activeChanges)
      if (tier === 5) await qualityBlocked
      recorded.tier = tier
      recorded.travelsAvailable = tier >= 3
      activeChanges -= 1
    })

    const qualityTrigger = view.find(
      `button[aria-label="${i18n.global.t('gcodeViewer.quality.title')}"]`,
    )
    await qualityTrigger.trigger('click')
    const qualityChoice = view
      .findAll('.gcode-popover button')
      .find((button) => button.text() === i18n.global.t('gcodeViewer.quality.modes.quality'))
    if (!qualityChoice) throw new Error('the Quality choice is missing')
    await qualityChoice.trigger('click')
    await flushPromises()

    await qualityTrigger.trigger('click')
    const performanceChoice = view
      .findAll('.gcode-popover button')
      .find((button) => button.text() === i18n.global.t('gcodeViewer.quality.modes.performance'))
    if (!performanceChoice) throw new Error('the Performance choice is missing')
    await performanceChoice.trigger('click')
    await flushPromises()

    expect(maximumActiveChanges).toBe(1)
    expect(latest().tiers).toEqual([4, 5])

    releaseQuality()
    await flushPromises()

    expect(maximumActiveChanges).toBe(1)
    expect(latest().tiers).toEqual([4, 5, 2])
    expect(latest().tier).toBe(2)
  })

  it('starts a device that could not hold its tier one rung lower', async () => {
    useGcodeViewerSettings().setTierCeiling(2)
    const view = await mountView()
    loadThroughParser(cubeGcode)
    await chooseLocalFile(view, cubeGcode)

    expect(latest().tier).toBe(2)
    // And says so where somebody looking at a coarse model would ask why.
    expect(latest().travelsAvailable).toBe(false)
  })

  it('installs the development benchmark for the console and removes it on unmount', async () => {
    const view = await mountView()
    const handle = '__alabasterGcodeViewerBenchmark'

    expect((window as unknown as Record<string, unknown>)[handle]).toBeDefined()
    view.unmount()
    expect((window as unknown as Record<string, unknown>)[handle]).toBeUndefined()
  })
})
