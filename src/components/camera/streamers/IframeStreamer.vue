<script setup lang="ts">
/**
 * `iframe` — a page that renders its own camera view, embedded whole. The
 * escape hatch for a camera whose vendor ships a viewer rather than a stream.
 *
 * Nothing inside is Alabaster's: the frame reports no size, no frame rate, and
 * no failure, which is why its aspect ratio has to be declared in the camera's
 * settings rather than measured. It is also the one service that cannot be
 * captured as a still or shown with a crosshair, since reading pixels out of
 * another origin's document is exactly what the browser prevents.
 *
 * The `src` is dropped while inactive for the same reason as every other
 * streamer: a hidden iframe keeps running, timers and stream included.
 */
import { computed } from 'vue'

import { parseAspectRatio } from '@/features/camera/services'

import type { CameraStreamerEmits, CameraStreamerProps } from './streamer'

const props = defineProps<CameraStreamerProps>()
const emit = defineEmits<CameraStreamerEmits>()

const source = computed(() => (props.active ? props.camera.primaryUrl : ''))

// 16:9 rather than the camera's own 4:3 default: an embedded viewer is a web
// page, and a page laid out for a 4:3 box letterboxes on every widescreen
// camera behind it. This only applies when the stored ratio is unparseable.
const aspectRatio = computed(() => parseAspectRatio(props.camera.aspectRatioText) ?? 16 / 9)

function onLoad(): void {
  emit('status', 'live')
  emit('surface', null)
}
</script>

<template>
  <iframe
    v-if="source !== ''"
    class="camera-frame camera-frame--iframe"
    :src="source"
    :title="camera.name"
    :style="{ aspectRatio: String(aspectRatio) }"
    @load="onLoad"
  ></iframe>
</template>
