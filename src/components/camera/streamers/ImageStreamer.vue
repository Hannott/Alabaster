<script setup lang="ts">
/**
 * A plain `<img>` holding a stream open — `uv4l-mjpeg`, and the fallback the
 * `mjpegstreamer` renderer drops to when it cannot read the stream itself.
 *
 * The browser decodes a multipart MJPEG response into the element frame by
 * frame and fires `load` exactly once, so this path reports no frame rate and
 * cannot detect a freeze. That is the trade it makes for working everywhere: it
 * needs no CORS headers, no worker, and no `OffscreenCanvas`.
 *
 * Deactivating removes `src` rather than hiding the element. An `<img>` with a
 * stream URL keeps the connection open and the camera encoding while it is off
 * screen; `display: none` does not stop it.
 */
import { onBeforeUnmount, ref, watch } from 'vue'

import type { CameraStreamerEmits, CameraStreamerProps } from './streamer'

const props = defineProps<CameraStreamerProps>()
const emit = defineEmits<CameraStreamerEmits>()

const image = ref<HTMLImageElement | null>(null)

function stop(): void {
  emit('status', 'connecting')
  image.value?.removeAttribute('src')
}

function start(): void {
  const element = image.value
  if (!element || props.camera.primaryUrl === '') return
  emit('status', 'connecting')
  element.src = props.camera.primaryUrl
}

watch(
  [() => props.active, () => props.camera.primaryUrl, image],
  ([active]) => {
    if (active) start()
    else stop()
  },
  { immediate: true },
)

onBeforeUnmount(stop)

function onLoad(): void {
  const element = image.value
  emit('status', 'live')
  emit('surface', element)
  if (element?.naturalWidth && element.naturalHeight) {
    emit('size', element.naturalWidth, element.naturalHeight)
  }
}
</script>

<template>
  <img
    ref="image"
    class="camera-frame"
    draggable="false"
    :alt="camera.name"
    @load="onLoad"
    @error="emit('status', 'error')"
  />
</template>
