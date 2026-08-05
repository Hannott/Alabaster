import { createPinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'

import MovementQuickSettings from '@/components/dashboard/modules/MovementQuickSettings.vue'
import MovementSettingsPane from '@/components/dashboard/modules/MovementSettingsPane.vue'
import { dashboardModuleContextKey } from '@/dashboard/context'
import { i18n } from '@/i18n'

type Component = typeof MovementSettingsPane | typeof MovementQuickSettings

function mountWith(component: Component, initial: Record<string, unknown> = {}) {
  const pinia = createPinia()
  const config = ref<Record<string, unknown>>(initial)
  const wrapper = mount(component, {
    global: {
      plugins: [pinia, i18n],
      provide: {
        [dashboardModuleContextKey as symbol]: {
          instanceId: 'movement',
          moduleId: 'movement',
          config: computed(() => config.value),
          updateConfig: (patch: Record<string, unknown>) => {
            config.value = { ...config.value, ...patch }
          },
          isSettingsOpen: computed(() => false),
          openSettings: () => undefined,
          closeSettings: () => undefined,
          isSurfaceOpen: computed(() => true),
          openSurface: () => undefined,
          closeSurface: () => undefined,
        },
      },
    },
  })
  return { wrapper, config }
}

function mountPane(initial: Record<string, unknown> = {}) {
  return mountWith(MovementSettingsPane, initial)
}

function mountQuick(initial: Record<string, unknown> = {}) {
  return mountWith(MovementQuickSettings, initial)
}

/** The row whose label or checkbox text is `label`, whichever shape it has. */
function field(wrapper: VueWrapper, label: string) {
  return wrapper
    .findAll('.settings-row')
    .find(
      (row) =>
        row.find('.settings-row__label').exists() &&
        row.get('.settings-row__label').text() === label,
    )
}

function checkRow(wrapper: VueWrapper, label: string) {
  return wrapper.findAll('.settings-row').find((row) => row.text().includes(label))
}

describe('MovementSettingsPane', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('offers a step set per axis group, showing the values rather than a scale name', async () => {
    const { wrapper } = mountPane()
    await flushPromises()

    expect(
      wrapper
        .findAll('.settings-row__label')
        .map((label) => label.text())
        .slice(0, 3),
    ).toEqual(['X and Y step size', 'Z step size', 'Z offset step'])

    expect(
      field(wrapper, 'X and Y step size')
        ?.findAll('.segmented button')
        .map((button) => button.text()),
      // `min / centre / max` is gone — the bed plan answers that question now.
    ).toEqual(['0.1 / 1 / 10', '1 / 10 / 100'])
  })

  it('marks the selected set and writes the choice to the card configuration', async () => {
    const { wrapper, config } = mountPane()
    await flushPromises()

    // Planar defaults to coarse, matching what the card renders.
    const planar = field(wrapper, 'X and Y step size')
    expect(planar?.findAll('.segmented button').at(1)?.attributes('aria-pressed')).toBe('true')

    await planar?.findAll('.segmented button').at(0)?.trigger('click')
    expect(config.value.planarStepScale).toBe('fine')
    await flushPromises()
    expect(planar?.findAll('.segmented button').at(0)?.attributes('aria-pressed')).toBe('true')
  })

  it('degrades an unknown stored scale to the default rather than rendering nothing', async () => {
    const { wrapper } = mountPane({ planarStepScale: 'enormous' })
    await flushPromises()

    const planar = field(wrapper, 'X and Y step size')
    expect(planar?.findAll('.segmented button').at(1)?.attributes('aria-pressed')).toBe('true')
  })

  it.each([
    ['skip motors-off confirming', 'Turn off motors without confirming', 'skipMotorsOffWarning'],
    ['skip leveling confirming', 'Start bed leveling without confirming', 'skipLevelingWarning'],
  ])('offers to %s, off by default', async (_label, text, key) => {
    const { wrapper, config } = mountPane()
    await flushPromises()

    const row = wrapper.findAll('.check-row').find((entry) => entry.text().includes(text))
    const checkbox = row?.get('input[type="checkbox"]')
    expect((checkbox?.element as HTMLInputElement).checked).toBe(false)

    await checkbox?.setValue(true)
    expect(config.value[key]).toBe(true)
  })

  /**
   * A setting decided once and then forgotten is not something the card's
   * disclosure layer is for, so these rows deliberately carry no pin.
   */
  it('offers no promotion for any confirmation setting', async () => {
    const { wrapper } = mountPane()
    await flushPromises()

    const row = wrapper
      .findAll('.check-row')
      .find((entry) => entry.text().includes('Turn off motors without confirming'))
    expect(row?.element.parentElement?.querySelector('[aria-label*="quick settings"]')).toBeNull()
  })

  /**
   * A bed-slinger's Z 0 sits at the top of its travel rather than the bottom,
   * so the slider's own direction is a printer property, not a look — off by
   * default, since the more common gantry-moves machine is what the unswapped
   * drawing already matches.
   */
  it('offers to swap the Z slider direction, off by default', async () => {
    const { wrapper, config } = mountPane()
    await flushPromises()

    const row = wrapper
      .findAll('.check-row')
      .find((entry) => entry.text().includes('Swap Z direction'))
    const checkbox = row?.get('input[type="checkbox"]')
    expect((checkbox?.element as HTMLInputElement).checked).toBe(false)

    await checkbox?.setValue(true)
    expect(config.value.swapZDirection).toBe(true)
  })

  /**
   * Meaningless without the bed plan itself, so it disables rather than
   * hides once its parent is off — the dependency stays visible instead of
   * disappearing along with the control it qualifies.
   */
  it('offers a nested "show during printing" setting under the bed plan toggle, off by default', async () => {
    const { wrapper, config } = mountPane()
    await flushPromises()

    const row = wrapper.find('.settings-row--nested')
    expect(row.text()).toContain('Show during printing')
    const checkbox = row.get('input[type="checkbox"]')
    expect((checkbox.element as HTMLInputElement).checked).toBe(false)
    expect((checkbox.element as HTMLInputElement).disabled).toBe(false)

    await checkbox.setValue(true)
    expect(config.value.showBedPlanWhilePrinting).toBe(true)
  })

  it('disables the nested "show during printing" setting while the bed plan itself is off', async () => {
    const { wrapper } = mountPane({ showBedPlan: false })
    await flushPromises()

    const checkbox = wrapper.find('.settings-row--nested').get('input[type="checkbox"]')
    expect((checkbox.element as HTMLInputElement).disabled).toBe(true)
  })

  /**
   * A sub-setting is still a setting someone might want a tap closer, so it
   * keeps a pin like every other row here — unlike the confirmation settings
   * below, which are decided once and forgotten and carry none.
   */
  it('promotes the nested "show during printing" setting, same as any other row', async () => {
    const { wrapper, config } = mountPane()
    await flushPromises()

    const row = wrapper.find('.settings-row--nested')
    const promote = row.get('[aria-label*="quick settings"]')
    await promote.trigger('click')
    expect(config.value.quickSettings).toContain('showBedPlanWhilePrinting')

    const { wrapper: quick } = mountQuick(config.value)
    await flushPromises()
    expect(quick.text()).toContain('Show during printing')
  })

  /**
   * The offset scales preview in the unit the buttons will use, not through
   * the locale formatter. Previewing `0.005` beside a card whose buttons read
   * `5` would be showing the reader a different control from the one they get.
   */
  it('previews the offset steps in the chosen unit', async () => {
    const { wrapper } = mountPane()
    await flushPromises()

    expect(
      field(wrapper, 'Z offset step')
        ?.findAll('.segmented button')
        .map((button) => button.text()),
    ).toEqual(['5 / 10 / 25 / 50', '10 / 25 / 50 / 100'])

    await field(wrapper, 'Z offset unit')?.findAll('.segmented button').at(1)?.trigger('click')
    await flushPromises()

    expect(
      field(wrapper, 'Z offset step')
        ?.findAll('.segmented button')
        .map((button) => button.text()),
    ).toEqual(['.005 / .01 / .025 / .05', '.01 / .025 / .05 / .1'])
  })
})

describe('Movement quick settings', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  /**
   * The defaults are what the card's fixed disclosure layer showed before
   * per-setting promotion existed, so a dashboard carried over from that build
   * looks unchanged.
   */
  it('shows exactly the two visibility toggles on a never-customized card', async () => {
    const { wrapper } = mountQuick()
    await flushPromises()

    expect(wrapper.findAll('.settings-row')).toHaveLength(2)
    expect(wrapper.text()).toContain('Show park positions')
    expect(wrapper.text()).toContain('Show Z offset controls')
    expect(wrapper.text()).not.toContain('X and Y step size')
  })

  /** Demoting is a decision made from the pane, never from the dashboard. */
  it('carries no promotion control of its own', async () => {
    const { wrapper } = mountQuick()
    await flushPromises()

    expect(wrapper.find('[aria-label*="quick settings"]').exists()).toBe(false)
  })

  it('renders a setting promoted from the pane, in the pane’s own order', async () => {
    const { wrapper: pane, config } = mountPane()
    await flushPromises()

    const promote = field(pane, 'X and Y step size')?.get('[aria-label*="quick settings"]')
    await promote?.trigger('click')
    expect(config.value.quickSettings).toContain('planarStepScale')

    const { wrapper: quick } = mountQuick(config.value)
    await flushPromises()
    expect(quick.text()).toContain('X and Y step size')
  })

  /**
   * Emptying the set is a supported state, and has to be stored differently
   * from never having been customized — otherwise the next load silently
   * restores the defaults. `DashboardView` sends the gear to the full surface
   * when this happens.
   */
  it('can be emptied, and stores that as an explicit empty list', async () => {
    const { wrapper: pane, config } = mountPane()
    await flushPromises()

    for (const label of ['Show park positions', 'Show Z offset controls']) {
      await checkRow(pane, label)?.get('[aria-label*="quick settings"]').trigger('click')
    }

    expect(config.value.quickSettings).toEqual([])

    const { wrapper: quick } = mountQuick(config.value)
    await flushPromises()
    expect(quick.findAll('.settings-row')).toHaveLength(0)
  })
})
