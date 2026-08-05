import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { dashboardModuleRegistry, type DashboardModuleDefinition } from '@/dashboard/registry'
import { i18n } from '@/i18n'

enableAutoUnmount(afterEach)

beforeAll(() => {
  // Two panes mount a confirm or prompt dialog, and jsdom ships <dialog>
  // without its modal methods.
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

const withPane = dashboardModuleRegistry.filter((module) => module.settingsComponent)

/**
 * Mounted without a dashboard context on purpose. `useDashboardModule` falls
 * back to local state outside a card, which is exactly the never-customized
 * instance these assertions are about — no stored `quickSettings` key, so every
 * module reads its declared defaults.
 */
function mountPane(module: DashboardModuleDefinition) {
  setActivePinia(createPinia())
  return mount(module.settingsComponent!, { global: { plugins: [i18n] } })
}

/*
 * These are about the shape every settings pane shares, not about any one
 * module's settings. A pane that hand-rolls its own headings and rules looks
 * right the day it is written and is then left behind by the next change to the
 * shared ones — so the assertions run across whatever the registry declares
 * rather than against a named pane.
 */
describe('module settings panes', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('lets the user promote settings from every module that has a card layer', () => {
    /*
     * A module with a fixed quick layer cannot be customized at all, and the
     * settings surface then has to mirror that layer above its pane so docking
     * does not put the rows out of reach. Every shipped module names its
     * defaults instead, so nothing is mirrored and no row is ever on screen
     * twice. See `docs/design/settings-surface.md`.
     */
    const withLayer = dashboardModuleRegistry.filter((module) => module.hasSettings)
    expect(withLayer.length).toBeGreaterThan(0)
    for (const module of withLayer) {
      expect(module.quickSettingsDefaultKeys, `${module.id} default quick keys`).toBeDefined()
      expect(
        module.quickSettingsDefaultKeys?.length,
        `${module.id} default quick keys`,
      ).toBeGreaterThan(0)
    }
  })

  it('offers the pin on a row of every pane, and never mirrors one above it', () => {
    for (const module of withPane) {
      const pane = mountPane(module)
      expect(
        pane.findAll('[aria-label*="quick settings"]').length,
        `${module.id} promotable rows`,
      ).toBeGreaterThan(0)
      // The pane holds every setting exactly once. "Shown on the card" is the
      // mirror's heading, and a mirror plus a pinned row is the same control
      // twice with nothing to say which is authoritative.
      expect(pane.text(), `${module.id} mirror`).not.toContain('Shown on the card')
    }
  })

  it('gives every section a heading and every section but the first a rule', () => {
    /*
     * The rule separates one section from the one above it, so the section that
     * renders first must not draw one — it would land against the top of the
     * panel and divide nothing from nothing. This is the assertion that catches
     * a conditional section disappearing and leaving the next one ruled off.
     */
    for (const module of withPane) {
      const pane = mountPane(module)
      const sections = pane.findAll('.surface-section')
      expect(sections.length, `${module.id} sections`).toBeGreaterThan(0)

      sections.forEach((section, index) => {
        expect(
          section.find('.surface-section__title').exists(),
          `${module.id} section ${index} heading`,
        ).toBe(true)
        expect(
          section.classes('surface-section--divided'),
          `${module.id} section ${index} rule`,
        ).toBe(index > 0)
      })
    }
  })

  it('builds every row from the one settings row, with nothing nested inside it', () => {
    /*
     * `.settings-row` is the row — see "The row every setting is built from" in
     * `docs/design/settings-surface.md`. The two classes it replaced are the
     * ways a pane used to build one for itself: `.surface-field`, a wrapping
     * flex row that dropped the pin to a line of its own as soon as a label
     * wrapped, and `.module-settings__row`, a second flex row nested inside the
     * first that carried a different label type than the panes beside it.
     * Neither exists in `main.css` any more, so a pane reintroducing either
     * would render an unstyled row rather than fail visibly.
     */
    for (const module of withPane) {
      const pane = mountPane(module)
      expect(pane.findAll('.surface-field'), `${module.id} legacy row`).toHaveLength(0)
      expect(pane.findAll('.module-settings__row'), `${module.id} nested row`).toHaveLength(0)

      // Every pin sits in a row, or it has nothing holding it against the
      // trailing edge.
      for (const pin of pane.findAll('[aria-label*="quick settings"]')) {
        expect(
          pin.element.closest('.settings-row'),
          `${module.id} pin outside a row`,
        ).not.toBeNull()
      }
    }
  })

  it('never leaves an independent checkbox setting as a bare check row', () => {
    /*
     * A stack of independent settings under its own heading — the reset-on-finish
     * choices, every module's confirmations — sat five times tighter than the
     * rows above it when each was a bare `.check-row`. The bare row is reserved
     * for the alternatives of a *single* setting, where the tighter seam is
     * right because the group reads as one block: a `.check-set`'s members, and
     * radio groups such as Print's estimate sources. So the rule is scoped to
     * checkboxes outside a check set.
     */
    for (const module of withPane) {
      const pane = mountPane(module)
      for (const row of pane.findAll('.check-row')) {
        if (!row.find('input[type="checkbox"]').exists()) continue
        if (row.element.closest('.check-set')) continue
        expect(
          row.element.closest('.settings-row'),
          `${module.id} bare checkbox row: ${row.text()}`,
        ).not.toBeNull()
      }
    }
  })

  it('writes every sub-heading with the shared class rather than a utility string', () => {
    // Three panes had each spelled this out as `mt-3 text-xs font-black` or
    // `mt-4 text-xs font-black` and disagreed about the margin.
    for (const module of withPane) {
      const pane = mountPane(module)
      expect(pane.html(), `${module.id} sub-heading`).not.toMatch(
        /class="[^"]*\bmt-\d+ text-xs font-black\b/,
      )
    }
  })
})
