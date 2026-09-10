<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import {
  type Hsv,
  hexToHsv,
  hsvToHex,
  isHexColor,
  normalizeHex,
  resolveCssColor,
  rgbToHsv,
} from '@/utils/color'

/**
 * One arbitrary color, picked inside a single popup — dialog-system.md's
 * Shape 7. The picker is drawn by the application, not borrowed from the
 * browser: `<input type="color">` always opens the platform's own panel on
 * top of whatever invoked it, so a dialog built around one showed two popups
 * stacked, and the native panel commits on its own close with no Apply of
 * its own to press. Here the shade square and hue bar are ordinary elements
 * driven by pointer position, the hex field types the same value directly,
 * and nothing leaves this dialog until Apply — `PromptDialog`'s reasoning
 * exactly, with a color where the text field was.
 */

const props = defineProps<{
  open: boolean
  /** Names the decision, composed by the caller — e.g. "Choose a custom color — Hotend". */
  title: string
  /** Any CSS color — a hex, or the `var()` a sensor is drawn in, resolved through the document. */
  initialValue: string
  confirmLabel: string
}>()

const emit = defineEmits<{ confirm: [value: string]; cancel: [] }>()

const { t } = useI18n({ useScope: 'global' })
const dialog = ref<HTMLDialogElement | null>(null)
const shade = ref<HTMLElement | null>(null)
const hueBar = ref<HTMLElement | null>(null)
const titleId = useId()
const hexId = useId()
const errorId = useId()

/** A mid-grey, so a value the document cannot resolve still opens on something pickable. */
const fallback: Hsv = { h: 0, s: 0, v: 0.5 }

const hsv = ref<Hsv>(fallback)
/**
 * What the hex field shows, kept apart from `hsv` so typing is not fought:
 * a half-typed value is invalid, and rewriting it from `hsv` on every
 * keystroke would erase the character just entered.
 */
const hexDraft = ref('')

const hex = computed(() => hsvToHex(hsv.value))
const hueColor = computed(() => `hsl(${Math.round(hsv.value.h)} 100% 50%)`)
const hexError = computed(() =>
  isHexColor(hexDraft.value) ? undefined : t('colorPickerDialog.invalidHex'),
)
const thumbStyle = computed(() => ({
  left: `${hsv.value.s * 100}%`,
  top: `${(1 - hsv.value.v) * 100}%`,
}))

function setHsv(next: Hsv): void {
  hsv.value = next
  hexDraft.value = hsvToHex(next)
}

async function sync(isOpen: boolean): Promise<void> {
  const element = dialog.value
  if (!element) return
  if (isOpen && !element.open) {
    const rgb = resolveCssColor(props.initialValue)
    setHsv(rgb ? rgbToHsv(rgb) : fallback)
    element.showModal()
    await nextTick()
    shade.value?.focus()
  }
  if (!isOpen && element.open) element.close()
}

onMounted(() => void sync(props.open))
watch(() => props.open, sync, { flush: 'post' })

onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close()
})

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** Where a pointer sits inside an element, as fractions of its width and height. */
function fraction(event: PointerEvent, element: HTMLElement): { x: number; y: number } {
  const rect = element.getBoundingClientRect()
  return {
    x: clamp((event.clientX - rect.left) / rect.width),
    y: clamp((event.clientY - rect.top) / rect.height),
  }
}

function pickShade(event: PointerEvent): void {
  if (!shade.value) return
  const { x, y } = fraction(event, shade.value)
  setHsv({ ...hsv.value, s: x, v: 1 - y })
}

function pickHue(event: PointerEvent): void {
  if (!hueBar.value) return
  const { x } = fraction(event, hueBar.value)
  setHsv({ ...hsv.value, h: Math.min(359.999, x * 360) })
}

/**
 * Capturing the pointer on press is what lets a drag continue past the
 * surface's edge — releasing outside still lands on the nearest edge value
 * rather than the last point that happened to be inside.
 */
function startDrag(event: PointerEvent, pick: (event: PointerEvent) => void): void {
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  pick(event)
}

function continueDrag(event: PointerEvent, pick: (event: PointerEvent) => void): void {
  if ((event.buttons & 1) === 1) pick(event)
}

/** Arrow keys move the shade thumb in 2% steps; with Shift, 10%. */
function nudgeShade(event: KeyboardEvent): void {
  const step = event.shiftKey ? 0.1 : 0.02
  const deltas: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, step],
    ArrowDown: [0, -step],
  }
  const delta = deltas[event.key]
  if (!delta) return
  event.preventDefault()
  setHsv({ ...hsv.value, s: clamp(hsv.value.s + delta[0]), v: clamp(hsv.value.v + delta[1]) })
}

/** Arrow keys turn the hue in 2° steps; with Shift, 15°. */
function nudgeHue(event: KeyboardEvent): void {
  const step = event.shiftKey ? 15 : 2
  const delta = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step }[event.key]
  if (delta === undefined) return
  event.preventDefault()
  setHsv({ ...hsv.value, h: (((hsv.value.h + delta) % 360) + 360) % 360 })
}

function onHexInput(event: Event): void {
  hexDraft.value = (event.target as HTMLInputElement).value
  const parsed = hexToHsv(hexDraft.value)
  if (parsed) hsv.value = parsed
}

/** Leaving the field tidies a valid value into the canonical six-digit form. */
function onHexBlur(): void {
  const normalized = normalizeHex(hexDraft.value)
  if (normalized) hexDraft.value = normalized
}

function submit(): void {
  if (hexError.value !== undefined) return
  emit('confirm', hex.value)
}
</script>

<template>
  <dialog
    ref="dialog"
    class="confirm-dialog color-picker-dialog"
    :aria-labelledby="titleId"
    @cancel.prevent="emit('cancel')"
  >
    <h2 :id="titleId" class="text-dialog-title">{{ title }}</h2>
    <form novalidate @submit.prevent="submit">
      <div
        ref="shade"
        class="color-picker-dialog__shade"
        :style="{ '--picker-hue': hueColor }"
        role="group"
        tabindex="0"
        :aria-label="t('colorPickerDialog.shade')"
        @pointerdown="startDrag($event, pickShade)"
        @pointermove="continueDrag($event, pickShade)"
        @keydown="nudgeShade"
      >
        <span
          class="color-picker-dialog__thumb"
          :style="{ ...thumbStyle, '--picker-color': hex }"
          aria-hidden="true"
        />
      </div>
      <div
        ref="hueBar"
        class="color-picker-dialog__hue"
        role="slider"
        tabindex="0"
        :aria-label="t('colorPickerDialog.hue')"
        aria-valuemin="0"
        aria-valuemax="360"
        :aria-valuenow="Math.round(hsv.h)"
        @pointerdown="startDrag($event, pickHue)"
        @pointermove="continueDrag($event, pickHue)"
        @keydown="nudgeHue"
      >
        <span
          class="color-picker-dialog__thumb"
          :style="{ left: `${(hsv.h / 360) * 100}%`, '--picker-color': hueColor }"
          aria-hidden="true"
        />
      </div>
      <div class="color-picker-dialog__hex">
        <span
          class="color-picker-dialog__preview"
          :style="{ '--picker-color': hex }"
          role="img"
          :aria-label="t('colorPickerDialog.preview')"
        />
        <div class="prompt-dialog__field">
          <label class="prompt-dialog__label" :for="hexId">{{
            t('colorPickerDialog.hexLabel')
          }}</label>
          <!-- A color value, not an identity field — the opt-outs keep password managers off it. -->
          <input
            :id="hexId"
            class="field field--sm field--block color-picker-dialog__input"
            type="text"
            :value="hexDraft"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            :aria-invalid="hexError !== undefined"
            :aria-describedby="hexError ? errorId : undefined"
            @input="onHexInput"
            @blur="onHexBlur"
          />
          <p v-if="hexError" :id="errorId" class="prompt-dialog__error">{{ hexError }}</p>
        </div>
      </div>
      <div class="confirm-dialog__actions">
        <AppButton
          variant="primary"
          :label="confirmLabel"
          type="submit"
          :disabled="hexError !== undefined"
        />
        <AppButton size="sm" :label="t('dashboard.cancel')" @click="emit('cancel')" />
      </div>
    </form>
  </dialog>
</template>
