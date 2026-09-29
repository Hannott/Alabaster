<script setup lang="ts">
import { computed } from 'vue'

import { sparklinePoints } from '@/features/calibration/trends'

/**
 * A series from the log as a line with a dot per run and no axis: the history
 * rows under it are the axis. Accent-coloured, never a status colour, since a
 * range rising is not a fault the interface can judge.
 */
const props = defineProps<{ values: readonly number[] }>()

const width = 80
const height = 16
const inset = 2

const points = computed(() => sparklinePoints(props.values, width, height, inset))
const line = computed(() => points.value.map((point) => `${point.x},${point.y}`).join(' '))
</script>

<template>
  <svg class="calibration-sparkline" :viewBox="`0 0 ${width} ${height}`" aria-hidden="true">
    <polyline :points="line" />
    <circle v-for="(point, index) in points" :key="index" :cx="point.x" :cy="point.y" r="1.5" />
  </svg>
</template>
