import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsSurface from '@/components/dashboard/SettingsSurface.vue'
import DashboardView from '@/views/DashboardView.vue'
import { i18n } from '@/i18n'
import { useAvailabilityStore } from '@/stores/availability'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'
import { useMoonrakerStore } from '@/stores/moonraker'

enableAutoUnmount(afterEach)

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

  /*
   * These tests are about where the card ends up, not how it gets there. jsdom
   * fires no transitionend, so an animated move would sit out its timeout on
   * every assertion; reporting reduced motion makes the swap synchronous. The
   * fades have their own spec.
   */
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
})

function mountDashboard() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const moonraker = useMoonrakerStore(pinia)
  moonraker.connectionPhase = 'connected'
  useAvailabilityStore(pinia).moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })

  const wrapper = mount(DashboardView, {
    global: { plugins: [pinia, i18n], stubs: { RouterLink: true } },
    attachTo: document.body,
  })
  return { wrapper, layout: useDashboardLayoutStore(pinia) }
}

function movementCard(wrapper: ReturnType<typeof mountDashboard>['wrapper']) {
  return wrapper.findAll('.dashboard-module').find((card) => card.get('h2').text() === 'Movement')
}

/**
 * The empty shell in the Movement card's dashboard slot, which is there for
 * the whole span of its settings surface — including both fades, where it
 * sits behind the card rather than instead of it.
 */
function movementShell(wrapper: ReturnType<typeof mountDashboard>['wrapper']) {
  return wrapper.find('.module-placeholder')
}

async function openMovementSurface(wrapper: ReturnType<typeof mountDashboard>['wrapper']) {
  const card = movementCard(wrapper)
  await card?.get('[aria-label="Movement settings"]').trigger('click')
  await flushPromises()
  await card?.get('.module-settings__link-row button').trigger('click')
  await flushPromises()
}

describe('settings surface', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('docks the card and holds its place in the column', async () => {
    const { wrapper } = mountDashboard()
    await flushPromises()

    expect(movementShell(wrapper).exists()).toBe(false)
    await openMovementSurface(wrapper)

    // The card is now inside the dialog rather than its column.
    const dialog = wrapper.get('dialog.settings-surface')
    expect(dialog.find('.dashboard-module').exists()).toBe(true)
    expect((dialog.element as HTMLDialogElement).open).toBe(true)

    // And its slot keeps a hollow shell, so nothing below it moves.
    // Empty rather than labelled: it reads as the card's own content having
    // faded to nothing, not as a second, differently-shaped box.
    const shell = movementShell(wrapper)
    expect(shell.attributes('aria-hidden')).toBe('true')
    expect(shell.text()).toBe('')
  })

  /*
   * The point of the shell, and the part an "exists while docked" check misses
   * entirely: it has to be in the slot *before* the card starts fading out and
   * still there *after* it has faded back in, because the card fades onto it
   * and back off it. A shell that only spanned the docked period would leave
   * the card fading against bare canvas at both ends, which is the whole
   * module going rather than its contents.
   */
  it('is in the slot for the whole round trip, not only while the card is away', async () => {
    const { wrapper } = mountDashboard()
    await flushPromises()
    const card = movementCard(wrapper)

    // Reduced motion is reported in these tests, so the move is synchronous
    // and the fades do not run — what is asserted here is the shell's span in
    // terms of the moves it brackets, which is the part that is not timing.
    await card?.get('[aria-label="Movement settings"]').trigger('click')
    await flushPromises()
    await card?.get('.module-settings__link-row button').trigger('click')
    expect(movementShell(wrapper).exists()).toBe(true)

    await flushPromises()
    expect(movementShell(wrapper).exists()).toBe(true)

    await wrapper.get('dialog.settings-surface [aria-label="Close settings"]').trigger('click')
    await flushPromises()
    // Down only once the card is home and opaque again.
    expect(movementShell(wrapper).exists()).toBe(false)
  })

  it('moves the card rather than re-creating it, so its state survives', async () => {
    const { wrapper } = mountDashboard()
    await flushPromises()

    // Local component state, held by the module and not by any store — the
    // one thing a second mounted instance would silently drop.
    const card = movementCard(wrapper)
    const input = card?.find('input[type="checkbox"]')
    void input

    const before = movementCard(wrapper)?.element
    await openMovementSurface(wrapper)
    const after = wrapper.get('dialog.settings-surface .dashboard-module').element

    expect(after).toBe(before)
  })

  it('carries availability into the dock, so a docked card cannot outlive its printer', async () => {
    const { wrapper } = mountDashboard()
    await flushPromises()
    await openMovementSurface(wrapper)

    const region = wrapper.get('dialog.settings-surface .availability-region')
    expect(region.find('.dashboard-module').exists()).toBe(true)

    useAvailabilityStore().handleKlipperNotification('notify_klippy_shutdown')
    await flushPromises()

    expect(region.get('.availability-region__content').attributes('inert')).toBeDefined()
  })

  it('returns the card to its column when the surface closes', async () => {
    const { wrapper } = mountDashboard()
    await flushPromises()
    await openMovementSurface(wrapper)

    await wrapper.get('dialog.settings-surface [aria-label="Close settings"]').trigger('click')
    await flushPromises()

    expect(movementShell(wrapper).exists()).toBe(false)
    expect(wrapper.find('dialog.settings-surface .dashboard-module').exists()).toBe(false)
    expect(movementCard(wrapper)?.exists()).toBe(true)
  })

  it('stacks when the card is too wide to leave the pane a readable measure', async () => {
    const { wrapper } = mountDashboard()
    await flushPromises()

    // jsdom reports 0 for every rect, so the dock width lands null — which is
    // itself the "cannot fit" case and must stack rather than squeeze.
    await openMovementSurface(wrapper)
    expect(wrapper.get('dialog.settings-surface').classes()).toContain('settings-surface--stacked')
  })

  it('sizes the placeholder to the card without its disclosure layer', async () => {
    const { wrapper } = mountDashboard()
    await flushPromises()
    const card = movementCard(wrapper)

    // jsdom reports no layout, so the heights are scripted: a 675px card whose
    // open disclosure accounts for 181px must leave a 494px hole.
    card!.element.getBoundingClientRect = () => ({ height: 675, width: 305 }) as DOMRect
    await card?.get('[aria-label="Movement settings"]').trigger('click')
    await flushPromises()
    const reveal = card!.element.querySelector('.module-settings')?.closest('.disclosure-reveal')
    if (reveal) reveal.getBoundingClientRect = () => ({ height: 181, width: 305 }) as DOMRect

    await card?.get('.module-settings__link-row button').trigger('click')
    await flushPromises()

    // Subtracted up front rather than measured after the collapse animates,
    // so the column never shows a height the card is about to leave behind.
    expect(movementShell(wrapper).attributes('style')).toContain('height: 494px')
  })

  it('closes the card disclosure layer, so one module is not configurable in two places', async () => {
    const { wrapper } = mountDashboard()
    await flushPromises()
    await openMovementSurface(wrapper)

    expect(wrapper.find('.module-settings').exists()).toBe(false)
  })

  /**
   * Movement has adopted per-setting promotion, so the pane already renders
   * every quick-eligible row once, in its own section, each carrying the pin
   * that decides whether it is also quick. Repeating them under a "Shown on
   * the card" heading would put the same control on screen twice with nothing
   * to say which is authoritative — the regression the first version of that
   * feature shipped. See `docs/design/settings-surface.md`.
   */
  it('does not mirror the card’s settings for a module that pins them in place', async () => {
    const { wrapper } = mountDashboard()
    await flushPromises()
    await openMovementSurface(wrapper)

    const pane = wrapper.get('.settings-surface__content')
    expect(pane.text()).not.toContain('Shown on the card')
    expect(pane.findAll('[aria-label*="quick settings"]').length).toBeGreaterThan(0)

    // Each promotable row appears exactly once.
    const parkRows = pane
      .findAll('.settings-row')
      .filter((row) => row.text().includes('Show park positions'))
    expect(parkRows).toHaveLength(1)

    // And the gear itself is gone from the docked card.
    const card = wrapper.get('dialog.settings-surface .dashboard-module')
    expect(card.find('[aria-label="Movement settings"]').exists()).toBe(false)
  })

  /** Every shipped module has adopted promotion, so none of them mirrors. */
  it('mirrors nothing for any module on the dashboard', async () => {
    const { wrapper } = mountDashboard()
    await flushPromises()

    for (const title of ['Print', 'Temperatures', 'Movement', 'Controls', 'Bed mesh', 'Console']) {
      const card = wrapper
        .findAll('.dashboard-module')
        .find((entry) => entry.get('h2').text() === title)
      await card?.get(`[aria-label="${title} settings"]`).trigger('click')
      await flushPromises()
      await card?.get('.module-settings__link-row button').trigger('click')
      await flushPromises()

      expect(wrapper.get('.settings-surface__content').text(), title).not.toContain(
        'Shown on the card',
      )
      await wrapper.get('[aria-label="Close settings"]').trigger('click')
      await flushPromises()
    }
  })

  /**
   * The mirror itself stays, for a module added later that has not adopted
   * per-setting promotion: its quick settings would be fixed, and docking
   * withdraws the gear that is otherwise the only way to reach them. No module
   * exercises it through `DashboardView` any more, so it is guarded here
   * instead of rotting away silently.
   */
  it('mirrors a fixed quick layer when one is handed to it', () => {
    const wrapper = mount(SettingsSurface, {
      props: {
        instanceId: 'legacy',
        moduleId: 'print',
        title: 'Legacy',
        icon: null,
        requires: 'moonraker',
        quickSettingsComponent: {
          template: '<label class="check-row"><input type="checkbox" /><span>Fixed</span></label>',
        },
        settingsComponent: null,
        dockWidth: null,
        stacked: false,
      },
      global: { plugins: [createPinia(), i18n] },
    })

    const quick = wrapper.get('.settings-surface__content .surface-section')
    expect(quick.get('.surface-section__title').text()).toBe('Shown on the card')
    expect(quick.find('input[type="checkbox"]').exists()).toBe(true)
  })
})

describe('switching between sibling instances of one module', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  /**
   * A `supportsMultiple` module's pane can move the surface to a sibling
   * instance without the user closing and reopening it by hand — Macros'
   * group switcher. `settings-surface.md`'s "one card at a time" still holds
   * throughout: the previous instance is fully undocked before the next one
   * docks, never two cards docked at once. But the surface itself — the
   * `<dialog>` and its backdrop — never closes for this: an earlier version
   * ran `closeSurface` then `openSurface` back to back, which cleared
   * `surfaceOpenInstanceId` to `null` on the way home and so closed the whole
   * surface around every switch, reappearing as the dashboard flashing back
   * into view mid-switch.
   */
  it('docks the sibling instance the pane asked for, and only that one', async () => {
    const { wrapper, layout } = mountDashboard()
    await flushPromises()
    layout.duplicateInstance('desktop', 'macros', { emptyConfig: true })
    layout.renameInstance('macros-2', 'Bed prep')
    await flushPromises()

    const macrosCards = () =>
      wrapper.findAll('.dashboard-module').filter((card) => card.get('h2').text() === 'Macros')
    const original = macrosCards()[0]
    await original?.get('[aria-label="Macros settings"]').trigger('click')
    await flushPromises()
    await original?.get('.module-settings__link-row button').trigger('click')
    await flushPromises()

    expect(wrapper.get('dialog.settings-surface').text()).toContain('Macros settings')
    expect((wrapper.get('dialog.settings-surface').element as HTMLDialogElement).open).toBe(true)

    const closeSpy = vi.spyOn(window.HTMLDialogElement.prototype, 'close')
    const sibling = wrapper
      .get('.macro-groups')
      .findAll('button')
      .find((chip) => chip.text() === 'Bed prep')
    await sibling!.trigger('click')
    await flushPromises()

    // The header now names the sibling, and only one card sits in the dock.
    expect(wrapper.get('dialog.settings-surface').text()).toContain('Bed prep settings')
    expect(wrapper.get('dialog.settings-surface').findAll('.dashboard-module')).toHaveLength(1)
    // The dialog itself was never asked to close for the switch — it stayed
    // open, backdrop and all, the whole time.
    expect(closeSpy).not.toHaveBeenCalled()
    expect((wrapper.get('dialog.settings-surface').element as HTMLDialogElement).open).toBe(true)
    closeSpy.mockRestore()
  })
})

describe('the dock', () => {
  /*
   * The end the card fades *in* at gets no shell of its own. One was tried and
   * removed: a box that appears under the arriving card for the length of the
   * fade and is taken away again blinks, which is the opposite of the effect
   * the shell in the dashboard slot is there to produce.
   */
  it('holds nothing but the card — the shell belongs at the end the card left', () => {
    const wrapper = mount(SettingsSurface, {
      props: {
        instanceId: null,
        moduleId: null,
        title: '',
        icon: null,
        requires: 'moonraker',
        quickSettingsComponent: null,
        settingsComponent: null,
        dockWidth: null,
        stacked: false,
      },
      global: { plugins: [i18n] },
    })
    expect(wrapper.get('.settings-surface__dock-target').element.children).toHaveLength(0)
  })
})
