/// <reference lib="webworker" />

/**
 * Reads an MJPEG stream, decodes each frame, and draws it to an
 * `OffscreenCanvas` — all off the main thread.
 *
 * The browser will happily render the same stream in a plain `<img>` with none
 * of this. What that cannot do is tell anyone *when* a frame arrived: an `<img>`
 * holding a multipart response open fires `load` once and then never reports
 * again, so a stream that silently freezes looks identical to a working one.
 * Parsing the multipart boundaries here is what makes a measured frame rate and
 * a stalled-stream badge possible at all.
 *
 * It has one requirement the `<img>` path does not: the stream must be readable
 * by `fetch`, which cross-origin means the camera's host has to send CORS
 * headers. `MjpegStreamer.vue` falls back to the `<img>` path when that fails,
 * so a camera on a host without them still shows a picture — without a rate.
 *
 * Multipart stream reading adapted from
 * <https://github.com/aruntj/mjpeg-readable-stream>.
 */

const worker = self as unknown as DedicatedWorkerGlobalScope

/** JPEG start-of-image marker: the two bytes that open every frame. */
const startOfImage = [0xff, 0xd8] as const
const contentLengthHeader = 'content-length'

let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
let abort: AbortController | null = null
let canvas: OffscreenCanvas | null = null
let context: OffscreenCanvasRenderingContext2D | null = null
let running = false
let stopping: Promise<void> | null = null
let decoding = false
let announcedConnection = false
let deadlineForRun: ReturnType<typeof setTimeout> | undefined
let lastWidth = 0
let lastHeight = 0

/**
 * Bumped by every `start`. A run that no longer owns the current generation has
 * been overtaken by a restart and must not touch the shared reader or the
 * running flag on its way out — otherwise a stream that is winding down tears
 * down the one that replaced it.
 */
let generation = 0

/**
 * How long a `fetch` may go without producing a frame before the stream is
 * called failed.
 *
 * Without this a camera whose host simply does not answer leaves the request
 * pending for as long as the browser's own connect timeout — minutes, on some
 * platforms — and nothing at all is reported: no error, no frame, and a card
 * showing black with no way to tell a dead camera from a slow one. A
 * cross-origin host that answers but sends no CORS headers rejects immediately
 * and needs none of this; a host that is off is the case it exists for.
 */
const connectTimeoutMs = 10_000

type IncomingMessage =
  | { type: 'init'; canvas: OffscreenCanvas }
  | { type: 'start'; url: string }
  | { type: 'stop' }
  | { type: 'shutdown' }

function contentLengthOf(headers: string): number {
  for (const header of headers.split('\n')) {
    const [name, value] = header.split(':')
    if (name?.trim().toLowerCase() === contentLengthHeader) return Number(value)
  }
  return -1
}

// `Uint8Array<ArrayBuffer>` rather than the default `ArrayBufferLike`: `Blob`
// refuses a view that might be over a `SharedArrayBuffer`, and the caller
// allocates a plain one for exactly this reason.
function renderFrame(buffer: Uint8Array<ArrayBuffer>): void {
  // Counted before the decode, and whether or not this frame is drawn: the
  // measured rate is meant to report what the camera is sending, not what this
  // machine managed to paint.
  worker.postMessage({ type: 'frame' })

  // A frame arriving while the previous one is still decoding is dropped rather
  // than queued. Queueing them means a slow client falls further and further
  // behind a fast camera, showing older and older pictures — the opposite of
  // what a live view is for.
  if (decoding || !context || !canvas) return
  decoding = true

  createImageBitmap(new Blob([buffer], { type: 'image/jpeg' }))
    .then((bitmap) => {
      if (!context || !canvas) {
        bitmap.close()
        decoding = false
        return
      }

      const { width, height } = bitmap
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      context.drawImage(bitmap, 0, 0)
      bitmap.close()

      if (width !== lastWidth || height !== lastHeight) {
        lastWidth = width
        lastHeight = height
        worker.postMessage({ type: 'size', width, height })
      }

      if (!announcedConnection) {
        announcedConnection = true
        worker.postMessage({ type: 'connected' })
      }
      clearTimeout(deadlineForRun)

      decoding = false
    })
    .catch(() => {
      // A single undecodable frame is a truncated JPEG, not a broken stream —
      // dropping it and reading on is the whole recovery.
      decoding = false
    })
}

async function readStream(): Promise<void> {
  if (!reader) return

  let headers = ''
  let contentLength = -1
  // Backed by a plain `ArrayBuffer` rather than left to `Uint8Array`'s default
  // `ArrayBufferLike`, so it can be handed straight to `Blob` — which does not
  // accept a view that might be over a `SharedArrayBuffer`.
  let imageBuffer = new Uint8Array(new ArrayBuffer(0))
  let bytesRead = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    for (let index = 0; index < value.length; index += 1) {
      if (value[index] === startOfImage[0] && value[index + 1] === startOfImage[1]) {
        contentLength = contentLengthOf(headers)
        imageBuffer = new Uint8Array(new ArrayBuffer(Math.max(0, contentLength)))
      }

      if (contentLength <= 0) {
        headers += String.fromCharCode(value[index] ?? 0)
        continue
      }

      if (bytesRead < contentLength) {
        imageBuffer[bytesRead] = value[index] ?? 0
        bytesRead += 1
        continue
      }

      renderFrame(imageBuffer)
      contentLength = 0
      bytesRead = 0
      headers = ''
    }
  }
}

async function start(url: string): Promise<void> {
  if (running) return
  running = true
  announcedConnection = false
  lastWidth = 0
  lastHeight = 0

  const ownGeneration = (generation += 1)

  // A stop still releasing the previous reader would null out the one created
  // below if it finished after this point. Waiting for it is what makes a
  // restart safe.
  if (stopping) await stopping
  if (ownGeneration !== generation) return

  const ownAbort = new AbortController()
  abort = ownAbort
  // Cleared by the first drawn frame, and by `finally` for a stream that ends.
  // A working stream never leaves `readStream`, so the frame is the only thing
  // that disarms this in the ordinary case.
  clearTimeout(deadlineForRun)
  deadlineForRun = setTimeout(() => {
    if (ownGeneration !== generation || announcedConnection) return
    worker.postMessage({ type: 'error', message: 'connect-timeout' })
    void stop()
  }, connectTimeoutMs)

  try {
    const target = new URL(url)
    target.searchParams.set('timestamp', String(Date.now()))
    const response = await fetch(target.toString(), { mode: 'cors', signal: ownAbort.signal })
    if (ownGeneration !== generation) return

    if (!response.ok) {
      worker.postMessage({ type: 'error', message: `${response.status} ${response.statusText}` })
      await stop()
      return
    }
    if (!response.body) {
      worker.postMessage({ type: 'error', message: 'no-stream' })
      await stop()
      return
    }

    reader = response.body.getReader()
    await readStream()
    if (ownGeneration === generation) reader = null
    // A stream that ends cleanly has still ended; the component decides whether
    // to reconnect.
    worker.postMessage({ type: 'ended' })
  } catch (error: unknown) {
    // An abort is this worker's own doing — a stop or a restart — not a failure.
    if (ownAbort.signal.aborted || ownGeneration !== generation) return
    worker.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    clearTimeout(deadlineForRun)
    if (ownGeneration === generation) running = false
  }
}

async function stop(): Promise<void> {
  running = false
  // Aborting the fetch releases the connection immediately. Cancelling only the
  // reader leaves it lingering until the response body happens to wind down,
  // which on a live stream is never.
  abort?.abort()
  abort = null
  try {
    await reader?.cancel()
    reader?.releaseLock()
  } catch {
    // Already released or cancelled.
  }
  reader = null
  decoding = false
}

worker.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const message = event.data
  switch (message.type) {
    case 'init':
      canvas = message.canvas
      context = canvas.getContext('2d')
      break
    case 'start':
      void start(message.url)
      break
    case 'stop':
      stopping = stop()
      break
    case 'shutdown':
      // The connection is released before this worker goes away. A
      // `terminate()` from the main thread would discard this work and leave
      // the socket dangling until the browser noticed.
      stopping = stop().finally(() => worker.close())
      break
  }
}
