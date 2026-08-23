<script setup lang="ts">
/**
 * `jmuxer-stream` — raw H.264 arriving over a websocket, remuxed into fragmented
 * MP4 in the browser so a plain `<video>` can play it.
 *
 * This is the lowest-latency option that needs no WebRTC negotiation at all:
 * the camera pushes NAL units down a socket and there is no handshake, no ICE,
 * and nothing for a firewall to get wrong. What it costs is the remuxing, which
 * is what `jmuxer` does, and a target frame rate that has to be configured
 * rather than discovered — the stream carries no timing of its own, so the
 * muxer is told what rate to stamp frames at. A value that disagrees with what
 * the camera actually sends drifts audio-free video slowly out of step with
 * real time, which is why the editor asks for it.
 *
 * Only a websocket URL can work here, so a camera configured with an HTTP one
 * reports an error rather than silently showing nothing.
 */
import JMuxer from 'jmuxer'
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
let muxer: JMuxer | null = null
let socket: WebSocket | null = null
let stopFrames: (() => void) | null = null
const watchdog = createStallWatchdog((stalled) => emit('status', stalled ? 'stalled' : 'live'))

function stop(): void {
  stopFrames?.()
  stopFrames = null
  watchdog.stop()
  const existingSocket = socket
  socket = null
  existingSocket?.close()
  muxer?.destroy()
  muxer = null
}

function start(): void {
  const element = video.value
  const url = props.camera.primaryUrl
  if (!element || url === '') return

  if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    emit('status', 'error')
    return
  }

  emit('status', 'connecting')
  muxer = new JMuxer({
    node: element,
    mode: 'video',
    // Flush as soon as data arrives; any buffering here is latency added to a
    // live view for no benefit.
    flushingTime: 0,
    fps: props.camera.targetFps,
    onReady: () => emit('status', 'live'),
    onError: () => emit('status', 'error'),
  })

  const ws = new WebSocket(url)
  socket = ws
  ws.binaryType = 'arraybuffer'

  stopFrames = watchVideoFrames(element, () => {
    emit('frame')
    watchdog.frame()
  })

  // Every handler checks it is still the current socket, so one that is closing
  // down after a restart can never feed the muxer that replaced its own.
  ws.addEventListener('message', (event) => {
    if (socket !== ws) return
    muxer?.feed({ video: new Uint8Array(event.data as ArrayBuffer) })
  })
  ws.addEventListener('error', () => {
    if (socket === ws) emit('status', 'error')
  })
  ws.addEventListener('close', (event) => {
    if (socket === ws && !event.wasClean) emit('status', 'error')
  })
}

watch(
  [() => props.active, () => props.camera.primaryUrl, () => props.camera.targetFps, video],
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
    muted
    @loadedmetadata="onMetadata"
    @resize="onMetadata"
  ></video>
</template>
