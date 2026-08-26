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

/** A step-value list's own group, keyed by the same label text `field` uses. */
function stepGroup(wrapper: VueWrapper, label: string) {
  return wrapper
    .findAll('.step-group')
    .find((row) => row.get('.settings-row__label').text() === label)
}

function stepValues(wrapper: VueWrapper, label: string): string[] | undefined {
  return stepGroup(wrapper, label)
    ?.findAll('.step-editor__item input')
    .map((input) => (input.element as HTMLInputElement).value)
}

describe('MovementSettingsPane', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('offers an editable step-value list per axis group, seeded from the defaults', async () => {
    const { wrapper } = mountPane()
    await flushPromises()

    expect(
      wrapper.findAll('.step-group .settings-row__label').map((label) => label.text()),
      // `min / centre / max` is gone — the bed plan answers that question now.
    ).toEqual(['X and Y step size', 'Z step size', 'Z offset step'])

    expect(stepValues(wrapper, 'X and Y step size')).toEqual(['1', '10', '100'])
    expect(stepValues(wrapper, 'Z step size')).toEqual(['0.1', '1', '10'])
  })

  it('commits an edited value to the card configuration as a list', async () => {
    const { wrapper, config } = mountPane()
    await flushPromises()

    const input = stepGroup(wrapper, 'X and Y step size')?.findAll('.step-editor__item input').at(1)
    await input?.setValue('25')
    await input?.trigger('change')

    expect(config.value.planarSteps).toEqual([1, 25, 100])
  })

  it('reverts an invalid edit rather than writing it or silently dropping the value', async () => {
    const { wrapper, config } = mountPane()
    await flushPromises()

    const input = stepGroup(wrapper, 'X and Y step size')?.findAll('.step-editor__item input').at(1)
    await input?.setValue('-5')
    await input?.trigger('change')

    expect(config.value.planarSteps).toBeUndefined()
    // The revert rebuilds the item under a fresh key (see `revisions` in the
    // component), so the corrected value has to be read off a re-query rather
    // than off the now-detached node `input` still points at.
    expect(stepValues(wrapper, 'X and Y step size')).toEqual(['1', '10', '100'])
  })

  it('adds a value and removes one, down to a floor of one value per side', async () => {
    const { wrapper, config } = mountPane()
    await flushPromises()

    const group = stepGroup(wrapper, 'X and Y step size')
    await group?.get('.step-editor button:not(.button--icon)').trigger('click')
    expect(stepValues(wrapper, 'X and Y step size')).toEqual(['1', '10', '100', ''])

    const removeButtons = () => stepGroup(wrapper, 'X and Y step size')?.findAll('.button--icon')
    await removeButtons()?.at(-1)?.trigger('click')
    await removeButtons()?.at(0)?.trigger('click')
    await removeButtons()?.at(0)?.trigger('click')
    expect(config.value.planarSteps).toEqual([100])

    // One value left: removing it is not offered, so a side never empties out.
    expect(removeButtons()?.at(0)?.attributes('disabled')).toBeDefined()
  })

  it('degrades an unknown legacy scale to the default rather than an empty list', async () => {
    const { wrapper } = mountPane({ planarStepScale: 'enormous' })
    await flushPromises()

    expect(stepValues(wrapper, 'X and Y step size')).toEqual(['1', '10', '100'])
  })

  it('offers no quick-settings promotion for a step-value list, unlike the unit picker beside it', async () => {
    const { wrapper } = mountPane()
    await flushPromises()

    for (const label of ['X and Y step size', 'Z step size', 'Z offset step']) {
      expect(stepGroup(wrapper, label)?.find('[aria-label*="quick settings"]').exists()).toBe(false)
    }
    expect(field(wrapper, 'Z offset unit')?.find('[aria-label*="quick settings"]').exists()).toBe(
      true,
    )
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
   * The offset list edits in the unit the buttons will use, not always in the
   * millimetres it is stored as. Editing `5` beside a card whose buttons read
   * `+5` is the same number the reader is looking at; editing `0.005` while
   * the card reads `+5` is not.
   */
  it('edits the offset list in the chosen unit, converting back to millimetres underneath', async () => {
    const { wrapper, config } = mountPane()
    await flushPromises()

    expect(stepValues(wrapper, 'Z offset step')).toEqual(['5', '10', '25', '50'])

    await field(wrapper, 'Z offset unit')?.findAll('.segmented button').at(1)?.trigger('click')
    await flushPromises()
    expect(stepValues(wrapper, 'Z offset step')).toEqual(['0.005', '0.01', '0.025', '0.05'])

    const input = stepGroup(wrapper, 'Z offset step')?.findAll('.step-editor__item input').at(0)
    await input?.setValue('0.02')
    await input?.trigger('change')
    expect(config.value.offsetSteps).toEqual([0.02, 0.01, 0.025, 0.05])
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

    const promote = field(pane, 'Z offset unit')?.get('[aria-label*="quick settings"]')
    await promote?.trigger('click')
    expect(config.value.quickSettings).toContain('zOffsetUnit')

    const { wrapper: quick } = mountQuick(config.value)
    await flushPromises()
    expect(quick.text()).toContain('Z offset unit')
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
