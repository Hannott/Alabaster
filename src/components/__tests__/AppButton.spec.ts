import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { computed, defineComponent, h, ref } from 'vue'

import AppButton from '@/components/AppButton.vue'
import type { ActionGuardResult } from '@/composables/useActionGuard'

/**
 * A stand-in for `useActionGuard`'s result. The composable has its own tests;
 * what belongs here is that `AppButton` reads both halves of whatever it is
 * handed, since binding one and forgetting the other was the failure the single
 * `guard` prop exists to make impossible.
 */
function fakeGuard(variant: string | null, bind: Record<string, string>): ActionGuardResult {
  return {
    tier: computed(() => 'terminal' as const),
    guarded: computed(() => true),
    variant: computed(() => variant),
    bind: computed(() => bind),
    request: (run: () => void) => run(),
  }
}

describe('AppButton', () => {
  it('defaults to type=button, so one inside a form does not submit it', () => {
    // The single most common reason a hand-written control misbehaved: a
    // `<button>` with no type is a submit button.
    expect(mount(AppButton, { props: { label: 'Save' } }).attributes('type')).toBe('button')
    expect(mount(AppButton, { props: { label: 'Save', type: 'submit' } }).attributes('type')).toBe(
      'submit',
    )
  })

  it('composes exactly the classes its props name, and nothing for the defaults', () => {
    // `neutral` is the unmodified base and must not emit a class of its own; a
    // `button--neutral` in the output would be a selector the stylesheet does
    // not define. `md` stays the bare `.button` CSS shape, so the `sm` prop
    // default -- a deliberate deviation from that shape -- still emits
    // `button--sm` even though nothing was passed explicitly.
    expect(mount(AppButton, { props: { label: 'Go' } }).classes()).toEqual(['button', 'button--sm'])

    const decorated = mount(AppButton, {
      props: {
        label: 'Go',
        variant: 'danger',
        size: 'sm',
        block: true,
        start: true,
        mono: true,
        badged: true,
        onSoft: true,
      },
    })
    expect(decorated.classes().sort()).toEqual(
      [
        'button',
        'button--badged',
        'button--block',
        'button--danger',
        'button--on-soft',
        'button--sm',
        'button--start',
        'button--value',
      ].sort(),
    )
  })

  it('squares a control that renders no label, and only that one', () => {
    /*
     * Vue hands every component a `default` slot function whether or not the
     * call site wrote children, so "does the slot exist" reported every icon
     * button as labeled and left it an oblong. The question has to be what the
     * slot renders — including a `v-if` that went false, which leaves a comment
     * placeholder behind rather than nothing.
     */
    expect(mount(AppButton, { props: { icon: 'close' } }).classes()).toContain('button--icon')
    expect(mount(AppButton, { props: { icon: 'close', label: 'Close' } }).classes()).not.toContain(
      'button--icon',
    )
    expect(
      mount(AppButton, { props: { icon: 'close' }, slots: { default: () => [] } }).classes(),
    ).toContain('button--icon')
    expect(
      mount(AppButton, { props: { icon: 'close' }, slots: { default: () => 'Close' } }).classes(),
    ).not.toContain('button--icon')
  })

  it('forces the square shape on request, since an absent boolean prop is false', () => {
    // Vue casts a missing boolean prop to `false`, not `undefined`, so the
    // override can only ever be force-on. A caller passing content through a
    // slot it also hides needs that.
    const forced = mount(AppButton, {
      props: { iconOnly: true },
      slots: { default: () => 'hidden at this width' },
    })
    expect(forced.classes()).toContain('button--icon')
  })

  it('sizes a leading icon from the control size rather than from the caller', () => {
    const md = mount(AppButton, { props: { icon: 'close', size: 'md' } })
    expect(md.find('svg').classes()).toContain('size-5')

    for (const size of ['sm', 'xs'] as const) {
      const dense = mount(AppButton, { props: { icon: 'close', size } })
      expect(dense.find('svg').classes(), size).toContain('size-4')
    }

    // Outlier 8 buys glyph size with padding, so it keeps the larger glyph
    // inside a dense control.
    const large = mount(AppButton, { props: { icon: 'close', size: 'sm', iconLg: true } })
    expect(large.find('svg').classes()).toContain('size-5')
    expect(large.classes()).toContain('button--icon-lg')

    // An icon is the fixed part of a control; the label is what may truncate.
    expect(md.find('svg').classes()).toContain('shrink-0')
  })

  it('takes both halves of an action guard from one prop', () => {
    const wrapper = mount(AppButton, {
      props: {
        label: 'Cancel print',
        guard: fakeGuard('button--danger', { 'data-guard': 'confirm', 'aria-haspopup': 'dialog' }),
      },
    })
    expect(wrapper.classes()).toContain('button--danger')
    expect(wrapper.attributes('data-guard')).toBe('confirm')
    expect(wrapper.attributes('aria-haspopup')).toBe('dialog')
  })

  it('lets the guard decide the variant, so a call site cannot contradict it', () => {
    // `useActionGuard` derives emphasis rather than accepting it. A `variant`
    // beside a `guard` is a call site asserting something the guard already
    // decided, and the guard wins.
    const wrapper = mount(AppButton, {
      props: { label: 'Restart', variant: 'primary', guard: fakeGuard('button--critical', {}) },
    })
    expect(wrapper.classes()).toContain('button--critical')
    expect(wrapper.classes()).not.toContain('button--primary')
  })

  it('disables a pending control as well as marking it', () => {
    // The two were never separable: a pending button that still takes clicks
    // sends the command a second time.
    const wrapper = mount(AppButton, { props: { label: 'Save', pending: true } })
    expect(wrapper.attributes('data-pending')).toBe('true')
    expect(wrapper.attributes('disabled')).toBeDefined()

    const idle = mount(AppButton, { props: { label: 'Save' } })
    expect(idle.attributes('data-pending')).toBeUndefined()
  })

  it('passes every attribute and listener it does not declare straight through', () => {
    // The reason this component can stay thin: `title`, `aria-*`, and listeners
    // need no prop of their own.
    let clicks = 0
    const wrapper = mount(AppButton, {
      props: { label: 'Stop' },
      attrs: {
        title: 'Stop the print',
        'aria-pressed': 'true',
        'data-testid': 'stop',
        onClick: () => (clicks += 1),
      },
    })
    expect(wrapper.attributes('title')).toBe('Stop the print')
    expect(wrapper.attributes('aria-pressed')).toBe('true')
    expect(wrapper.attributes('data-testid')).toBe('stop')
    wrapper.trigger('click')
    expect(clicks).toBe(1)
  })

  it('merges a caller class rather than replacing the composed ones', () => {
    // Feature classes still exist — `machine-editor-action`, `jog-pivot` — and
    // they layer on top of the system rather than instead of it.
    const wrapper = mount(AppButton, {
      props: { label: 'Save', size: 'sm' },
      attrs: { class: 'machine-editor-action' },
    })
    expect(wrapper.classes()).toContain('machine-editor-action')
    expect(wrapper.classes()).toContain('button')
    expect(wrapper.classes()).toContain('button--sm')
  })

  it('renders the label in an element, because two rules already reach for one', () => {
    // `.machine-editor-action span` collapses the editor toolbar's labels
    // together below a 55rem pane, and `.machine-structure .button >
    // span:first-child` truncates a section name. A bare text node has nothing
    // for either to select.
    const wrapper = mount(AppButton, { props: { label: 'Save' } })
    expect(wrapper.find('span').exists()).toBe(true)
    expect(wrapper.find('span').text()).toBe('Save')
  })

  it('exposes focus, which wrapping a native button would otherwise hide', () => {
    // The icon picker moves focus onto the selected tile as its dialog opens;
    // a dialog that opens with focus nowhere is a keyboard trap.
    const host = defineComponent({
      setup() {
        const control = ref<InstanceType<typeof AppButton> | null>(null)
        return { control }
      },
      render() {
        return h(AppButton, { ref: 'control', label: 'Focus me' })
      },
    })
    const wrapper = mount(host, { attachTo: document.body })
    wrapper.vm.control?.focus()
    expect(document.activeElement).toBe(wrapper.find('button').element)
    wrapper.unmount()
  })
})
