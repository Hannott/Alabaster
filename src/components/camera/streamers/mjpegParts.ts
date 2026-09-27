/** JPEG start-of-image marker: the two bytes that open every frame. */
const startOfImage = [0xff, 0xd8] as const
const contentLengthHeader = 'content-length'

function contentLengthOf(headers: string): number {
  for (const header of headers.split('\n')) {
    const [name, value] = header.split(':')
    if (name?.trim().toLowerCase() === contentLengthHeader) return Number(value)
  }
  return -1
}

/**
 * Splits a `multipart/x-mixed-replace` MJPEG body into its JPEG frames.
 *
 * Returns a function to feed each network chunk to, in order. Frames are
 * handed to `onFrame` whole, however the chunks happened to split them.
 *
 * Each part is framed by its own `Content-Length` header, which every streamer
 * a Klipper install ships with — ustreamer, camera-streamer, mjpg-streamer —
 * sends. Only the start-of-image marker after a part's headers opens a frame;
 * inside a frame the length alone decides where it ends. The same two bytes
 * inside a frame are a thumbnail embedded in its EXIF data, and treating them
 * as the next frame discarded every frame that carried one, which made such a
 * camera look dead.
 *
 * A part without a usable `Content-Length` cannot be framed and is skipped;
 * the worker's connect timeout then hands the camera to the `<img>` path.
 */
export function createMjpegPartParser(
  onFrame: (frame: Uint8Array<ArrayBuffer>) => void,
): (chunk: Uint8Array) => void {
  let headers = ''
  let contentLength = -1
  // Backed by a plain `ArrayBuffer` rather than left to `Uint8Array`'s default
  // `ArrayBufferLike`, so it can be handed straight to `Blob` — which does not
  // accept a view that might be over a `SharedArrayBuffer`.
  let frame = new Uint8Array(new ArrayBuffer(0))
  let bytesRead = 0
  // Compared against the previous byte rather than the next one, so a marker
  // split across two network chunks is still found.
  let previousByte = -1

  return (chunk) => {
    for (const byte of chunk) {
      if (contentLength > 0) {
        frame[bytesRead] = byte
        bytesRead += 1
        if (bytesRead === contentLength) {
          onFrame(frame)
          contentLength = -1
          bytesRead = 0
        }
        continue
      }

      if (previousByte === startOfImage[0] && byte === startOfImage[1]) {
        const length = contentLengthOf(headers)
        headers = ''
        previousByte = -1
        if (!Number.isInteger(length) || length <= startOfImage.length) continue
        contentLength = length
        frame = new Uint8Array(new ArrayBuffer(length))
        frame.set(startOfImage)
        bytesRead = startOfImage.length
        continue
      }

      headers += String.fromCharCode(byte)
      previousByte = byte
    }
  }
}
