import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import DashboardView from '@/views/DashboardView.vue'
import { dashboardModuleRegistry } from '@/dashboard/registry'
import { i18n } from '@/i18n'
import { useAvailabilityStore } from '@/stores/availability'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'
import { useMoonrakerStore } from '@/stores/moonraker'
import { useWebcamsStore } from '@/stores/webcams'

enableAutoUnmount(afterEach)

const sourceRoot = join(process.cwd(), 'src')

beforeAll(() => {
  // Forcing every module visible reaches Bed mesh, whose renderer already
  // tolerates jsdom's missing WebGL2 context and limps along with `renderer`
  // at null (see BedMeshModule.spec.ts) — but it still constructs a real
  // `ResizeObserver` unconditionally, which jsdom does not provide at all.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
})

async function mountDashboard() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useMoonrakerStore(pinia).connectionPhase = 'connected'
  useAvailabilityStore(pinia).moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })

  const wrapper = mount(DashboardView, {
    global: { plugins: [pinia, i18n], stubs: { RouterLink: true } },
    attachTo: document.body,
  })
  await flushPromises()

  // The Standard preset this profile starts from hides Spool, Bed mesh,
  // Extruder, Job queue and Maintenance — a module a preset hides is a module
  // these shared-shape assertions never rendered. jsdom's default 1024px
  // width resolves to the 'desktop' viewport (see dashboardViewportForWidth).
  // This has to run after mount, not before: DashboardView's own printer-scope
  // watcher fires on mount and rebuilds `profile` from storage, which would
  // silently discard a visibility change made any earlier.
  const layout = useDashboardLayoutStore(pinia)
  for (const module of dashboardModuleRegistry) {
    layout.setVisible('desktop', module.id, true)
  }

  // Camera's promoted quick setting is its arrangement, which only means
  // something with more than one camera on the card — so a Camera card without
  // two of them correctly has no layer to disclose and its gear opens the
  // settings surface instead. These assertions are about the layer's shared
  // shape, so the card is given the two cameras that give it one.
  useWebcamsStore(pinia).webcams = ['Chamber', 'Nozzle'].map((name) => ({
    uid: name.toLowerCase(),
    name,
    service: 'mjpegstreamer',
    enabled: true,
    stream_url: `/webcam/${name}?action=stream`,
    snapshot_url: `/webcam/${name}?action=snapshot`,
  }))
  layout.updateConfig('camera', { cameras: ['chamber', 'nozzle'] })
  await flushPromises()

  return wrapper
}

/*
 * These are about the parts every module shares, not about any one module. A
 * module that hand-rolls its disclosure layer looks right the day it is written
 * and is then left behind by the next change to the shared one — so the
 * assertions run across every registered module rather than against a named
 * card.
 */
describe('module disclosure', () => {
  it('names both settings components for every module with a disclosure layer', () => {
    /*
     * The layer always ends with a link into the surface, so a module with a
     * layer and no pane sends the user to an empty half-screen. And docking
     * withdraws the card's gear, so a module whose quick settings the registry
     * does not name loses them for as long as the surface is open.
     */
    const withLayer = dashboardModuleRegistry.filter((module) => module.hasSettings)
    expect(withLayer.length).toBeGreaterThan(0)
    for (const module of withLayer) {
      expect(module.quickSettingsComponent, `${module.id} quick settings`).toBeDefined()
      expect(module.settingsComponent, `${module.id} settings pane`).toBeDefined()
    }
  })

  /*
   * The registry names a module's quick-settings component, but the *card* gets
   * its rows from the module filling `AppDashboardModule`'s `quick-settings`
   * slot — the registry entry is what the settings surface repeats above the
   * pane. A module that names the component and never renders it therefore
   * passes every other check here and opens a layer containing nothing but its
   * heading and the link out. Camera shipped exactly that.
   */
  it('renders its quick settings on the card, not only in the surface', () => {
    const modules = dashboardModuleRegistry.filter((module) => module.quickSettingsComponent)
    expect(modules.length).toBeGreaterThan(0)

    for (const module of modules) {
      const name = `${module.id.charAt(0).toUpperCase()}${module.id.slice(1)}Module.vue`
      const source = readFileSync(
        join(sourceRoot, 'components', 'dashboard', 'modules', name),
        'utf8',
      )
      expect(source, `${module.id} never fills the quick-settings slot`).toContain(
        '#quick-settings',
      )
    }
  })

  it('collapses every card body through the shared reveal', async () => {
    const wrapper = await mountDashboard()

    const cards = wrapper.findAll('.dashboard-module')
    expect(cards.length).toBeGreaterThan(0)
    for (const card of cards) {
      const body = card.find('.dashboard-module__body')
      expect(body.element.parentElement?.classList.contains('disclosure-reveal__clip')).toBe(true)
    }
  })

  it('ends every settings layer with the link to the surface', async () => {
    const wrapper = await mountDashboard()

    const cards = wrapper
      .findAll('.dashboard-module')
      .filter((card) => card.find('.dashboard-module__quick-controls [aria-pressed]').exists())
    expect(cards.length).toBeGreaterThan(0)

    for (const card of cards) {
      await card.get('.dashboard-module__quick-controls [aria-pressed]').trigger('click')
      await flushPromises()

      const panel = card.get('.module-settings')
      expect(panel.element.parentElement?.classList.contains('disclosure-reveal__clip')).toBe(true)
      // Last, so it reads as the way out rather than as another setting.
      expect(panel.element.lastElementChild?.classList.contains('module-settings__link-row')).toBe(
        true,
      )
    }
  })

  it('insets every settings layer from the card edge, ambiently or explicitly', async () => {
    /*
     * A layer gets its 1rem inset one of two ways: nested inside the card's own
     * padded wrapper, or carrying `module-settings--inset` when the card's body
     * has no padding of its own (Print, Console — see settings-surface.md). A
     * panel that is neither — a direct child of `.dashboard-module__body`,
     * which carries no padding of its own, without the class — lands flush
     * against the card edge instead. SpoolModule shipped exactly that shape
     * before it was caught by eye; this is the version of that check that does
     * not depend on eyes.
     */
    const wrapper = await mountDashboard()

    const cards = wrapper
      .findAll('.dashboard-module')
      .filter((card) => card.find('.dashboard-module__quick-controls [aria-pressed]').exists())
    expect(cards.length).toBeGreaterThan(0)

    for (const card of cards) {
      await card.get('.dashboard-module__quick-controls [aria-pressed]').trigger('click')
      await flushPromises()

      const panel = card.get('.module-settings')
      const body = card.get('.dashboard-module__body').element
      // .module-settings sits inside DisclosureReveal's own wrapper elements
      // (and, under test-utils' transition stub, one more on top of those); the
      // element that actually carries the card's inset is wherever the module's
      // own template placed `<ModuleSettingsPanel>`, somewhere above all of
      // them and below the card body itself.
      let insetAmbiently = false
      for (
        let node = panel.element.parentElement;
        node && node !== body;
        node = node.parentElement
      ) {
        if (/\bp[xylrtb]?-\d/.test(node.className)) {
          insetAmbiently = true
          break
        }
      }

      const insetExplicitly = panel.classes('module-settings--inset')
      expect(
        insetExplicitly || insetAmbiently,
        `${card.attributes('data-instance-id')}: settings panel has no inset, ambient or explicit`,
      ).toBe(true)
    }
  })
})
