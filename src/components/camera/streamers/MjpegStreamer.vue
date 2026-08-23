<script setup lang="ts">
/**
 * `mjpegstreamer` — the default, and what ustreamer and camera-streamer serve
 * on a stock Klipper install.
 *
 * Two paths, in order of preference:
 *
 * 1. A worker reads the multipart stream, decodes each frame, and paints it to
 *    an `OffscreenCanvas` transferred to it. This is the path that can report a
 *    frame rate and notice a freeze, because it sees every frame boundary.
 * 2. A plain `<img>`, when the first path is unavailable — an older browser
 *    without `OffscreenCanvas`, or a camera host that does not send CORS headers
 *    so `fetch` cannot read the stream the browser itself can display.
 *
 * The fallback matters more than it looks. The reference implementation offers
 * only the first path and shows an error where it fails, which means a camera
 * served from a host without CORS headers appears broken in the interface while
 * being perfectly viewable. Here it shows the picture and gives up only the
 * frame-rate readout.
 *
 * A failure *after* frames have arrived is treated differently from one before:
 * the first is a stream that dropped and is worth reconnecting, the second is a
 * stream that was never readable and reconnecting will fail identically forever.
 */
import { onBeforeUnmount, ref, watch } from 'vue'

import { createStallWatchdog, type CameraStreamerEmits, type CameraStreamerProps } from './streamer'

const props = defineProps<CameraStreamerProps>()
const emit = defineEmits<CameraStreamerEmits>()

/** How long to wait before reconnecting a stream that had been working. */
const reconnectDelayMs = 2000

const canvas = ref<HTMLCanvasElement | null>(null)
const usesFallback = ref(!workerPathSupported())
let worker: Worker | null = null
let canvasTransferred = false
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let everConnected = false

const watchdog = createStallWatchdog((stalled) => emit('status', stalled ? 'stalled' : 'live'))

/**
 * `transferControlToOffscreen` is the API this path is built on and Safari
 * only gained it in 16.4, so it is checked rather than assumed — an
 * unsupported browser takes the `<img>` path from the start instead of showing
 * an error.
 */
function workerPathSupported(): boolean {
  return (
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap === 'function' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function'
  )
}

function clearReconnect(): void {
  if (reconnectTimer !== null) clearTimeout(reconnectTimer)
  reconnectTimer = null
}

function onWorkerMessage(event: MessageEvent): void {
  const message = event.data as { type: string; width?: number; height?: number }
  switch (message.type) {
    case 'frame':
      emit('frame')
      watchdog.frame()
      break
    case 'size':
      if (message.width && message.height) emit('size', message.width, message.height)
      break
    case 'connected':
      everConnected = true
      emit('status', 'live')
      emit('surface', canvas.value)
      break
    case 'ended':
    case 'error':
      if (!everConnected) {
        // Never worked, so it will not start working on a retry. The `<img>`
        // path can still show this camera.
        usesFallback.value = true
        teardownWorker()
        return
      }
      emit('status', 'error')
      scheduleReconnect()
      break
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (props.active) startWorker()
  }, reconnectDelayMs)
}

function teardownWorker(): void {
  watchdog.stop()
  clearReconnect()
  const existing = worker
  worker = null
  if (!existing) return
  // Asked to shut itself down rather than terminated: `terminate()` discards
  // the queued message, leaving the MJPEG connection open until the browser
  // tears the worker down on its own schedule.
  existing.postMessage({ type: 'shutdown' })
  setTimeout(() => existing.terminate(), 2000)
  canvasTransferred = false
}

function startWorker(): void {
  const element = canvas.value
  if (!element || props.camera.primaryUrl === '') return
  emit('status', 'connecting')

  if (!worker) {
    worker = new Worker(new URL('./mjpeg.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = onWorkerMessage
  }
  // `transferControlToOffscreen` may be called only once per canvas element,
  // and the element outlives a worker restart.
  if (!canvasTransferred) {
    const offscreen = element.transferControlToOffscreen()
    worker.postMessage({ type: 'init', canvas: offscreen }, [offscreen])
    canvasTransferred = true
  }
  worker.postMessage({ type: 'start', url: props.camera.primaryUrl })
}

function stopWorker(): void {
  watchdog.stop()
  clearReconnect()
  worker?.postMessage({ type: 'stop' })
  emit('status', 'connecting')
}

watch(
  [() => props.active, () => props.camera.primaryUrl, () => usesFallback.value, canvas],
  ([active, , fallback]) => {
    if (fallback) {
      teardownWorker()
      return
    }
    if (active) startWorker()
    else stopWorker()
  },
  { immediate: true },
)

onBeforeUnmount(teardownWorker)

/*
 * --- The fallback path ---
 *
 * Deliberately duplicated rather than delegated to `ImageStreamer.vue`. The
 * two are one component's two modes: sharing the fallback would make this file
 * depend on a sibling streamer's contract, and the sibling could then not be
 * changed for `uv4l-mjpeg` without silently changing this fallback too.
 */
const image = ref<HTMLImageElement | null>(null)

watch(
  [() => props.active, () => props.camera.primaryUrl, () => usesFallback.value, image],
  ([active, url, fallback]) => {
    const element = image.value
    if (!fallback || !element) return
    if (!active || url === '') {
      element.removeAttribute('src')
      emit('status', 'connecting')
      return
    }
    emit('status', 'connecting')
    element.src = url as string
  },
  { immediate: true },
)

function onFallbackLoad(): void {
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
    v-if="usesFallback"
    ref="image"
    class="camera-frame"
    draggable="false"
    :alt="camera.name"
    @load="onFallbackLoad"
    @error="emit('status', 'error')"
  />
  <canvas v-else ref="canvas" class="camera-frame" :aria-label="camera.name" role="img"></canvas>
</template>
