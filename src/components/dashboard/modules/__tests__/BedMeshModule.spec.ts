import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import BedMeshModule from '@/components/dashboard/modules/BedMeshModule.vue'
import { dashboardModuleContextKey } from '@/dashboard/context'
import { meshOrientationPresets } from '@/features/bedMesh/scene'
import { i18n } from '@/i18n'
import { useBedMeshStore } from '@/stores/bedMesh'
import { useConsoleStore } from '@/stores/console'
import { usePrinterStore } from '@/stores/printer'
import { useTelemetryStore } from '@/stores/telemetry'

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

/**
 * jsdom never grants a real WebGL2 context, so the actual `MeshGlRenderer`
 * always fails to construct and the module quietly limps along with
 * `renderer` stuck at null — which would hide the bug this file guards
 * against, where a *successful* renderer outlives the canvas it was built
 * from. A fake that always succeeds is what lets the test see that.
 *
 * `layers` records every `setLayer` call by key, so a test can ask what the
 * card actually handed the GPU for a given layer — the live surface's matrix
 * and area, in particular — rather than only whether *a* paint happened.
 *
 * `geometries` records every `setGeometry` call by key — the easter egg's
 * voyage goes this way rather than through `setLayer`, since it carries no
 * matrix or style for `setLayer` to turn into one.
 *
 * `lastDraws` records the most recent `render` call's own draw list, keyed by
 * layer key. `setLayer`/`setGeometry` are what get *uploaded*; `lastDraws` is
 * what a given frame actually asked for — the one place the flat-map
 * crossfade and the level plane's hide/reveal timing show up, since both work
 * by varying opacity per frame rather than by touching the upload.
 */
const rendererInstances = vi.hoisted(
  () =>
    [] as Array<{
      disposed: boolean
      layers: Map<string, { matrix: number[][]; area: unknown; opacity: number }>
      geometries: Map<string, { positions: number[] }>
      lastDraws: Map<string, { opacity: number; wireframe?: boolean }>
    }>,
)
vi.mock('@/features/bedMesh/glRenderer', () => ({
  MeshGlRenderer: class {
    disposed = false
    layers = new Map<string, { matrix: number[][]; area: unknown; opacity: number }>()
    geometries = new Map<string, { positions: number[] }>()
    lastDraws = new Map<string, { opacity: number; wireframe?: boolean }>()
    constructor() {
      rendererInstances.push(this)
    }
    setLayer(layer: { key: string; matrix: number[][]; area: unknown; opacity: number }): void {
      this.layers.set(layer.key, layer)
    }
    removeLayer(key: string): void {
      this.layers.delete(key)
      this.geometries.delete(key)
    }
    setGeometry(key: string, geometry: { positions: number[] }): void {
      this.geometries.set(key, geometry)
    }
    setGuides(): void {}
    render(
      _frame: unknown,
      draws: Array<{ key: string; opacity: number; wireframe?: boolean }>,
    ): void {
      this.lastDraws = new Map(draws.map((draw) => [draw.key, draw]))
    }
    dispose(): void {
      this.disposed = true
    }
  },
}))

function mountModule(
  initialConfig: Record<string, unknown> = {},
  props: Record<string, unknown> = {},
) {
  const pinia = createPinia()
  const bedMesh = useBedMeshStore(pinia)
  const telemetry = useTelemetryStore(pinia)
  const printer = usePrinterStore(pinia)
  const gcodeConsole = useConsoleStore(pinia)
  const config = ref<Record<string, unknown>>(initialConfig)
  const wrapper = mount(BedMeshModule, {
    props,
    global: {
      plugins: [pinia, i18n],
      provide: {
        [dashboardModuleContextKey as symbol]: {
          instanceId: 'bedMesh',
          moduleId: 'bedMesh',
          config: computed(() => config.value),
          updateConfig: (patch: Record<string, unknown>) => {
            config.value = { ...config.value, ...patch }
          },
          isSettingsOpen: computed(() => false),
          openSettings: () => undefined,
          closeSettings: () => undefined,
          isSurfaceOpen: computed(() => false),
          openSurface: () => undefined,
          closeSurface: () => undefined,
        },
      },
    },
  })
  return { pinia, bedMesh, telemetry, printer, gcodeConsole, config, wrapper }
}

/** Appends a console line the way the console store's transcript actually grows. */
async function say(gcodeConsole: ReturnType<typeof useConsoleStore>, raw: string): Promise<void> {
  gcodeConsole.consoleEntries = [
    ...gcodeConsole.consoleEntries,
    { id: raw + gcodeConsole.consoleEntries.length, raw, kind: 'response', at: 0 },
  ] as never
}

function loadMesh(bedMesh: ReturnType<typeof useBedMeshStore>): void {
  bedMesh.profileName = 'default'
  bedMesh.meshMin = [10, 10]
  bedMesh.meshMax = [210, 210]
  bedMesh.probedMatrix = [
    [0.02, 0.06, 0.1],
    [0, 0.04, 0.09],
    [-0.03, 0.01, 0.05],
  ]
}

function mountLoaded(initialConfig: Record<string, unknown> = {}) {
  const mounted = mountModule(initialConfig)
  loadMesh(mounted.bedMesh)
  return mounted
}

/**
 * jsdom has neither layout nor a canvas, so the painter is never reached and
 * every visual setting looks like it works. Giving the stage a size and the
 * canvas a recording context lets the real paint path run, which is how a
 * control that quietly does nothing gets caught.
 */
function stubCanvas() {
  const paints: number[] = []
  const texts: string[] = []
  const context = {
    clearRect: () => paints.push(paints.length),
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    arc: () => undefined,
    setLineDash: () => undefined,
    setTransform: () => undefined,
    fillText: (text: string) => texts.push(text),
    measureText: () => ({ width: 24 }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: '',
    font: '',
    textAlign: '',
    textBaseline: '',
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  )
  for (const dimension of ['clientWidth', 'clientHeight'] as const) {
    vi.spyOn(HTMLElement.prototype, dimension, 'get').mockReturnValue(
      dimension === 'clientWidth' ? 360 : 240,
    )
  }
  return Object.assign(paints, { texts })
}

/**
 * Forces the viewpoint transition onto its instant branch, so a test can
 * assert on the settled state of a toggle without driving a real animation
 * frame by frame — the same trick `cardMove.spec.ts` uses for its own fades.
 */
function setReducedMotion(reduce: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
}

describe('BedMeshModule', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
    rendererInstances.length = 0
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    )
  })

  function findToggle(wrapper: ReturnType<typeof mountModule>['wrapper']) {
    return wrapper.find('[title="Switch between the flat map and the height map"]')
  }

  it('offers no view toggle until there is a mesh to look at', async () => {
    const { bedMesh, wrapper } = mountModule()
    expect(findToggle(wrapper).exists()).toBe(false)

    loadMesh(bedMesh)
    await wrapper.vm.$nextTick()
    expect(findToggle(wrapper).exists()).toBe(true)
  })

  it('names the view in text, and never marks the switch itself as pressed', async () => {
    // This is a switch between two views, not a toggle whose own on/off state
    // is the thing being tracked — like a play/pause button, its label already
    // names the action a click performs. `aria-pressed` here previously stayed
    // true while the label read "2D view", which looked like "2D" was the
    // selected option when 3D was actually the one showing.
    const { bedMesh, wrapper } = mountModule({ showSurface: true })
    loadMesh(bedMesh)
    await wrapper.vm.$nextTick()

    const toggle = findToggle(wrapper)
    expect(toggle.attributes('aria-pressed')).toBeUndefined()
    expect(toggle.text()).toContain('2D view')

    await toggle.trigger('click')
    expect(findToggle(wrapper).attributes('aria-pressed')).toBeUndefined()
    expect(findToggle(wrapper).text()).toContain('3D view')
  })

  it('tells apart never-calibrated, calibrated-but-unloaded, and loaded', async () => {
    // Two of these look identical if the header only ever says "no mesh": a
    // printer that has never been probed, and one that has a saved mesh it
    // simply is not using right now — the second is running unlevelled after
    // having known better, which deserves a warning the first case does not.
    const { bedMesh, wrapper } = mountModule()
    expect(wrapper.text()).toContain('No calibration data')
    expect(wrapper.find('.mesh-status').classes()).not.toContain('text-caution-text')

    bedMesh.profiles = ['default']
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('No mesh loaded')
    expect(wrapper.find('.mesh-status').classes()).toContain('text-caution-text')
    expect(wrapper.findComponent({ name: 'AppIcon' }).exists()).toBe(true)

    loadMesh(bedMesh)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Mesh loaded: default')
    expect(wrapper.find('.mesh-status').classes()).not.toContain('text-caution-text')
  })

  /*
   * Loading a different profile or clearing the active one both rewrite the Z
   * compensation the toolhead is following right now — the same reason a
   * calibration run is refused while a print is active.
   */
  it('clears the mesh once the printer is idle', async () => {
    const { printer, wrapper } = mountLoaded()
    const clearBedMesh = vi.spyOn(printer, 'clearBedMesh').mockResolvedValue(true)
    printer.printStats.state = 'standby'
    await wrapper.vm.$nextTick()

    const clear = wrapper.findAll('.button').find((button) => button.text() === 'Clear mesh')
    expect(clear?.attributes('disabled')).toBeUndefined()
    await clear?.trigger('click')
    expect(clearBedMesh).toHaveBeenCalled()
  })

  it('labels both ends of the gradient with the deviation they stand for', async () => {
    const { bedMesh, wrapper } = mountModule({ fixedLimit: 0.15 })
    loadMesh(bedMesh)
    await wrapper.vm.$nextTick()

    const values = wrapper.findAll('.mesh-legend__value').map((node) => node.text())
    expect(values).toEqual(['-0.150', '0.150'])
  })

  it('scales the gradient to the mesh only when asked, so two meshes stay comparable', async () => {
    const { wrapper } = mountLoaded({ scaleToMesh: true })
    await wrapper.vm.$nextTick()

    // Centred on the mean of loadMesh's nine points (~0.038) with reach set
    // from their mean absolute deviation, not the raw -0.03..0.1 span.
    expect(wrapper.findAll('.mesh-legend__value').map((node) => node.text())).toEqual([
      '-0.029',
      '0.105',
    ])
  })

  it('only offers to orbit the view that can be orbited', async () => {
    // The overlay is the one that takes the pointer — the WebGL canvas below
    // it is inert — so it is the one that advertises whether it can be turned.
    const flat = mountLoaded({ showSurface: false })
    await flat.wrapper.vm.$nextTick()
    expect(flat.wrapper.find('.mesh-canvas--overlay').classes()).not.toContain(
      'mesh-canvas--orbitable',
    )

    const solid = mountLoaded({ showSurface: true })
    await solid.wrapper.vm.$nextTick()
    expect(solid.wrapper.find('.mesh-canvas--overlay').classes()).toContain(
      'mesh-canvas--orbitable',
    )
  })

  it('keeps a right-click on the map to itself', async () => {
    // A viewport, not a document: the browser's own menu over an aimed gesture
    // interrupts the drag and offers nothing about what was clicked.
    const { wrapper } = mountLoaded()
    await wrapper.vm.$nextTick()
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    wrapper.find('.mesh-canvas--overlay').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('pans on the secondary button and leaves the angle alone', async () => {
    // The two drags answer different questions, and a pan that also turned the
    // surface would make the angle impossible to hold while moving the map.
    stubCanvas()
    const { config, wrapper } = mountLoaded({ showSurface: true })
    await wrapper.vm.$nextTick()
    // `trigger` cannot set `button`, which is read-only on a real MouseEvent,
    // so the event is constructed and dispatched directly.
    const canvas = wrapper.find('.mesh-canvas--overlay').element
    canvas.setPointerCapture = () => undefined
    canvas.releasePointerCapture = () => undefined
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 2,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
        bubbles: true,
      }),
    )
    canvas.dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 1, clientX: 80, clientY: 20, bubbles: true }),
    )
    canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.mesh-stage__reset').exists()).toBe(true)

    await wrapper.find('.mesh-stage__lock').trigger('click')
    const resting = meshOrientationPresets.rightFront
    expect(config.value.lockedPanX).toBeCloseTo(80, 6)
    expect(config.value.lockedPanY).toBeCloseTo(20, 6)
    expect(config.value.lockedAlpha).toBeCloseTo(resting.alpha, 6)
    expect(config.value.lockedBeta).toBeCloseTo(resting.beta, 6)
  })

  /*
   * The browser's middle-click autoscroll starts on the press, so the page slid
   * under a pan already under way. `auxclick` cannot stop it — that fires on
   * release — so the pointer event's own default has to go.
   */
  it('stops the browser scrolling the page under a middle-button pan', async () => {
    stubCanvas()
    const { wrapper } = mountLoaded({ showSurface: true })
    await wrapper.vm.$nextTick()
    const canvas = wrapper.find('.mesh-canvas--overlay').element
    canvas.setPointerCapture = () => undefined
    canvas.releasePointerCapture = () => undefined

    const middle = new PointerEvent('pointerdown', {
      button: 1,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      bubbles: true,
      cancelable: true,
    })
    canvas.dispatchEvent(middle)
    expect(middle.defaultPrevented).toBe(true)

    // It still pans, which is the whole reason the button is claimed.
    canvas.dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 1, clientX: 60, clientY: 15, bubbles: true }),
    )
    canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mesh-stage__reset').exists()).toBe(true)
  })

  /*
   * The secondary button raises no autoscroll, and a locked map hands every
   * gesture back to the page on purpose — so neither may have its default taken.
   */
  it('leaves the page its own gestures where nothing needs suppressing', async () => {
    stubCanvas()
    const { wrapper } = mountLoaded({ showSurface: true })
    await wrapper.vm.$nextTick()
    const canvas = wrapper.find('.mesh-canvas--overlay').element
    canvas.setPointerCapture = () => undefined
    canvas.releasePointerCapture = () => undefined

    const secondary = new PointerEvent('pointerdown', {
      button: 2,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      bubbles: true,
      cancelable: true,
    })
    canvas.dispatchEvent(secondary)
    expect(secondary.defaultPrevented).toBe(false)
    canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }))

    const locked = mountLoaded({ showSurface: true, locked: true })
    await locked.wrapper.vm.$nextTick()
    const lockedCanvas = locked.wrapper.find('.mesh-canvas--overlay').element
    lockedCanvas.setPointerCapture = () => undefined
    const onLocked = new PointerEvent('pointerdown', {
      button: 1,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      bubbles: true,
      cancelable: true,
    })
    lockedCanvas.dispatchEvent(onLocked)
    expect(onLocked.defaultPrevented).toBe(false)
  })

  it('does nothing at all from a button that is neither a drag nor a pan', async () => {
    stubCanvas()
    const { wrapper } = mountLoaded({ showSurface: true })
    await wrapper.vm.$nextTick()
    const canvas = wrapper.find('.mesh-canvas--overlay').element
    canvas.setPointerCapture = () => undefined
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 4,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
        bubbles: true,
      }),
    )
    canvas.dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 1, clientX: 80, clientY: 20, bubbles: true }),
    )
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.mesh-stage__reset').exists()).toBe(false)
  })

  /**
   * A two-finger gesture, dispatched the way a browser reports one: a
   * `pointermove` per finger, never both at once.
   */
  function pinch(
    wrapper: ReturnType<typeof mountModule>['wrapper'],
    moves: ReadonlyArray<[pointerId: number, clientX: number, clientY: number]>,
    start: ReadonlyArray<[pointerId: number, clientX: number, clientY: number]> = [
      [1, 100, 100],
      [2, 200, 100],
    ],
  ): void {
    const canvas = wrapper.find('.mesh-canvas--overlay').element
    canvas.setPointerCapture = () => undefined
    canvas.releasePointerCapture = () => undefined
    for (const [pointerId, clientX, clientY] of start) {
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', {
          button: 0,
          pointerType: 'touch',
          pointerId,
          clientX,
          clientY,
          bubbles: true,
        }),
      )
    }
    for (const [pointerId, clientX, clientY] of moves) {
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerType: 'touch',
          pointerId,
          clientX,
          clientY,
          bubbles: true,
        }),
      )
    }
    for (const [pointerId] of start) {
      canvas.dispatchEvent(
        new PointerEvent('pointerup', { pointerType: 'touch', pointerId, bubbles: true }),
      )
    }
  }

  it('pans and magnifies from two fingers without turning the surface', async () => {
    // The whole gesture on a phone: a mouse has a second button to pan with and
    // a wheel to zoom with, and a finger has neither.
    stubCanvas()
    const { config, wrapper } = mountLoaded({ showSurface: true })
    await wrapper.vm.$nextTick()

    // Both fingers 30 right, and spread from 100 px apart to 160 px.
    pinch(wrapper, [
      [1, 100, 100],
      [2, 260, 100],
    ])
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.mesh-stage__reset').exists()).toBe(true)
    await wrapper.find('.mesh-stage__lock').trigger('click')
    const resting = meshOrientationPresets.rightFront
    expect(config.value.lockedPanX).toBeCloseTo(30, 6)
    expect(config.value.lockedZoom).toBeCloseTo(1.6, 6)
    // A pinch is not an orbit, however far the fingers travel.
    expect(config.value.lockedAlpha).toBeCloseTo(resting.alpha, 6)
    expect(config.value.lockedBeta).toBeCloseTo(resting.beta, 6)
  })

  it('drops the orbit the first finger started when a second one lands', async () => {
    // Left running underneath, the orbit would spin the surface as the fingers
    // moved apart — a pinch that also rotates.
    stubCanvas()
    const { config, wrapper } = mountLoaded({ showSurface: true })
    await wrapper.vm.$nextTick()

    pinch(wrapper, [
      [1, 40, 220],
      [2, 260, 100],
    ])
    await wrapper.vm.$nextTick()

    await wrapper.find('.mesh-stage__lock').trigger('click')
    const resting = meshOrientationPresets.rightFront
    expect(config.value.lockedAlpha).toBeCloseTo(resting.alpha, 6)
    expect(config.value.lockedBeta).toBeCloseTo(resting.beta, 6)
  })

  it('keeps the pan inside the stage, so the map cannot be dragged off the card', async () => {
    // Off the edge there is nothing on screen saying why, and the chip that
    // undoes it is only there because a pan happened.
    stubCanvas()
    const { config, wrapper } = mountLoaded({ showSurface: true })
    await wrapper.vm.$nextTick()

    pinch(
      wrapper,
      [
        [1, 5_000, 5_000],
        [2, 5_100, 5_000],
      ],
      [
        [1, 0, 0],
        [2, 100, 0],
      ],
    )
    await wrapper.vm.$nextTick()

    await wrapper.find('.mesh-stage__lock').trigger('click')
    // The stubbed stage is 360 x 240, and the limit is three quarters of it.
    expect(config.value.lockedPanX).toBeCloseTo(270, 6)
    expect(config.value.lockedPanY).toBeCloseTo(180, 6)
  })

  function orbitBy(
    wrapper: ReturnType<typeof mountModule>['wrapper'],
    clientX: number,
    clientY: number,
  ): void {
    const canvas = wrapper.find('.mesh-canvas--overlay').element
    canvas.setPointerCapture = () => undefined
    canvas.releasePointerCapture = () => undefined
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
        bubbles: true,
      }),
    )
    canvas.dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 1, clientX, clientY, bubbles: true }),
    )
    canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }))
  }

  it('saves the angle a lock is taken at, not the preset it started from', async () => {
    // An orbit is otherwise deliberately ephemeral, so locking is the only way
    // a chosen angle outlives the session. Writing the preset here instead of
    // the dragged angle would look right until the card was reloaded.
    const { config, wrapper } = mountLoaded({ showSurface: true })
    await wrapper.vm.$nextTick()
    orbitBy(wrapper, 50, 10)
    await wrapper.vm.$nextTick()

    await wrapper.find('.mesh-stage__lock').trigger('click')
    const resting = meshOrientationPresets.rightFront
    expect(config.value.locked).toBe(true)
    expect(config.value.lockedBeta).toBeCloseTo(resting.beta - 50 * 0.4, 6)
    expect(config.value.lockedAlpha).toBeCloseTo(resting.alpha + 10 * 0.4, 6)
    expect(wrapper.find('.mesh-stage__lock').attributes('aria-pressed')).toBe('true')
  })

  it('orbits past level to look up from underneath the bed', async () => {
    // A full orbit, not only the hemisphere above the bed — see `trigFor`.
    const { config, wrapper } = mountLoaded({ showSurface: true })
    await wrapper.vm.$nextTick()
    orbitBy(wrapper, 0, -200)
    await wrapper.vm.$nextTick()

    await wrapper.find('.mesh-stage__lock').trigger('click')
    const resting = meshOrientationPresets.rightFront
    expect(config.value.lockedAlpha).toBeCloseTo(resting.alpha - 200 * 0.4, 6)
    expect(config.value.lockedAlpha as number).toBeLessThan(0)
  })

  it('clamps the orbit at looking straight up, rather than flipping past it', async () => {
    const { config, wrapper } = mountLoaded({ showSurface: true })
    await wrapper.vm.$nextTick()
    orbitBy(wrapper, 0, -1000)
    await wrapper.vm.$nextTick()

    await wrapper.find('.mesh-stage__lock').trigger('click')
    expect(config.value.lockedAlpha).toBe(-90)
  })

  it('locks the viewer out of manipulation and gives the wheel back to the page', async () => {
    const { wrapper } = mountLoaded({
      showSurface: true,
      locked: true,
      lockedAlpha: 40,
      lockedBeta: 20,
    })
    await wrapper.vm.$nextTick()
    const overlay = wrapper.find('.mesh-canvas--overlay')
    expect(overlay.classes()).not.toContain('mesh-canvas--orbitable')
    // Touch has to be handed back with the wheel, or a lock that frees the
    // mouse still traps a finger against the card it cannot scroll past.
    expect(overlay.classes()).toContain('mesh-canvas--locked')

    orbitBy(wrapper, 90, 40)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mesh-stage__reset').exists()).toBe(false)

    const wheel = new WheelEvent('wheel', { deltaY: -200, bubbles: true, cancelable: true })
    overlay.element.dispatchEvent(wheel)
    expect(wheel.defaultPrevented).toBe(false)
  })

  it('claims the wheel again once unlocked', async () => {
    const { wrapper } = mountLoaded({ showSurface: true })
    await wrapper.vm.$nextTick()
    const wheel = new WheelEvent('wheel', { deltaY: -200, bubbles: true, cancelable: true })
    wrapper.find('.mesh-canvas--overlay').element.dispatchEvent(wheel)
    expect(wheel.defaultPrevented).toBe(true)
  })

  it('hands the view back as it was framed rather than snapping to the preset', async () => {
    const { config, wrapper } = mountLoaded({
      showSurface: true,
      locked: true,
      lockedAlpha: 33,
      lockedBeta: 12,
      lockedZoom: 1.6,
      lockedPanX: -48,
      lockedPanY: 12,
    })
    await wrapper.vm.$nextTick()
    // Nothing to reset while locked: there is no ephemeral view to discard.
    expect(wrapper.find('.mesh-stage__reset').exists()).toBe(false)

    await wrapper.find('.mesh-stage__lock').trigger('click')
    expect(config.value.locked).toBe(false)
    expect(wrapper.find('.mesh-stage__lock').attributes('aria-pressed')).toBe('false')
    // The whole framing carried over — angle, magnification and pan alike — so
    // the chip is the way back to the preset.
    expect(wrapper.find('.mesh-stage__reset').exists()).toBe(true)

    await wrapper.find('.mesh-stage__reset').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mesh-stage__reset').exists()).toBe(false)
  })

  it('takes the pan alone as reason enough for the reset chip', async () => {
    // The chip appeared for an orbit and a zoom but not for a pan, so a map
    // dragged off centre at the resting angle had no way back at all.
    stubCanvas()
    const { wrapper } = mountLoaded({ showSurface: false, lockedPanX: 0 })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mesh-stage__reset').exists()).toBe(false)

    // The flat map cannot be orbited, which is what makes it the case that
    // isolates the pan.
    pinch(wrapper, [
      [1, 140, 100],
      [2, 240, 100],
    ])
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.mesh-stage__reset').exists()).toBe(true)
    await wrapper.find('.mesh-stage__reset').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mesh-stage__reset').exists()).toBe(false)
  })

  it('keeps the angle through a lens change, and gives it up for a chosen preset', async () => {
    // Swapping the lens answers a different question from choosing an angle.
    // Resetting on both made the projection select feel like it spun the model
    // as well, undoing whatever the user had just lined up to look at.
    const { config, wrapper } = mountLoaded({ showSurface: true })
    await wrapper.vm.$nextTick()
    orbitBy(wrapper, 40, 15)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mesh-stage__reset').exists()).toBe(true)

    config.value = { ...config.value, projection: 'orthographic' }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mesh-stage__reset').exists()).toBe(true)

    config.value = { ...config.value, orientation: 'leftFront' }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mesh-stage__reset').exists()).toBe(false)
  })

  it('lets isometric through, because it is an angle wearing a lens name', async () => {
    // Equal foreshortening on all three axes is the whole of what the option
    // means, so a drag holding it off would make selecting it do nothing.
    const { config, wrapper } = mountLoaded({ showSurface: true })
    await wrapper.vm.$nextTick()
    orbitBy(wrapper, 40, 15)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mesh-stage__reset').exists()).toBe(true)

    config.value = { ...config.value, projection: 'isometric' }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mesh-stage__reset').exists()).toBe(false)
  })

  it('declines the orbit for a projection defined by its own angle', async () => {
    // Turning under the pointer and springing straight back is worse than not
    // turning: the drag would be overridden by the projection every frame.
    const { wrapper } = mountLoaded({ showSurface: true, projection: 'dimetric' })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mesh-canvas--overlay').classes()).not.toContain('mesh-canvas--orbitable')

    orbitBy(wrapper, 60, 20)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mesh-stage__reset').exists()).toBe(false)
  })

  it('lets a one-point view be dragged from face to face', async () => {
    // It only asks to be square-on, so the drag still chooses which face — and
    // snaps rather than being refused.
    const { wrapper } = mountLoaded({ showSurface: true, projection: 'onePoint' })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mesh-canvas--overlay').classes()).toContain('mesh-canvas--orbitable')

    orbitBy(wrapper, 200, 0)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mesh-stage__reset').exists()).toBe(true)
  })

  it('keeps the magnification through an isometric switch', async () => {
    // Releasing the zoom as well would be the same overreach in the other
    // direction: isometric names an angle, and says nothing about how close.
    const { config, wrapper } = mountLoaded({ showSurface: true })
    await wrapper.vm.$nextTick()
    const canvas = wrapper.find('.mesh-canvas--overlay').element
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -240, bubbles: true, cancelable: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mesh-stage__reset').exists()).toBe(true)

    config.value = { ...config.value, projection: 'isometric' }
    await wrapper.vm.$nextTick()
    // The chip survives on the zoom alone, which is what proves it was kept.
    expect(wrapper.find('.mesh-stage__reset').exists()).toBe(true)
  })

  /*
   * Given its own budget because it is expensive by nature, not because it is
   * slow by accident: proving the voyage tears itself down means simulating the
   * whole ten seconds, and at a mocked 16ms frame that is nearly seven hundred
   * turns of the renderer. It sat just under the 5s default, so it failed for
   * whoever next added tests anywhere in the suite and pushed the workers a
   * little harder — which is what happened.
   */
  it('sets sail when the console asks, and leaves nothing behind when it ends', async () => {
    // The whole safety property of the easter egg: it borrows the card for ten
    // seconds and changes nothing that outlives them. A voyage that wrote to
    // the module's configuration would survive a reload with no way to undo it.
    vi.useFakeTimers()
    const raf = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => setTimeout(() => callback(performance.now()), 16) as never)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle) => {
      clearTimeout(handle as unknown as NodeJS.Timeout)
    })

    const { bedMesh, config, wrapper } = mountLoaded({ showSurface: true })
    await wrapper.vm.$nextTick()
    const before = { ...config.value }

    bedMesh.requestVoyage()
    await wrapper.vm.$nextTick()
    expect(raf).toHaveBeenCalled()

    // Ten seconds of frames, then one more to notice it is over.
    await vi.advanceTimersByTimeAsync(11_000)
    await wrapper.vm.$nextTick()

    expect(config.value).toEqual(before)
    expect(wrapper.find('.mesh-stage').exists()).toBe(true)
    wrapper.unmount()
    vi.useRealTimers()
  }, 20_000)

  it('never sails a card that has no mesh to sail on', async () => {
    const { bedMesh, wrapper } = mountModule()
    await wrapper.vm.$nextTick()
    const raf = vi.spyOn(window, 'requestAnimationFrame')

    bedMesh.requestVoyage()
    await wrapper.vm.$nextTick()
    // There is no stage, no renderer, and nothing to draw on.
    expect(raf).not.toHaveBeenCalled()
  })

  it('holds the readout line open so the card does not jog as the pointer crosses it', async () => {
    const { wrapper } = mountLoaded()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mesh-readout').exists()).toBe(true)
    expect(wrapper.find('.mesh-readout').text()).toBe('')
  })

  it('says in words when the bed strays past the tolerance the user set', async () => {
    const { bedMesh, wrapper } = mountModule({ rangeWarning: 0.1 })
    loadMesh(bedMesh)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('past the 0.100 mm you set')

    bedMesh.probedMatrix = [
      [0.01, 0.02],
      [0.02, 0.03],
    ]
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).not.toContain('past the')
  })

  function setBedTarget(telemetry: ReturnType<typeof useTelemetryStore>, target: number): void {
    telemetry.readings.heater_bed = {
      objectName: 'heater_bed',
      name: 'heater_bed',
      kind: 'bed',
      temperature: target,
      target,
      power: 0.3,
      speed: null,
      isSettable: true,
    }
  }

  it('warns when the active profile was probed far from where the bed is heading now', async () => {
    const { bedMesh, telemetry, wrapper } = mountModule({ temperatureWarning: 5 })
    loadMesh(bedMesh)
    setBedTarget(telemetry, 60)
    bedMesh.recordCalibration(45)
    bedMesh.commitProfileTemperature('', 'default')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('probed at 45.0°C')
    expect(wrapper.text()).toContain('60.0°C')
  })

  it('stays quiet within the threshold, without a recorded temperature, or with the heater off', async () => {
    const { bedMesh, telemetry, wrapper } = mountModule({ temperatureWarning: 5 })
    loadMesh(bedMesh)
    await wrapper.vm.$nextTick()
    // No recorded temperature at all — the profile predates this feature.
    setBedTarget(telemetry, 60)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).not.toContain('recalibrate before')

    bedMesh.recordCalibration(58)
    bedMesh.commitProfileTemperature('', 'default')
    await wrapper.vm.$nextTick()
    // Within the threshold.
    expect(wrapper.text()).not.toContain('recalibrate before')

    setBedTarget(telemetry, 0)
    await wrapper.vm.$nextTick()
    // Heater off: no upcoming print to be wrong about.
    expect(wrapper.text()).not.toContain('recalibrate before')
  })

  it('lets the threshold be turned off entirely', async () => {
    const { bedMesh, telemetry, wrapper } = mountModule({ temperatureWarning: 0 })
    loadMesh(bedMesh)
    setBedTarget(telemetry, 90)
    bedMesh.recordCalibration(20)
    bedMesh.commitProfileTemperature('', 'default')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).not.toContain('recalibrate before')
  })

  it('repaints for every setting that changes the picture', async () => {
    // A setting missing from the module's redraw watch still reaches the canvas
    // on the next unrelated repaint, so it looks like it works and then does
    // not. The projection dropdown shipped that way once.
    //
    // Each is applied to a fresh card rather than to the one before it: with
    // the gradient already scaled to the mesh, changing the fixed limit is
    // correctly a no-op, and a cumulative run would read that as a defect.
    const visualSettings: Array<[string, unknown]> = [
      ['projection', 'orthographic'],
      ['renderStyle', 'bars'],
      ['orientation', 'leftFront'],
      ['zMax', 0.8],
      ['scaleToMesh', true],
      ['fixedLimit', 0.25],
      ['wireframe', false],
      ['showProbes', false],
      ['showProbedLayer', true],
      ['showFlatLayer', true],
      ['showMeshLayer', false],
    ]

    for (const [key, value] of visualSettings) {
      const paints = stubCanvas()
      const { config, wrapper } = mountLoaded()
      await wrapper.vm.$nextTick()
      const before = paints.length
      expect(before, 'the card never painted at all').toBeGreaterThan(0)

      config.value = { ...config.value, [key]: value }
      await wrapper.vm.$nextTick()
      expect(paints.length, `changing ${key} did not repaint the map`).toBeGreaterThan(before)
      wrapper.unmount()
      vi.restoreAllMocks()
    }
  })

  describe('following a live calibration', () => {
    /**
     * Five points: two finished rows (y=10, y=20) plus one point starting a
     * third (y=30). The third row's first point is what *proves* the second row
     * finished — `completedRows` only closes a row once a point from a
     * different Y arrives after it, so a sequence that stops at exactly two
     * rows leaves the second one still "in progress" by the same rule that
     * keeps the truly-open row from being drawn too early.
     */
    const twoFinishedRows = [
      'BED_MESH_CALIBRATE',
      'probe: at 10.000,10.000 bed will contact at z=1.000000',
      'probe: at 20.000,10.000 bed will contact at z=1.010000',
      // Walked back the other way, as Klipper's raster path does.
      'probe: at 20.000,20.000 bed will contact at z=1.030000',
      'probe: at 10.000,20.000 bed will contact at z=1.020000',
      'probe: at 10.000,30.000 bed will contact at z=1.050000',
    ]

    /** Rounded to the precision the console text itself carries, so the mean's
     * own floating-point noise doesn't make an exact-equality assertion flaky. */
    function rounded(matrix: number[][]): number[][] {
      return matrix.map((row) => row.map((value) => Math.round(value * 1e6) / 1e6))
    }

    /**
     * The defect this guards: the card only repainted on a pointer event —
     * orbiting or zooming — because nothing in the redraw watch depended on the
     * run. A point arriving over the console produced no visible change at all
     * until the user happened to touch the viewer.
     */
    it('repaints on its own as points arrive, without any pointer event', async () => {
      const paints = stubCanvas()
      const { gcodeConsole, wrapper } = mountModule({}, { liveProbing: true })
      await wrapper.vm.$nextTick()

      // The viewer itself only appears once there is a point to show — before
      // that there is nothing on the page for a redraw to reach.
      await say(gcodeConsole, 'BED_MESH_CALIBRATE')
      await say(gcodeConsole, 'probe: at 10.000,10.000 bed will contact at z=1.000000')
      await wrapper.vm.$nextTick()
      const afterFirstPoint = paints.length
      expect(afterFirstPoint, 'the first point did not open the viewer').toBeGreaterThan(0)

      // A second point on the same, still-open row: no layer changes, only the
      // marker — exactly the update the missing watch dependency dropped.
      await say(gcodeConsole, 'probe: at 20.000,10.000 bed will contact at z=1.010000')
      await wrapper.vm.$nextTick()

      expect(paints.length, 'a new point did not repaint the card on its own').toBeGreaterThan(
        afterFirstPoint,
      )
    })

    it('shows nothing yet with only a single, still-open row probed', async () => {
      const { gcodeConsole, wrapper } = mountModule({}, { liveProbing: true })
      await wrapper.vm.$nextTick()

      await say(gcodeConsole, 'BED_MESH_CALIBRATE')
      await say(gcodeConsole, 'probe: at 10.000,10.000 bed will contact at z=1.000000')
      await say(gcodeConsole, 'probe: at 20.000,10.000 bed will contact at z=1.010000')
      await wrapper.vm.$nextTick()

      expect(rendererInstances[0]?.layers.has('live')).toBe(false)
    })

    /**
     * The second complaint this fixes: the colour-filled surface between
     * points, appearing once there is something to interpolate between — two
     * finished rows — rather than waiting for the whole mesh to complete.
     */
    it('draws the colour-filled surface once a second row finishes', async () => {
      const { gcodeConsole, wrapper } = mountModule({}, { liveProbing: true })
      await wrapper.vm.$nextTick()

      for (const line of twoFinishedRows) await say(gcodeConsole, line)
      await wrapper.vm.$nextTick()

      const live = rendererInstances[0]?.layers.get('live')
      expect(live).toBeDefined()
      // The mean of all five points probed so far, subtracted out — the same
      // zero the point markers plot against, and the reason these are not the
      // raw trigger heights Klipper reported. The row still open (y=30) has no
      // row of its own in the matrix, but its point still moves the mean.
      expect(rounded(live!.matrix)).toEqual([
        [-0.022, -0.012],
        [-0.002, 0.008],
      ])
      expect(live!.area).toEqual({ minX: 10, maxX: 20, minY: 10, maxY: 20 })
    })

    it('draws nothing live once the finished mesh replaces the run', async () => {
      const { bedMesh, gcodeConsole, wrapper } = mountModule({}, { liveProbing: true })
      await wrapper.vm.$nextTick()

      for (const line of twoFinishedRows) await say(gcodeConsole, line)
      await wrapper.vm.$nextTick()
      expect(rendererInstances[0]?.layers.has('live')).toBe(true)

      loadMesh(bedMesh)
      await wrapper.vm.$nextTick()

      expect(rendererInstances[0]?.layers.has('live')).toBe(false)
    })

    it('never draws a live surface on the dashboard card, only on the page that asked for it', async () => {
      const { gcodeConsole, wrapper } = mountModule()
      await wrapper.vm.$nextTick()

      for (const line of twoFinishedRows) await say(gcodeConsole, line)
      await wrapper.vm.$nextTick()

      // Without `liveProbing`, `isFollowingRun` never turns on, `liveMarkers`
      // stays empty, the viewer never opens, and no renderer is ever created —
      // not merely one without a 'live' layer.
      expect(rendererInstances).toHaveLength(0)
    })

    /**
     * Klipper reports mesh_min/mesh_max as (0, 0) — not null — the instant
     * BED_MESH_CALIBRATE clears the previous mesh, on any printer that has ever
     * calibrated one before. A fallback keyed on "are these truthy" never
     * noticed the clearing, so the probed-points-so-far area (used to frame
     * the flat mosaic layer, among other things) was frozen at zero size for
     * every run on such a printer, not only a first-ever one.
     */
    it('takes the frame from live points once the mesh is cleared, even on a printer with mesh history', async () => {
      const { bedMesh, gcodeConsole, wrapper } = mountModule(
        { showFlatLayer: true },
        { liveProbing: true },
      )
      // A profile with no data of its own, so `flatMosaic` falls back to the
      // mesh matrix — see the layer's own comment — and its area is the same
      // `probedArea` this regression is actually about, without also flipping
      // `isActive` and taking the card off the live-points path being tested.
      bedMesh.probedMatrix = [
        [0, 0],
        [0, 0],
      ]
      // The bounds an earlier, real mesh left behind.
      bedMesh.meshMin = [10, 10]
      bedMesh.meshMax = [210, 210]
      await wrapper.vm.$nextTick()

      await say(gcodeConsole, 'BED_MESH_CALIBRATE')
      // Klipper's own clearing, reported as (0, 0) rather than removed.
      bedMesh.meshMin = [0, 0]
      bedMesh.meshMax = [0, 0]
      for (const line of twoFinishedRows.slice(1)) await say(gcodeConsole, line)
      await wrapper.vm.$nextTick()

      // The full extent probed so far, not only the rows finished enough to
      // interpolate between — the y=30 point is still "in progress" and has no
      // row of its own yet, but it is still a point that has been probed.
      expect(rendererInstances[0]?.layers.get('flatMosaic')?.area).toEqual({
        minX: 10,
        maxX: 20,
        minY: 10,
        maxY: 30,
      })
    })
  })

  it('keeps the height map describable without seeing it', async () => {
    const { bedMesh, wrapper } = mountModule({ showSurface: true })
    loadMesh(bedMesh)
    await wrapper.vm.$nextTick()

    // The overlay carries the accessible name for the pair; the WebGL canvas
    // beneath it is hidden, so the map is announced once rather than twice.
    const canvas = wrapper.find('.mesh-canvas--overlay')
    expect(canvas.attributes('role')).toBe('img')
    expect(canvas.attributes('aria-label')).toContain('Height map of bed mesh default')
    expect(wrapper.findAll('canvas')[0]?.attributes('aria-hidden')).toBe('true')
  })

  it('rebuilds the renderer against a fresh canvas after clearing and reloading the mesh', async () => {
    // The stage — and its WebGL canvas — sits behind `v-if="bedMesh.isActive"`,
    // so clearing the mesh destroys that canvas and loading one back in
    // creates a new one. A renderer left pointing at the old, now-detached
    // canvas draws every frame into a dead context: the card looks loaded but
    // the map never appears.
    const { bedMesh, wrapper } = mountModule({ showSurface: true })
    loadMesh(bedMesh)
    await wrapper.vm.$nextTick()
    expect(rendererInstances).toHaveLength(1)
    expect(wrapper.find('.mesh-stage').exists()).toBe(true)

    bedMesh.profileName = ''
    bedMesh.probedMatrix = []
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mesh-stage').exists()).toBe(false)
    expect(rendererInstances[0]?.disposed).toBe(true)

    loadMesh(bedMesh)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mesh-stage').exists()).toBe(true)
    // A second renderer bound to the new canvas, not the first one silently
    // left in place against a canvas that no longer exists.
    expect(rendererInstances).toHaveLength(2)
  })

  describe('the flat map', () => {
    it('crossfades mesh into the flat mosaic, and back, as the toggle switches', async () => {
      setReducedMotion(true)
      stubCanvas()
      const { config, wrapper } = mountLoaded()
      await wrapper.vm.$nextTick()

      const renderer = rendererInstances[0]
      expect(renderer?.lastDraws.get('mesh')?.opacity).toBeGreaterThan(0)
      expect(renderer?.lastDraws.get('flatMosaic')?.opacity ?? 0).toBe(0)

      config.value = { ...config.value, showSurface: false }
      await wrapper.vm.$nextTick()
      expect(renderer?.lastDraws.get('mesh')?.opacity).toBe(0)
      expect(renderer?.lastDraws.get('flatMosaic')?.opacity).toBeGreaterThan(0)

      config.value = { ...config.value, showSurface: true }
      await wrapper.vm.$nextTick()
      expect(renderer?.lastDraws.get('mesh')?.opacity).toBeGreaterThan(0)
      expect(renderer?.lastDraws.get('flatMosaic')?.opacity ?? 0).toBe(0)
    })

    /**
     * The bug this guards: `flatMosaic` used to be skipped whenever the 3D
     * render style was already `'mosaic'`, on the reasoning that a
     * mosaic-styled `mesh` layer looks the same — but skipping it also
     * removed the only thing that makes `mesh`/`probed` crossfade to zero in
     * 2D, so both stayed at full opacity there instead of yielding to the
     * probed-preferred flat reading the 2D view is supposed to force.
     */
    it('still crossfades to the flat mosaic in 2D when the render style is already mosaic', async () => {
      setReducedMotion(true)
      stubCanvas()
      const { wrapper } = mountLoaded({ showSurface: false, renderStyle: 'mosaic' })
      await wrapper.vm.$nextTick()

      const renderer = rendererInstances[0]
      expect(renderer?.lastDraws.get('mesh')?.opacity ?? 0).toBe(0)
      expect(renderer?.lastDraws.get('flatMosaic')?.opacity).toBeGreaterThan(0)
    })

    it('hides the level plane at once leaving 2D, and only reveals it once 3D has settled', async () => {
      // Reduced motion collapses the animation to its instant branch, so
      // "settled" and "started" are the same tick here — the state machine
      // this locks down is which of the two edges reveals and which hides,
      // not how long either takes to get there.
      setReducedMotion(true)
      stubCanvas()
      const { config, wrapper } = mountLoaded({ showFlatLayer: true })
      await wrapper.vm.$nextTick()

      const renderer = rendererInstances[0]
      expect(renderer?.lastDraws.get('flat')?.opacity).toBeGreaterThan(0)

      config.value = { ...config.value, showSurface: false }
      await wrapper.vm.$nextTick()
      expect(renderer?.lastDraws.get('flat')?.opacity).toBe(0)

      config.value = { ...config.value, showSurface: true }
      await wrapper.vm.$nextTick()
      expect(renderer?.lastDraws.get('flat')?.opacity).toBeGreaterThan(0)
    })

    it('spans the level plane over the whole bed, translucent, rather than the probed patch', async () => {
      stubCanvas()
      const { bedMesh, printer, wrapper } = mountLoaded({ showFlatLayer: true })
      printer.buildVolume.minimum = [0, 0, 0]
      printer.buildVolume.maximum = [300, 300, 300]
      await wrapper.vm.$nextTick()

      const flat = rendererInstances[0]?.layers.get('flat')
      expect(flat?.area).toEqual({ minX: 0, minY: 0, maxX: 300, maxY: 300 })
      expect(flat?.opacity).toBe(0.5)
      // The probed patch this mesh actually covers is smaller than the bed —
      // otherwise the two areas could coincide by accident and prove nothing.
      expect(flat?.area).not.toEqual({
        minX: bedMesh.meshMin?.[0],
        minY: bedMesh.meshMin?.[1],
        maxX: bedMesh.meshMax?.[0],
        maxY: bedMesh.meshMax?.[1],
      })
    })

    it('subdivides the level plane finely, rather than describing it with one giant quad', async () => {
      // Screen position is a nonlinear function of bed position under any
      // lens but orthographic, and the rasterizer only interpolates a
      // triangle's corners affinely — so one giant quad depth-tests wrong
      // against a finely subdivided mesh sharing the same scene, in a patch
      // that moves with the angle. `mesh` and `probed` are already fine
      // enough that this never showed on them; the level plane needs the
      // same treatment for the same reason, not a two-point rectangle.
      stubCanvas()
      const { wrapper } = mountLoaded({ showFlatLayer: true })
      await wrapper.vm.$nextTick()

      const flat = rendererInstances[0]?.layers.get('flat')
      expect(flat?.matrix.length ?? 0).toBeGreaterThan(10)
      expect(flat?.matrix[0]?.length ?? 0).toBeGreaterThan(10)
      // Flat in the one sense that matters: every reading is still zero.
      expect(flat?.matrix.flat().every((value) => value === 0)).toBe(true)
    })

    it('shows probed-point numbers in 2D even with "Show probed points" switched off', async () => {
      // Both mount resting in 2D, where the axis guides are faded all the way
      // out regardless of either setting — so any difference between the two
      // counts can only be the probed-point labels the switch would
      // otherwise gate, not the axis ticks it never touches.
      const switchOff = stubCanvas()
      const { wrapper: off } = mountLoaded({ showProbes: false, showSurface: false })
      await off.vm.$nextTick()

      const switchOn = stubCanvas()
      const { wrapper: on } = mountLoaded({ showProbes: true, showSurface: false })
      await on.vm.$nextTick()

      expect(switchOff.texts.length).toBeGreaterThan(0)
      expect(switchOff.texts.length).toBe(switchOn.texts.length)
    })
  })
})

describe('the viewpoint transition', () => {
  it('runs for exactly as long as the motion token says', () => {
    // The animation is driven in TypeScript rather than CSS, so nothing else
    // keeps the two in step. ADR 0004 records 500 ms as a bounded exception;
    // this fails if either side is changed alone.
    const root = resolve(__dirname, '../../../..')
    const styles = readFileSync(resolve(root, 'styles/components.css'), 'utf8')
    const module = readFileSync(
      resolve(root, 'components/dashboard/modules/BedMeshModule.vue'),
      'utf8',
    )
    const token = /--motion-duration-viewpoint:\s*(\d+)ms/.exec(styles)?.[1]
    const constant = /const viewpointDuration = (\d+)/.exec(module)?.[1]

    expect(token).toBe('500')
    expect(constant).toBe(token)
  })
})
