/**
 * The streaming services a camera can be configured as, and what each one can
 * actually do.
 *
 * The identifiers are not Alabaster's to choose: they are the strings
 * Moonraker's webcam database already stores, which every Klipper interface on
 * the printer reads. A camera added in Mainsail arrives here with Mainsail's
 * `service` value, so the set below has to match theirs exactly — renaming one
 * would silently orphan a working camera rather than migrate it.
 *
 * `traits` exists so that neither the editor nor the renderer decides on its
 * own which fields a service uses. Both read the same record, which is what
 * keeps the settings form from offering a target frame rate to a service that
 * ignores it — the failure being prevented is a user setting a value, saving
 * it, and watching nothing change.
 */

export const cameraServiceIds = [
  'mjpegstreamer',
  'mjpegstreamer-adaptive',
  'uv4l-mjpeg',
  'html-video',
  'iframe',
  'webrtc-camerastreamer',
  'webrtc-go2rtc',
  'webrtc-mediamtx',
  'webrtc-janus',
  'hlsstream',
  'jmuxer-stream',
] as const

export type CameraServiceId = (typeof cameraServiceIds)[number]

export interface CameraServiceTraits {
  id: CameraServiceId
  /** Locale key for the name shown in the service picker. */
  labelKey: string
  /**
   * Which of the camera's two URLs the renderer loads, and therefore which one
   * the editor requires. `mjpegstreamer-adaptive` is the only service built on
   * the snapshot URL: it re-requests a still image on a timer rather than
   * holding a multipart stream open, which is why it is the one service that
   * can be saved with no stream URL at all.
   */
  primaryUrl: 'stream' | 'snapshot'
  /** The service paces itself, so the target frame rate is its own to obey. */
  usesTargetFps: boolean
  /**
   * The renderer can count delivered frames, so a measured rate is worth
   * showing and worth offering a switch for. False for the two services whose
   * picture arrives without any per-frame signal Alabaster can observe: a
   * plain `<img>` holding a multipart stream open fires `load` exactly once,
   * and an `iframe`'s document is the browser's rather than ours.
   */
  reportsFrames: boolean
  /**
   * `iframe` cannot be measured or reshaped from outside, so its frame box has
   * to be declared rather than discovered — every other service reports its
   * own intrinsic size once the first frame lands.
   */
  needsDeclaredAspectRatio: boolean
  /** The transport carries an audio track that can be asked for separately. */
  supportsAudio: boolean
  /**
   * Whether Alabaster can read pixels back out of the rendered frame — what
   * both the still-image capture and any future frame analysis need. False for
   * `iframe`, whose document is the browser's, not ours.
   */
  canCaptureStill: boolean
}

const traits: Record<CameraServiceId, CameraServiceTraits> = {
  mjpegstreamer: {
    id: 'mjpegstreamer',
    labelKey: 'cameras.services.mjpegstreamer',
    primaryUrl: 'stream',
    usesTargetFps: false,
    reportsFrames: true,
    needsDeclaredAspectRatio: false,
    supportsAudio: false,
    canCaptureStill: true,
  },
  'mjpegstreamer-adaptive': {
    id: 'mjpegstreamer-adaptive',
    labelKey: 'cameras.services.mjpegstreamerAdaptive',
    primaryUrl: 'snapshot',
    usesTargetFps: true,
    reportsFrames: true,
    needsDeclaredAspectRatio: false,
    supportsAudio: false,
    canCaptureStill: true,
  },
  'uv4l-mjpeg': {
    id: 'uv4l-mjpeg',
    labelKey: 'cameras.services.uv4lMjpeg',
    primaryUrl: 'stream',
    usesTargetFps: false,
    reportsFrames: false,
    needsDeclaredAspectRatio: false,
    supportsAudio: false,
    canCaptureStill: true,
  },
  'html-video': {
    id: 'html-video',
    labelKey: 'cameras.services.htmlVideo',
    primaryUrl: 'stream',
    usesTargetFps: false,
    reportsFrames: true,
    needsDeclaredAspectRatio: false,
    supportsAudio: true,
    canCaptureStill: true,
  },
  iframe: {
    id: 'iframe',
    labelKey: 'cameras.services.iframe',
    primaryUrl: 'stream',
    usesTargetFps: false,
    reportsFrames: false,
    needsDeclaredAspectRatio: true,
    supportsAudio: false,
    canCaptureStill: false,
  },
  'webrtc-camerastreamer': {
    id: 'webrtc-camerastreamer',
    labelKey: 'cameras.services.webrtcCameraStreamer',
    primaryUrl: 'stream',
    usesTargetFps: false,
    reportsFrames: true,
    needsDeclaredAspectRatio: false,
    supportsAudio: false,
    canCaptureStill: true,
  },
  'webrtc-go2rtc': {
    id: 'webrtc-go2rtc',
    labelKey: 'cameras.services.webrtcGo2rtc',
    primaryUrl: 'stream',
    usesTargetFps: false,
    reportsFrames: true,
    needsDeclaredAspectRatio: false,
    supportsAudio: true,
    canCaptureStill: true,
  },
  'webrtc-mediamtx': {
    id: 'webrtc-mediamtx',
    labelKey: 'cameras.services.webrtcMediaMtx',
    primaryUrl: 'stream',
    usesTargetFps: false,
    reportsFrames: true,
    needsDeclaredAspectRatio: false,
    supportsAudio: true,
    canCaptureStill: true,
  },
  'webrtc-janus': {
    id: 'webrtc-janus',
    labelKey: 'cameras.services.webrtcJanus',
    primaryUrl: 'stream',
    usesTargetFps: false,
    reportsFrames: true,
    needsDeclaredAspectRatio: false,
    supportsAudio: false,
    canCaptureStill: true,
  },
  hlsstream: {
    id: 'hlsstream',
    labelKey: 'cameras.services.hlsstream',
    primaryUrl: 'stream',
    usesTargetFps: false,
    reportsFrames: true,
    needsDeclaredAspectRatio: false,
    supportsAudio: true,
    canCaptureStill: true,
  },
  'jmuxer-stream': {
    id: 'jmuxer-stream',
    labelKey: 'cameras.services.jmuxerStream',
    primaryUrl: 'stream',
    usesTargetFps: true,
    reportsFrames: true,
    needsDeclaredAspectRatio: false,
    supportsAudio: false,
    canCaptureStill: true,
  },
}

export function isCameraServiceId(value: unknown): value is CameraServiceId {
  return typeof value === 'string' && cameraServiceIds.includes(value as CameraServiceId)
}

/**
 * A camera whose `service` Alabaster does not implement still has to render
 * something rather than crash the card — Moonraker accepts any string, and a
 * future service will exist before Alabaster speaks it. It falls back to
 * `mjpegstreamer`'s traits, which is the plain `<img>` path: the one renderer
 * that is right often enough to be worth attempting, since most services that
 * are not WebRTC serve MJPEG underneath.
 */
export function cameraServiceTraits(service: string): CameraServiceTraits {
  return isCameraServiceId(service) ? traits[service] : traits.mjpegstreamer
}

export const cameraServiceList: readonly CameraServiceTraits[] = cameraServiceIds.map(
  (id) => traits[id],
)

export const cameraRotations = [0, 90, 180, 270] as const
export type CameraRotation = (typeof cameraRotations)[number]

export function isCameraRotation(value: unknown): value is CameraRotation {
  return value === 0 || value === 90 || value === 180 || value === 270
}

/**
 * Parses Moonraker's `W:H` aspect ratio into a number. Returns null rather
 * than a guess for anything unparseable, so a caller can fall back to the
 * frame's own measured size instead of laying the stream out against a ratio
 * nobody chose. Accepts `/` as well as `:` because both are in circulation.
 */
export function parseAspectRatio(value: string | undefined): number | null {
  if (!value) return null
  const match = value.trim().match(/^(\d+)\s*[:/]\s*(\d+)$/)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (width < 1 || height < 1) return null
  return width / height
}
