<script setup lang="ts">
/**
 * `webrtc-camerastreamer` — camera-streamer's own signalling, which is a
 * sequence of JSON POSTs to the stream URL rather than a standard handshake.
 *
 * The unusual part is that camera-streamer sends the offer and the browser
 * answers, the reverse of every other service here: the first POST asks for a
 * session and comes back with an SDP offer, which is set as the remote
 * description before an answer is created and posted back with the session id.
 *
 * STUN is requested on the first attempt and dropped on the second. Older
 * camera-streamer builds answer a request carrying `iceServers` with a 500, and
 * on a printer's own network there is nothing for STUN to discover anyway — so
 * the retry without it is not a degraded mode, it is the mode that works.
 */
import { computed, ref } from 'vue'

import type { CameraStreamerEmits, CameraStreamerProps } from './streamer'
import { useWebrtcVideo } from './useWebrtcVideo'

const props = defineProps<CameraStreamerProps>()
const emit = defineEmits<CameraStreamerEmits>()

interface SessionOffer extends RTCSessionDescriptionInit {
  id: string
  iceServers?: RTCIceServer[]
}

let connection: RTCPeerConnection | null = null
let useStun = true

const video = ref<HTMLVideoElement | null>(null)
const url = computed(() => props.camera.primaryUrl)

const host = useWebrtcVideo({
  video,
  camera: () => props.camera,
  active: () => props.active,
  emit,
  connect: requestSession,
  disconnect: () => {
    connection?.close()
    connection = null
    useStun = true
  },
})

async function post(body: unknown): Promise<Response> {
  return fetch(url.value, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function requestSession(): Promise<void> {
  try {
    const response = await post({
      type: 'request',
      iceServers: useStun ? [{ urls: ['stun:stun.l.google.com:19302'] }] : null,
      keepAlive: true,
    })

    if (useStun && response.status === 500) {
      useStun = false
      host.reconnect(200)
      return
    }
    if (!response.ok) {
      host.fail()
      return
    }

    await answerOffer((await response.json()) as SessionOffer)
  } catch {
    host.fail()
  }
}

async function answerOffer(offer: SessionOffer): Promise<void> {
  connection?.close()
  // `sdpSemantics` is not part of the standard `RTCConfiguration`, but older
  // camera-streamer builds still expect it in the config they are handed.
  const peer = new RTCPeerConnection({
    iceServers: offer.iceServers ?? [],
    sdpSemantics: 'unified-plan',
  } as RTCConfiguration)
  connection = peer

  peer.addTransceiver('video', { direction: 'recvonly' })
  // Absent `iceServers` means a build too old to accept trickled candidates at
  // all; sending them anyway produces a stream of rejected POSTs.
  if ('iceServers' in offer) {
    peer.onicecandidate = (event) => void sendCandidate(event, offer.id)
  }
  peer.onconnectionstatechange = () => {
    if (connection !== peer) return
    if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
      host.fail()
    }
  }
  peer.ontrack = (event) => {
    if (connection !== peer || event.track.kind !== 'video') return
    const stream = event.streams[0]
    if (stream) host.attach(stream)
  }
  // camera-streamer keeps the session alive over a data channel and drops it
  // otherwise — a stream that dies after roughly a minute with no error is this
  // channel going unanswered.
  peer.ondatachannel = (event) => {
    if (event.channel.label !== 'keepalive') return
    event.channel.onmessage = (message) => {
      if (message.data === 'ping') event.channel.send('pong')
    }
  }

  try {
    await peer.setRemoteDescription(offer)
    const answer = await peer.createAnswer()
    await peer.setLocalDescription(answer)
    if (connection !== peer) return

    const response = await post({ type: answer.type, id: offer.id, sdp: answer.sdp })
    if (!response.ok) host.fail()
  } catch {
    host.fail()
  }
}

async function sendCandidate(event: RTCPeerConnectionIceEvent, id: string): Promise<void> {
  if (!event.candidate) return
  try {
    const response = await post({ id, type: 'remote_candidate', candidates: [event.candidate] })
    if (!response.ok) host.fail()
  } catch {
    host.fail()
  }
}
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
