<script setup lang="ts">
/**
 * `webrtc-mediamtx` — WHEP, the standard "WebRTC-HTTP egress protocol":
 * `OPTIONS` for the ICE servers, `POST` an SDP offer, `PATCH` trickled
 * candidates into the session the response's `Location` header names.
 *
 * The one non-standard part is the trickle body. WHEP carries candidates as an
 * SDP fragment, and no specification says exactly which lines it has to
 * contain, so `sdpFragmentFor` reconstructs the `ice-ufrag`/`ice-pwd` pair and
 * the media sections from the offer we just sent — which is what MediaMTX
 * expects.
 *
 * Adapted from MediaMTX's own reader page.
 */
import { computed, ref } from 'vue'

import type { CameraStreamerEmits, CameraStreamerProps } from './streamer'
import { useWebrtcVideo } from './useWebrtcVideo'

const props = defineProps<CameraStreamerProps>()
const emit = defineEmits<CameraStreamerEmits>()

interface OfferData {
  iceUfrag: string
  icePwd: string
  medias: string[]
}

let peer: RTCPeerConnection | null = null
let sessionUrl: string | null = null
let eTag: string | null = null
let offerData: OfferData = { iceUfrag: '', icePwd: '', medias: [] }
let queuedCandidates: RTCIceCandidate[] = []

const video = ref<HTMLVideoElement | null>(null)

/**
 * MediaMTX serves WHEP at `<path>/whep`, and the URL people store is the path
 * itself, so the suffix is appended rather than expected.
 */
const whepUrl = computed(() => {
  if (props.camera.primaryUrl === '') return ''
  const base = props.camera.primaryUrl.endsWith('/')
    ? props.camera.primaryUrl
    : `${props.camera.primaryUrl}/`
  return `${base}whep`
})

const host = useWebrtcVideo({
  video,
  camera: () => props.camera,
  active: () => props.active,
  emit,
  restartOn: () => whepUrl.value,
  connect,
  disconnect: () => {
    peer?.close()
    peer = null
    sessionUrl = null
    eTag = null
    queuedCandidates = []
  },
})

/**
 * Parses the `Link` headers WHEP uses to advertise ICE servers. A malformed
 * entry yields no server rather than a broken one, because a `urls: ''` entry
 * makes `RTCPeerConnection` throw on construction.
 */
function iceServersFrom(links: string | null): RTCIceServer[] {
  if (links === null) return []
  const servers: RTCIceServer[] = []
  for (const link of links.split(', ')) {
    const match = link.match(
      /^<(.+?)>; rel="ice-server"(; username="(.*?)"; credential="(.*?)"; credential-type="password")?/i,
    )
    if (!match?.[1]) continue
    const server: RTCIceServer = { urls: [match[1]] }
    if (match[3] !== undefined && match[4] !== undefined) {
      server.username = JSON.parse(`"${match[3]}"`) as string
      server.credential = JSON.parse(`"${match[4]}"`) as string
    }
    servers.push(server)
  }
  return servers
}

function parseOffer(sdp: string): OfferData {
  const parsed: OfferData = { iceUfrag: '', icePwd: '', medias: [] }
  for (const line of sdp.split('\r\n')) {
    if (line.startsWith('m=')) parsed.medias.push(line.slice('m='.length))
    else if (parsed.iceUfrag === '' && line.startsWith('a=ice-ufrag:')) {
      parsed.iceUfrag = line.slice('a=ice-ufrag:'.length)
    } else if (parsed.icePwd === '' && line.startsWith('a=ice-pwd:')) {
      parsed.icePwd = line.slice('a=ice-pwd:'.length)
    }
  }
  return parsed
}

function sdpFragmentFor(candidates: RTCIceCandidate[]): string {
  const byMedia = new Map<number, RTCIceCandidate[]>()
  for (const candidate of candidates) {
    const index = candidate.sdpMLineIndex
    if (index === null) continue
    const existing = byMedia.get(index)
    if (existing) existing.push(candidate)
    else byMedia.set(index, [candidate])
  }

  let fragment = `a=ice-ufrag:${offerData.iceUfrag}\r\na=ice-pwd:${offerData.icePwd}\r\n`
  offerData.medias.forEach((media, index) => {
    const forMedia = byMedia.get(index)
    if (!forMedia) return
    fragment += `m=${media}\r\na=mid:${index}\r\n`
    for (const candidate of forMedia) fragment += `a=${candidate.candidate}\r\n`
  })
  return fragment
}

async function connect(): Promise<void> {
  if (whepUrl.value === '') return
  try {
    const response = await fetch(whepUrl.value, { method: 'OPTIONS' })
    // WHEP answers a preflight with 204 and nothing else; anything else means
    // this URL is not a WHEP endpoint.
    if (response.status !== 204) {
      host.fail()
      return
    }
    await openPeer(iceServersFrom(response.headers.get('Link')))
  } catch {
    host.fail()
  }
}

async function openPeer(iceServers: RTCIceServer[]): Promise<void> {
  const connection = new RTCPeerConnection({
    iceServers,
    sdpSemantics: 'unified-plan',
  } as RTCConfiguration)
  peer = connection

  // `sendrecv` rather than `recvonly`: MediaMTX's WHEP implementation answers a
  // receive-only offer without the media lines the trickle fragment then has to
  // reference.
  connection.addTransceiver('video', { direction: 'sendrecv' })
  connection.addTransceiver('audio', { direction: 'sendrecv' })

  connection.onicecandidate = (event) => {
    if (peer !== connection || !event.candidate) return
    // Candidates found before the session exists are held rather than dropped —
    // the local ones are usually the only ones that work on a printer's LAN.
    if (sessionUrl === null) {
      queuedCandidates.push(event.candidate)
      return
    }
    void sendCandidates([event.candidate])
  }
  connection.oniceconnectionstatechange = () => {
    if (peer !== connection) return
    if (connection.iceConnectionState === 'disconnected') host.fail()
  }
  connection.ontrack = (event) => {
    if (peer !== connection) return
    const stream = event.streams[0]
    if (stream) host.attach(stream)
  }

  try {
    const offer = await connection.createOffer()
    await connection.setLocalDescription(offer)
    if (peer !== connection) return
    offerData = parseOffer(offer.sdp ?? '')

    const response = await fetch(whepUrl.value, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: offer.sdp ?? '',
    })
    if (response.status !== 201 || peer !== connection) {
      host.fail()
      return
    }

    // MediaMTX 1.0.x sent this header as `E-Tag`; both spellings are read
    // rather than picking one and failing against the other release.
    eTag = response.headers.get('ETag') ?? response.headers.get('E-Tag')
    const location = response.headers.get('Location')
    sessionUrl = location === null ? null : new URL(location, whepUrl.value).toString()

    await connection.setRemoteDescription({ type: 'answer', sdp: await response.text() })

    if (queuedCandidates.length > 0) {
      const pending = queuedCandidates
      queuedCandidates = []
      await sendCandidates(pending)
    }
  } catch {
    host.fail()
  }
}

async function sendCandidates(candidates: RTCIceCandidate[]): Promise<void> {
  if (sessionUrl === null) return
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/trickle-ice-sdpfrag',
    }
    if (eTag !== null) headers['If-Match'] = eTag
    const response = await fetch(sessionUrl, {
      method: 'PATCH',
      headers,
      body: sdpFragmentFor(candidates),
    })
    if (response.status !== 204) host.fail()
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
    :muted="camera.extraData.enableAudio !== true"
    @loadedmetadata="host.reportSize()"
    @resize="host.reportSize()"
  ></video>
</template>
