import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AppField from '@/components/AppField.vue'
import { i18n } from '@/i18n'

/**
 * Mounted with the model wired back to the prop, because that is what `v-model`
 * does and the whole subject here is what happens when the value changes from
 * outside. Asserting on `emitted('update:modelValue')` instead would pass for a
 * component that never reconciles what it emitted with what it was handed.
 */
function mountField(props: Record<string, unknown> = {}) {
  const wrapper = mount(AppField, {
    props: {
      label: 'Retract speed',
      modelValue: 60,
      ...props,
      'onUpdate:modelValue': (value: number | string | null | undefined) =>
        void wrapper.setProps({ modelValue: value }),
    },
    global: { plugins: [i18n] },
  })
  return wrapper
}

/**
 * One keystroke. `setValue` also fires `change` — it does that on purpose, for
 * `v-model.lazy` — and `change` is exactly the commit boundary several of these
 * tests are about, so typing has to be driven directly.
 */
async function type(
  input: { element: Element; trigger: (event: string) => Promise<unknown> },
  text: string,
): Promise<void> {
  ;(input.element as HTMLInputElement).value = text
  await input.trigger('input')
}

/** What the box actually listens for as a commit — see `AppField`'s own doc
 *  comment on why that is Enter and not the browser's `change` event. */
async function pressEnter(input: {
  trigger: (event: string, options?: object) => Promise<unknown>
}): Promise<void> {
  await input.trigger('keydown', { key: 'Enter' })
}

/**
 * `mountField` always relays `update:modelValue` back into the prop, which is
 * exactly the pattern that never exposed the bug the one-way test below
 * guards: a caller with no listener at all has nowhere for a typed-but-
 * uncommitted value to go but this component's own local copy of the model.
 */
function mountOneWay(props: Record<string, unknown> = {}) {
  return mount(AppField, {
    props: { label: 'Target X', modelValue: 100, ...props },
    global: { plugins: [i18n] },
  })
}

describe('AppField', () => {
  it('names itself and its unit without either becoming part of the value', () => {
    const wrapper = mountField({ unit: 'mm/s' })

    expect(wrapper.get('.app-field__label').text()).toBe('Retract speed')
    expect(wrapper.get('.app-field__unit').text()).toBe('mm/s')
    // The unit is a sibling, never a character inside the box: a number input
    // rejects a typed `mm/s`, and a field containing its own unit starts
    // refusing input for reasons nothing on screen explains.
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('60')
  })

  it('shows an optional leading icon before the label, at every label position', () => {
    expect(mountField().find('.app-field__label-icon').exists()).toBe(false)

    for (const labelPos of ['embed', 'front', 'back'] as const) {
      const wrapper = mountField({ labelIcon: 'fan', labelPos })
      expect(wrapper.find('.app-field__label-icon').exists(), labelPos).toBe(true)
      expect(wrapper.get('.app-field__label').text(), labelPos).toBe('Retract speed')
    }
  })

  it('aligns a value from its label position unless align overrides it', () => {
    // An embedded label already answers "which value is this", so the value
    // sits next to it rather than end-aligned against a distant unit. A label
    // outside the box is in a column of values, which is what end-alignment is for.
    expect(mountField().get('input').classes()).toContain('app-field__input--start')
    expect(mountField({ labelPos: 'front' }).get('input').classes()).toContain(
      'app-field__input--end',
    )
    expect(mountField({ labelPos: 'back' }).get('input').classes()).toContain(
      'app-field__input--end',
    )
    // Either default can be overridden, and the override wins over label position.
    expect(mountField({ align: 'end' }).get('input').classes()).toContain('app-field__input--end')
  })

  it('lets ariaLabel override the accessible name without changing the visible notch', () => {
    // Movement's axis boxes put a bracketed reading in the notch — "[175.4]"
    // is the honest visible text but a wrong accessible name for a field that
    // types a target, not a reading.
    const wrapper = mountField({ label: '[175.4]', ariaLabel: 'Target X' })

    expect(wrapper.get('.app-field__label').text()).toBe('[175.4]')
    expect(wrapper.get('input').attributes('aria-label')).toBe('Target X')
  })

  it('places the label and the unit on whichever edge it is told', () => {
    const wrapper = mountField({ labelAlign: 'end', unit: '%', unitAlign: 'start' })

    expect(wrapper.get('.app-field__label').classes()).toContain('app-field__label--end')
    // A leading unit is before the input in DOM order, not merely drawn there.
    // Filtered rather than indexed, because an embedded field's notch is also a
    // child of the box — it has to be, or `labelAlign="end"` measures its inset
    // from a box that includes the stepper column.
    const order = [...wrapper.get('.app-field__box').element.children]
      .map((child) => child.className)
      .filter((name) => /app-field__(unit|input)/.test(name))
    expect(order[0]).toContain('app-field__unit')
    expect(order[1]).toContain('app-field__input')
  })

  it('places the label before, inside, or after the complete control', () => {
    // The embedded notch is inside the box so its edges are the box's edges.
    const embedded = mountField({ steppers: true })
    expect(embedded.get('.app-field__box').find('.app-field__label').exists()).toBe(true)

    const front = mountField({ labelPos: 'front', steppers: true })
    const frontOrder = [...front.get('.app-field').element.children].map(
      (child) => (child as HTMLElement).className,
    )
    expect(frontOrder).toEqual([
      'app-field__label app-field__label--start',
      'app-field__box app-field__box--sm',
      'app-field__steppers',
    ])

    const back = mountField({ labelPos: 'back', steppers: true })
    const backOrder = [...back.get('.app-field').element.children].map(
      (child) => (child as HTMLElement).className,
    )
    expect(backOrder).toEqual([
      'app-field__box app-field__box--sm',
      'app-field__steppers',
      'app-field__label app-field__label--start',
    ])
  })

  it('puts the size tier on the complete field, not only its input box', () => {
    expect(mountField().get('.app-field').classes()).toContain('app-field--size-sm')
    expect(mountField({ size: 'md' }).get('.app-field').classes()).toContain('app-field--size-md')
    expect(mountField({ size: 'xs' }).get('.app-field').classes()).toContain('app-field--size-xs')
  })

  it('draws no steppers unless asked, and both when asked', () => {
    expect(mountField().find('.app-field__steppers').exists()).toBe(false)

    const wrapper = mountField({ steppers: true })
    const buttons = wrapper.findAll('.app-field__steppers button')
    expect(buttons).toHaveLength(2)
    // Up then down stays the DOM and reading order when the pair becomes a
    // vertical column; CSS changes the axis, not the controls' semantics.
    expect(buttons[0]?.attributes('aria-label')).toBe(
      i18n.global.t('field.increase', { field: 'Retract speed' }),
    )
    expect(buttons[1]?.attributes('aria-label')).toBe(
      i18n.global.t('field.decrease', { field: 'Retract speed' }),
    )
    expect(buttons.every((button) => button.classes('app-field__stepper'))).toBe(true)
    expect(wrapper.findAll('.app-field__stepper-icon')).toHaveLength(2)
  })

  it('reveals reset only when an enabled field differs from its configured value', async () => {
    const wrapper = mountField({ canReset: true, resetValue: 60 })

    expect(wrapper.find('.app-field__reset').exists()).toBe(false)

    await wrapper.setProps({ modelValue: 75 })
    const reset = wrapper.get('.app-field__reset')
    expect(reset.attributes('aria-label')).toBe(
      i18n.global.t('field.reset', { field: 'Retract speed' }),
    )

    await wrapper.setProps({ canReset: false })
    expect(wrapper.find('.app-field__reset').exists()).toBe(false)
  })

  it('puts reset furthest right inside the input box', () => {
    const wrapper = mountField({ canReset: true, resetValue: 42, unit: 'mm/s', steppers: true })
    const box = wrapper.get('.app-field__box')

    expect(box.find('.app-field__reset').exists()).toBe(true)
    expect(box.element.lastElementChild?.classList).toContain('app-field__reset')
    expect(wrapper.get('.app-field__steppers').find('.app-field__reset').exists()).toBe(false)
  })

  it('marks the box so an embedded label reserves the visible reset action', async () => {
    const wrapper = mountField({
      label: 'Retraction speed while printing',
      modelValue: 75,
      canReset: true,
      resetValue: 60,
    })

    expect(wrapper.get('.app-field__box').classes()).toContain('app-field__box--has-reset')

    await wrapper.setProps({ modelValue: 60 })
    expect(wrapper.get('.app-field__box').classes()).not.toContain('app-field__box--has-reset')
  })

  it('commits the configured value when reset is pressed', async () => {
    const wrapper = mountField({ modelValue: 75, canReset: true, resetValue: 60 })

    await wrapper.get('.app-field__reset').trigger('click')

    expect(wrapper.props('modelValue')).toBe(60)
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('60')
    expect(wrapper.emitted('commit')?.at(-1)).toEqual([60])
    expect(wrapper.find('.app-field__reset').exists()).toBe(false)
  })

  it('does not let a disabled reset commit', async () => {
    const wrapper = mountField({ modelValue: 75, canReset: true, resetValue: 60, disabled: true })
    const reset = wrapper.get('.app-field__reset')

    expect((reset.element as HTMLButtonElement).disabled).toBe(true)
    await reset.trigger('click')
    expect(wrapper.emitted('commit')).toBeUndefined()
  })

  it('can reserve the stepper footprint without drawing controls', () => {
    const wrapper = mountField({ reserveStepperSpace: true })

    expect(wrapper.get('.app-field').classes()).toContain('app-field--reserve-steppers')
    expect(wrapper.find('.app-field__steppers').exists()).toBe(false)

    const stepped = mountField({ steppers: true, reserveStepperSpace: true })
    expect(stepped.get('.app-field').classes()).not.toContain('app-field--reserve-steppers')
  })

  it('steps by the step and rounds onto its precision', async () => {
    // Binary addition of 0.05 does not stay on two decimals by itself: 0.1 + 0.05
    // is 0.15000000000000002, a value Klipper accepts and nobody wants to read.
    // The precision comes from the step itself rather than a second prop that
    // could disagree with it.
    const wrapper = mountField({ modelValue: 0.1, step: 0.05, min: 0, steppers: true })
    await wrapper.findAll('.app-field__steppers button')[0]?.trigger('click')

    expect(wrapper.props('modelValue')).toBe(0.15)
    // A stepper press is a whole edit, not a keystroke on the way to one, so it
    // commits: a caller listening only to `@commit` would otherwise watch the
    // number change on screen and never be told.
    expect(wrapper.emitted('commit')?.at(-1)).toEqual([0.15])
  })

  it('holds a stepped value inside its bounds', async () => {
    const atCeiling = mountField({ modelValue: 100, max: 100, step: 1, steppers: true })
    await atCeiling.findAll('.app-field__steppers button')[0]?.trigger('click')
    expect(atCeiling.props('modelValue')).toBe(100)

    const atFloor = mountField({ modelValue: 0, min: 0, step: 1, steppers: true })
    await atFloor.findAll('.app-field__steppers button')[1]?.trigger('click')
    expect(atFloor.props('modelValue')).toBe(0)
  })

  /*
   * The regression this component exists for. It has never had a test, because
   * the guard lived in each of several call sites rather than anywhere a test
   * could reach one of them.
   *
   * The temperature preset editor shipped bound straight to stored state and was
   * unusable against a connected printer: status arrives about four times a
   * second, and every push reset the field before a second character could be
   * typed. Every fixture passed, because no fixture changes that fast — so the
   * tests below change the value from outside deliberately, which is the thing
   * no fixture was doing.
   */
  it('does not let an outside change overwrite the box while it is being edited', async () => {
    const wrapper = mountField({ modelValue: 60 })
    const input = wrapper.get('input')

    await input.trigger('focus')
    await type(input, '75')
    // What a live printer's status push looks like from in here.
    await wrapper.setProps({ modelValue: 60 })

    expect((input.element as HTMLInputElement).value).toBe('75')
    // And the edit wins on the way out too. Guarding only the visible text would
    // leave the caller's own state holding 60 — which is what Apply reads, so the
    // typed number would vanish the moment the box lost focus.
    expect(wrapper.props('modelValue')).toBe(75)
  })

  it('re-seeds from the outside once the box is no longer being edited', async () => {
    const wrapper = mountField({ modelValue: 60 })
    const input = wrapper.get('input')

    await input.trigger('focus')
    await input.trigger('blur')
    await wrapper.setProps({ modelValue: 42 })

    expect((input.element as HTMLInputElement).value).toBe('42')
  })

  it('keeps a half-typed value verbatim instead of round-tripping it', async () => {
    // The draft is a string because it has to hold what a half-typed number looks
    // like: `Number('0.')` is `0`, so a numeric draft turns `0.` back into `0` and
    // the next digit lands in the wrong place.
    //
    // Driven through a text field because a number input sanitizes its own value
    // — `0.` is not a valid floating-point literal, so the DOM stores `''` and
    // the intermediate cannot be observed there at all. What protects the number
    // case is the focus guard above: nothing writes over the box mid-edit, so the
    // browser's own raw text survives until it parses.
    const wrapper = mountField({ modelValue: '0', type: 'text' })
    const input = wrapper.get('input')

    await input.trigger('focus')
    await type(input, '0.')

    expect((input.element as HTMLInputElement).value).toBe('0.')
  })

  it('treats an emptied box as empty rather than as a zero', async () => {
    const wrapper = mountField({ modelValue: 60 })
    const input = wrapper.get('input')

    await input.trigger('focus')
    await type(input, '')

    // The model keeps the last value it had; `Number('')` is 0, and a field that
    // silently commits a zero when cleared is a retraction speed of nothing.
    expect(wrapper.props('modelValue')).toBe(60)
    // Commit reports the emptiness so a caller can apply its own default.
    await pressEnter(input)
    expect(wrapper.emitted('commit')?.at(-1)).toEqual([null])

    // Leaving an empty box shows the value again, because empty was never one.
    await input.trigger('blur')
    expect((input.element as HTMLInputElement).value).toBe('60')
  })

  it('commits on Enter rather than per keystroke, for a field that is a command', async () => {
    const wrapper = mountField({ modelValue: 100 })
    const input = wrapper.get('input')

    await input.trigger('focus')
    await type(input, '5')
    await type(input, '50')

    // On the way to 50 the box reads 5, and 5 is a real value: a caller that
    // dispatched per keystroke would send it. Nothing has committed yet.
    expect(wrapper.emitted('commit')).toBeUndefined()

    await pressEnter(input)
    expect(wrapper.emitted('commit')).toEqual([[50]])
  })

  /**
   * The regression Movement's axis boxes shipped with: a browser's own
   * `change` event fires on blur too, the instant a modified field loses
   * focus, so a naive `@change` listener commits on blur exactly as readily
   * as on Enter. Typing a target and clicking away without pressing Enter
   * moved the toolhead to it anyway — leaving abandons an edit, it does not
   * send it.
   */
  it('abandons an edit left without Enter, for a field with nothing relaying it back', async () => {
    const wrapper = mountOneWay()
    const input = wrapper.get('input')

    await input.trigger('focus')
    await type(input, '205.5')
    await input.trigger('blur')

    // Nothing relays `update:modelValue` for this caller, so the typed value
    // has nowhere to go but this component's own local copy of the model —
    // and blurring without committing has to give it back rather than strand
    // it on a value the caller was never told about.
    expect((input.element as HTMLInputElement).value).toBe('100')
    expect(wrapper.emitted('commit')).toBeUndefined()
  })

  it('sends an edit left with Enter even without anything relaying the model back', async () => {
    const wrapper = mountOneWay()
    const input = wrapper.get('input')

    await input.trigger('focus')
    await type(input, '205.5')
    await pressEnter(input)
    await input.trigger('blur')

    expect(wrapper.emitted('commit')).toEqual([[205.5]])
    expect((input.element as HTMLInputElement).value).toBe('205.5')
  })

  it('renders a text field read-only without pretending it is disabled', () => {
    // `readonly` is the accurate state for a value read from printer.cfg —
    // only changing it is unavailable — where `disabled` would claim a control
    // that might become usable and dim the whole field for it.
    const wrapper = mountField({ modelValue: 'tanh', type: 'text', readonly: true })
    const input = wrapper.get('input').element as HTMLInputElement

    expect(input.value).toBe('tanh')
    expect(input.readOnly).toBe(true)
    expect(input.disabled).toBe(false)
  })

  /*
   * A read-only field is a reading, not a control. Left as a plain `readonly`
   * input it was still a focus target: clicking one put a caret in it, and
   * Chromium goes on painting an input's selection after it is blurred, so a
   * stray click left a value looking marked on a card the reader had already
   * moved on from — with nothing to click to clear it.
   *
   * The `<label>` is the part that cannot be fixed with an attribute: its whole
   * job is forwarding a click into the control it wraps, so a read-only field
   * is not wrapped in one, and names its input from the same words instead.
   */
  it('makes a read-only field inert rather than merely uneditable', () => {
    const wrapper = mountField({ modelValue: 'tanh', type: 'text', readonly: true })

    expect(wrapper.find('label').exists()).toBe(false)
    expect(wrapper.get('.app-field').element.tagName).toBe('SPAN')
    expect(wrapper.get('input').attributes('tabindex')).toBe('-1')
    // The notch is still the visible name, and now the accessible one too.
    expect(wrapper.get('.app-field__label').text()).toBe('Retract speed')
    expect(wrapper.get('input').attributes('aria-label')).toBe('Retract speed')
  })

  /*
   * Vue patches an element's props in the order the template writes them, so
   * a field switching from `number` to `text` — `MovementModule`'s X/Y/Z
   * boxes, the moment an axis stops reading as homed — gets its em dash while
   * the input is still numeric if `:value` comes first. Chromium refuses the
   * text, keeps the empty string, and carries that emptiness through the type
   * change, so the placeholder never appears and the box simply goes blank.
   *
   * Pinned against the source because it cannot be pinned against a mounted
   * component: jsdom does not implement a number input's value sanitisation,
   * so both orders render the dash there and only a browser can tell them
   * apart.
   */
  it('sets an input its type before its value, so a dash can replace a number', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'components', 'AppField.vue'), 'utf8')
    const input = /<input\b[\s\S]*?\/>/u.exec(source)?.[0] ?? ''

    expect(input).toContain(':type="type"')
    expect(input.indexOf(':type="type"')).toBeLessThan(input.indexOf(':value="draft"'))
  })

  it('keeps an editable field label-wrapped and in the tab sequence', () => {
    const wrapper = mountField()

    expect(wrapper.get('.app-field').element.tagName).toBe('LABEL')
    expect(wrapper.get('input').attributes('tabindex')).toBeUndefined()
    // An editable field is named by the `<label>` that wraps it, so it carries
    // no `aria-label` of its own unless a caller overrides the visible words.
    expect(wrapper.get('input').attributes('aria-label')).toBeUndefined()
  })
})
