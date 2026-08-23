<script setup lang="ts">
/**
 * `webrtc-go2rtc` — go2rtc signals over a websocket rather than HTTP, and the
 * browser makes the offer.
 *
 * The URL people paste is rarely the signalling URL. go2rtc's own viewer lives
 * at `stream.html?src=name` and its WebRTC endpoint at `api/webrtc?src=name`,
 * while signalling happens at `api/ws?src=name` — so the stored URL is
 * rewritten to the last of those, keeping the query intact. Getting this wrong
 * is the common configuration failure: the socket opens against a page rather
 * than the API and simply never answers.
 *
 * Audio is a separate media type in the request, not a property of the track,
 * which is why asking for it has to restart the connection.
 *
 * Adapted from go2rtc's own reference player.
 */
import { computed, ref } from 'vue'

import { cameraWebsocketUrl, type CameraStreamerEmits, type CameraStreamerProps } from './streamer'
import { useWebrtcVideo } from './useWebrtcVideo'

const props = defineProps<CameraStreamerProps>()
const emit = defineEmits<CameraStreamerEmits>()

let peer: RTCPeerConnection | null = null
let socket: WebSocket | null = null

const video = ref<HTMLVideoElement | null>(null)
const wantsAudio = computed(() => props.camera.extraData.enableAudio === true)

const signallingUrl = computed(() => {
  if (props.camera.primaryUrl === '') return ''
  const url = new URL(props.camera.primaryUrl)

  if (url.pathname.endsWith('/api/webrtc')) {
    url.pathname = `${url.pathname.slice(0, -'webrtc'.length)}ws`
  } else if (!url.pathname.endsWith('/api/ws')) {
    url.pathname = `${url.pathname.replace(/[^/]*$/, '')}api/ws`
  }
  url.searchParams.set('media', wantsAudio.value ? 'video+audio' : 'video')
  return cameraWebsocketUrl(props.camera, url.toString())
})

const host = useWebrtcVideo({
  video,
  camera: () => props.camera,
  active: () => props.active,
  emit,
  restartOn: () => signallingUrl.value,
  connect,
  disconnect: () => {
    peer?.close()
    peer = null
    socket?.close()
    socket = null
  },
})

function connect(): void {
  if (!video.value || signallingUrl.value === '') return

  const connection = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  })
  peer = connection

  // The transceivers are added before signalling and their receivers' tracks
  // attached immediately, rather than waiting for `ontrack`: go2rtc's protocol
  // expects the answer to describe both media lines whether or not the source
  // carries audio, and a stream assembled from the receivers is ready the
  // moment the first packet lands.
  const tracks: MediaStreamTrack[] = []
  for (const kind of ['video', 'audio']) {
    const track = connection.addTransceiver(kind, { direction: 'recvonly' }).receiver.track
    if (track) tracks.push(track)
  }
  host.attach(new MediaStream(tracks))

  const ws = new WebSocket(signallingUrl.value)
  socket = ws

  ws.addEventListener('open', () => {
    if (socket !== ws || peer !== connection) return

    connection.addEventListener('icecandidate', (event) => {
      if (!event.candidate || socket !== ws) return
      ws.send(JSON.stringify({ type: 'webrtc/candidate', value: event.candidate.candidate }))
    })
    connection.addEventListener('connectionstatechange', () => {
      if (peer !== connection) return
      const state = connection.connectionState
      if (state === 'failed' || state === 'disconnected') host.fail()
    })

    void connection
      .createOffer()
      .then(async (offer) => {
        await connection.setLocalDescription(offer)
        if (socket !== ws) return
        ws.send(
          JSON.stringify({ type: 'webrtc/offer', value: connection.localDescription?.sdp ?? '' }),
        )
      })
      .catch(() => host.fail())
  })

  ws.addEventListener('message', (event) => {
    if (socket !== ws || peer !== connection) return
    const message = JSON.parse(String(event.data)) as { type?: string; value?: string }
    if (message.type === 'webrtc/candidate' && message.value !== undefined) {
      void connection.addIceCandidate({ candidate: message.value, sdpMid: '0' })
      return
    }
    if (message.type === 'webrtc/answer' && message.value !== undefined) {
      void connection.setRemoteDescription({ type: 'answer', sdp: message.value })
    }
  })

  ws.addEventListener('close', (event) => {
    if (socket !== ws) return
    // A clean close is go2rtc or the network shutting the session down on
    // purpose; only an unclean one is a failure worth retrying against.
    if (!event.wasClean) host.fail()
  })

  ws.addEventListener('error', () => {
    if (socket === ws) host.fail()
  })
}
</script>

<template>
  <video
    ref="video"
    class="camera-frame"
    autoplay
    playsinline
    :muted="!wantsAudio"
    @loadedmetadata="host.reportSize()"
    @resize="host.reportSize()"
  ></video>
</template>
