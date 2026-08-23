import type { Camera } from './camera'

/**
 * Grabs a still frame from a camera and hands back a file.
 *
 * What this is for: a print that went wrong is worth a picture — for a support
 * thread, a print-profile note, or a before/after when tuning. Otherwise the
 * only way to keep a frame is a screenshot of the whole browser, cropped by
 * hand, at whatever size the card happened to be.
 *
 * Two sources, tried in order:
 *
 * 1. **The snapshot URL**, requested with `crossorigin` set. This is the full
 *    sensor resolution rather than the card's, which matters — the card is often
 *    a third of the frame's real width. It needs the camera's host to send CORS
 *    headers, which a proxied same-origin camera does trivially and a
 *    cross-origin one may not.
 * 2. **The element on screen**, drawn straight to a canvas. Always available,
 *    but a cross-origin element without CORS headers *taints* the canvas and
 *    reading it back throws — the browser's own protection against a page
 *    exfiltrating pixels it was only allowed to display.
 *
 * When both fail there is genuinely no way to get the pixels, and the caller
 * says so rather than saving a blank image.
 */

export class CameraCaptureError extends Error {
  constructor() {
    super('camera-capture-unavailable')
    this.name = 'CameraCaptureError'
  }
}

type CaptureSource = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement

function sourceSize(source: CaptureSource): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight }
  }
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight }
  }
  return { width: source.width, height: source.height }
}

/**
 * Draws the source through the camera's own flips and rotation, so the saved
 * file matches what was on screen. A quarter turn swaps the canvas's own
 * dimensions — rotating into a box of the original shape would crop the long
 * side away.
 */
function drawTransformed(source: CaptureSource, camera: Camera): HTMLCanvasElement {
  const { width, height } = sourceSize(source)
  if (!width || !height) throw new CameraCaptureError()

  const quarterTurn = camera.rotation === 90 || camera.rotation === 270
  const canvas = document.createElement('canvas')
  canvas.width = quarterTurn ? height : width
  canvas.height = quarterTurn ? width : height

  const context = canvas.getContext('2d')
  if (!context) throw new CameraCaptureError()

  context.translate(canvas.width / 2, canvas.height / 2)
  if (camera.rotation !== 0) context.rotate((camera.rotation * Math.PI) / 180)
  context.scale(camera.flipHorizontal ? -1 : 1, camera.flipVertical ? -1 : 1)
  context.drawImage(source, -width / 2, -height / 2, width, height)

  return canvas
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // A tainted canvas throws synchronously here rather than calling back.
    try {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new CameraCaptureError())),
        'image/jpeg',
        0.92,
      )
    } catch {
      reject(new CameraCaptureError())
    }
  })
}

function loadSnapshot(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    // Without this the load succeeds and the canvas is tainted, which fails
    // later and less clearly. With it, a host that sends no CORS headers fails
    // the load itself and the fallback runs.
    image.crossOrigin = 'anonymous'
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', () => reject(new CameraCaptureError()))
    const target = new URL(url)
    target.searchParams.set('bypassCache', String(Date.now()))
    image.src = target.toString()
  })
}

export async function captureCameraStill(
  camera: Camera,
  onScreen: CaptureSource | null,
): Promise<Blob> {
  if (camera.snapshotUrl !== '') {
    try {
      return await toBlob(drawTransformed(await loadSnapshot(camera.snapshotUrl), camera))
    } catch {
      // Fall through to the element already on screen.
    }
  }
  if (!onScreen) throw new CameraCaptureError()
  return toBlob(drawTransformed(onScreen, camera))
}

/**
 * A filename that sorts chronologically and survives every filesystem: the
 * camera's name reduced to safe characters, then a timestamp with the colons
 * a local time carries replaced, since Windows rejects them outright.
 */
export function cameraStillFilename(camera: Camera, now: Date): string {
  const name = camera.name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'camera'
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `${name}-${stamp}.jpg`
}
