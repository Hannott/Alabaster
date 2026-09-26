import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import AppSelect from '@/components/AppSelect.vue'
import QuickConfigOptionDialog from '@/components/machine/QuickConfigOptionDialog.vue'
import type { OptionCatalogueSection, QuickConfigPin } from '@/features/config/quickConfigFields'
import { i18n } from '@/i18n'

enableAutoUnmount(afterEach)

beforeAll(() => {
  // jsdom's dialog has no showModal/close, so the open watcher has nothing to call.
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

const catalogue: OptionCatalogueSection[] = [
  {
    section: 'printer',
    key: 'printer',
    options: [
      { option: 'max_accel', value: '5000', isDefault: false },
      { option: 'max_velocity', value: '600', isDefault: false },
      { option: 'square_corner_velocity', value: '5.0', isDefault: true },
    ],
  },
  {
    section: 'resonance_tester',
    key: 'resonance_tester',
    options: [{ option: 'accel_per_hz', value: '75', isDefault: true }],
  },
]

const pins: QuickConfigPin[] = [
  { section: 'printer', option: 'max_velocity' },
  // Not in the catalogue, as a multi-line or unknown option would not be; saving must keep it.
  { section: 'printer', option: 'kinematics_extra' },
  { section: 'resonance_tester', option: 'accel_per_hz' },
]

type Wrapper = Awaited<ReturnType<typeof mountOpen>>

async function mountOpen(initialSection: string | null = 'printer') {
  const wrapper = mount(QuickConfigOptionDialog, {
    props: { open: false, catalogue, pins, initialSection },
    global: { plugins: [i18n] },
  })
  await wrapper.setProps({ open: true })
  return wrapper
}

function tiles(wrapper: Wrapper) {
  return wrapper.findAll('.quick-config-tile')
}

function names(wrapper: Wrapper) {
  return tiles(wrapper).map((candidate) => candidate.find('.quick-config-tile__name').text())
}

function tile(wrapper: Wrapper, option: string) {
  const found = tiles(wrapper).find(
    (candidate) => candidate.find('.quick-config-tile__name').text() === option,
  )
  if (!found) throw new Error(`no tile ${option}`)
  return found
}

function saveButton(wrapper: Wrapper) {
  const button = wrapper
    .findAll('.confirm-dialog__actions button')
    .find((candidate) => candidate.text() === 'Save')
  if (!button) throw new Error('no save button')
  return button
}

describe('QuickConfigOptionDialog', () => {
  it('shows the card options highlighted and first, in order, then the rest by name', async () => {
    const wrapper = await mountOpen()

    expect(names(wrapper)).toEqual([
      'max_velocity',
      'kinematics_extra',
      'max_accel',
      'square_corner_velocity',
    ])
    expect(tile(wrapper, 'max_velocity').attributes('aria-pressed')).toBe('true')
    expect(tile(wrapper, 'max_accel').attributes('aria-pressed')).toBe('false')
    expect(tile(wrapper, 'square_corner_velocity').text()).toContain('5.0 · default')
  })

  it('saves the highlighted options in tile order, keeping pins it cannot list', async () => {
    const wrapper = await mountOpen()

    await tile(wrapper, 'square_corner_velocity').trigger('click')
    await tile(wrapper, 'max_velocity').trigger('click')
    await saveButton(wrapper).trigger('click')

    expect(wrapper.emitted('save')).toEqual([
      ['printer', ['kinematics_extra', 'square_corner_velocity']],
    ])
  })

  it('reorders by dragging one tile onto another', async () => {
    const wrapper = await mountOpen()
    await tile(wrapper, 'max_accel').trigger('click')

    await tile(wrapper, 'max_accel').find('.quick-config-tile__grip').trigger('pointerdown')
    await tile(wrapper, 'max_accel').trigger('dragstart')
    await tile(wrapper, 'max_velocity').trigger('dragover')
    await tile(wrapper, 'max_velocity').trigger('drop')
    await saveButton(wrapper).trigger('click')

    expect(wrapper.emitted('save')?.[0]).toEqual([
      'printer',
      ['max_accel', 'max_velocity', 'kinematics_extra'],
    ])
  })

  it('moves the focused tile with Alt+Up and Alt+Down', async () => {
    const wrapper = await mountOpen()

    await tile(wrapper, 'kinematics_extra').trigger('keydown', { key: 'ArrowUp', altKey: true })

    expect(names(wrapper).slice(0, 2)).toEqual(['kinematics_extra', 'max_velocity'])
  })

  it('starts without a section from the toolbar and loads one when it is chosen', async () => {
    const wrapper = await mountOpen(null)

    expect(tiles(wrapper)).toHaveLength(0)
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined()

    wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 'resonance_tester')
    await wrapper.vm.$nextTick()

    expect(names(wrapper)).toEqual(['accel_per_hz'])
  })

  it('removes the card when nothing is highlighted', async () => {
    const wrapper = await mountOpen('resonance_tester')

    await tile(wrapper, 'accel_per_hz').trigger('click')
    await saveButton(wrapper).trigger('click')

    expect(wrapper.emitted('save')).toEqual([['resonance_tester', []]])
  })
})
