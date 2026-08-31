import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFarmExpansion } from '@/composables/useFarmExpansion'
import { emptyFarmSnapshot } from '@/farm/types'
import { i18n } from '@/i18n'
import { useFarmStore } from '@/stores/farm'
import { useMoonrakerStore } from '@/stores/moonraker'

/**
 * The rail's two sizes and what separates them.
 *
 * The geometry lives in `main.css`, so what is asserted here is what the markup
 * promises: the machine controls are on a collapsed column, expanding adds the
 * preview and the queue layer, homing obeys the same job-loaded rule the
 * Movement card documents, and the size is remembered per printer.
 */

enableAutoUnmount(afterEach)

let pinia: Pinia
let realWebSocket: typeof WebSocket

const routerPush = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush }),
}))

beforeAll(() => {
  const dialogPrototype = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>
  if (typeof dialogPrototype.showModal !== 'function') {
    dialogPrototype.showModal = function showModal(this: HTMLDialogElement): void {
      this.open = true
    }
    dialogPrototype.close = function close(this: HTMLDialogElement): void {
      this.open = false
    }
  }
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
})

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem(
    'alabaster.printers.v1',
    JSON.stringify({
      version: 1,
      activeId: 'printer',
      entries: [
        { id: 'printer', label: 'Workshop', endpoint: 'ws://active.local:7125/websocket' },
        { id: 'printer-2', label: 'Voron', endpoint: 'ws://voron.local:7125/websocket' },
      ],
    }),
  )
  pinia = createPinia()
  setActivePinia(pinia)
  realWebSocket = globalThis.WebSocket
  globalThis.WebSocket = class {
    static readonly CONNECTING = 0
    readyState = 0
    close(): void {}
    send(): void {}
  } as unknown as typeof WebSocket
  useMoonrakerStore().connect('ws://active.local:7125/websocket')
  routerPush.mockClear()
  // Expansion is module-level state by design (a display preference with no
  // domain behind it), so it outlives a mount and has to be reset here.
  useFarmExpansion().collapseAll()
})

afterEach(() => {
  globalThis.WebSocket = realWebSocket
})

function labelsOf(
  column: { findAll: (selector: string) => Array<{ text: () => string }> } | undefined,
): string[] {
  return column?.findAll('button').map((button) => button.text()) ?? []
}

/** One connected column, for the tests that need controls to be live. */
function connectedColumn(state: 'paused' | 'standby' = 'paused') {
  return {
    id: 'printer-2',
    label: 'Voron',
    host: 'voron.local:7125',
    endpoint: 'ws://voron.local:7125/websocket',
    isActive: false,
    snapshot: {
      ...emptyFarmSnapshot(),
      connection: 'connected' as const,
      hasConnected: true,
      klipper: 'ready' as const,
      state,
      homedAxes: 'xyz',
      job:
        state === 'paused'
          ? {
              filename: 'bracket.gcode',
              progress: 0.4,
              printDuration: 100,
              totalDuration: 120,
              remainingSeconds: 200,
              currentLayer: 40,
              totalLayer: 100,
              thumbnailUrl: null,
            }
          : null,
    },
  }
}

async function mountView() {
  const { default: FarmView } = await import('@/views/FarmView.vue')
  const wrapper = mount(FarmView, { global: { plugins: [pinia, i18n] } })
  await flushPromises()
  return wrapper
}

describe('the farm rail', () => {
  it('renders one column per saved printer', async () => {
    const wrapper = await mountView()
    expect(wrapper.findAll('.farm-column')).toHaveLength(2)
    expect(wrapper.text()).toContain('Workshop')
    expect(wrapper.text()).toContain('Voron')
  })

  it('starts every column collapsed', async () => {
    const wrapper = await mountView()
    expect(wrapper.findAll('.farm-column--wide')).toHaveLength(0)
  })

  /*
   * The reason to have an emergency stop on this page at all is spotting a
   * crash on a machine nobody is driving, so it has to survive collapsing —
   * and it sits in the header rather than the dock, where it is in the same
   * place whatever else the column is showing.
   */
  it('keeps an emergency stop on a collapsed column', async () => {
    const wrapper = await mountView()
    const collapsed = wrapper.findAll('.farm-column')
    expect(collapsed).toHaveLength(2)
    for (const column of collapsed) {
      expect(column.classes()).not.toContain('farm-column--wide')
      expect(column.find('.farm-estop').exists()).toBe(true)
    }
  })

  /*
   * Collapsed acts on the machine in front of you; expanding adds the preview
   * and the queue layer — holding the line, dropping the next job. What must
   * never be true is that a collapsed column is a worse copy of an expanded
   * one, so the machine controls are asserted on both.
   */
  it('carries the machine controls at both sizes', async () => {
    const wrapper = await mountView()
    const column = wrapper.findAll('.farm-column')[1]
    expect(column?.find('.farm-dock__grid').exists()).toBe(true)
    expect(column?.find('.farm-home').exists()).toBe(true)
    expect(column?.find('.farm-preview').exists()).toBe(false)
    expect(labelsOf(column).some((label) => label === i18n.global.t('farm.holdQueue'))).toBe(false)

    await column?.find('.farm-column__chevron').trigger('click')

    const expanded = wrapper.findAll('.farm-column')[1]
    expect(expanded?.classes()).toContain('farm-column--wide')
    expect(expanded?.find('.farm-dock__grid').exists()).toBe(true)
    expect(expanded?.find('.farm-home').exists()).toBe(true)
    expect(expanded?.find('.farm-preview').exists()).toBe(true)
    expect(labelsOf(expanded).some((label) => label === i18n.global.t('farm.holdQueue'))).toBe(true)
  })

  /*
   * The Movement card refuses homing while a job is *loaded* — paused as well
   * as printing — because `G28 Z` drives the nozzle at a bed with a printed
   * part on it. A second surface offering the same command has to refuse it on
   * the same terms.
   */
  it('refuses homing on a machine with a job loaded', async () => {
    const farm = useFarmStore()
    vi.spyOn(farm, 'columns', 'get').mockReturnValue([connectedColumn()])

    const wrapper = await mountView()
    const home = wrapper.findAll('.farm-home button').map((button) => button.attributes('disabled'))

    expect(home.length).toBeGreaterThan(0)
    expect(home.every((disabled) => disabled !== undefined)).toBe(true)
  })

  /*
   * What keeps the two sizes one design rather than two: a collapsed column is
   * never missing information, only room.
   */
  it('shows the temperature rows at both sizes', async () => {
    const wrapper = await mountView()
    const column = wrapper.findAll('.farm-column')[1]
    expect(column?.find('.farm-temps').exists()).toBe(true)

    await column?.find('.farm-column__chevron').trigger('click')
    expect(wrapper.findAll('.farm-column')[1]?.find('.farm-temps').exists()).toBe(true)
  })

  /*
   * Choosing a file is the common act on a wall, and doing it by navigating to
   * Print files would switch the connection and lose the wall — the one thing
   * this page exists to keep. So it happens in a dialog, over that printer's
   * own gcodes root.
   */
  it('browses a printer file list without leaving the page', async () => {
    const farm = useFarmStore()
    // A connected column: every control is gated on a live connection, and the
    // stubbed socket in this file never opens one.
    vi.spyOn(farm, 'columns', 'get').mockReturnValue([connectedColumn()])
    const listFiles = vi.spyOn(farm, 'listFiles').mockResolvedValue([
      { path: 'benchy.gcode', modified: 1_700_000_000, size: 2_400_000 },
      { path: 'projects/bracket.gcode', modified: 1_699_000_000, size: 1_100_000 },
    ])

    const wrapper = await mountView()
    const files = wrapper
      .findAll('button')
      .find((button) => button.text() === i18n.global.t('farm.files.open'))
    await files?.trigger('click')
    await flushPromises()

    expect(listFiles).toHaveBeenCalledWith('printer-2')
    expect(wrapper.findAll('.farm-files__list li')).toHaveLength(2)
    expect(routerPush).not.toHaveBeenCalled()
  })

  /*
   * The failure this catches was silent and total: the column renders its
   * confirmation only while one is pending, so the dialog mounts with `open`
   * already true and a watcher on that prop never fires. Every guarded action
   * on every card — cancel, power, the emergency stop where it is confirmed —
   * put a closed `<dialog>` in the document and did nothing at all.
   */
  it('opens the confirmation a guarded card action asks for', async () => {
    const farm = useFarmStore()
    vi.spyOn(farm, 'columns', 'get').mockReturnValue([connectedColumn()])
    const cancel = vi.spyOn(farm, 'cancel').mockResolvedValue(true)

    const wrapper = await mountView()
    const button = wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === i18n.global.t('farm.cancel'))
    await button?.trigger('click')
    await flushPromises()

    const dialog = wrapper.find('dialog.confirm-dialog')
    expect(dialog.exists()).toBe(true)
    expect((dialog.element as HTMLDialogElement).open).toBe(true)
    expect(dialog.text()).toContain('Voron')
    // Asking is the whole point: nothing may have run yet.
    expect(cancel).not.toHaveBeenCalled()
  })

  it('remembers which columns were expanded', async () => {
    const wrapper = await mountView()
    await wrapper.findAll('.farm-column')[1]?.find('.farm-column__chevron').trigger('click')

    expect(JSON.parse(window.localStorage.getItem('alabaster.farm.expanded') ?? '[]')).toEqual([
      'printer-2',
    ])
  })

  /*
   * Switching and leaving are two actions, and both cards used to do both. The
   * reader is looking at the wall: the useful outcome of switching is that
   * Alabaster is now driving this machine, not that they have been moved.
   */
  it('switches the live connection without leaving the rail', async () => {
    const wrapper = await mountView()
    const moonraker = useMoonrakerStore()
    const selectPrinter = vi.spyOn(moonraker, 'selectPrinter')

    const buttons = wrapper.findAll('.farm-column')[1]?.findAll('button') ?? []
    const switchTo = buttons.find((button) => button.text() === i18n.global.t('farm.switch'))
    await switchTo?.trigger('click')

    expect(selectPrinter).toHaveBeenCalledWith('printer-2')
    expect(routerPush).not.toHaveBeenCalled()
  })

  it('leaves for the dashboard only from the card already being driven', async () => {
    const wrapper = await mountView()
    const moonraker = useMoonrakerStore()
    const selectPrinter = vi.spyOn(moonraker, 'selectPrinter')

    const buttons = wrapper.findAll('.farm-column')[0]?.findAll('button') ?? []
    const toDashboard = buttons.find((button) => button.text() === i18n.global.t('farm.openActive'))
    await toDashboard?.trigger('click')

    expect(routerPush).toHaveBeenCalledWith({ name: 'overview' })
    expect(selectPrinter).not.toHaveBeenCalled()
  })

  it('scrolls the rail with the arrow keys', async () => {
    const wrapper = await mountView()
    const rail = wrapper.find('.farm-rail')
    const element = rail.element as HTMLElement
    const scrollBy = vi.fn()
    element.scrollBy = scrollBy as unknown as HTMLElement['scrollBy']

    await rail.trigger('keydown', { key: 'ArrowRight' })
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: expect.any(Number) }))
  })
})
