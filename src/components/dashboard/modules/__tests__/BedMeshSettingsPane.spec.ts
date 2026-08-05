import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import BedMeshSettingsPane from '@/components/dashboard/modules/BedMeshSettingsPane.vue'
import { dashboardModuleContextKey } from '@/dashboard/context'
import { i18n } from '@/i18n'
import { useBedMeshStore } from '@/stores/bedMesh'
import { usePrinterStore } from '@/stores/printer'

/**
 * `AppSelect`'s open panel is teleported to `document.body` so a dashboard
 * card's `overflow: hidden` cannot clip it, so its content is queried there
 * rather than within a mounted component's own wrapper.
 */
function panelTexts(selector: string): string[] {
  return [...document.body.querySelectorAll(selector)].map((el) => el.textContent?.trim() ?? '')
}

function mountPane(initialConfig: Record<string, unknown> = {}) {
  const pinia = createPinia()
  const bedMesh = useBedMeshStore(pinia)
  const printer = usePrinterStore(pinia)
  const config = ref<Record<string, unknown>>(initialConfig)
  const wrapper = mount(BedMeshSettingsPane, {
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
          isSurfaceOpen: computed(() => true),
          openSurface: () => undefined,
          closeSurface: () => undefined,
        },
      },
    },
  })
  return { bedMesh, printer, config, wrapper }
}

beforeAll(() => {
  // jsdom ships <dialog> without its modal methods, so the save/rename
  // prompts' open/close watcher has nothing to call.
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

describe('BedMeshSettingsPane', () => {
  it('never wraps a select row in a <label>', () => {
    // `.settings-row` stretches its leading track to the panel's full width, so
    // a `<label>` holding one forwards a click from anywhere in that width —
    // including empty space well past the trigger — to the control inside. For
    // a checkbox that is the point; for a control that opens a popover it reads
    // as the popover opening from nowhere, and it is also what reopened the
    // panel immediately after a choice closed it. Only a plain `<div>` may hold
    // a row with an `AppSelect` in it.
    const { wrapper } = mountPane()
    for (const select of wrapper.findAllComponents({ name: 'AppSelect' })) {
      const row = select.element.closest('.settings-row')
      expect(row?.tagName).toBe('DIV')
    }
  })

  it('opens the projection choices only from the trigger, not from the row around it', async () => {
    const { wrapper } = mountPane()
    const row = wrapper
      .findAll('.settings-row')
      .find((candidate) => candidate.text().includes('Projection'))
    expect(row).toBeTruthy()

    // A click that lands on the row but not on the trigger button.
    await row?.trigger('click')
    expect(document.body.querySelector('.app-select__panel')).toBeNull()

    await row?.find('.app-select__trigger').trigger('click')
    expect(document.body.querySelector('.app-select__panel')).not.toBeNull()
    // Teleported content outlives the row it opened from, so it has to be
    // torn down explicitly or it leaks into whichever test runs next.
    wrapper.unmount()
  })

  function restingAngleRow(wrapper: ReturnType<typeof mountPane>['wrapper']) {
    return wrapper
      .findAll('.settings-row')
      .find((candidate) => candidate.text().includes('Resting angle'))
  }

  it('disables the resting-angle choice for every projection that names its own', async () => {
    // Not just isometric: the whole axonometric family and the oblique pair are
    // each defined by a viewing angle, and a live-looking control that changes
    // nothing is the failure this prevents.
    for (const projection of ['isometric', 'dimetric', 'trimetric', 'cavalier', 'twoPoint']) {
      const { wrapper } = mountPane({ projection })
      expect(
        restingAngleRow(wrapper)?.find('.app-select__trigger').attributes('disabled'),
        projection,
      ).toBeDefined()
      expect(wrapper.text()).toContain('fixes its own viewing angle')
    }
  })

  it('leaves the resting angle live for the projections that only constrain it', async () => {
    // One-point perspective needs to be square-on and nothing more, so the
    // preset still picks which face — taking the control away would be a
    // stronger claim than the projection actually makes.
    for (const projection of ['perspective', 'orthographic', 'onePoint', 'fisheye']) {
      const { wrapper } = mountPane({ projection })
      expect(
        restingAngleRow(wrapper)?.find('.app-select__trigger').attributes('disabled'),
        projection,
      ).toBeUndefined()
    }
  })

  function rowNamed(wrapper: ReturnType<typeof mountPane>['wrapper'], label: string) {
    return wrapper.findAll('.settings-row').find((candidate) => candidate.text().includes(label))
  }

  it('keeps the projection list to the everyday pair until the extras are asked for', async () => {
    // A dozen drawing conventions in front of someone who wanted "3D" is the
    // wrong trade, and the checkbox is what lets both people have the list they
    // came for.
    const { config, wrapper } = mountPane()
    await rowNamed(wrapper, 'Projection')?.find('.app-select__trigger').trigger('click')
    expect(panelTexts('.app-select__option')).toEqual(['Perspective', 'Orthographic'])
    expect(panelTexts('.app-select__group')).toHaveLength(0)

    config.value = { ...config.value, showExtras: true }
    await wrapper.vm.$nextTick()
    const labels = panelTexts('.app-select__option')
    expect(labels).toContain('Cabinet')
    expect(labels).toContain('One point')
    expect(panelTexts('.app-select__group')).toEqual([
      'Axonometric',
      'Oblique',
      'Vanishing points',
      'Other',
    ])
    // Teleported content outlives the row it opened from, so it has to be
    // torn down explicitly or it leaks into whichever test runs next.
    wrapper.unmount()
  })

  it('shows the render styles behind that same one switch', async () => {
    // One decision — "show me the unusual options" — so one control. Two
    // checkboxes would ask the same question twice.
    const { config, wrapper } = mountPane()
    expect(rowNamed(wrapper, 'Render style')).toBeUndefined()

    config.value = { ...config.value, showExtras: true }
    await wrapper.vm.$nextTick()
    await rowNamed(wrapper, 'Render style')?.find('.app-select__trigger').trigger('click')
    expect(panelTexts('.app-select__option')).toEqual([
      'Surface',
      'Bars',
      'Contour',
      'Terraced',
      'Mosaic',
    ])
    // Teleported content outlives the row it opened from, so it has to be
    // torn down explicitly or it leaks into whichever test runs next.
    wrapper.unmount()
  })

  it('never hides a setting that is currently in force', async () => {
    // Otherwise a control names a value that is not among its options and
    // AppSelect renders a blank trigger — or, for the style, the mesh is drawn
    // as something the surface offers no way to see or undo.
    const { wrapper } = mountPane({
      projection: 'cabinet',
      renderStyle: 'bars',
      showExtras: false,
    })
    const projectionTrigger = rowNamed(wrapper, 'Projection')?.find('.app-select__trigger')
    expect(projectionTrigger?.text()).toContain('Cabinet')
    expect(rowNamed(wrapper, 'Render style')?.find('.app-select__trigger').text()).toContain('Bars')

    await projectionTrigger?.trigger('click')
    expect(panelTexts('.app-select__option')).toEqual(['Perspective', 'Orthographic', 'Cabinet'])
    // Teleported content outlives the row it opened from, so it has to be
    // torn down explicitly or it leaks into whichever test runs next.
    wrapper.unmount()
  })

  it('disables loading a saved profile while a print is active', async () => {
    const { bedMesh, printer, wrapper } = mountPane()
    bedMesh.profiles = ['default', 'spare']
    await wrapper.vm.$nextTick()

    const row = wrapper
      .findAll('.mesh-profile-row')
      .find((candidate) => candidate.text().includes('spare'))
    const load = row?.find('button')
    expect(load?.attributes('disabled')).toBeUndefined()

    printer.printStats.state = 'printing'
    await wrapper.vm.$nextTick()
    expect(load?.attributes('disabled')).toBeDefined()

    printer.printStats.state = 'standby'
    await wrapper.vm.$nextTick()
    expect(load?.attributes('disabled')).toBeUndefined()
  })

  it('offers to skip its own delete confirmation, off by default', async () => {
    const { wrapper, config } = mountPane()

    const row = wrapper
      .findAll('.check-row')
      .find((entry) => entry.text().includes('Delete a mesh profile without confirming'))
    const checkbox = row?.get('input[type="checkbox"]')
    expect((checkbox?.element as HTMLInputElement).checked).toBe(false)

    await checkbox?.setValue(true)
    expect(config.value.skipDeleteProfileWarning).toBe(true)
  })

  it('deletes immediately, in the full danger variant, once its confirmation is off', async () => {
    const { bedMesh, printer, wrapper } = mountPane({ skipDeleteProfileWarning: true })
    bedMesh.profiles = ['default', 'spare']
    await wrapper.vm.$nextTick()
    const removeBedMeshProfile = vi.spyOn(printer, 'removeBedMeshProfile').mockResolvedValue(true)

    const row = wrapper
      .findAll('.mesh-profile-row')
      .find((candidate) => candidate.text().includes('spare'))
    const deleteButton = row?.find('[aria-label="Delete spare"]')
    expect(deleteButton?.classes()).toContain('button--danger')
    expect(deleteButton?.classes()).not.toContain('button--danger-quiet')

    await deleteButton?.trigger('click')

    expect(removeBedMeshProfile).toHaveBeenCalledWith('spare')
    expect(wrapper.find('.confirm-dialog[open]').exists()).toBe(false)
  })

  it('resets the height axis to its clamped default, and hides once there', async () => {
    const { bedMesh, config, wrapper } = mountPane({ zMax: 0.9 })
    bedMesh.probedMatrix = [
      [0.01, 0.02],
      [0.02, 0.03],
    ]
    await wrapper.vm.$nextTick()

    // `AppSlider`'s reset is absent, not merely disabled, once the committed
    // value already matches its (clamped) reset target.
    const resetButton = wrapper.find(
      '[aria-label="Reset Height axis (± mm) to its configured value"]',
    )
    expect(resetButton.exists()).toBe(true)
    await resetButton.trigger('click')
    expect(config.value.zMax).toBe(0.5)

    await wrapper.vm.$nextTick()
    expect(
      wrapper.find('[aria-label="Reset Height axis (± mm) to its configured value"]').exists(),
    ).toBe(false)
  })

  it('resets the fixed scale and the warning threshold to their literal defaults', async () => {
    const { config, wrapper } = mountPane({ fixedLimit: 0.3, rangeWarning: 0.4 })

    await wrapper
      .find('[aria-label="Reset Fixed scale (± mm) to its configured value"]')
      .trigger('click')
    expect(config.value.fixedLimit).toBe(0.1)
    await wrapper
      .find('[aria-label="Reset Bed range (mm) to its configured value"]')
      .trigger('click')
    expect(config.value.rangeWarning).toBe(0.2)
  })

  it('updates and resets the temperature warning threshold like the other card warnings', async () => {
    const { config, wrapper } = mountPane({ temperatureWarning: 8 })

    const slider = wrapper
      .findAll('.app-slider')
      .find((candidate) => candidate.text().includes('Probe temperature drift'))
    const resetLabel = 'Reset Probe temperature drift (°C) to its configured value'
    expect(slider?.find(`[aria-label="${resetLabel}"]`).exists()).toBe(true)

    const input = slider?.get('.app-slider__entry input')
    ;(input?.element as HTMLInputElement).value = '3'
    await input?.trigger('input')
    await input?.trigger('keydown', { key: 'Enter' })
    expect(config.value.temperatureWarning).toBe(3)

    await slider?.get(`[aria-label="${resetLabel}"]`).trigger('click')
    expect(config.value.temperatureWarning).toBe(5)
    await wrapper.vm.$nextTick()
    expect(slider?.find(`[aria-label="${resetLabel}"]`).exists()).toBe(false)
  })

  /**
   * Klipper names every anonymous calibration "default", so a printer that
   * already has a saved "default" profile is the exact case a blind
   * `profileName || 'default'` fallback would silently overwrite.
   */
  it('suggests a numbered variant rather than defaulting onto an existing profile', async () => {
    const { bedMesh, wrapper } = mountPane()
    bedMesh.profileName = 'default'
    bedMesh.probedMatrix = [[0.1]]
    bedMesh.profiles = ['default']
    await wrapper.vm.$nextTick()

    const saveButton = wrapper.findAll('button').find((button) => button.text() === 'Save as')
    await saveButton?.trigger('click')
    await flushPromises()

    const input = wrapper.find('.prompt-dialog__input')
    expect((input.element as HTMLInputElement).value).toBe('default2')
  })

  it('refuses to save under a name a different profile already has', async () => {
    const { bedMesh, printer, wrapper } = mountPane()
    bedMesh.profileName = 'default'
    bedMesh.probedMatrix = [[0.1]]
    bedMesh.profiles = ['default', 'cold']
    await wrapper.vm.$nextTick()
    const saveBedMeshProfile = vi.spyOn(printer, 'saveBedMeshProfile').mockResolvedValue(true)

    const saveButton = wrapper.findAll('button').find((button) => button.text() === 'Save as')
    await saveButton?.trigger('click')
    await flushPromises()

    const input = wrapper.find('.prompt-dialog__input')
    await input.setValue('cold')
    expect(wrapper.text()).toContain('A profile with that name already exists')
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined()

    await input.setValue('warm')
    expect(wrapper.text()).not.toContain('A profile with that name already exists')
    await wrapper.find('form').trigger('submit')
    expect(saveBedMeshProfile).toHaveBeenCalledWith('warm')
  })
})
