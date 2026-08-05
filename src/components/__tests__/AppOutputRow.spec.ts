import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AppOutputRow from '@/components/AppOutputRow.vue'

function mountToggle(props: Record<string, unknown> = {}) {
  const wrapper = mount(AppOutputRow, {
    props: {
      label: 'led',
      toggle: true,
      modelValue: false,
      ...props,
      'onUpdate:modelValue': (value: boolean) => void wrapper.setProps({ modelValue: value }),
    },
  })
  return wrapper
}

describe('AppOutputRow', () => {
  it('reads an icon, a Title Case label, and a value with a visible unit', () => {
    const wrapper = mount(AppOutputRow, {
      props: { label: 'hotend fan', icon: 'fan', value: 62, unit: '%' },
    })

    expect(wrapper.get('.app-output-row__label').text()).toBe('hotend fan')
    expect(wrapper.get('.app-output-row__value').text()).toBe('62%')
    expect(wrapper.find('.app-output-row__icon').exists()).toBe(true)
    // The casing is a CSS transform, not a rewrite — a name read straight
    // from the printer's own config keeps whatever case it was given.
    expect(wrapper.get('.app-output-row__label').element.textContent).toBe('hotend fan')
  })

  it('omits the unit rather than showing one beside a value that has none', () => {
    const wrapper = mount(AppOutputRow, { props: { label: 'hotend fan', value: '—' } })

    expect(wrapper.get('.app-output-row__value').text()).toBe('—')
    expect(wrapper.find('.app-output-row__unit').exists()).toBe(false)
  })

  it('renders the shared switch, not a reading, when toggle is on', () => {
    const wrapper = mountToggle()

    expect(wrapper.find('.app-output-row__value').exists()).toBe(false)
    const toggle = wrapper.get('input.switch')
    expect((toggle.element as HTMLInputElement).checked).toBe(false)
  })

  it('flips the model when the switch is toggled', async () => {
    const wrapper = mountToggle()

    await wrapper.get('input.switch').setValue(true)

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true])
    expect((wrapper.get('input.switch').element as HTMLInputElement).checked).toBe(true)
  })

  it('gives the switch its own accessible name, falling back to the visible label', () => {
    const plain = mountToggle()
    expect(plain.get('input.switch').attributes('aria-label')).toBe('led')

    const described = mountToggle({ ariaLabel: 'Toggle led' })
    expect(described.get('input.switch').attributes('aria-label')).toBe('Toggle led')
  })

  it('renders an icon on a toggle row too, not only on a reading', () => {
    const wrapper = mountToggle({ icon: 'bulb' })

    expect(wrapper.find('.app-output-row__icon').exists()).toBe(true)
    expect(wrapper.find('input.switch').exists()).toBe(true)
  })

  it('disables only the switch when disabled, never the whole row', () => {
    const wrapper = mountToggle({ disabled: true })

    // `pendingCommands.pin` is one flag shared by every pin, so every row
    // receives the same `disabled` value at once — a row-level dim would
    // read as the whole card breaking rather than one in-flight command.
    expect(wrapper.attributes('aria-disabled')).toBeUndefined()
    expect((wrapper.get('input.switch').element as HTMLInputElement).disabled).toBe(true)
  })

  it('enables the spin animation only once a duration is given, and reflects spinning separately', () => {
    const idle = mount(AppOutputRow, { props: { label: 'fan', icon: 'fan', value: 0 } })
    expect(idle.get('.app-output-row__icon').classes()).not.toContain('fan-icon')

    const paused = mount(AppOutputRow, {
      props: { label: 'fan', icon: 'fan', value: 0, spinDurationSeconds: 2.6 },
    })
    expect(paused.get('.app-output-row__icon').classes()).toContain('fan-icon')
    expect(paused.get('.app-output-row__icon').classes()).not.toContain('fan-icon--spinning')

    const spinning = mount(AppOutputRow, {
      props: { label: 'fan', icon: 'fan', value: 62, spinDurationSeconds: 0.4, spinning: true },
    })
    expect(spinning.get('.app-output-row__icon').classes()).toContain('fan-icon--spinning')
    expect(spinning.get('.app-output-row__icon').attributes('style') ?? '').toContain(
      'animation-duration: 0.4s',
    )
  })

  it('defaults to the sm tier and switches tiers through the size prop', () => {
    const sm = mount(AppOutputRow, { props: { label: 'led', toggle: true } })
    expect(sm.classes()).toContain('app-output-row--size-sm')

    const xs = mount(AppOutputRow, { props: { label: 'led', toggle: true, size: 'xs' } })
    expect(xs.classes()).toContain('app-output-row--size-xs')
  })
})
