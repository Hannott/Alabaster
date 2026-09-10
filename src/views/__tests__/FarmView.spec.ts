import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { emptyFarmSnapshot } from '@/farm/types'
import { i18n } from '@/i18n'
import { useFarmStore } from '@/stores/farm'
import { useMoonrakerStore } from '@/stores/moonraker'

/**
 * What the farm grid's markup promises.
 *
 * The geometry is CSS, so what is asserted here is the card's contract: one
 * card per saved printer in the saved order, an emergency stop on every one of
 * them, job controls disabled rather than removed on a machine with nothing
 * loaded, homing refused while a job is loaded on the same terms the Movement
 * card documents, and the two things that must not navigate — choosing a file
 * and switching — not navigating.
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
})

afterEach(() => {
  globalThis.WebSocket = realWebSocket
})

/** One connected card, for the tests that need controls to be live. */
function connectedCard(state: 'paused' | 'standby' = 'paused') {
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
      queue: {
        state: 'ready' as const,
        jobs: [{ jobId: 'job-1', filename: 'next.gcode' }],
      },
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

/**
 * Everything the card does not keep on its own action row is one menu away, so
 * most of these tests have to open it first.
 */
async function openCardMenu(wrapper: Awaited<ReturnType<typeof mountView>>, printer: string) {
  const trigger = wrapper
    .findAll('.farm-card button')
    .find(
      (button) =>
        button.attributes('aria-label') === i18n.global.t('farm.moreActions', { printer }),
    )
  await trigger?.trigger('click')
  await flushPromises()
  return trigger
}

function menuItem(wrapper: Awaited<ReturnType<typeof mountView>>, label: string) {
  return wrapper.findAll('.header-menu__panel button').find((button) => button.text() === label)
}

describe('the farm grid', () => {
  it('renders one card per saved printer, in the saved order', async () => {
    const wrapper = await mountView()
    const cards = wrapper.findAll('.farm-card')

    expect(cards).toHaveLength(2)
    expect(cards.map((card) => card.attributes('aria-label'))).toEqual(['Workshop', 'Voron'])
  })

  /*
   * The reason to have an emergency stop on this page at all is spotting a
   * crash on a machine nobody is driving, so it is on every card and never
   * behind the menu — the one control that must not be a click away.
   */
  it('keeps an emergency stop on every card', async () => {
    const wrapper = await mountView()
    const cards = wrapper.findAll('.farm-card')

    expect(cards).toHaveLength(2)
    for (const card of cards) expect(card.find('.farm-estop').exists()).toBe(true)
  })

  /*
   * A control that moves position between states is how a wall of
   * near-identical cards produces a wrong click, so an idle machine greys its
   * job controls in place rather than dropping them.
   */
  it('disables the job controls on an idle machine rather than removing them', async () => {
    const farm = useFarmStore()
    vi.spyOn(farm, 'columns', 'get').mockReturnValue([connectedCard('standby')])

    const wrapper = await mountView()
    const actions = wrapper.findAll('.farm-actions button')
    const pause = actions.find((button) => button.text() === i18n.global.t('farm.pause'))
    const cancel = actions.find((button) => button.text() === i18n.global.t('farm.cancel'))

    expect(pause?.attributes('disabled')).toBeDefined()
    expect(cancel?.attributes('disabled')).toBeDefined()
  })

  /* Every card carries the same facts strip: only capability removes a cell. */
  it('shows the temperatures on every card', async () => {
    const wrapper = await mountView()
    const cards = wrapper.findAll('.farm-card')

    for (const card of cards) {
      expect(card.find('.farm-facts').exists()).toBe(true)
      expect(card.text()).toContain(i18n.global.t('farm.hotend'))
      expect(card.text()).toContain(i18n.global.t('farm.bed'))
    }
  })

  /*
   * The Movement card refuses homing while a job is *loaded* — paused as well
   * as printing — because `G28 Z` drives the nozzle at a bed with a printed
   * part on it. A second surface offering the same command has to refuse it on
   * the same terms, wherever that surface keeps it.
   */
  it('refuses homing on a machine with a job loaded', async () => {
    const farm = useFarmStore()
    vi.spyOn(farm, 'columns', 'get').mockReturnValue([connectedCard()])

    const wrapper = await mountView()
    await openCardMenu(wrapper, 'Voron')
    const home = menuItem(wrapper, i18n.global.t('farm.homeAll'))

    expect(home?.exists()).toBe(true)
    expect(home?.attributes('disabled')).toBeDefined()
  })

  /*
   * Choosing a file is the common act on a wall, and doing it by navigating to
   * Print files would switch the connection and lose the wall — the one thing
   * this page exists to keep. So it happens in a dialog, over that printer's
   * own gcodes root.
   */
  it('browses a printer file list without leaving the page', async () => {
    const farm = useFarmStore()
    // A connected card: every control is gated on a live connection, and the
    // stubbed socket in this file never opens one.
    vi.spyOn(farm, 'columns', 'get').mockReturnValue([connectedCard()])
    const listFiles = vi.spyOn(farm, 'listFiles').mockResolvedValue([
      { path: 'benchy.gcode', modified: 1_700_000_000, size: 2_400_000 },
      { path: 'projects/bracket.gcode', modified: 1_699_000_000, size: 1_100_000 },
    ])

    const wrapper = await mountView()
    await openCardMenu(wrapper, 'Voron')
    await menuItem(wrapper, i18n.global.t('farm.files.open'))?.trigger('click')
    await flushPromises()

    expect(listFiles).toHaveBeenCalledWith('printer-2')
    expect(wrapper.findAll('.farm-files__list li')).toHaveLength(2)
    expect(routerPush).not.toHaveBeenCalled()
  })

  /*
   * The card reduced the queue to a count, so the job list has to be somewhere:
   * the second tab of the same dialog, rather than the Job queue destination,
   * which would switch the connection to get there.
   */
  it('shows the printer queue beside its files', async () => {
    const farm = useFarmStore()
    vi.spyOn(farm, 'columns', 'get').mockReturnValue([connectedCard()])
    vi.spyOn(farm, 'listFiles').mockResolvedValue([])

    const wrapper = await mountView()
    await openCardMenu(wrapper, 'Voron')
    await menuItem(wrapper, i18n.global.t('farm.files.open'))?.trigger('click')
    await flushPromises()

    const queueTab = wrapper
      .findAll('.farm-files__tabs button')
      .find((button) => button.text().includes(i18n.global.t('farm.queue')))
    await queueTab?.trigger('click')

    expect(wrapper.find('.farm-files__queue').text()).toContain('next.gcode')
  })

  /*
   * The failure this catches was silent and total: the card renders its
   * confirmation only while one is pending, so the dialog mounts with `open`
   * already true and a watcher on that prop never fires. Every guarded action
   * on every card — cancel, power, the emergency stop where it is confirmed —
   * put a closed `<dialog>` in the document and did nothing at all.
   */
  it('opens the confirmation a guarded card action asks for', async () => {
    const farm = useFarmStore()
    vi.spyOn(farm, 'columns', 'get').mockReturnValue([connectedCard()])
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

  /*
   * Switching and leaving are two actions, and both cards used to do both. The
   * reader is looking at the wall: the useful outcome of switching is that
   * Alabaster is now driving this machine, not that they have been moved.
   */
  it('switches the live connection without leaving the page', async () => {
    const wrapper = await mountView()
    const moonraker = useMoonrakerStore()
    const selectPrinter = vi.spyOn(moonraker, 'selectPrinter')

    const buttons = wrapper.findAll('.farm-card')[1]?.findAll('button') ?? []
    const switchTo = buttons.find((button) => button.text() === i18n.global.t('farm.switch'))
    await switchTo?.trigger('click')

    expect(selectPrinter).toHaveBeenCalledWith('printer-2')
    expect(routerPush).not.toHaveBeenCalled()
  })

  it('leaves for the dashboard only from the card already being driven', async () => {
    const wrapper = await mountView()
    const moonraker = useMoonrakerStore()
    const selectPrinter = vi.spyOn(moonraker, 'selectPrinter')

    const buttons = wrapper.findAll('.farm-card')[0]?.findAll('button') ?? []
    const toDashboard = buttons.find((button) => button.text() === i18n.global.t('farm.openActive'))
    await toDashboard?.trigger('click')

    expect(routerPush).toHaveBeenCalledWith({ name: 'overview' })
    expect(selectPrinter).not.toHaveBeenCalled()
  })
})
