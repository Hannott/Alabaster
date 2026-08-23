import type { MoonrakerWebcam, MoonrakerWebcamExtraData } from '@/services/moonraker'

import {
  cameraServiceTraits,
  isCameraRotation,
  parseAspectRatio,
  type CameraRotation,
  type CameraServiceId,
  type CameraServiceTraits,
} from './services'

/**
 * The defaults Moonraker's own API documents for a new webcam entry. They are
 * written down once, here, because a Moonraker old enough to omit a field is
 * not saying "zero" — it is saying "this predates the field", and the whole
 * list has to agree on what the API would have sent.
 */
export const cameraDefaults = {
  location: 'printer',
  icon: 'mdiWebcam',
  service: 'mjpegstreamer' as CameraServiceId,
  enabled: true,
  targetFps: 15,
  targetFpsIdle: 5,
  flipHorizontal: false,
  flipVertical: false,
  rotation: 0 as CameraRotation,
  aspectRatio: '4:3',
} as const

/**
 * One camera, with every optional field resolved and both URLs made absolute.
 * Components read this and never `MoonrakerWebcam`, so a field's default is
 * applied in one place rather than at each of the dozen or so reads.
 */
export interface Camera {
  /**
   * Stable across renames. Moonraker supplies a UUID; a Moonraker too old to
   * send one leaves the name standing in, which is why every consumer treats
   * this as an opaque string rather than parsing it. A dashboard card stores
   * this, so it keeps pointing at the same camera after a rename.
   */
  uid: string
  name: string
  location: string
  icon: string
  service: CameraServiceId
  traits: CameraServiceTraits
  enabled: boolean
  /** Absolute, resolved against the Moonraker host. Empty when unset. */
  streamUrl: string
  /** Absolute, resolved against the Moonraker host. Empty when unset. */
  snapshotUrl: string
  /**
   * The URLs exactly as stored, before resolution. The editor round-trips
   * these so a relative path someone typed stays a relative path — resolving
   * it and saving the result would pin the camera to whichever host the
   * browser happened to be talking to when it was last edited. `webrtc-janus`
   * also reads them, because whether a port was written down at all decides
   * whether Janus's own default applies.
   */
  rawStreamUrl: string
  rawSnapshotUrl: string
  /** The URL this camera's service actually loads, per its traits. */
  primaryUrl: string
  targetFps: number
  targetFpsIdle: number
  flipHorizontal: boolean
  flipVertical: boolean
  rotation: CameraRotation
  /** null when the stored ratio is unparseable — measure the frame instead. */
  aspectRatio: number | null
  /** The `W:H` string as stored, for the editor to show and re-save. */
  aspectRatioText: string
  extraData: MoonrakerWebcamExtraData
  /**
   * A camera declared in `moonraker.conf` rather than added by a client.
   * Moonraker refuses to modify or delete one, so the editor shows its values
   * without controls instead of offering a save that would be rejected.
   */
  isReadOnly: boolean
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

function positiveIntOr(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.round(value)
}

/**
 * Resolves a camera URL against the printer's Moonraker host.
 *
 * The stream may be served from a different port than Moonraker's, or from an
 * entirely different machine, so an absolute URL is left alone; only a path is
 * joined onto the host. The websocket endpoint is the only address Alabaster is
 * certain reaches this printer — it is never the page's own origin, because
 * ADR 0003 supports serving the interface from somewhere other than the
 * printer.
 */
export function resolveCameraUrl(url: string, websocketEndpoint: string): string {
  if (url.trim() === '') return ''
  const endpoint = new URL(websocketEndpoint)
  endpoint.protocol = endpoint.protocol === 'wss:' ? 'https:' : 'http:'
  endpoint.pathname = '/'
  endpoint.search = ''
  endpoint.hash = ''
  return new URL(url, endpoint).toString()
}

export function normalizeCamera(webcam: MoonrakerWebcam, websocketEndpoint: string): Camera {
  const service = webcam.service
  const traits = cameraServiceTraits(service)
  const streamUrl = resolveCameraUrl(webcam.stream_url ?? '', websocketEndpoint)
  const snapshotUrl = resolveCameraUrl(webcam.snapshot_url ?? '', websocketEndpoint)
  const aspectRatioText = stringOr(webcam.aspect_ratio, cameraDefaults.aspectRatio)

  return {
    uid: stringOr(webcam.uid, webcam.name),
    name: webcam.name,
    location: stringOr(webcam.location, cameraDefaults.location),
    icon: stringOr(webcam.icon, cameraDefaults.icon),
    service: traits.id,
    traits,
    enabled: webcam.enabled !== false,
    streamUrl,
    snapshotUrl,
    rawStreamUrl: webcam.stream_url ?? '',
    rawSnapshotUrl: webcam.snapshot_url ?? '',
    // Falls back to the other URL rather than to nothing: a camera saved as
    // adaptive with only a stream URL, or the reverse, still shows a picture
    // instead of an empty stage that looks like a broken camera.
    primaryUrl:
      traits.primaryUrl === 'snapshot' ? snapshotUrl || streamUrl : streamUrl || snapshotUrl,
    targetFps: positiveIntOr(webcam.target_fps, cameraDefaults.targetFps),
    targetFpsIdle: positiveIntOr(webcam.target_fps_idle, cameraDefaults.targetFpsIdle),
    flipHorizontal: webcam.flip_horizontal === true,
    flipVertical: webcam.flip_vertical === true,
    rotation: isCameraRotation(webcam.rotation) ? webcam.rotation : cameraDefaults.rotation,
    aspectRatio: parseAspectRatio(aspectRatioText),
    aspectRatioText,
    extraData: webcam.extra_data ?? {},
    isReadOnly: webcam.source === 'config',
  }
}

/**
 * How a camera's frame is laid out inside its tile: the transform that applies
 * the flips and the rotation, and — for a quarter turn only — the size the
 * frame box has to be *before* rotating so that it lands exactly on the tile
 * afterwards.
 *
 * The geometry is the part that is easy to get subtly wrong. A 4:3 stream
 * rotated a quarter turn is a 3:4 picture, so `cameraBoxAspectRatio` gives the
 * tile that shape. The frame inside it therefore has to be laid out transposed
 * — as wide as the tile is tall — and then rotated onto it. Sizing the frame to
 * the tile and rotating that instead is what produces the failure this replaces:
 * a portrait-shaped frame holding a landscape stream, cropped to a narrow strip
 * down the middle of the picture.
 *
 * The two percentages are relative to the tile's own width and height, which is
 * why they read as inverses of each other rather than both multiplying by the
 * ratio.
 *
 * The leading `translate(-50%, -50%)` is not decoration: the frame is
 * positioned from the tile's centre so that rotating it keeps it centred, and
 * dropping the translate leaves it hanging off the bottom-right corner.
 */
export interface CameraFrameLayout {
  transform: string
  width?: string
  height?: string
  /**
   * Never set here. Present so the object satisfies Vue's `CSSProperties`,
   * which requires custom-property keys to be declared before a plain record
   * can be bound to `:style`.
   */
  [custom: `--${string}`]: string | undefined
}

export function cameraFrameLayout(
  camera: Camera,
  measuredAspectRatio: number | null,
): CameraFrameLayout {
  const transforms = ['translate(-50%, -50%)']
  if (camera.rotation !== 0) transforms.push(`rotate(${camera.rotation}deg)`)
  if (camera.flipHorizontal) transforms.push('scaleX(-1)')
  if (camera.flipVertical) transforms.push('scaleY(-1)')
  const transform = transforms.join(' ')

  const isQuarterTurn = camera.rotation === 90 || camera.rotation === 270
  const ratio = measuredAspectRatio ?? camera.aspectRatio
  if (!isQuarterTurn || ratio === null || ratio <= 0) return { transform }

  return {
    transform,
    width: `calc(100% * ${ratio})`,
    height: `calc(100% / ${ratio})`,
  }
}

/**
 * The aspect ratio the tile should hold, which is the stream's own until a
 * quarter turn swaps its axes. Null leaves the tile to whatever the layout
 * gives it, which is right before the first frame has landed and for a service
 * that never reports a size.
 */
export function cameraBoxAspectRatio(
  camera: Camera,
  measuredAspectRatio: number | null,
): number | null {
  const ratio = measuredAspectRatio ?? camera.aspectRatio
  if (ratio === null) return null
  return camera.rotation === 90 || camera.rotation === 270 ? 1 / ratio : ratio
}
