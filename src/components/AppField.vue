<script setup lang="ts" generic="T extends number | string | null | undefined">
/**
 * The one text and number field.
 *
 * One component whose props describe its anatomy. `labelPos="embed"` notches
 * the label into the field's own top border, `front` places it before the
 * control, and `back` places it after the complete control. Layout outside the
 * field is deliberately not part of this component: a module may place several
 * AppFields in an ordinary grid, but there is no AppField-specific grid or a
 * variant that silently bundles several design decisions together.
 *
 * **This component owns the in-progress value, and that is the point of it.**
 * `docs/design/interface-standards.md` carries a hard rule with a scar
 * attached: a field renders from a draft, never from the value it commits to.
 * Vue re-applies a `:value` binding on every render whether or not the bound
 * value changed, a connected printer pushes status several times a second, and
 * the temperature preset editor shipped bound straight to stored state — every
 * push reset the input before a second character could be typed, and every
 * fixture passed because no fixture changes that fast. The rule existed; what
 * did not exist was anywhere to put it, so several call sites each grew their
 * own draft ref and their own focus guard, and each one was a fresh chance to
 * forget — `MachineModule` is the one that did, and its motion limits were
 * re-seeded mid-edit by any status push that reported them.
 *
 * The draft is a **string**, not a number, because it has to be able to hold
 * what a half-typed number looks like. `Number('0.')` is `0`, so a numeric
 * draft eats the decimal point between `0.` and `0.5` — the exact bug
 * `ExtruderModule`'s own comment describes. The string is what the box shows;
 * the model gets the parsed value.
 *
 * **An empty box is not a zero.** Clearing the field leaves the model holding
 * the last value it had and reports `null` through `commit` instead, so a
 * caller can apply its own default rather than receiving the `0` that
 * `Number('')` hands out. Blurring an empty box shows that last value again,
 * because "empty" was never a value the field had.
 *
 * Two ways to read the value back out, and the difference matters:
 *
 * - `v-model` is live, updated as the box is typed in. This is for a field in a
 *   form whose Apply button reads several of them at once.
 * - `@commit` fires only when the field commits — Enter, or a stepper press,
 *   which is a whole edit rather than a keystroke on the way to one. This is
 *   for a field that *is* the command: a settings row that saves on change, or
 *   a field paired with a slider, where `5` on the way to `50` is a real value
 *   that must not be sent. Such a caller binds `:model-value` one-way and
 *   listens to `@commit`; the draft plus the focus guard is what keeps the
 *   value it renders from fighting the typing.
 *
 * Blur is deliberately **not** a commit, even though a browser's own `change`
 * event fires on it the same as on Enter: leaving a field is how an edit is
 * abandoned, not how it is sent — the axis boxes in `MovementModule` are
 * typed positions with no Set button, and clicking away from one must not
 * move the toolhead to whatever was typed on the way to a target the user
 * changed their mind about.
 */
import { computed, getCurrentInstance, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon, { type AppIconName } from '@/components/AppIcon.vue'

const props = withDefaults(
  defineProps<{
    /**
     * The field's own label, already translated — components hold no literal
     * user-facing text, so this takes the output of `t()`. It is also the
     * accessible name by default, and the steppers always build theirs from
     * it, whether or not `ariaLabel` overrides the name below.
     */
    label: string
    /**
     * Optional leading icon before the label, matching `AppSlider`'s own —
     * both components name a field the same way, so both mark it the same
     * way. Decorative only; the accessible name still comes from `label` or
     * `ariaLabel`.
     */
    labelIcon?: AppIconName
    /**
     * Overrides the accessible name the input reports, while `label` keeps
     * naming the visible notch. The two agree almost everywhere in the product,
     * because a field's own words are usually the honest name for it. This
     * exists for the bounded case where the notch holds a **reading** instead:
     * a number the field reports beside the one it sets. A screen reader
     * announcing that number where the field's name belongs would say what the
     * box shows rather than what typing into it does.
     *
     * Such a label is written in brackets — `[175.4]`, `[25.0]` — so a reader
     * sees it is a reading rather than the box's name before it changes; that
     * convention is `interface-standards.md`'s, and both instances follow it.
     *
     * Two instances, and adding a third belongs in this list:
     *
     * - **Movement's axis boxes** put the toolhead's actual position in the
     *   notch above the coordinate typed into the box.
     * - **Temperatures' sensor rows** put the live reading there above the
     *   target — which is what let that table drop both its numeric headings,
     *   so the notch is now the only place the card states the reading. The
     *   name folds the reading back in for that reason, rather than naming the
     *   target alone: `targetFieldLabel` in `TemperaturesModule.vue`.
     */
    ariaLabel?: string
    /** Where the visible label sits relative to the complete field control. */
    labelPos?: 'embed' | 'front' | 'back'
    /** Which edge the digits hug. Defaults from label position; see `alignment`. */
    align?: 'start' | 'end'
    /** Which end of the border an embedded label notch sits at. */
    labelAlign?: 'start' | 'end'
    /** A translated unit — `mm/s`, `%`. Never a character typed inside the box. */
    unit?: string
    /**
     * Translated stand-in for a value the field genuinely does not have yet —
     * a setting the printer has not reported. Not a label substitute and not a
     * hint: the notched label already names the field, so anything here is read
     * as "this is empty, and here is why".
     */
    placeholder?: string
    /** Suffix by default; `start` for the rare unit that reads before its value. */
    unitAlign?: 'start' | 'end'
    /** Draws the paired step buttons. Does not change the field's height. */
    steppers?: boolean
    /**
     * Reserves the paired step buttons' width without drawing them. Use when a
     * plain field must align with a steppered peer; the decision belongs to the
     * field rather than to a parent selector inspecting its children.
     */
    reserveStepperSpace?: boolean
    size?: 'md' | 'sm' | 'xs'
    type?: 'number' | 'text'
    min?: number
    max?: number
    /**
     * The typing step, and what one stepper press moves the value by. It also
     * fixes the precision a stepped value is rounded back onto: binary addition
     * of `0.05` does not stay on two decimals by itself, and a value that
     * drifts to `0.15000000000000002` is one Klipper accepts and nobody wants
     * to read.
     */
    step?: number
    /**
     * Enables the config-value reset affordance. The button is derived rather
     * than manually toggled: it exists only while the field's committed value
     * differs from `resetValue`, and sits at the trailing edge inside the box.
     *
     * Reset is a normal commit boundary. Pressing it updates the draft, model,
     * and committed value together, then emits `commit` with the exact reset
     * value so a one-way command field persists the reset through the same
     * handler it uses for Enter and stepper presses.
     */
    canReset?: boolean
    /** The concrete value read from configuration. Omit it when none was read. */
    resetValue?: T
    /**
     * The value can be read and not changed — Extruder's configured pressure
     * advance model, which `SET_PRESSURE_ADVANCE` has no parameter for.
     *
     * **A read-only field is a reading, not a control**, and everything that
     * makes it one follows from that: it is not wrapped in a `<label>`, so no
     * click is forwarded into it; it is out of the tab sequence; and
     * `.app-field__input:read-only` in `app-field.css` takes away its pointer
     * events and its text selection. Left as a plain `readonly` input it was
     * still a focus target that took a caret and a highlight — and because
     * Chromium keeps painting an input's selection after the input is
     * blurred, a stray click left a marked-looking value on a card the reader
     * had already moved on from.
     *
     * `readonly` rather than `disabled` all the same: `disabled` dims the
     * whole field and claims a control that might become usable, where this
     * value is legible and simply not editable — anywhere.
     */
    readonly?: boolean
    disabled?: boolean
  }>(),
  {
    labelPos: 'embed',
    labelAlign: 'start',
    unitAlign: 'end',
    steppers: false,
    reserveStepperSpace: false,
    size: 'sm',
    type: 'number',
    canReset: false,
    readonly: false,
    disabled: false,
  },
)

/**
 * `defineModel` rather than a hand-rolled prop and emit pair, following
 * `AppSelect`, which nominates itself as the canonical v-model example. The
 * component is generic over the value so a caller's own state keeps its exact
 * type — a numeric draft stays `number` rather than widening to a union every
 * caller then has to narrow back.
 *
 * `undefined` is in the constraint for the caller that binds one entry of a
 * record keyed by whatever the printer reported: the key is always present at
 * runtime, because the same status object decides which fields exist, but an
 * index signature cannot say so. It is treated exactly as `null` — an empty box.
 */
const model = defineModel<T>({ required: true })

const emit = defineEmits<{ commit: [value: T | null] }>()

const { t } = useI18n({ useScope: 'global' })

function modelAsText(): string {
  return model.value === null || model.value === undefined ? '' : String(model.value)
}

const draft = ref(modelAsText())
/** One flag, because focus is one field at a time. */
const isFocused = ref(false)

/**
 * Whether a caller relays the model back — `v-model`, or the equivalent
 * `:model-value` plus `@update:model-value` — rather than binding
 * `:model-value` one-way and reading only `@commit`. Read straight off the
 * raw vnode props rather than `useAttrs()`: `defineModel` declares
 * `update:modelValue` as an emit, and Vue omits a declared emit's listener
 * from `attrs`, which would make every caller look un-relayed.
 *
 * The two callers need different answers to "what does blur restore." A
 * relayed caller has no such thing as an uncommitted edit — the model *is*
 * live, which is the entire point of a form whose Apply button reads several
 * of them at once — so `committed` below has to track every value the model
 * takes on. A one-way caller's own writes while typing reach nothing but this
 * component's local copy of the model, since nobody relays them back, and
 * `committed` has to hold still until an actual commit moves it — or blur
 * would restore a value nothing sent, which is what the axis boxes in
 * `MovementModule` did before this existed: typing a target and clicking away
 * without pressing Enter left the box reading a coordinate the printer was
 * never asked to reach.
 */
const isRelayed = !!getCurrentInstance()?.vnode.props?.['onUpdate:modelValue']

/**
 * The value blur restores. Kept separate from `model` because `model` is not
 * trustworthy for this on its own: a one-way caller's `onInput` still has to
 * write it, live, so the box shows what is being typed, and that write is
 * indistinguishable from a genuine external one once it lands — nothing marks
 * it as this component's own echo.
 */
const committed = ref(model.value)

/**
 * A field with an embedded label left-aligns and one with an outside label
 * end-aligns unless told otherwise. Values end-align so that a stacked column
 * of them lines its digits up; an embedded label already answers "which value
 * is this" without a column to read down, and left-aligning puts the value next
 * to that label instead of stranding it against a distant unit.
 */
const alignment = computed(() => props.align ?? (props.labelPos === 'embed' ? 'start' : 'end'))

/**
 * Compare against the last value the field accepted as real, not its draft.
 * A half-typed one-way command must not reveal a reset action for a value the
 * printer has never received. `undefined` means the caller has no configured
 * baseline; zero and null remain concrete reset values when explicitly passed.
 */
const showReset = computed(
  () =>
    props.canReset &&
    props.resetValue !== undefined &&
    !Object.is(committed.value, props.resetValue),
)

/**
 * A read-only field's root is a `<span>`, because a `<label>`'s whole job is
 * to forward a click into the control it wraps — the one behavior a value that
 * cannot be edited must not have. Nothing else about it changes: the notch,
 * the box, the chrome, and the size scale are the field's, so a configured
 * value still reads as the same kind of thing as an editable one beside it.
 */
const rootTag = computed(() => (props.readonly ? 'span' : 'label'))

/**
 * Losing the `<label>` loses the accessible name with it, so a read-only field
 * names its input from the same words the notch shows. `ariaLabel` still wins
 * where a caller has said the visible text is not the honest name.
 */
const accessibleName = computed(() => props.ariaLabel ?? (props.readonly ? props.label : undefined))

/**
 * Digits after the decimal point in `step`, which is the precision a stepped
 * value is rounded back onto. Derived rather than declared: every field that
 * carries an explicit precision in this codebase already agrees with its own
 * step — `0.05` with two decimals, `1` with none — so a second prop would only
 * be a chance for the two to disagree.
 */
const stepDecimals = computed(() => (String(props.step ?? 1).split('.')[1] ?? '').length)

/**
 * The one place the generic is asserted. The component's whole job is to hold
 * text and hand back the shape the caller declared, and `type` is what says
 * which of the two that is; TypeScript cannot see the correspondence between a
 * runtime prop and a type parameter, so it is stated here once rather than
 * pushed out to every call site as a union to narrow.
 */
function parse(text: string): T | null {
  if (props.type === 'text') return text as T
  if (text.trim() === '') return null
  const value = Number(text)
  return Number.isFinite(value) ? (value as T) : null
}

/**
 * Re-seed the box from the outside world, but never while someone is typing in
 * it. This is the guard the rule is about: without it a live printer's status
 * push, a value changed from the console or another browser, or a caller that
 * clamps what it was given all land in the middle of an edit.
 *
 * While the box does have focus the edit **wins**, and the draft is asserted
 * back over whatever arrived. Guarding only the visible text would not be
 * enough: the caller's own state is what Apply reads, so a status push that
 * overwrote it mid-edit would be invisible until blur re-seeded the box from it
 * and the typed number vanished. Defending the model here is what lets a caller
 * hold no focus flag of its own — the reason those flags kept being forgotten
 * is that every field needed one, and now none do. The write settles in one
 * extra tick: it re-enters this watcher once, finds the model already equal to
 * the draft, and stops.
 *
 * `committed` follows along here whenever the box is not the one editing —
 * always, for a relayed caller (see its own comment), and while unfocused for
 * a one-way one. A one-way caller's own writes only ever happen while
 * focused, so a change arriving unfocused is always genuinely external — the
 * printer reporting a new position, most often — and skipping it left
 * `committed` stuck on whatever `model` held at mount, before the caller's
 * first real value had even arrived: the box reverted a typed-but-uncommitted
 * edit to a coordinate from before the printer ever reported one.
 */
watch(model, (value) => {
  if (isRelayed || !isFocused.value) committed.value = value
  if (!isFocused.value) {
    draft.value = modelAsText()
    return
  }
  const parsed = parse(draft.value)
  if (parsed !== null && parsed !== model.value) model.value = parsed
})

function onInput(event: Event): void {
  draft.value = (event.target as HTMLInputElement).value
  const parsed = parse(draft.value)
  if (parsed !== null) model.value = parsed
}

/**
 * Enter, not a browser `change` event: `change` fires on blur too, the instant
 * a modified field loses focus, and blur is exactly the case this commits on
 * purpose does *not* — see the class-level comment.
 */
function onEnter(): void {
  const parsed = parse(draft.value)
  // A real commit is what advances `committed` for a one-way caller — see its
  // own comment. `null` (an emptied box) commits nothing to advance to.
  if (parsed !== null) committed.value = parsed
  emit('commit', parsed)
}

function onBlur(): void {
  isFocused.value = false
  // A one-way caller's own typing writes stop at this component's local copy
  // of the model, since nobody relays them anywhere — nothing but this box
  // itself is disagreeing with `committed` when that happens, and leaving the
  // field without committing has to give the model back rather than strand it
  // on a value nothing was ever asked to reach. A relayed caller never
  // triggers this: `committed` already equals `model` by construction.
  if (model.value !== committed.value) model.value = committed.value
  // Whatever the value became while the box had focus is now the value it
  // shows. A clamped or refused number was hidden behind the guard until this
  // moment, and leaving the field is when the box has to stop disagreeing with
  // the model — including when the box is empty, which was never a value.
  draft.value = modelAsText()
}

function stepBy(direction: 1 | -1): void {
  const current = Number(draft.value)
  const from = Number.isFinite(current) ? current : 0
  const next = from + (props.step ?? 1) * direction
  const bounded = Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, next))
  const rounded = Number(bounded.toFixed(stepDecimals.value))
  const value = (Number.isFinite(rounded) ? rounded : 0) as T
  committed.value = value
  draft.value = String(value)
  model.value = value
  emit('commit', value)
}

function resetToConfigured(): void {
  const value = props.resetValue
  if (value === undefined) return
  committed.value = value
  draft.value = value === null ? '' : String(value)
  model.value = value
  emit('commit', value)
}
</script>

<template>
  <component
    :is="rootTag"
    class="app-field"
    :class="[
      `app-field--label-${labelPos}`,
      `app-field--size-${size}`,
      {
        'app-field--disabled': disabled,
        'app-field--reserve-steppers': reserveStepperSpace && !steppers,
      },
    ]"
  >
    <!--
      An outside label is a flow sibling of the box; an embedded label is
      absolutely positioned *inside* it, so its edges are the box's edges. That
      is what `labelAlign="end"` needs: anchored to the field instead, the notch
      measured from an outer box that also contains the stepper column and the
      space reserved for an absent one, and landed 55px past the value it names.
    -->
    <span
      v-if="labelPos === 'front'"
      class="app-field__label"
      :class="`app-field__label--${labelAlign}`"
      ><AppIcon
        v-if="labelIcon"
        :name="labelIcon"
        class="app-field__label-icon"
        aria-hidden="true"
      /><span class="app-field__label-text">{{ label }}</span></span
    >
    <span
      class="app-field__box"
      :class="[`app-field__box--${size}`, { 'app-field__box--has-reset': showReset }]"
    >
      <span
        v-if="labelPos === 'embed'"
        class="app-field__label"
        :class="`app-field__label--${labelAlign}`"
        ><AppIcon
          v-if="labelIcon"
          :name="labelIcon"
          class="app-field__label-icon"
          aria-hidden="true"
        /><span class="app-field__label-text">{{ label }}</span></span
      >
      <span v-if="unit && unitAlign === 'start'" class="app-field__unit">{{ unit }}</span>
      <!--
        `:type` is bound before `:value` on purpose, and the two must not be
        swapped back. Vue patches an element's props in the order they are
        written here, so with `:value` first a field switching from `number`
        to `text` is handed its new text while it is still a number input —
        which silently blanks it, permanently, because the rejected value is
        what the type change then carries over. That is the whole em-dash
        placeholder gone the moment a reading stops being available:
        `MovementModule`'s X/Y/Z boxes blank rather than dash the instant an
        axis reads as unhomed, and Chromium logs "cannot be parsed, or is out
        of range" once per box on the way. jsdom does not sanitise a number
        input's value, so no mounted test can catch this — `AppField.spec.ts`
        pins the order in the source instead.
      -->
      <input
        :type="type"
        :value="draft"
        class="app-field__input"
        :class="`app-field__input--${alignment}`"
        :min="min"
        :max="max"
        :step="step"
        :placeholder="placeholder"
        :readonly="readonly"
        :disabled="disabled"
        :tabindex="readonly ? -1 : undefined"
        :aria-label="accessibleName"
        autocomplete="off"
        data-1p-ignore
        data-lpignore="true"
        data-bwignore
        @input="onInput"
        @keydown.enter="onEnter"
        @focus="isFocused = true"
        @blur="onBlur"
      />
      <span v-if="unit && unitAlign === 'end'" class="app-field__unit">{{ unit }}</span>
      <button
        v-if="showReset"
        type="button"
        class="app-field__reset"
        :disabled="disabled || readonly"
        :aria-label="t('field.reset', { field: label })"
        @click.prevent.stop="resetToConfigured"
      >
        <AppIcon name="reset" class="app-field__reset-icon size-4" aria-hidden="true" />
      </button>
    </span>
    <!--
      Up then down, in that order, laid out as a vertical pair. The fixed field
      root still owns the component's measured height; the transparent targets
      may meet its edges without widening the value box by two buttons. The DOM
      order and names remain the same control as every other increase/decrease
      pair in the product.
    -->
    <span v-if="steppers" class="app-field__steppers">
      <AppButton
        variant="quiet"
        size="xs"
        icon-only
        class="app-field__stepper"
        :disabled="disabled || readonly"
        :aria-label="t('field.increase', { field: label })"
        @click="stepBy(1)"
      >
        <AppIcon name="up" class="app-field__stepper-icon size-4" aria-hidden="true" />
      </AppButton>
      <AppButton
        variant="quiet"
        size="xs"
        icon-only
        class="app-field__stepper"
        :disabled="disabled || readonly"
        :aria-label="t('field.decrease', { field: label })"
        @click="stepBy(-1)"
      >
        <AppIcon name="down" class="app-field__stepper-icon size-4" aria-hidden="true" />
      </AppButton>
    </span>
    <span
      v-if="labelPos === 'back'"
      class="app-field__label"
      :class="`app-field__label--${labelAlign}`"
      ><AppIcon
        v-if="labelIcon"
        :name="labelIcon"
        class="app-field__label-icon"
        aria-hidden="true"
      /><span class="app-field__label-text">{{ label }}</span></span
    >
  </component>
</template>
