<script setup lang="ts">
/**
 * `html-video` — any URL the browser can play in a `<video>` element directly:
 * a WebM or fragmented-MP4 stream, or a file.
 *
 * Muted by default and unmuted only for a camera whose audio was asked for,
 * because a `<video>` that is not muted is not allowed to autoplay at all —
 * the stream would sit on its first frame waiting for a click nobody knows to
 * make.
 */
import { onBeforeUnmount, ref, watch } from 'vue'

import {
  createStallWatchdog,
  videoAspectSize,
  watchVideoFrames,
  type CameraStreamerEmits,
  type CameraStreamerProps,
} from './streamer'

const props = defineProps<CameraStreamerProps>()
const emit = defineEmits<CameraStreamerEmits>()

const video = ref<HTMLVideoElement | null>(null)
let stopFrames: (() => void) | null = null
const watchdog = createStallWatchdog((stalled) => emit('status', stalled ? 'stalled' : 'live'))

function stop(): void {
  stopFrames?.()
  stopFrames = null
  watchdog.stop()
  const element = video.value
  if (!element) return
  element.pause()
  // Clearing the source is what actually closes the connection. Pausing alone
  // leaves the browser buffering ahead, which keeps the camera encoding for a
  // card nobody is looking at.
  element.removeAttribute('src')
  element.load()
}

function start(): void {
  const element = video.value
  if (!element || props.camera.primaryUrl === '') return
  emit('status', 'connecting')
  element.src = props.camera.primaryUrl
  void element.play().catch(() => emit('status', 'error'))
  stopFrames = watchVideoFrames(element, () => {
    emit('frame')
    watchdog.frame()
  })
}

watch(
  [() => props.active, () => props.camera.primaryUrl, video],
  ([active]) => {
    stop()
    if (active) start()
    else emit('status', 'connecting')
  },
  { immediate: true },
)

onBeforeUnmount(stop)

function onMetadata(): void {
  const element = video.value
  if (!element) return
  emit('status', 'live')
  emit('surface', element)
  const size = videoAspectSize(element)
  if (size) emit('size', size.width, size.height)
}
</script>

<template>
  <video
    ref="video"
    class="camera-frame"
    autoplay
    playsinline
    :muted="camera.extraData.enableAudio !== true"
    @loadedmetadata="onMetadata"
    @resize="onMetadata"
    @error="emit('status', 'error')"
  ></video>
</template>
