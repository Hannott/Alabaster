<!--
  The bed from above with each object's footprint on it, for finding the part
  that just failed by where it sits rather than by a slicer's generated name.

  A press only picks an object out — it never excludes. The dialog's
  confirmation can be switched off, and with it off a press on a small part
  beside a large one would abandon the wrong part with nothing in between. The
  irreversible step stays on the list row's own guarded button.

  aria-hidden, because every object drawn here is also a row in the list beside
  it, which is the keyboard and screen-reader route to the same choice.
-->
<script setup lang="ts">
import { computed } from 'vue'

import { planOutline, planPoint, planPointInBedUnits, type BedExtents } from '@/dashboard/bedPlan'
import type { ExcludeObjectDefinition } from '@/stores/excludeObject'

export type ExcludeObjectState = 'excluded' | 'current' | 'pending'

const props = defineProps<{
  extents: BedExtents
  objects: readonly ExcludeObjectDefinition[]
  stateOf: (object: ExcludeObjectDefinition) => ExcludeObjectState
  /** The object picked out from either side — hovered here or in the list, or pressed. */
  highlighted: string | null
  /** The nozzle in the file's own frame, or null when X and Y are not homed. */
  nozzle: { x: number; y: number } | null
}>()

const emit = defineEmits<{
  select: [name: string]
  hover: [name: string | null]
}>()

interface DrawnObject {
  name: string
  state: ExcludeObjectState
  points: string | null
  center: { x: number; y: number } | null
}

/*
 * Largest first, so a small part is painted over a large one rather than under
 * it and stays reachable. File order would let a part defined late cover one
 * defined early.
 */
const drawn = computed<DrawnObject[]>(() =>
  [...props.objects]
    .filter((object) => object.polygon !== null || object.center !== null)
    .sort((a, b) => b.area - a.area)
    .map((object) => ({
      name: object.name,
      state: props.stateOf(object),
      points: object.polygon ? planOutline(object.polygon, props.extents) : null,
      center: object.center
        ? planPointInBedUnits({ x: object.center[0], y: object.center[1] }, props.extents)
        : null,
    })),
)

/** A centre-only object's mark, sized to the bed so it reads the same on any machine. */
const centerRadius = computed(() => Math.max(props.extents.width, props.extents.depth) * 0.015)

const viewBox = computed(() => `0 0 ${props.extents.width} ${props.extents.depth}`)

const nozzleTransform = computed(() => {
  if (!props.nozzle) return null
  const point = planPoint(props.nozzle, props.extents)
  return `translate(${point.x * 100}%, ${point.y * 100}%)`
})

/*
 * The plate's width is capped by the height it may take, through the bed's own
 * aspect, so a deep bed shrinks to fit rather than being squashed or pushing
 * the list off the dialog.
 */
const plateStyle = computed(() => ({
  '--exclude-map-aspect': `${props.extents.width / props.extents.depth}`,
}))
</script>

<template>
  <div
    class="exclude-map"
    :class="{ 'exclude-map--circular': extents.shape === 'circular' }"
    :style="plateStyle"
    aria-hidden="true"
    @pointerleave="emit('hover', null)"
  >
    <svg :viewBox="viewBox" focusable="false">
      <g
        v-for="object in drawn"
        :key="object.name"
        class="exclude-map__object"
        :class="[
          `exclude-map__object--${object.state}`,
          { 'exclude-map__object--highlighted': object.name === highlighted },
        ]"
        @pointerenter="emit('hover', object.name)"
        @click="emit('select', object.name)"
      >
        <template v-if="object.points">
          <polygon class="exclude-map__hit" :points="object.points" />
          <polygon class="exclude-map__shape" :points="object.points" />
        </template>
        <template v-else-if="object.center">
          <circle
            class="exclude-map__hit"
            :cx="object.center.x"
            :cy="object.center.y"
            :r="centerRadius"
          />
          <circle
            class="exclude-map__shape"
            :cx="object.center.x"
            :cy="object.center.y"
            :r="centerRadius"
          />
        </template>
      </g>
    </svg>
    <span v-if="nozzleTransform" class="bed-plan__nozzle" :style="{ transform: nozzleTransform }" />
  </div>
</template>
