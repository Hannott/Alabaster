import { defineAsyncComponent, type Component } from 'vue'

import type { Camera } from '@/features/camera/camera'
import type { CameraServiceId } from '@/features/camera/services'

/**
 * One camera renderer per streaming service, behind one contract.
 *
 * The contract exists so the shell around a stream — the frame box, the flips,
 * the label, the still capture, fullscreen, the stalled badge — is written once
 * rather than eleven times. That is not only less code: the reference
 * interfaces implement visibility handling, restart-on-error and aspect-ratio
 * measurement separately inside each streamer, and the copies have drifted, so
 * whether a stream stops when you switch browser tabs depends on which service
 * the camera happens to use. Here that decision belongs to `CameraTile`, and
 * every streamer obeys the same `active` prop.
 */

export type CameraStreamStatus =
  /** Asked for, nothing on screen yet. Renders no spinner — see ADR 0004. */
  | 'connecting'
  /** Frames are arriving. */
  | 'live'
  /**
   * Connected, but nothing has arrived for long enough that the picture on
   * screen is stale. Distinct from `error` because the last frame is still
   * worth showing — a frozen image with a badge tells the truth, a blank stage
   * does not.
   */
  | 'stalled'
  | 'error'

export interface CameraStreamerProps {
  camera: Camera
  /**
   * Whether this stream should be running at all. False while the card is off
   * screen, the browser tab is in the background, or another camera's tab is
   * showing — a stream nobody is looking at still costs the printer's CPU and
   * the network, which on a Pi streaming 1080p is the difference between a
   * smooth print and a stuttering one.
   */
  active: boolean
}

/** The element a still frame can be read out of, or null for a service with none. */
export type CameraSurface = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | null

export interface CameraStreamerEmits {
  status: [CameraStreamStatus]
  /** The stream's own pixel dimensions, once known. */
  size: [width: number, height: number]
  /** One delivered frame. Drives both the measured rate and stall detection. */
  frame: []
  surface: [CameraSurface]
}

/**
 * Every streamer is loaded on demand. The WebRTC, HLS and jMuxer paths are
 * several kilobytes of protocol handling each, and HLS pulls a library —
 * charging every user for eleven services when their printer has one camera on
 * one of them is exactly the bundle growth ADR 0001 asks to avoid. The chunk
 * arrives while the card's frame box is already laid out, so nothing reflows
 * when it lands.
 */
const streamers: Record<CameraServiceId, () => Promise<Component>> = {
  mjpegstreamer: () => import('./MjpegStreamer.vue').then((module) => module.default),
  'mjpegstreamer-adaptive': () =>
    import('./MjpegAdaptiveStreamer.vue').then((module) => module.default),
  'uv4l-mjpeg': () => import('./ImageStreamer.vue').then((module) => module.default),
  'html-video': () => import('./VideoStreamer.vue').then((module) => module.default),
  iframe: () => import('./IframeStreamer.vue').then((module) => module.default),
  'webrtc-camerastreamer': () =>
    import('./WebrtcCameraStreamer.vue').then((module) => module.default),
  'webrtc-go2rtc': () => import('./WebrtcGo2rtcStreamer.vue').then((module) => module.default),
  'webrtc-mediamtx': () => import('./WebrtcMediaMtxStreamer.vue').then((module) => module.default),
  'webrtc-janus': () => import('./WebrtcJanusStreamer.vue').then((module) => module.default),
  hlsstream: () => import('./HlsStreamer.vue').then((module) => module.default),
  'jmuxer-stream': () => import('./JmuxerStreamer.vue').then((module) => module.default),
}

const loaded = new Map<CameraServiceId, Component>()

/**
 * The component for a camera's service. Memoized per service rather than per
 * camera, so two cards showing the same service share one chunk and one
 * `defineAsyncComponent` wrapper — a fresh wrapper per camera would re-enter
 * its loading state on every re-render of the grid.
 */
export function streamerFor(service: CameraServiceId): Component {
  const existing = loaded.get(service)
  if (existing) return existing
  const component = defineAsyncComponent(streamers[service])
  loaded.set(service, component)
  return component
}

/**
 * Reports each frame a `<video>` presents.
 *
 * `requestVideoFrameCallback` is the only API that fires once per decoded
 * frame; without it there is no per-frame signal at all, and `timeupdate`
 * (roughly 4 Hz, and silent on a stalled stream) is used purely as a
 * liveness signal so stall detection still works on Firefox. The rate shown
 * there is therefore the rate frames *arrive at the element*, not the encoded
 * frame rate — which is the number worth showing anyway, since it is the one
 * that drops when the printer is struggling.
 */
export function watchVideoFrames(video: HTMLVideoElement, onFrame: () => void): () => void {
  type WithFrameCallback = HTMLVideoElement & {
    requestVideoFrameCallback?: (callback: () => void) => number
    cancelVideoFrameCallback?: (handle: number) => void
  }
  const element = video as WithFrameCallback

  if (typeof element.requestVideoFrameCallback !== 'function') {
    video.addEventListener('timeupdate', onFrame)
    return () => video.removeEventListener('timeupdate', onFrame)
  }

  let handle: number | null = null
  let stopped = false
  const tick = (): void => {
    if (stopped) return
    onFrame()
    handle = element.requestVideoFrameCallback?.(tick) ?? null
  }
  handle = element.requestVideoFrameCallback(tick)

  return () => {
    stopped = true
    if (handle !== null) element.cancelVideoFrameCallback?.(handle)
  }
}

/**
 * Reports a `<video>`'s intrinsic size once it is known. Called from
 * `loadedmetadata` and again from `resize`, because an adaptive stream can
 * change resolution mid-session and the frame box has to follow it.
 */
export function videoAspectSize(video: HTMLVideoElement): { width: number; height: number } | null {
  if (!video.videoWidth || !video.videoHeight) return null
  return { width: video.videoWidth, height: video.videoHeight }
}

/**
 * How long a stream that has already delivered a frame may go quiet before it
 * is reported stalled. Generous on purpose: Firefox has no
 * `requestVideoFrameCallback`, so its liveness signal is `timeupdate` at
 * roughly 4 Hz, and a 1 fps time-lapse camera is a legitimate configuration.
 * A false "stalled" badge over a working camera is worse than noticing a real
 * freeze four seconds late.
 */
export const cameraStallTimeoutMs = 4000

/**
 * Watches for a stream going quiet.
 *
 * The failure this catches is the one no `error` event reports: an MJPEG or
 * WebRTC connection that stays open while the camera behind it has stopped
 * sending. The browser holds the last frame on screen indefinitely, so the
 * card shows a plausible picture of the printer that is minutes old — which is
 * worse than showing nothing, because it is the picture someone checks before
 * deciding the print is fine.
 *
 * The last frame stays on screen; only the badge changes. `notice` fires with
 * `true` on going quiet and `false` on the next frame after that.
 */
export function createStallWatchdog(notice: (stalled: boolean) => void): {
  frame: () => void
  stop: () => void
} {
  let timer: ReturnType<typeof setTimeout> | null = null
  let stalled = false

  function stop(): void {
    if (timer !== null) clearTimeout(timer)
    timer = null
    stalled = false
  }

  return {
    frame() {
      if (stalled) {
        stalled = false
        notice(false)
      }
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        stalled = true
        notice(true)
      }, cameraStallTimeoutMs)
    },
    stop,
  }
}

/**
 * The websocket URL for a camera whose transport is a websocket, matching the
 * page's own security context. A `ws://` socket opened from an `https://` page
 * is blocked outright, so the scheme follows the stream URL's own when it is
 * absolute and the printer's otherwise.
 */
export function cameraWebsocketUrl(camera: Camera, url: string): string {
  const parsed = new URL(url, camera.primaryUrl || 'http://localhost')
  if (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') return parsed.toString()
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
  return parsed.toString()
}
