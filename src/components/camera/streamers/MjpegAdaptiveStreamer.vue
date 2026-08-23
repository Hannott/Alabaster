<script setup lang="ts">
/**
 * `mjpegstreamer-adaptive` — one snapshot request at a time, each fired as soon
 * as the previous image has decoded, paced toward the camera's target frame
 * rate.
 *
 * Why anyone chooses it: a held-open MJPEG stream sends frames as fast as the
 * camera produces them whether the client can keep up or not, and on a slow
 * link that queues. Here the next request is only made once the last frame has
 * arrived, so the picture degrades in frame rate rather than in latency — the
 * newest frame is always the one on screen.
 *
 * The pacing subtracts a smoothed measurement of how long a request actually
 * takes from the target interval, so a camera on a slow link is not asked for
 * frames faster than it can answer.
 */
import { onBeforeUnmount, ref, watch } from 'vue'

import { createStallWatchdog, type CameraStreamerEmits, type CameraStreamerProps } from './streamer'

const props = defineProps<CameraStreamerProps>()
const emit = defineEmits<CameraStreamerEmits>()

/** Weight given to the previous request-duration estimate; 0 would track noise. */
const requestTimeSmoothing = 0.2

const image = ref<HTMLImageElement | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null
let requestStartedAt = 0
let smoothedRequestMs = 0
let generation = 0

const watchdog = createStallWatchdog((stalled) => emit('status', stalled ? 'stalled' : 'live'))

function clearTimer(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
}

function requestFrame(): void {
  clearTimer()
  const element = image.value
  if (!props.active || !element || props.camera.primaryUrl === '') return
  const url = new URL(props.camera.primaryUrl)
  // A snapshot URL is the same URL every time, and a cached response would
  // freeze the picture on the first frame. The generation counter also makes
  // the parameter unique across restarts, so a stale in-flight response cannot
  // be mistaken for the current one.
  url.searchParams.set('bypassCache', `${generation}-${performance.now()}`)
  requestStartedAt = performance.now()
  element.src = url.toString()
}

function stop(): void {
  generation += 1
  clearTimer()
  watchdog.stop()
  smoothedRequestMs = 0
  image.value?.removeAttribute('src')
}

function start(): void {
  stop()
  if (props.camera.primaryUrl === '') return
  emit('status', 'connecting')
  requestFrame()
}

watch(
  [() => props.active, () => props.camera.primaryUrl, () => props.camera.targetFps, image],
  ([active]) => {
    if (active) start()
    else {
      stop()
      emit('status', 'connecting')
    }
  },
  { immediate: true },
)

onBeforeUnmount(stop)

function onLoad(): void {
  const element = image.value
  if (!element) return
  emit('status', 'live')
  emit('frame')
  emit('surface', element)
  watchdog.frame()
  if (element.naturalWidth && element.naturalHeight) {
    emit('size', element.naturalWidth, element.naturalHeight)
  }

  const targetIntervalMs = 1000 / Math.max(1, props.camera.targetFps)
  const elapsed = performance.now() - requestStartedAt
  smoothedRequestMs =
    smoothedRequestMs * requestTimeSmoothing + elapsed * (1 - requestTimeSmoothing)
  timer = setTimeout(requestFrame, Math.max(0, targetIntervalMs - smoothedRequestMs))
}

function onError(): void {
  emit('status', 'error')
  // Retried on a slow cadence rather than immediately: a camera that is off
  // stays off, and hammering its host a dozen times a second while it reboots
  // is how a reconnect turns into a denial of service against the printer.
  clearTimer()
  timer = setTimeout(requestFrame, 1000)
}
</script>

<template>
  <img
    ref="image"
    class="camera-frame"
    draggable="false"
    :alt="camera.name"
    @load="onLoad"
    @error="onError"
  />
</template>
