import {
  defaultGcodeFilamentDiameter,
  maximumGcodeSourceBytes,
  type GcodeGeometryBatch,
  type GcodeParserWorkerRequest,
  type GcodeParserWorkerResponse,
  type ParsedGcodeSummary,
} from '@/features/gcode/types'

export interface GcodeLoadProgress {
  loaded: number
  total: number | null
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
   * Called for every streamed geometry batch as it parses, so the scene can
   * grow in during the download instead of staying blank until the end.
   * Batches arrive before the returned promise settles.
   */
  onBatch?: (batch: GcodeGeometryBatch) => void
  /**
   * Size in bytes when the caller already knows it from somewhere other than the
   * response, used only when the response does not say.
   *
   * This is what makes a download stream into the scene rather than appear all
   * at once at the end. The parser can only emit a batch mid-parse if it can
   * normalise that batch's print progress against a total, so with no total it
   * defers every batch to the end — correct, but indistinguishable from the
   * feature not existing.
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
 * Worth its own function because the consequence of returning null is nothing
 * like proportional to how small the decision looks: with no total the parser
 * cannot normalise a batch's print progress, so it emits nothing until the end
 * and the scene stays empty for the whole download. Moonraker sends G-code
 * without a `Content-Length`, which meant the one path most people use — pick a
 * file off the printer — silently had no progressive loading at all, while the
 * two paths that do declare a size worked and hid it.
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
): Promise<ParsedGcodeSummary> {
  if (total !== null && total > maximumGcodeSourceBytes) throw new GcodeFileTooLargeError()
  const worker = parserWorker()
  const reader = stream.getReader()
  let loaded = 0
  let settled = false
  let awaitingWorker = false
  let rejectParsed: ((reason?: unknown) => void) | null = null

  const parsed = new Promise<ParsedGcodeSummary>((resolve, reject) => {
    rejectParsed = reject
    worker.onmessage = (event: MessageEvent<GcodeParserWorkerResponse>) => {
      if (event.data.type === 'batch') {
        if (!settled) options.onBatch?.(event.data.batch)
        return
      }
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
      const transferableChunk = new Uint8Array(value.byteLength)
      transferableChunk.set(value)
      const buffer = transferableChunk.buffer
      worker.postMessage({ type: 'chunk', buffer } satisfies GcodeParserWorkerRequest, [buffer])
      options.onProgress({ loaded, total })
    }
    worker.postMessage({ type: 'finish' } satisfies GcodeParserWorkerRequest)
    awaitingWorker = true
    return await parsed
  } finally {
    options.signal.removeEventListener('abort', abort)
    worker.terminate()
    reader.releaseLock()
  }
}

export async function parseGcodeFile(
  file: File,
  options: GcodeLoadOptions,
): Promise<ParsedGcodeSummary> {
  return parseGcodeStream(file.stream(), file.size, options)
}

export async function fetchAndParseGcode(
  url: string,
  options: GcodeLoadOptions,
): Promise<ParsedGcodeSummary> {
  const response = await fetch(url, { signal: options.signal, cache: 'no-store' })
  if (!response.ok || !response.body)
    throw new Error(`G-code download failed with ${response.status}`)
  return parseGcodeStream(
    response.body,
    gcodeStreamTotalBytes(response.headers.get('content-length'), options.declaredTotalBytes),
    options,
  )
}
