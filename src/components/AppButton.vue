<script setup lang="ts">
/**
 * The one button.
 *
 * `docs/design/button-system.md` is still the authority for *which* variant and
 * size a control wears, and `main.css` still holds the rules that draw them.
 * This component owns the third thing, which previously had no owner: the
 * **composition** — which class names combine into a legal control, and what
 * else has to be true once they do.
 *
 * That document originally argued against exactly this component, on the
 * grounds that "a `BaseButton.vue` would have to re-expose `type`, `disabled`,
 * `aria-*`, `title`, and every listener to earn nothing". The first half turned
 * out to be false — Vue's attribute fallthrough re-exposes all of it for free,
 * so this component declares none of them — and the second half was measured
 * against the wrong thing. A class-string system has no way to reject an
 * illegal combination, and 336 hand-written class strings drifted in four ways
 * that CSS cannot catch:
 *
 * - **`type="button"` is load-bearing and omissible.** A `<button>` inside a
 *   `<form>` defaults to `type="submit"`. Every call site had to remember;
 *   here it is the default and a caller opts out.
 * - **Icon size is a function of button size, and was written by hand.** The
 *   guard test in `interactionConsistency.spec.ts` exists solely because the
 *   product drifted to `size-4` everywhere and left every `md` button with a
 *   visibly undersized glyph. `iconClass` below derives it instead, so the
 *   drift has nowhere to enter.
 * - **`button--icon` is what makes an icon-only control square**, and nothing
 *   failed when it was forgotten — the button just came out an odd oblong.
 *   `isIconOnly` derives it from whether there is a label at all.
 * - **`data-pending` and `disabled` must move together.** A pending control
 *   that still takes clicks fires the command twice; that pairing was written
 *   out at each site, and at some sites only half of it was.
 *
 * The component is deliberately thin everywhere else. It adds no state, no
 * focus management, and no keyboard behavior, because a button needs none —
 * `AGENTS.md`'s preference for small native elements is satisfied by rendering
 * exactly one native `<button>` with everything the caller passed on it.
 *
 * **What is not a button stays not a button.** `file-select`, `tab-select`,
 * `text-action`, and `brand-trigger` are the four patterns that document
 * themselves as outside this system, and the emergency stop is a fifth. None
 * of them may be built from this component; reaching for it there is how
 * button chrome ends up on a file name again.
 */
import { Comment, Fragment, Text, computed, ref, useSlots, type VNode } from 'vue'

import AppIcon, { type AppIconName } from '@/components/AppIcon.vue'
import type { ActionGuardResult } from '@/composables/useActionGuard'

/** The six emphasis variants, in the document's own descending order. */
export type AppButtonVariant =
  'critical' | 'primary' | 'danger' | 'neutral' | 'quiet' | 'danger-quiet'

export type AppButtonSize = 'md' | 'sm' | 'xs'

const props = withDefaults(
  defineProps<{
    /**
     * Emphasis. `neutral` is the default and carries no class of its own.
     *
     * Pass nothing rather than `'neutral'` at a call site that has no opinion;
     * the explicit value exists for a caller computing one variant among
     * several. A `guard` overrides this entirely — see below.
     */
    variant?: AppButtonVariant | undefined
    size?: AppButtonSize | undefined
    /**
     * A guard from `useActionGuard`, which then decides both the variant and
     * the `data-guard` / `data-tier` / `aria-haspopup` attributes.
     *
     * Passing the whole result rather than its two halves is the point. The
     * halves were bound separately at every site — `:class="g.variant.value"`
     * beside `v-bind="g.bind.value"` — and a site that bound one and forgot the
     * other got a control whose livery and whose dialog disagreed, which is the
     * exact failure the composable was written to make impossible. One prop
     * cannot be half-bound.
     *
     * The variant is read off the guard and never merged with `variant`: the
     * composable derives emphasis rather than accepting it, so a call site able
     * to contribute its own could contradict the guard beside it.
     */
    guard?: ActionGuardResult | undefined
    /**
     * Leading icon. Sized from `size` — never pass a size class for it; see
     * `iconClass`.
     */
    icon?: AppIconName | undefined
    /** Trailing icon, for the caret and chevron pairs that read after a label. */
    iconEnd?: AppIconName | undefined
    /**
     * The button's translated label. Components hold no literal user-facing
     * text, so this takes the output of `t()` — or a bare number, for a `mono`
     * control whose label *is* a value: a step size, a jog distance, a column
     * count. Those are not translatable text and were never routed through
     * `t()` when they were written as interpolations.
     *
     * The default slot is the alternative, for a label that is not one string:
     * a value beside a unit, a name beside a count. Passing both is legal and
     * puts the slot after the label, which is what a label-plus-badge wants.
     */
    label?: string | number | undefined
    /**
     * Forces the square icon-only shape. Otherwise derived from the absence of
     * any rendered label, which is right everywhere in the product today.
     *
     * Force-on only — there is deliberately no way to force it *off*. Vue casts
     * an absent boolean prop to `false` rather than leaving it `undefined`, so a
     * three-state `??` here silently never fell through to the derivation and
     * every icon button came out an oblong. `||` has only two states and cannot
     * lie about which one it is in; forcing the shape off is not a thing any
     * caller needs, since a button with a label already derives `false`.
     */
    iconOnly?: boolean | undefined
    /**
     * Buys glyph size with padding rather than height — outlier 8. Registered
     * per file in `interactionConsistency.spec.ts`, so a new instance has to be
     * argued for in `button-system.md` before it can ship.
     */
    iconLg?: boolean | undefined
    /**
     * Overrides the derived glyph size. The escape hatch for outlier 7, the
     * console send button, whose glyph is the only thing it has to say. Every
     * other caller leaves this alone — the whole reason the component derives
     * the size is that hand-written ones drifted.
     */
    iconClass?: string | undefined
    /** Fills the container inline size. Menu entries and stacked mobile actions. */
    block?: boolean | undefined
    /**
     * Aligns content to the start of the reading direction, for a control that
     * reads as text first: menu entries, list rows, the file-structure outline.
     */
    start?: boolean | undefined
    /** Mono label, for a value rather than a verb: step sizes, speeds. */
    mono?: boolean | undefined
    /** Marks a control that opens something unread. Position only; the label still names it. */
    badged?: boolean | undefined
    /** Flips the neutral fill for a control on `--surface-canvas` or `--surface-soft`. */
    onSoft?: boolean | undefined
    /** Swaps the neutral surface roles for controls on `--surface-strong`. */
    onStrong?: boolean | undefined
    /**
     * Long-running work. Applies the shared breathe **and disables the control**,
     * because the two were never separable: a pending button that still takes
     * clicks sends the command again.
     *
     * Every optional prop here spells out `| undefined` rather than relying on
     * `?` alone. `exactOptionalPropertyTypes` is on, so the two are different
     * types, and a shared primitive is bound to possibly-absent expressions at
     * dozens of sites — `:disabled="capability?.busy"` is the ordinary case. A
     * `withDefaults` entry would undo the widening by making the prop required
     * again, which is why only `size` and `type` carry one.
     */
    pending?: boolean | undefined
    disabled?: boolean | undefined
    /**
     * Defaults to `button`, which is the whole reason this is a prop. A
     * `<button>` with no type inside a `<form>` submits it.
     */
    type?: 'button' | 'submit' | 'reset' | undefined
  }>(),
  { size: 'sm', type: 'button' },
)

const slots = useSlots()

/**
 * Whether a slot puts anything on the page.
 *
 * `slots.default` is the wrong question and answers it wrongly: Vue hands a
 * component a `default` slot function whether or not the call site wrote any
 * children, so testing the function's existence reported every icon button as
 * having a label. What is left after a `v-if` goes false is a comment
 * placeholder, and a fragment can wrap either — so the check has to look at
 * what the slot actually returns, and recurse.
 */
function rendersAnything(nodes: VNode[] | undefined): boolean {
  if (!nodes) return false
  return nodes.some((node) => {
    if (node.type === Comment) return false
    if (node.type === Text) return String(node.children).trim() !== ''
    if (node.type === Fragment) return rendersAnything(node.children as VNode[])
    return true
  })
}

/**
 * A control with no words is square. Derived rather than declared so that
 * `button--icon` cannot be forgotten — the failure it prevents is silent, since
 * an icon-only button missing it renders as a legible oblong rather than as
 * anything obviously wrong.
 */
const isIconOnly = computed(
  () => props.iconOnly || (props.label === undefined && !rendersAnything(slots.default?.())),
)

/**
 * The variant class, from the guard where there is one.
 *
 * `guard.variant` already yields `null` for the neutral default, which is the
 * same thing this returns for `variant: 'neutral'` — neutral is the unmodified
 * base and has no class.
 */
const variantClass = computed(() => {
  if (props.guard) return props.guard.variant.value
  if (props.variant === undefined || props.variant === 'neutral') return null
  return `button--${props.variant}`
})

/**
 * Glyph size as a function of control size — `button-system.md`'s size scale,
 * applied rather than restated at 336 call sites. `iconLg` keeps `size-5`
 * inside a dense control, which is what buying glyph size with padding means.
 */
const iconClass = computed(() => {
  if (props.iconClass) return props.iconClass
  // `shrink-0` unconditionally: a glyph is the fixed part of a control and the
  // label is the part that may truncate, so an icon that flex-shrinks turns
  // into an ellipse on a narrow card. Several call sites had learned to write
  // it by hand and several had not.
  if (props.iconLg) return 'size-5 shrink-0'
  return props.size === 'md' ? 'size-5 shrink-0' : 'size-4 shrink-0'
})

const classes = computed(() => [
  'button',
  variantClass.value,
  props.size !== 'md' ? `button--${props.size}` : null,
  isIconOnly.value ? 'button--icon' : null,
  props.iconLg ? 'button--icon-lg' : null,
  props.block ? 'button--block' : null,
  props.start ? 'button--start' : null,
  props.mono ? 'button--value' : null,
  props.badged ? 'button--badged' : null,
  props.onSoft ? 'button--on-soft' : null,
  props.onStrong ? 'button--on-strong' : null,
])

/**
 * The rendered control, so the component can hand back the one thing a caller
 * used to get for free from a template ref on a native `<button>`.
 *
 * Wrapping an element in a component hides its DOM methods behind the instance,
 * and `focus()` is the one this product actually calls: the icon picker moves
 * focus onto the selected tile when the dialog opens, and a dialog that opens
 * with focus nowhere is a keyboard trap rather than a cosmetic slip. Exposing
 * it keeps those call sites reading exactly as they did.
 */
const el = ref<HTMLButtonElement | null>(null)

defineExpose({
  focus: (options?: FocusOptions) => el.value?.focus(options),
  /** The element itself, for a caller that needs geometry rather than focus. */
  el,
})
</script>

<template>
  <button
    ref="el"
    :type="type"
    :class="classes"
    :disabled="disabled || pending"
    :data-pending="pending ? 'true' : undefined"
    v-bind="guard?.bind.value"
  >
    <AppIcon v-if="icon" :name="icon" :class="iconClass" aria-hidden="true" />
    <!--
      The label renders before the slot so a caller may pass both: the string is
      the control's name, and the slot is whatever hangs off it.

      A bare `<span>`, and it must stay an element rather than a text node: two
      rules already reach for it. `.machine-editor-action span` is how Save,
      Save and restart, and Discard changes drop their labels together below a
      55rem editor pane, and `.machine-structure .button > span:first-child`
      truncates a section name to the outline's width. Both predate this
      component and both match the markup it now generates.
    -->
    <span v-if="label !== undefined">{{ label }}</span>
    <slot />
    <AppIcon v-if="iconEnd" :name="iconEnd" :class="iconClass" aria-hidden="true" />
  </button>
</template>
