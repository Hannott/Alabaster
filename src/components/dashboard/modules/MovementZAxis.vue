<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { zExtents, zValue } from '@/dashboard/zAxisPlan'
import { usePrinterStore } from '@/stores/printer'
import type { ZMovingPart } from '@/stores/zMotion'

/**
 * A vertical Z slider standing to the left of the bed plan at the same height:
 * a soft column naming its two travel ends, with the moving part drawn as an
 * accent bar across it. Underneath it is still a native `input[type=range]`
 * committed on release, so keyboard input and the `change` contract come from
 * the browser rather than from a bespoke pointer surface like the plan's.
 */

const { locale, t } = useI18n({ useScope: 'global' })
const printer = usePrinterStore()

const emit = defineEmits<{
  move: [z: number]
  /** The height the pointer is hovering over, or `null` once it leaves. */
  hover: [z: number | null]
}>()

const props = defineProps<{
  /** Whether a move may be commanded at all — the card's shared precondition. */
  canMove: boolean
  /**
   * The thumb is drawn as the part that moves, so its top is wherever that
   * part is highest — Z max on most machines, Z 0 where Z+ moves the moving
   * part down (`stores/zMotion.ts`). This flips which end of the track reads
   * as the maximum without changing a single Z value sent to the printer — it
   * is a drawing choice, not a coordinate one.
   */
  swapDirection: boolean
  /**
   * The part Z moves (`stores/zMotion.ts`), drawn as the thumb: a nozzle where
   * the toolhead travels, a flat bar where the bed does.
   */
  movingPart: ZMovingPart
  /**
   * Whether the toolhead is actually moving right now, shared from the card
   * rather than recomputed here so the two never disagree on the threshold.
   * While true the thumb tracks the live frame, the same one the X/Y dot
   * follows; see the `draft` watch below for why it stops doing that once
   * the move settles.
   */
  isMoving: boolean
}>()

const extents = computed(() =>
  zExtents(printer.buildVolume.minimum[2], printer.buildVolume.maximum[2]),
)

const heightFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
)

/**
 * Mirrors the fan and pin sliders: a draft kept in sync with the printer's
 * position so the slider reflects reality between drags, and committed only
 * on release rather than on every intermediate value a drag passes through.
 *
 * Tracks `toolheadPosition` — the same `motion_report.live_position` frame
 * the X/Y dot follows — only while `isMoving` is true, so the thumb travels
 * alongside the toolhead the way the dot does. Once the move settles this
 * re-syncs from `motion.position` (`gcode_move.gcode_position`) instead:
 * `commit` sends the draft straight through `moveTo` as a literal
 * `G1 Z<value>`, which lands in that nominal frame, while the live frame is
 * sampled after the bed-mesh transform — up to a third of a millimetre off.
 * Settling on the live value would leave the thumb at a slightly different
 * height than the one just clicked, which is indistinguishable from the
 * slider having ignored the click.
 */
const draft = ref(0)

watch(
  () => (props.isMoving ? printer.toolheadPosition[2] : printer.motion.position[2]),
  (z) => {
    if (z !== null) draft.value = z
  },
  { immediate: true },
)

const travelEndFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }),
)

/**
 * The bottom of the travel is printed as the number it is, because it is 0 on
 * nearly every machine and a reader recognizes it; the top is a word, because
 * a three-digit maximum would not fit the column and is not what anyone aims
 * for by number.
 */
const travelEnds = computed(() => {
  const minimum = travelEndFormatter.value.format(extents.value?.minimum ?? 0)
  const maximum = t('dashboard.movement.zAxisMax')
  return props.swapDirection ? [minimum, maximum] : [maximum, minimum]
})
const topLabel = computed(() => travelEnds.value[0])
const bottomLabel = computed(() => travelEnds.value[1])

const isZHomed = computed(() => printer.motion.homedAxes.toUpperCase().includes('Z'))

const sliderLabel = computed(() => {
  const z = printer.motion.position[2]
  if (!isZHomed.value || z === null) return t('dashboard.movement.zAxisNotHomed')
  return t('dashboard.movement.zAxisNozzleAt', { z: heightFormatter.value.format(z) })
})

/**
 * The height last read back from a pointer position via `hoverAt`, in whole
 * millimetres — `null` once the pointer leaves so a keyboard nudge never
 * reuses a stale drag reading.
 *
 * `commit` prefers this over the native thumb's own value: laid out with
 * `writing-mode: vertical-lr` plus a flipped `direction`, a range input's own
 * drag-to-value mapping does not reliably agree with the coordinates it was
 * just dragged to, so the value the browser settles on can differ from the
 * height this component just showed as the preview. Reading the same pointer
 * math back here keeps the committed move and the previewed height in
 * agreement instead of trusting two different calculations of the same
 * gesture.
 */
const lastPointerZ = ref<number | null>(null)

function commit(): void {
  const z = lastPointerZ.value ?? Math.floor(draft.value)
  draft.value = z
  emit('move', z)
}

/**
 * Reads a height back from a pointer position the same way `commit` reads
 * one from the native thumb, so hovering reports the height a click would
 * actually send rather than an approximation of it. Floored to a whole
 * millimetre rather than rounded, so the preview never reports a height a
 * fraction of a pixel above where the pointer actually sits: the track is a
 * few hundred pixels standing in for a few hundred millimetres of travel, and
 * a tenth-of-a-millimetre reading is precision the gesture never had.
 */
function hoverAt(event: PointerEvent): void {
  const box = extents.value
  if (!box || !props.canMove) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  if (rect.height === 0) return
  const fraction = (event.clientY - rect.top) / rect.height
  const z = Math.floor(zValue(props.swapDirection ? 1 - fraction : fraction, box))
  lastPointerZ.value = z
  emit('hover', z)
}

function clearHover(): void {
  lastPointerZ.value = null
  emit('hover', null)
}
</script>

<template>
  <div v-if="extents" class="z-axis" :class="{ 'z-axis--nozzle': movingPart === 'nozzle' }">
    <span class="z-axis__end" aria-hidden="true">{{ topLabel }}</span>
    <span class="z-axis__end" aria-hidden="true">{{ bottomLabel }}</span>
    <input
      v-model.number="draft"
      type="range"
      class="z-axis__slider"
      :style="{ direction: swapDirection ? 'ltr' : 'rtl' }"
      :min="extents.minimum"
      :max="extents.maximum"
      step="1"
      :disabled="!canMove"
      :aria-label="sliderLabel"
      @change="commit"
      @pointermove="hoverAt"
      @pointerleave="clearHover"
    />
  </div>
</template>
