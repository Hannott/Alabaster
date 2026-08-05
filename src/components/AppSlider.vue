<script setup lang="ts">
/**
 * The one slider. `AppSlider` owns a value that is dragged as well as typed:
 * a track always renders, an optional exact-entry field replaces the plain
 * reading, optional steppers flank the track itself, and an optional reset
 * restores a firmware or app-local default. Layout outside the component is
 * not part of it, the same rule `AppField` follows — a module places several
 * `AppSlider`s in an ordinary grid.
 *
 * Two rows, tuned to land on `AppField`'s own 44/48/52px total height at each
 * size, so the two read as one rhythm wherever a card mixes them: row-a holds
 * the label, the optional reset, and the reading or entry field; row-b holds
 * the track, flanked by steppers when enabled.
 *
 * The track's own bounds are `trackMin`/`trackMax`/`trackStep`, defaulting to
 * `min`/`max`/`step` when omitted. `min`/`max`/`step` stay the real limit —
 * what the entry field accepts and what a stepper press clamps to — while the
 * track bounds are the sensible drag span: a slider that had to cover every
 * accepted value would spend nearly all its travel on values nobody sets
 * (see Bed mesh's range and temperature warnings).
 *
 * `commitOnDrag` decides when the track's own movement becomes a command:
 * `false` (the default) commits only on release, because a drag from 100 to
 * 40 passes through every value between and each one would be a real
 * command if committed while dragging (Extruder's `M221`, Movement's
 * `M220`). `true` commits on every `input` event instead, for a value that
 * is local, cost-free state (Bed mesh's settings, Console's visible lines).
 *
 * The exact-entry field is a text box, so it needs `AppField`'s own
 * draft/commit technique — a string draft that survives a live status push
 * mid-edit, because `Number('0.')` is `0` and a numeric draft eats the
 * decimal point on the way from `0.` to `0.5`. It is deliberately not an
 * `AppField`, per the documented boundary in interface-standards.md: its
 * label is a separate `<label for>` rather than a wrapper, and reset sits in
 * row-a rather than inside the entry box.
 *
 * The track itself needs no such draft: a thumb position has no half-typed
 * ambiguity, so `defineModel` alone is enough, re-seeded whenever the model
 * changes the same way `MovementModule`'s own `speedFactorDraft` already was
 * before this component existed.
 */
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon, { type AppIconName } from '@/components/AppIcon.vue'

const props = withDefaults(
  defineProps<{
    /** The field's own label, already translated. Rendered Title Case by CSS. */
    label: string
    /** Optional leading icon before the label — a fan, a heater, a motor. */
    labelIcon?: AppIconName | undefined
    /** A translated unit — `%`, `mm`. Never a character typed inside the box. */
    unit?: string
    /** Selects the shared row-a/row-b tier; the total matches AppField's own. */
    size?: 'md' | 'sm' | 'xs'
    /** The real limit: what the entry field accepts and a stepper clamps to. */
    min: number
    max: number
    /**
     * The typing step, and what one stepper press moves the value by. Also
     * fixes the precision a stepped or typed value is rounded back onto.
     */
    step?: number
    /**
     * The track's own bounds, when the sensible drag span is narrower than
     * the permitted value. Default to `min`/`max`/`step` when omitted.
     */
    trackMin?: number
    trackMax?: number
    trackStep?: number
    /** Renders an exact-entry field in row-a in place of the plain reading. */
    entry?: boolean
    /** Draws the flanking increase/decrease pair either side of the track — on by default; pass `false` to turn it off for a slider that has no reason for one. */
    steppers?: boolean
    /** Opts into the reset affordance. See `resetValue`. */
    canReset?: boolean
    /**
     * The concrete baseline to reset to: the firmware's own default for a
     * parameter Klipper defines one for (Extrusion Factor, Speed Factor —
     * both 100%), or Alabaster's own app-local default when there is no
     * firmware equivalent (Bed mesh's warnings, Z-max). Omit when no
     * baseline was actually read.
     */
    resetValue?: number
    /**
     * `false`: the track commits only on release (`change`) — for a value
     * that dispatches a real command. `true`: commits on every `input` —
     * for local, cost-free state.
     */
    commitOnDrag?: boolean
    disabled?: boolean
  }>(),
  {
    size: 'sm',
    step: 1,
    entry: false,
    steppers: true,
    canReset: false,
    commitOnDrag: false,
    disabled: false,
  },
)

const model = defineModel<number>({ required: true })

const emit = defineEmits<{ commit: [value: number] }>()

const { t } = useI18n({ useScope: 'global' })

const entryInputId = useId()

const trackMin = computed(() => props.trackMin ?? props.min)
const trackMax = computed(() => props.trackMax ?? props.max)
const trackStep = computed(() => props.trackStep ?? props.step)

/**
 * The filled portion behind the track, as a percentage. Neither WebKit nor
 * Blink expose a fill pseudo-element the way Firefox's `::-moz-range-progress`
 * does, so this is a plain decorative sibling instead — never the thing
 * dragged, which stays the native, fully functional `<input type="range">`.
 */
const trackFillPercent = computed(() => {
  const span = trackMax.value - trackMin.value
  if (span <= 0) return 0
  return ((model.value - trackMin.value) / span) * 100
})

/**
 * Digits after the decimal point in `step` — the precision a stepped or
 * typed value is rounded back onto, the same derivation `AppField` uses.
 */
const stepDecimals = computed(() => (String(props.step).split('.')[1] ?? '').length)

function clampAndRound(value: number): number {
  const bounded = Math.min(props.max, Math.max(props.min, value))
  return Number(bounded.toFixed(stepDecimals.value))
}

/** The entry field's own string draft — see the component-level comment. */
const draft = ref(String(model.value))
/** One flag, because focus is one field at a time. */
const isFocused = ref(false)

/**
 * The value blur restores, and what a reset or stepper press compares
 * against. Kept separate from `model` for the same reason `AppField` keeps
 * one: a one-way caller's own writes while typing reach nothing but this
 * component's local copy of the model, so `committed` has to hold still
 * until an actual commit moves it.
 */
const committed = ref(model.value)

const showReset = computed(
  () =>
    props.canReset &&
    props.resetValue !== undefined &&
    !Object.is(committed.value, props.resetValue),
)

/**
 * Re-seed the draft and `committed` from the outside world, but never while
 * the entry field has focus — the same guard `AppField` uses, and for the
 * same reason: a live status push several times a second must not eat a
 * half-typed edit. The track itself needs no such guard; it has no draft to
 * protect, only `model`, which a fresh external value simply moves to.
 */
watch(model, (value) => {
  if (!isFocused.value) {
    committed.value = value
    draft.value = String(value)
  }
})

function onEntryInput(event: Event): void {
  draft.value = (event.target as HTMLInputElement).value
}

function onEntryFocus(): void {
  isFocused.value = true
}

/**
 * Enter, not blur: blur is how an edit is abandoned, not how it is sent —
 * the same rule `AppField` documents for its own draft.
 */
function onEntryEnter(): void {
  if (draft.value.trim() === '') return
  const parsed = Number(draft.value)
  if (!Number.isFinite(parsed)) return
  const value = clampAndRound(parsed)
  committed.value = value
  model.value = value
  draft.value = String(value)
  emit('commit', value)
}

function onEntryBlur(): void {
  isFocused.value = false
  draft.value = String(committed.value)
}

function onTrackInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  model.value = value
  if (props.commitOnDrag) {
    committed.value = value
    emit('commit', value)
  }
}

/**
 * Fires once, on release. A drag from 100 to 40 passes through every value
 * between, and each one is a real command if `commitOnDrag` is on — see the
 * component-level comment.
 */
function onTrackChange(event: Event): void {
  if (props.commitOnDrag) return
  const value = Number((event.target as HTMLInputElement).value)
  committed.value = value
  emit('commit', value)
}

function stepBy(direction: 1 | -1): void {
  const value = clampAndRound(model.value + props.step * direction)
  committed.value = value
  model.value = value
  draft.value = String(value)
  emit('commit', value)
}

function resetToConfigured(): void {
  const value = props.resetValue
  if (value === undefined) return
  committed.value = value
  model.value = value
  draft.value = String(value)
  emit('commit', value)
}
</script>

<template>
  <div
    class="app-slider"
    :class="`app-slider--size-${size}`"
    :aria-disabled="disabled || undefined"
  >
    <div class="app-slider__row-a">
      <AppIcon
        v-if="labelIcon"
        :name="labelIcon"
        class="app-slider__label-icon"
        aria-hidden="true"
      />
      <label v-if="entry" class="app-slider__label" :for="entryInputId">{{ label }}</label>
      <span v-else class="app-slider__label">{{ label }}</span>

      <button
        v-if="showReset"
        type="button"
        class="app-slider__reset"
        :disabled="disabled"
        :aria-label="t('field.reset', { field: label })"
        @click="resetToConfigured"
      >
        <AppIcon name="reset" />
      </button>

      <!-- `reading` overrides the plain formatted number for a caller that
           composes a richer sentence around it (G-code viewer's "layer 5 of
           120 (2.50 mm)"), while still rendering it as the same `<output>`. -->
      <output v-if="!entry" class="app-slider__reading">
        <slot name="reading" :value="model">{{ model.toFixed(stepDecimals) }}{{ unit }}</slot>
      </output>
      <span v-else class="app-slider__entry">
        <input
          :id="entryInputId"
          :value="draft"
          type="number"
          :min="min"
          :max="max"
          :step="step"
          :disabled="disabled"
          @input="onEntryInput"
          @keydown.enter="onEntryEnter"
          @focus="onEntryFocus"
          @blur="onEntryBlur"
        />
        <span v-if="unit" class="app-slider__unit">{{ unit }}</span>
      </span>
    </div>

    <div class="app-slider__row-b">
      <button
        v-if="steppers"
        type="button"
        class="app-slider__stepper app-slider__stepper--down"
        :disabled="disabled"
        :aria-label="t('field.decrease', { field: label })"
        @click="stepBy(-1)"
      >
        <AppIcon name="minus" class="app-slider__stepper-icon" />
      </button>

      <span class="app-slider__track-wrap" :style="{ '--app-slider-fill': `${trackFillPercent}%` }">
        <input
          class="app-slider__track"
          type="range"
          :min="trackMin"
          :max="trackMax"
          :step="trackStep"
          :value="model"
          :disabled="disabled"
          :aria-label="label"
          @input="onTrackInput"
          @change="onTrackChange"
        />
        <span class="app-slider__track-fill" aria-hidden="true"></span>
      </span>

      <button
        v-if="steppers"
        type="button"
        class="app-slider__stepper app-slider__stepper--up"
        :disabled="disabled"
        :aria-label="t('field.increase', { field: label })"
        @click="stepBy(1)"
      >
        <AppIcon name="add" class="app-slider__stepper-icon" />
      </button>
    </div>
  </div>
</template>
