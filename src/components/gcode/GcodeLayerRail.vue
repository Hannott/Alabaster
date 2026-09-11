<script setup lang="ts">
/**
 * The layer range, as a vertical two-thumb rail down the right edge of the
 * stage.
 *
 * It is not an `AppSlider`. That component is a labelled two-row control tuned
 * to `AppField`'s height rhythm so a dashboard card can mix the two; this is a
 * bare dragged track sitting on a canvas, with its reading in a bubble that
 * follows the thumb. Giving `AppSlider` a vertical mode and a second thumb
 * would have bent a card component into a shape no card wants — the boundary
 * `interface-standards.md` already draws around it.
 *
 * Vertical because Z is up: the rail's geometry means the same thing as the
 * model's. Two thumbs because one was never enough — the old viewer had a
 * "visible layer" slider plus a second slider that only appeared once a
 * checkbox was ticked, and nobody found the cross-section that combination
 * could cut. Here the bottom thumb starts at the floor, so leaving it alone
 * reproduces the familiar behaviour and dragging it up opens the model.
 *
 * Both thumbs are real range inputs, so the rail is keyboard-operable and
 * announced without any of it being reimplemented. They overlap, though, and
 * a pointer can only ever land on the one stacked on top — so the rail drives
 * pointer drags itself, from wherever the press happened to the nearest thumb,
 * and leaves the inputs to the keyboard and the screen reader.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  /** Highest layer index that may be shown; the rail spans 0 to this. */
  maximum: number
  top: number
  bottom: number
  /** Layer heights in millimetres, indexed by layer. */
  heights: Float32Array | null
  /** Set while follow or simulation owns the range, with the reason. */
  disabledReason?: string | undefined
}>()

const emit = defineEmits<{ 'update:top': [number]; 'update:bottom': [number] }>()

const { t, n } = useI18n({ useScope: 'global' })
const active = ref<'top' | 'bottom'>('top')
const dragging = ref(false)
const disabled = computed(() => Boolean(props.disabledReason))

function heightAt(layer: number): string {
  const height = props.heights?.[layer]
  return height === undefined ? '' : n(height, { maximumFractionDigits: 2 })
}

/** Fraction of the rail, measured from the bottom, for a layer index. */
function offsetFor(layer: number): number {
  if (props.maximum <= 0) return 100
  return (Math.min(props.maximum, Math.max(0, layer)) / props.maximum) * 100
}

const topLabel = computed(() =>
  t('gcodeViewer.layers.reading', { layer: n(props.top + 1), height: heightAt(props.top) }),
)
const bottomLabel = computed(() =>
  t('gcodeViewer.layers.reading', { layer: n(props.bottom + 1), height: heightAt(props.bottom) }),
)
const bubble = computed(() => (active.value === 'top' ? topLabel.value : bottomLabel.value))
const bubbleOffset = computed(() =>
  active.value === 'top' ? offsetFor(props.top) : offsetFor(props.bottom),
)

const topInput = ref<HTMLInputElement | null>(null)
const bottomInput = ref<HTMLInputElement | null>(null)

/** The layer index under a pointer, measured from the rail's bottom. */
function layerAt(rail: HTMLElement, event: PointerEvent): number | null {
  const bounds = rail.getBoundingClientRect()
  if (bounds.height <= 0 || props.maximum <= 0) return null
  const fraction = 1 - (event.clientY - bounds.top) / bounds.height
  return Math.min(props.maximum, Math.max(0, fraction * props.maximum))
}

/*
 * A press anywhere on the rail grabs the nearest thumb and drags it from
 * there.
 *
 * The two inputs cover the same track, so the browser hands every press to
 * whichever one is stacked on top — and the stacking order cannot be changed
 * for a press that has already been dispatched. Letting the inputs take the
 * press therefore meant the lower thumb could never be picked up: the press
 * aimed at it moved the upper thumb down to the pointer instead. So the rail
 * takes the press, suppresses the input's own handling, and moves the thumb
 * that was actually closest for as long as the pointer is held.
 */
function beginDrag(event: PointerEvent): void {
  const rail = event.currentTarget
  if (!(rail instanceof HTMLElement) || disabled.value) return
  if (event.button !== 0 && event.pointerType === 'mouse') return
  const layer = layerAt(rail, event)
  if (layer === null) return
  event.preventDefault()
  active.value = Math.abs(layer - props.top) <= Math.abs(layer - props.bottom) ? 'top' : 'bottom'
  dragging.value = true
  rail.setPointerCapture(event.pointerId)
  // Focus follows the grab, so the arrow keys continue what the drag started.
  const input = active.value === 'top' ? topInput.value : bottomInput.value
  input?.focus({ preventScroll: true })
  moveTo(layer)
}

function continueDrag(event: PointerEvent): void {
  const rail = event.currentTarget
  if (!dragging.value || !(rail instanceof HTMLElement)) return
  const layer = layerAt(rail, event)
  if (layer !== null) moveTo(layer)
}

function endDrag(event: PointerEvent): void {
  if (!dragging.value) return
  dragging.value = false
  const rail = event.currentTarget
  if (rail instanceof HTMLElement && rail.hasPointerCapture(event.pointerId)) {
    rail.releasePointerCapture(event.pointerId)
  }
}

function moveTo(layer: number): void {
  if (active.value === 'top') commitTop(layer)
  else commitBottom(layer)
}

function commitTop(value: number): void {
  const next = Math.min(props.maximum, Math.max(0, Math.round(value)))
  emit('update:top', next)
  // The thumbs share one range and must not cross.
  if (props.bottom > next) emit('update:bottom', next)
}

function commitBottom(value: number): void {
  const next = Math.min(props.maximum, Math.max(0, Math.round(value)))
  emit('update:bottom', next)
  if (next > props.top) emit('update:top', next)
}

function onInput(which: 'top' | 'bottom', event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  active.value = which
  if (which === 'top') commitTop(target.valueAsNumber)
  else commitBottom(target.valueAsNumber)
}
</script>

<template>
  <div
    class="gcode-rail"
    :data-disabled="disabled ? 'true' : undefined"
    :title="props.disabledReason"
    @pointerdown="beginDrag"
    @pointermove="continueDrag"
    @pointerup="endDrag"
    @pointercancel="endDrag"
  >
    <div class="gcode-rail__track" aria-hidden="true">
      <div
        class="gcode-rail__fill"
        :style="{
          bottom: `${offsetFor(props.bottom)}%`,
          top: `${100 - offsetFor(props.top)}%`,
        }"
      ></div>
    </div>
    <p
      v-if="props.maximum > 0"
      class="gcode-rail__bubble"
      :class="{ 'gcode-rail__bubble--held': dragging }"
      :style="{ bottom: `${bubbleOffset}%` }"
      aria-hidden="true"
    >
      {{ bubble }}
    </p>
    <input
      ref="topInput"
      class="gcode-rail__input"
      :class="{ 'gcode-rail__input--active': active === 'top' }"
      type="range"
      min="0"
      :max="props.maximum"
      step="1"
      :value="props.top"
      :disabled="disabled"
      :aria-label="t('gcodeViewer.layers.top')"
      :aria-valuetext="topLabel"
      @focus="active = 'top'"
      @input="onInput('top', $event)"
    />
    <input
      ref="bottomInput"
      class="gcode-rail__input"
      :class="{ 'gcode-rail__input--active': active === 'bottom' }"
      type="range"
      min="0"
      :max="props.maximum"
      step="1"
      :value="props.bottom"
      :disabled="disabled"
      :aria-label="t('gcodeViewer.layers.bottom')"
      :aria-valuetext="bottomLabel"
      @focus="active = 'bottom'"
      @input="onInput('bottom', $event)"
    />
  </div>
</template>
