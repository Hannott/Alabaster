import {
  defaultGcodeFilamentDiameter,
  maximumGcodeSourceBytes,
  type GcodeParserWorkerRequest,
  type GcodeParserWorkerResponse,
  type ParsedGcodeSummary,
} from '@/features/gcode/types'

export interface GcodeLoadProgress {
  loaded: number
  total: number | null
}

/**
 * What one load yields: the file exactly as it was written, and the timeline
 * parsed out of it.
 *
 * Both, because they serve different consumers and neither can be recovered
 * from the other cheaply. The scene is built from `text` — geometry comes from
 * the file itself rather than from anything this module derives — while the
 * timeline is what playback, the simulation and the layer, feature and
 * feed-rate readouts step through.
 */
export interface GcodeLoadResult {
  text: string
  summary: ParsedGcodeSummary
}

export interface GcodeLoadOptions {
  signal: AbortSignal
  /**
   * The machine's filament diameter, which the parser squares when recovering a
   * bead's width from the extruded volume. Omitted falls back to 1.75 mm.
   */
  filamentDiameter?: number | undefined
  onProgress: (progress: GcodeLoadProgress) => void
  /**
   * Size in bytes when the caller already knows it from somewhere other than the
   * response, used only when the response does not say.
   *
   * This is what makes a download report a percentage rather than a rising byte
   * count with no end in sight: the progress readout needs a denominator, and
   * with no total there is nothing to divide by.
   *
   * Moonraker serves G-code without a `Content-Length`, so the header route
   * yields nothing for the one path that matters most: picking a file off the
   * printer. Its file listing does carry the size, and that is the same number
   * the follow frontier divides by, so using it here also keeps the two
   * agreeing.
   */
  declaredTotalBytes?: number | null
}

/** The byte table stores Uint32 offsets, so larger files are refused up front. */
export class GcodeFileTooLargeError extends Error {
  constructor() {
    super('G-code file exceeds the 4 GiB byte-table limit')
    this.name = 'GcodeFileTooLargeError'
  }
}

function parserWorker(): Worker {
  return new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' })
}

/**
 * The size a download will parse to, from the response if it says and from the
 * caller if it does not.
 *
 * Worth its own function because Moonraker sends G-code without a
 * `Content-Length`, which means the one path most people use — pick a file off
 * the printer — is exactly the path where the header says nothing, while the
 * two paths that do declare a size work and hide it.
 *
 * A zero or negative declared size is treated as unknown rather than trusted,
 * since a file listing that has not loaded yet reports 0.
 */
export function gcodeStreamTotalBytes(
  contentLengthHeader: string | null,
  declaredTotalBytes?: number | null,
): number | null {
  const header = Number.parseInt(contentLengthHeader ?? '', 10)
  if (Number.isFinite(header) && header >= 0) return header
  const declared = declaredTotalBytes
  return typeof declared === 'number' && Number.isFinite(declared) && declared > 0 ? declared : null
}

export async function parseGcodeStream(
  stream: ReadableStream<Uint8Array>,
  total: number | null,
  options: GcodeLoadOptions,
): Promise<GcodeLoadResult> {
  if (total !== null && total > maximumGcodeSourceBytes) throw new GcodeFileTooLargeError()
  const worker = parserWorker()
  const reader = stream.getReader()
  // One decoded copy of the file, assembled here rather than in the worker: the
  // scene builder needs the text on this side anyway, so decoding it twice or
  // posting the whole string back would double the peak memory a large file
  // costs for nothing.
  const decoder = new TextDecoder()
  const textParts: string[] = []
  let loaded = 0
  let settled = false
  let awaitingWorker = false
  let rejectParsed: ((reason?: unknown) => void) | null = null

  const parsed = new Promise<ParsedGcodeSummary>((resolve, reject) => {
    rejectParsed = reject
    worker.onmessage = (event: MessageEvent<GcodeParserWorkerResponse>) => {
      settled = true
      if (event.data.type === 'parsed') resolve(event.data.summary)
      else reject(new Error(event.data.message))
    }
    worker.onerror = (event) => {
      settled = true
      reject(new Error(event.message || 'G-code worker failed'))
    }
  })

  const abort = (): void => {
    if (!settled) {
      settled = true
      worker.terminate()
      if (awaitingWorker) rejectParsed?.(new DOMException('Aborted', 'AbortError'))
    }
    void reader.cancel()
  }
  options.signal.addEventListener('abort', abort, { once: true })

  try {
    worker.postMessage({
      type: 'start',
      expectedTotalBytes: total,
      filamentDiameter: options.filamentDiameter ?? defaultGcodeFilamentDiameter,
    } satisfies GcodeParserWorkerRequest)
    while (true) {
      if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const { done, value } = await reader.read()
      if (done) break
      loaded += value.byteLength
      // Decode before the buffer is handed away, and in streaming mode, so a
      // multi-byte character or a CRLF straddling a chunk boundary is held
      // over to the next chunk instead of becoming a replacement character.
      textParts.push(decoder.decode(value, { stream: true }))
      const transferableChunk = new Uint8Array(value.byteLength)
      transferableChunk.set(value)
      const buffer = transferableChunk.buffer
      worker.postMessage({ type: 'chunk', buffer } satisfies GcodeParserWorkerRequest, [buffer])
      options.onProgress({ loaded, total })
    }
    textParts.push(decoder.decode())
    worker.postMessage({ type: 'finish' } satisfies GcodeParserWorkerRequest)
    awaitingWorker = true
    return { text: textParts.join(''), summary: await parsed }
  } finally {
    options.signal.removeEventListener('abort', abort)
    worker.terminate()
    reader.releaseLock()
  }
}

export async function parseGcodeFile(
  file: File,
  options: GcodeLoadOptions,
): Promise<GcodeLoadResult> {
  return parseGcodeStream(file.stream(), file.size, options)
}

export async function fetchAndParseGcode(
  url: string,
  options: GcodeLoadOptions,
): Promise<GcodeLoadResult> {
  const response = await fetch(url, { signal: options.signal, cache: 'no-store' })
  if (!response.ok || !response.body)
    throw new Error(`G-code download failed with ${response.status}`)
  return parseGcodeStream(
    response.body,
    gcodeStreamTotalBytes(response.headers.get('content-length'), options.declaredTotalBytes),
    options,
  )
}
