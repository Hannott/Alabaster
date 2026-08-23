<script setup lang="ts">
/**
 * `webrtc-janus` — the Janus gateway's streaming plugin, signalled directly
 * over its websocket API.
 *
 * Written against the protocol rather than against Janus's own client library,
 * which would be a runtime dependency for the least common service here. The
 * exchange is four steps: create a session, attach the streaming plugin, ask to
 * `watch` a stream id, and answer the SDP offer that comes back with a `start`.
 * Every request carries a transaction id so its reply can be matched, and the
 * session needs a keepalive or Janus reaps it after about a minute.
 *
 * The stream id is the last path segment of the configured URL, and everything
 * before it is the websocket endpoint — `http://printer.lan:8188/janus/1`
 * watches stream 1. A URL with no port falls back to 8188, Janus's own default,
 * because resolving a bare path against Moonraker's host would otherwise point
 * the socket at Moonraker's port.
 */
import { computed, onBeforeUnmount, ref } from 'vue'

import { cameraWebsocketUrl, type CameraStreamerEmits, type CameraStreamerProps } from './streamer'
import { useWebrtcVideo } from './useWebrtcVideo'

const props = defineProps<CameraStreamerProps>()
const emit = defineEmits<CameraStreamerEmits>()

/** Janus reaps a session after roughly 60 s of silence. */
const keepaliveIntervalMs = 25_000
const janusDefaultPort = '8188'

interface JanusMessage {
  janus?: string
  transaction?: string
  session_id?: number
  sender?: number
  data?: { id?: number }
  jsep?: RTCSessionDescriptionInit
}

let socket: WebSocket | null = null
let peer: RTCPeerConnection | null = null
let sessionId: number | null = null
let handleId: number | null = null
let keepalive: ReturnType<typeof setInterval> | null = null
let transactionCounter = 0
const remoteStream = ref<MediaStream | null>(null)

const video = ref<HTMLVideoElement | null>(null)

const endpoint = computed(() => {
  if (props.camera.primaryUrl === '') return { url: '', streamId: null as number | null }
  const url = new URL(props.camera.primaryUrl)
  const segments = url.pathname.split('/').filter((segment) => segment !== '')
  const last = segments.pop()
  const streamId = last !== undefined && /^\d+$/.test(last) ? Number(last) : null
  url.pathname = `/${segments.join('/')}`
  url.search = ''
  // A stored URL that named no port at all was resolved against Moonraker's,
  // which is never where Janus listens.
  if (!/:\d+/.test(props.camera.rawStreamUrl)) url.port = janusDefaultPort
  return { url: cameraWebsocketUrl(props.camera, url.toString()), streamId }
})

const host = useWebrtcVideo({
  video,
  camera: () => props.camera,
  active: () => props.active,
  emit,
  restartOn: () => endpoint.value.url,
  connect,
  disconnect,
})

function nextTransaction(): string {
  transactionCounter += 1
  return `alabaster-${transactionCounter}`
}

function send(message: Record<string, unknown>): void {
  if (socket?.readyState !== WebSocket.OPEN) return
  socket.send(JSON.stringify({ transaction: nextTransaction(), ...message }))
}

function disconnect(): void {
  if (keepalive !== null) clearInterval(keepalive)
  keepalive = null
  // Destroying the session explicitly rather than just dropping the socket:
  // Janus otherwise holds the stream's viewer slot until its own timeout, and
  // a card that reconnects on every tab switch runs out of slots.
  if (sessionId !== null) send({ janus: 'destroy', session_id: sessionId })
  sessionId = null
  handleId = null
  remoteStream.value = null
  peer?.close()
  peer = null
  const existing = socket
  socket = null
  existing?.close()
}

function connect(): void {
  const { url, streamId } = endpoint.value
  if (url === '' || streamId === null) {
    emit('status', 'error')
    return
  }

  // Janus requires its subprotocol on the handshake and refuses the connection
  // without it.
  const ws = new WebSocket(url, 'janus-protocol')
  socket = ws

  ws.addEventListener('open', () => {
    if (socket !== ws) return
    send({ janus: 'create' })
  })
  ws.addEventListener('message', (event) => {
    if (socket !== ws) return
    void onMessage(JSON.parse(String(event.data)) as JanusMessage, streamId)
  })
  ws.addEventListener('error', () => {
    if (socket === ws) host.fail()
  })
  ws.addEventListener('close', (event) => {
    if (socket === ws && !event.wasClean) host.fail()
  })
}

async function onMessage(message: JanusMessage, streamId: number): Promise<void> {
  if (message.janus === 'error') {
    host.fail()
    return
  }

  if (message.janus === 'success' && message.data?.id !== undefined) {
    // One `success` carrying an id is the session, the next is the plugin
    // handle — they are told apart by which one we are still waiting for.
    if (sessionId === null) {
      sessionId = message.data.id
      keepalive = setInterval(() => {
        if (sessionId !== null) send({ janus: 'keepalive', session_id: sessionId })
      }, keepaliveIntervalMs)
      send({ janus: 'attach', plugin: 'janus.plugin.streaming', session_id: sessionId })
      return
    }
    if (handleId === null) {
      handleId = message.data.id
      send({
        janus: 'message',
        body: { request: 'watch', id: streamId },
        session_id: sessionId,
        handle_id: handleId,
      })
    }
    return
  }

  if (message.jsep) await answer(message.jsep)
}

async function answer(offer: RTCSessionDescriptionInit): Promise<void> {
  const connection = new RTCPeerConnection({ iceServers: [] })
  peer?.close()
  peer = connection

  connection.addEventListener('track', (event) => {
    if (peer !== connection || event.track.kind !== 'video') return
    // Janus renegotiates tracks onto the same session rather than sending a new
    // stream, so tracks accumulate on one `MediaStream` that stays attached.
    const stream = remoteStream.value ?? new MediaStream()
    remoteStream.value = stream
    stream.addTrack(event.track)
    host.attach(stream)
  })
  connection.addEventListener('icecandidate', (event) => {
    if (peer !== connection) return
    send({
      janus: 'trickle',
      candidate: event.candidate ? event.candidate.toJSON() : { completed: true },
      session_id: sessionId,
      handle_id: handleId,
    })
  })
  connection.addEventListener('connectionstatechange', () => {
    if (peer !== connection) return
    const state = connection.connectionState
    if (state === 'failed' || state === 'disconnected') host.fail()
  })

  try {
    await connection.setRemoteDescription(offer)
    const localAnswer = await connection.createAnswer()
    await connection.setLocalDescription(localAnswer)
    if (peer !== connection) return
    send({
      janus: 'message',
      body: { request: 'start' },
      jsep: { type: localAnswer.type, sdp: localAnswer.sdp },
      session_id: sessionId,
      handle_id: handleId,
    })
  } catch {
    host.fail()
  }
}

onBeforeUnmount(disconnect)
</script>

<template>
  <video
    ref="video"
    class="camera-frame"
    autoplay
    playsinline
    muted
    @loadedmetadata="host.reportSize()"
    @resize="host.reportSize()"
  ></video>
</template>
