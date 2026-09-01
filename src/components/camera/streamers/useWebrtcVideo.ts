import { onBeforeUnmount, watch, type Ref } from 'vue'

import type { Camera } from '@/features/camera/camera'

import {
  createStallWatchdog,
  videoAspectSize,
  watchVideoFrames,
  type CameraStreamStatus,
  type CameraSurface,
} from './streamer'

/**
 * The parts every WebRTC streamer shares: the `<video>` element, the media
 * stream attached to it, frame reporting, stall detection, and the
 * start/stop/reconnect lifecycle driven by the tile's `active` prop.
 *
 * Four services do their signalling four different ways — a JSON POST dance,
 * a websocket, WHEP over HTTP verbs, and Janus's own plugin protocol — but
 * once a track arrives they are identical. Sharing everything after that point
 * is what keeps a fix to reconnect behavior from having to be applied four
 * times, which in the reference implementation is exactly where the four
 * copies have drifted apart.
 *
 * The caller supplies `connect`, which does its own signalling and calls
 * `attach` with the resulting stream, and `disconnect`, which tears its own
 * connection down. Everything else belongs here.
 */
export interface WebrtcVideoHost {
  /** Points the element at a stream and begins reporting its frames. */
  attach: (stream: MediaStream) => void
  /** Call from `@loadedmetadata` and `@resize`. */
  reportSize: () => void
  /**
   * Tears the connection down and reconnects after a delay. Idempotent while a
   * reconnect is already pending, so a burst of ICE failures schedules one
   * attempt rather than one per event.
   */
  reconnect: (delayMs?: number) => void
  /** Reports a signalling or connection failure and schedules a reconnect. */
  fail: () => void
}

export function useWebrtcVideo(options: {
  /** The component's own `<video>` ref, so its template can bind it by name. */
  video: Ref<HTMLVideoElement | null>
  camera: () => Camera
  active: () => boolean
  emit: {
    (event: 'status', status: CameraStreamStatus): void
    (event: 'size', width: number, height: number): void
    (event: 'frame'): void
    (event: 'surface', surface: CameraSurface): void
  }
  connect: () => void | Promise<void>
  disconnect: () => void
  /** Extra values whose change should restart the connection. */
  restartOn?: () => unknown
}): WebrtcVideoHost {
  const { video, camera, active, emit, connect, disconnect } = options
  let stopFrames: (() => void) | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const watchdog = createStallWatchdog((stalled) => emit('status', stalled ? 'stalled' : 'live'))

  function clearReconnect(): void {
    if (reconnectTimer !== null) clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  function attach(stream: MediaStream): void {
    const element = video.value
    if (!element) return
    element.srcObject = stream
    stopFrames?.()
    stopFrames = watchVideoFrames(element, () => {
      emit('frame')
      watchdog.frame()
    })
    // Autoplay is only permitted muted, and a WebRTC camera whose audio was
    // asked for still has to start playing before the user can unmute it.
    void element.play().catch(() => undefined)
  }

  function reportSize(): void {
    const element = video.value
    if (!element) return
    emit('status', 'live')
    emit('surface', element)
    const size = videoAspectSize(element)
    if (size) emit('size', size.width, size.height)
  }

  function teardown(): void {
    clearReconnect()
    watchdog.stop()
    stopFrames?.()
    stopFrames = null
    disconnect()
    const element = video.value
    if (element) element.srcObject = null
  }

  function reconnect(delayMs = 2000): void {
    if (reconnectTimer !== null) return
    teardown()
    emit('status', 'connecting')
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (active()) void connect()
    }, delayMs)
  }

  function fail(): void {
    emit('status', 'error')
    reconnect()
  }

  watch(
    [active, () => camera().primaryUrl, options.restartOn ?? (() => undefined), video],
    ([isActive]) => {
      teardown()
      if (!isActive) {
        emit('status', 'connecting')
        return
      }
      if (camera().primaryUrl === '') {
        emit('status', 'error')
        return
      }
      emit('status', 'connecting')
      void connect()
    },
    { immediate: true },
  )

  onBeforeUnmount(teardown)

  return { attach, reportSize, reconnect, fail }
}
