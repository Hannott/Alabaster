<script setup lang="ts">
/**
 * `hlsstream` — HTTP Live Streaming, which most Klipper camera software does
 * not serve but a network camera or a go2rtc/MediaMTX instance configured for
 * it does.
 *
 * Safari plays HLS natively; nothing else does, so this is the one service that
 * needs a library. `hls.js` is loaded only when a camera is actually configured
 * as HLS — the whole streamer set is code-split per service for exactly this
 * reason — and the native path is preferred where it exists, because a browser
 * decoding HLS itself does it more efficiently than a library reassembling
 * segments in JavaScript.
 *
 * The tuning below is what makes it usable as a *camera* rather than as video
 * playback: HLS buffers by design, and its defaults would show the printer
 * where it was ten seconds ago. Chasing the live edge with a short sync window
 * trades smoothness for latency, which is the right trade when the picture's
 * job is to tell you what the printer is doing now.
 */
import Hls from 'hls.js'
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
let hls: Hls | null = null
let stopFrames: (() => void) | null = null
const watchdog = createStallWatchdog((stalled) => emit('status', stalled ? 'stalled' : 'live'))

function stop(): void {
  stopFrames?.()
  stopFrames = null
  watchdog.stop()
  hls?.destroy()
  hls = null
  const element = video.value
  if (!element) return
  element.pause()
  element.removeAttribute('src')
  element.load()
}

function start(): void {
  const element = video.value
  if (!element || props.camera.primaryUrl === '') return
  emit('status', 'connecting')

  stopFrames = watchVideoFrames(element, () => {
    emit('frame')
    watchdog.frame()
  })

  if (element.canPlayType('application/vnd.apple.mpegurl') !== '') {
    element.src = props.camera.primaryUrl
    void element.play().catch(() => emit('status', 'error'))
    return
  }

  if (!Hls.isSupported()) {
    emit('status', 'error')
    return
  }

  hls = new Hls({
    enableWorker: true,
    lowLatencyMode: true,
    // Sit half a second behind the live edge and be willing to play at double
    // speed to catch up, rather than letting latency accumulate.
    liveSyncDuration: 0.5,
    liveMaxLatencyDuration: 2,
    maxLiveSyncPlaybackRate: 2,
    // No reason to keep history for a live camera nobody scrubs backwards in.
    backBufferLength: 5,
  })
  hls.loadSource(props.camera.primaryUrl)
  hls.attachMedia(element)
  hls.on(Hls.Events.MANIFEST_PARSED, () => void element.play().catch(() => undefined))
  hls.on(Hls.Events.ERROR, (_event, data) => {
    // Non-fatal errors are hls.js's normal operation — a dropped segment it
    // will re-request. Reporting them would flicker the badge continuously on
    // a perfectly watchable stream.
    if (data.fatal) emit('status', 'error')
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
  ></video>
</template>
