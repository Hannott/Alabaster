import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AppSlider from '@/components/AppSlider.vue'
import { i18n } from '@/i18n'

/**
 * Mounted with the model wired back to the prop, matching `AppField.spec.ts`'s
 * own `mountField` helper: the subject here is what happens when the value
 * changes from outside, so asserting on `emitted('update:modelValue')` alone
 * would pass for a component that never reconciles what it emitted with what
 * it was handed.
 */
function mountSlider(props: Record<string, unknown> = {}) {
  const wrapper = mount(AppSlider, {
    props: {
      label: 'Extrusion factor',
      modelValue: 92,
      min: 50,
      max: 150,
      ...props,
      'onUpdate:modelValue': (value: number) => void wrapper.setProps({ modelValue: value }),
    },
    global: { plugins: [i18n] },
  })
  return wrapper
}

function mountOneWay(props: Record<string, unknown> = {}) {
  return mount(AppSlider, {
    props: { label: 'Speed factor', modelValue: 100, min: 10, max: 300, ...props },
    global: { plugins: [i18n] },
  })
}

async function type(
  input: { element: Element; trigger: (event: string) => Promise<unknown> },
  text: string,
): Promise<void> {
  ;(input.element as HTMLInputElement).value = text
  await input.trigger('input')
}

async function pressEnter(input: {
  trigger: (event: string, options?: object) => Promise<unknown>
}): Promise<void> {
  await input.trigger('keydown', { key: 'Enter' })
}

describe('AppSlider', () => {
  it('names itself and its unit without either becoming part of the entry value', () => {
    const wrapper = mountSlider({ entry: true, unit: '%' })

    expect(wrapper.get('.app-slider__label').text()).toBe('Extrusion factor')
    expect(wrapper.get('.app-slider__unit').text()).toBe('%')
    expect((wrapper.get('.app-slider__entry input').element as HTMLInputElement).value).toBe('92')
  })

  it('renders a plain reading, not an entry field, unless entry is on', () => {
    const reading = mountSlider()
    expect(reading.find('.app-slider__entry').exists()).toBe(false)
    expect(reading.get('.app-slider__reading').text()).toBe('92')

    const entry = mountSlider({ entry: true })
    expect(entry.find('.app-slider__reading').exists()).toBe(false)
    expect(entry.find('.app-slider__entry input').exists()).toBe(true)
  })

  it('shows an optional leading icon before the label', () => {
    expect(mountSlider().find('.app-slider__label-icon').exists()).toBe(false)

    const wrapper = mountSlider({ labelIcon: 'fan' })
    expect(wrapper.find('.app-slider__label-icon').exists()).toBe(true)
  })

  it('puts reset in row-a immediately before the value it resets, not beside the label', () => {
    const wrapper = mountSlider({ entry: true, canReset: true, resetValue: 100 })
    const order = [...wrapper.get('.app-slider__row-a').element.children].map(
      (child) => (child as HTMLElement).className,
    )
    const labelIndex = order.findIndex((name) => name.includes('app-slider__label'))
    const resetIndex = order.findIndex((name) => name.includes('app-slider__reset'))
    const valueIndex = order.findIndex(
      (name) => name.includes('app-slider__reading') || name.includes('app-slider__entry'),
    )
    expect(labelIndex).toBeLessThan(resetIndex)
    expect(resetIndex).toBeLessThan(valueIndex)
  })

  it('flanks the track with the decrease button first, then the track, then increase', () => {
    const wrapper = mountSlider({ steppers: true })
    const order = [...wrapper.get('.app-slider__row-b').element.children].map(
      (child) => (child as HTMLElement).className,
    )
    expect(order[0]).toContain('app-slider__stepper--down')
    expect(order[order.length - 1]).toContain('app-slider__stepper--up')
    expect(wrapper.find('.app-slider__stepper').exists()).toBe(true)
  })

  it('draws steppers by default, and none when explicitly turned off', () => {
    expect(mountSlider().findAll('.app-slider__stepper')).toHaveLength(2)
    expect(mountSlider({ steppers: false }).find('.app-slider__stepper').exists()).toBe(false)
  })

  it('puts the size tier on the whole component', () => {
    expect(mountSlider().classes()).toContain('app-slider--size-sm')
    expect(mountSlider({ size: 'xs' }).classes()).toContain('app-slider--size-xs')
    expect(mountSlider({ size: 'md' }).classes()).toContain('app-slider--size-md')
  })

  it('reveals reset only when an enabled slider differs from its configured value', async () => {
    const wrapper = mountSlider({ canReset: true, resetValue: 100 })
    expect(wrapper.find('.app-slider__reset').exists()).toBe(true)

    await wrapper.setProps({ modelValue: 100 })
    expect(wrapper.find('.app-slider__reset').exists()).toBe(false)
  })

  it('does not reveal reset when resetValue was never supplied', () => {
    expect(mountSlider({ canReset: true }).find('.app-slider__reset').exists()).toBe(false)
  })

  it('commits the configured value when reset is pressed', async () => {
    const wrapper = mountSlider({ canReset: true, resetValue: 100 })

    await wrapper.get('.app-slider__reset').trigger('click')

    expect(wrapper.emitted('commit')?.at(-1)).toEqual([100])
    expect(wrapper.props('modelValue')).toBe(100)
  })

  it('does not let a disabled reset commit', async () => {
    const wrapper = mountSlider({ canReset: true, resetValue: 100, disabled: true })

    await wrapper.get('.app-slider__reset').trigger('click')

    expect(wrapper.emitted('commit')).toBeUndefined()
  })

  it('steps by the step and rounds onto its precision, clamped to bounds', async () => {
    const wrapper = mountSlider({ min: 0, max: 1, step: 0.05, modelValue: 0.98, steppers: true })

    await wrapper.get('.app-slider__stepper--up').trigger('click')
    expect(wrapper.emitted('commit')?.at(-1)).toEqual([1])

    await wrapper.get('.app-slider__stepper--down').trigger('click')
    await wrapper.get('.app-slider__stepper--down').trigger('click')
    expect(wrapper.emitted('commit')?.at(-1)).toEqual([0.9])
  })

  it('does not let a disabled stepper commit', async () => {
    const wrapper = mountSlider({ steppers: true, disabled: true })

    await wrapper.get('.app-slider__stepper--up').trigger('click')

    expect(wrapper.emitted('commit')).toBeUndefined()
  })

  describe('track commit timing', () => {
    it('moves the model on every input but commits only on release when commitOnDrag is off', async () => {
      const wrapper = mountSlider({ commitOnDrag: false })
      const track = wrapper.get('.app-slider__track')

      await type(track, '110')
      expect(wrapper.props('modelValue')).toBe(110)
      expect(wrapper.emitted('commit')).toBeUndefined()

      await track.trigger('change')
      expect(wrapper.emitted('commit')?.at(-1)).toEqual([110])
    })

    it('commits on every input when commitOnDrag is on', async () => {
      const wrapper = mountSlider({ commitOnDrag: true })
      const track = wrapper.get('.app-slider__track')

      await type(track, '110')

      expect(wrapper.emitted('commit')?.at(-1)).toEqual([110])
    })

    it('defaults the track bounds to min/max/step, and lets trackMin/trackMax/trackStep diverge', () => {
      const shared = mountSlider().get('.app-slider__track')
      expect(shared.attributes('min')).toBe('50')
      expect(shared.attributes('max')).toBe('150')

      const divergent = mountSlider({
        min: 0,
        max: 5,
        step: 0.01,
        trackMin: 0,
        trackMax: 1,
        trackStep: 0.01,
      }).get('.app-slider__track')
      expect(divergent.attributes('max')).toBe('1')
    })
  })

  describe('the entry field draft', () => {
    it('does not let an outside change overwrite the box while it is being edited', async () => {
      const wrapper = mountSlider({ entry: true })
      const input = wrapper.get('.app-slider__entry input')

      await input.trigger('focus')
      await type(input, '9')
      await wrapper.setProps({ modelValue: 60 })

      expect((input.element as HTMLInputElement).value).toBe('9')
    })

    it('re-seeds from the outside once the box is no longer being edited', async () => {
      const wrapper = mountSlider({ entry: true })
      const input = wrapper.get('.app-slider__entry input')

      await input.trigger('focus')
      await type(input, '9')
      await input.trigger('blur')
      await wrapper.setProps({ modelValue: 60 })

      expect((input.element as HTMLInputElement).value).toBe('60')
    })

    // The entry field's draft is a string for the same reason AppField's is —
    // `Number('0.')` is `0`, so a numeric draft would eat the decimal point on
    // the way from `0.` to `0.5`. Unlike AppField, this input has no `type`
    // prop to fall back to `text` with, and a real `type="number"` input
    // sanitizes an intermediate value like `0.` to `''` before jsdom (or a
    // browser's own DOM property setter) ever exposes it — only a live
    // keystroke-by-keystroke browser session preserves it, which is exactly
    // what the focus guard above exists to protect during. See
    // `AppField.spec.ts`'s own comment on the equivalent test for the same
    // reasoning.

    it('abandons an empty box rather than committing it as zero', async () => {
      const wrapper = mountSlider({ entry: true })
      const input = wrapper.get('.app-slider__entry input')

      await input.trigger('focus')
      await type(input, '')
      await pressEnter(input)

      expect(wrapper.emitted('commit')).toBeUndefined()
    })

    it('commits on Enter rather than per keystroke', async () => {
      const wrapper = mountSlider({ entry: true })
      const input = wrapper.get('.app-slider__entry input')

      await input.trigger('focus')
      await type(input, '5')
      expect(wrapper.emitted('commit')).toBeUndefined()

      await type(input, '55')
      await pressEnter(input)
      expect(wrapper.emitted('commit')?.at(-1)).toEqual([55])
    })

    it('abandons an edit left without Enter, for a slider with nothing relaying it back', async () => {
      const wrapper = mountOneWay({ entry: true })
      const input = wrapper.get('.app-slider__entry input')

      await input.trigger('focus')
      await type(input, '150')
      await input.trigger('blur')

      expect((input.element as HTMLInputElement).value).toBe('100')
      expect(wrapper.emitted('commit')).toBeUndefined()
    })

    it('sends an edit left with Enter even without anything relaying the model back', async () => {
      const wrapper = mountOneWay({ entry: true })
      const input = wrapper.get('.app-slider__entry input')

      await input.trigger('focus')
      await type(input, '150')
      await pressEnter(input)
      await input.trigger('blur')

      expect((input.element as HTMLInputElement).value).toBe('150')
    })

    it('clamps a typed value to bounds and rounds it onto the step precision', async () => {
      const wrapper = mountSlider({ entry: true, min: 50, max: 150, step: 1 })
      const input = wrapper.get('.app-slider__entry input')

      await input.trigger('focus')
      await type(input, '999')
      await pressEnter(input)

      expect(wrapper.emitted('commit')?.at(-1)).toEqual([150])
    })
  })

  it('disables the track, entry field, steppers, and reset together', () => {
    const wrapper = mountSlider({
      entry: true,
      steppers: true,
      canReset: true,
      resetValue: 100,
      disabled: true,
    })

    expect((wrapper.get('.app-slider__track').element as HTMLInputElement).disabled).toBe(true)
    expect((wrapper.get('.app-slider__entry input').element as HTMLInputElement).disabled).toBe(
      true,
    )
    expect((wrapper.get('.app-slider__stepper--up').element as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((wrapper.get('.app-slider__reset').element as HTMLButtonElement).disabled).toBe(true)
  })
})
