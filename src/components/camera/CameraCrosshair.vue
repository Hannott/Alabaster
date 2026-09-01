<script setup lang="ts">
/**
 * A crosshair drawn over the center of a camera's frame, marking where the
 * nozzle sits in the picture.
 *
 * What it is for: aligning a camera so the nozzle is actually in shot, and
 * judging a first layer against a fixed reference instead of against the
 * frame's edges. It marks the frame's center, not the nozzle's real position —
 * nothing here knows where the toolhead is relative to the lens — so it is
 * useful precisely because the camera is aimed to put the nozzle on it.
 *
 * It sits inside the transformed frame rather than over the untransformed box,
 * so a flipped or rotated camera keeps the crosshair on the same physical
 * point. Its color is the user's own pick from the shared seven-hue palette —
 * a crosshair the same color as the print is invisible, so this is one of the
 * cases `dashboard/colorTokens.ts` exists for.
 */
import { computed } from 'vue'

import type { Camera } from '@/features/camera/camera'
import { cameraCrosshair, crosshairColorValue } from '@/features/camera/crosshair'

const props = defineProps<{ camera: Camera }>()

const crosshair = computed(() => cameraCrosshair(props.camera))

/**
 * `undefined` rather than a fallback color, so the stylesheet's own default
 * applies. That default is a palette token, which is what keeps a crosshair
 * nobody has recolored coherent with the rest of the theme pack.
 */
const color = computed(() => crosshairColorValue(crosshair.value) ?? undefined)

/** Half-length of each arm, as a percentage of the frame's smaller side. */
const armPercent = computed(() => `${(crosshair.value.size * 100) / 2}%`)
</script>

<template>
  <div class="camera-crosshair" aria-hidden="true">
    <span
      class="camera-crosshair__arm camera-crosshair__arm--horizontal"
      :style="{ background: color, width: armPercent }"
    ></span>
    <span
      class="camera-crosshair__arm camera-crosshair__arm--vertical"
      :style="{ background: color, height: armPercent }"
    ></span>
  </div>
</template>
