import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'

import ConsoleQuickSettings from '@/components/dashboard/modules/ConsoleQuickSettings.vue'
import ConsoleSettingsPane from '@/components/dashboard/modules/ConsoleSettingsPane.vue'
import { dashboardModuleContextKey } from '@/dashboard/context'
import { i18n } from '@/i18n'
import { useConsoleStore } from '@/stores/console'

function provideContext(stored: ReturnType<typeof ref<Record<string, unknown>>>) {
  return {
    [dashboardModuleContextKey as symbol]: {
      instanceId: 'console',
      moduleId: 'console',
      config: computed(() => stored.value ?? {}),
      updateConfig: (patch: Record<string, unknown>) => {
        stored.value = { ...stored.value, ...patch }
      },
      isSettingsOpen: computed(() => false),
      openSettings: () => undefined,
      closeSettings: () => undefined,
      isSurfaceOpen: computed(() => true),
      openSurface: () => undefined,
      closeSurface: () => undefined,
    },
  }
}

/**
 * The visible text of each option row. Both element names are matched because a
 * checkbox row labels itself with a `span` inside its `label`, while the slider
 * row's label is a `label` bound to the field by id.
 */
function rowLabels(html: string): string[] {
  return [...html.matchAll(/<(?:span|label)(?:\s[^>]*)?>([^<]+)<\/(?:span|label)>/g)].map(
    (match) => match[1] ?? '',
  )
}

describe('ConsoleSettingsPane', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('renders every row exactly once, in the section its subject matter puts it in', () => {
    // The pane is the only place a setting lives. It is not repeated under a
    // "Shown on the card" heading — the pin at the end of each row is what
    // says whether the card shows it too, and a second copy bound to the same
    // value would leave nothing to say which one is authoritative.
    const stored = ref<Record<string, unknown>>({})
    useConsoleStore().gcodeHelp = [{ command: 'TIMELAPSE_RENDER', help: '' }]
    const pane = mount(ConsoleSettingsPane, {
      global: { plugins: [i18n], provide: provideContext(stored) },
    })

    const labels = rowLabels(pane.html())
    for (const label of ['Hide temperature reports', 'Show timestamps', 'Compact rows']) {
      expect(
        labels.filter((entry) => entry === label),
        label,
      ).toHaveLength(1)
    }
    expect(pane.text()).not.toContain('Shown on the card')
  })

  it('binds the pane and the card to one promotion list, not to two copies', async () => {
    // Both read and write `config.quickSettings` through `useQuickSettings`, so
    // demoting from the pane empties the card's layer rather than leaving a
    // second, independently rendered copy behind.
    const stored = ref<Record<string, unknown>>({})
    const quickLabels = () =>
      rowLabels(
        mount(ConsoleQuickSettings, {
          global: { plugins: [i18n], provide: provideContext(stored) },
        }).html(),
      )
    const pane = mount(ConsoleSettingsPane, {
      global: { plugins: [i18n], provide: provideContext(stored) },
    })
    expect(quickLabels()).toEqual(['Hide temperature reports', 'Show timestamps', 'Compact rows'])

    const pin = pane
      .findAll('[aria-label*="quick settings"]')
      .find((button) => button.attributes('aria-label')?.includes('Compact rows'))
    await pin?.trigger('click')

    expect(quickLabels()).toEqual(['Hide temperature reports', 'Show timestamps'])
  })

  it('still offers everything the card can be configured with', () => {
    const stored = ref<Record<string, unknown>>({})
    const gcodeConsole = useConsoleStore()
    gcodeConsole.gcodeHelp = [{ command: 'TIMELAPSE_RENDER', help: '' }]

    const pane = mount(ConsoleSettingsPane, {
      global: { plugins: [i18n], provide: provideContext(stored) },
    })

    expect(rowLabels(pane.html())).toEqual(
      expect.arrayContaining([
        'Hide temperature reports',
        'Hide timelapse commands',
        'Show timestamps',
        'Compact rows',
        "Show Klipper's own prefixes",
        'Autoscroll',
        'Visible lines',
        'Prompt',
      ]),
    )
  })

  it('rules off every section but whichever one renders first', () => {
    // Nothing is repeated above the pane any more, so a rule on the leading
    // section draws against the top of the panel and divides nothing from
    // nothing. Which section leads is a runtime question, which is why the pane
    // computes it rather than hard-coding the class.
    const stored = ref<Record<string, unknown>>({})
    const pane = mount(ConsoleSettingsPane, {
      global: { plugins: [i18n], provide: provideContext(stored) },
    })
    expect(
      pane
        .findAll('.surface-section')
        .map((section) => [
          section.get('.surface-section__title').text(),
          section.classes('surface-section--divided'),
        ]),
    ).toEqual([
      ['Filters', false],
      ['Display', true],
    ])
  })

  it('leads the segmented picker with its label, not trailing it', () => {
    // A label after a wide segmented track reads as a caption for the next row.
    const stored = ref<Record<string, unknown>>({})
    const pane = mount(ConsoleSettingsPane, {
      global: { plugins: [i18n], provide: provideContext(stored) },
    })
    const row = pane.findAll('.settings-row').find((r) => r.find('.segmented').exists())
    expect(row?.element.firstElementChild?.tagName).toBe('SPAN')
    expect(row?.element.firstElementChild?.textContent).toBe('Prompt')
  })

  it('offers the line count as a slider over the useful span and a field past it', async () => {
    const stored = ref<Record<string, unknown>>({ visibleLines: 12 })
    const pane = mount(ConsoleSettingsPane, {
      global: { plugins: [i18n], provide: provideContext(stored) },
    })
    const slider = pane.get('input[type="range"]')
    const field = pane.get('input[type="number"]')

    expect(slider.attributes('min')).toBe('5')
    expect(slider.attributes('max')).toBe('20')
    // The field accepts more than the slider can reach — that is the override.
    expect(field.attributes('min')).toBe('5')
    expect(field.attributes('max')).toBe('100')
    expect((slider.element as HTMLInputElement).value).toBe('12')

    await slider.setValue('7')
    expect(stored.value.visibleLines).toBe(7)

    // `AppSlider`'s entry field commits on Enter, not a bare `change`.
    ;(field.element as HTMLInputElement).value = '45'
    await field.trigger('input')
    await field.trigger('keydown', { key: 'Enter' })
    expect(stored.value.visibleLines).toBe(45)
    // The slider pegs at its own maximum rather than misreporting the value.
    expect((pane.get('input[type="range"]').element as HTMLInputElement).value).toBe('20')
  })

  it('ignores a cleared field instead of resizing the card mid-keystroke', async () => {
    const stored = ref<Record<string, unknown>>({ visibleLines: 12 })
    const pane = mount(ConsoleSettingsPane, {
      global: { plugins: [i18n], provide: provideContext(stored) },
    })
    const field = pane.get('input[type="number"]')
    ;(field.element as HTMLInputElement).value = ''
    await field.trigger('input')
    await field.trigger('keydown', { key: 'Enter' })
    expect(stored.value.visibleLines).toBe(12)
  })

  it('gives the card’s quick layer the rows alone, with no heading over them', () => {
    // A heading in the disclosure layer would name a section of one, and the pin
    // belongs to the pane: demoting is decided where every row is visible.
    const stored = ref<Record<string, unknown>>({})
    const quick = mount(ConsoleQuickSettings, {
      global: { plugins: [i18n], provide: provideContext(stored) },
    })
    expect(quick.find('.surface-section').exists()).toBe(false)
    expect(quick.text()).not.toContain('Filters')
    expect(quick.text()).not.toContain('Display')
    expect(quick.findAll('[aria-label*="quick settings"]')).toHaveLength(0)
  })

  it('renders nothing at all once every row is demoted', () => {
    // A real, supported state: the card's gear then opens the full surface
    // instead of an empty layer — see `moduleHasQuickSettings`.
    const stored = ref<Record<string, unknown>>({ quickSettings: [] })
    const quick = mount(ConsoleQuickSettings, {
      global: { plugins: [i18n], provide: provideContext(stored) },
    })
    expect(quick.find('input').exists()).toBe(false)
  })
})
