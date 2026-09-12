import { MoonrakerEndpointError } from '@/services/moonraker/errors'
import { moonrakerHttpBaseUrl } from '@/services/moonraker/url'
import type { MoonrakerFileRoot } from '@/services/moonraker/types'

export interface MoonrakerUploadResult {
  item: {
    path: string
    root: string
  }
}

export function normalizeMoonrakerRelativePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!normalized) return ''
  const segments = normalized.split('/')
  if (
    segments.some(
      (segment) => !segment || segment === '.' || segment === '..' || segment.includes('\0'),
    )
  ) {
    throw new MoonrakerEndpointError()
  }
  return segments.join('/')
}

const gcodeExtensionPattern = /\.(gcode|g|gco|ufp|nc)$/i

/**
 * Whether this filename is a G-code file the printer can be asked to run.
 *
 * Shared rather than duplicated because the two places that ask — the print
 * card's file list and the Print files workspace — must always agree: a file one
 * of them offers and the other refuses to start is a bug the user reads as the
 * printer rejecting their file. The gcodes root also holds extracted thumbnails
 * and slicer leftovers, which are files but not printable.
 */
export function isPrintableGcodeFilename(name: string): boolean {
  return gcodeExtensionPattern.test(name)
}

/**
 * The name to show for a G-code path: no folder, no extension.
 *
 * Slicers name a file with everything the reader already knows — the printer,
 * the nozzle, the material — and the part that identifies it is what gets
 * truncated away first in a card-width row. Dropping the folder and the
 * extension buys back the only characters on the line that carry no
 * information: every file in this list is G-code, so `.gcode` distinguishes
 * nothing. The full path stays reachable as the row's `title`, which is why
 * this is safe to shorten rather than merely a nicer default.
 *
 * Only a known G-code extension is stripped, never the last dot in the name:
 * `Bracket_v1.2` is a version, not a suffix, and a generic rule would rename
 * the file in front of its owner. A name that is *nothing but* an extension
 * keeps it, since the alternative is an empty row.
 *
 * Shared between the Print card and the Job queue card for the reason those
 * two must agree in particular: the queue's front job is rendered on both, so
 * a name that trimmed differently on each would read as two different files.
 */
export function gcodeDisplayName(path: string): string {
  const separatorIndex = path.lastIndexOf('/')
  const name = separatorIndex < 0 ? path : path.slice(separatorIndex + 1)
  return name.replace(gcodeExtensionPattern, '') || name
}

export function validMoonrakerFilename(name: string): boolean {
  const trimmed = name.trim()
  return Boolean(
    trimmed &&
    trimmed !== '.' &&
    trimmed !== '..' &&
    !trimmed.includes('/') &&
    !trimmed.includes('\\') &&
    !trimmed.includes('\0'),
  )
}

export async function fetchMoonrakerTextFile(
  root: MoonrakerFileRoot,
  path: string,
  websocketEndpoint: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const normalizedPath = normalizeMoonrakerRelativePath(path)
  if (!normalizedPath) throw new MoonrakerEndpointError()
  const endpoint = moonrakerHttpBaseUrl(websocketEndpoint)
  endpoint.pathname = `/server/files/${root}/${normalizedPath
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`
  endpoint.searchParams.set('t', String(Date.now()))
  const response = await fetcher(endpoint, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Moonraker file download failed with ${response.status}`)
  return response.text()
}

export interface MoonrakerUploadOptions {
  /**
   * Called as the request body goes out, with the fraction sent so far, or
   * `null` for a body whose total the browser will not commit to. Passing it
   * switches this call onto `XMLHttpRequest` — see the note below.
   */
  onProgress?: (fraction: number | null) => void
  /** Aborts the transfer. The rejection is an `AbortError`, not a failure. */
  signal?: AbortSignal
  /** Injectable for tests. Ignored on the progress-reporting path. */
  fetcher?: typeof fetch
}

/**
 * `fetch` cannot report upload progress and is not going to: the request body
 * is handed over whole, and the streaming-body proposal that would change
 * that is not something a printer's own browser can be assumed to have. So a
 * caller that wants to show bytes-sent gets the one API that has always
 * reported them, `XMLHttpRequest`, and every other caller keeps `fetch`.
 *
 * Two paths, not one, because the alternative is worse in both directions:
 * moving every caller onto XHR would swap a good request API for a callback
 * shape at six call sites that upload a few kilobytes of config and have
 * nothing to draw a bar with, and dropping progress entirely would leave the
 * one upload that is routinely tens of megabytes — a sliced G-code file —
 * with no way to say how far along it is. The seam is `onProgress`: present
 * means XHR, absent means `fetch`, and both resolve the same result.
 */
export async function uploadMoonrakerFile(
  root: MoonrakerFileRoot,
  directory: string,
  file: Blob,
  filename: string,
  websocketEndpoint: string,
  options: MoonrakerUploadOptions = {},
): Promise<MoonrakerUploadResult> {
  if (!validMoonrakerFilename(filename)) throw new MoonrakerEndpointError()
  const normalizedDirectory = normalizeMoonrakerRelativePath(directory)
  const form = new FormData()
  form.append('file', file, filename.trim())
  form.append('root', root)
  form.append('path', normalizedDirectory)
  const endpoint = moonrakerHttpBaseUrl(websocketEndpoint)
  endpoint.pathname = '/server/files/upload'
  if (options.onProgress) {
    return uploadWithProgress(endpoint, form, options.onProgress, options.signal)
  }
  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(endpoint, {
    method: 'POST',
    body: form,
    signal: options.signal ?? null,
  })
  if (!response.ok) throw new Error(`Moonraker file upload failed with ${response.status}`)
  return (await response.json()) as MoonrakerUploadResult
}

function uploadAbortError(): Error {
  const error = new Error('Moonraker file upload was cancelled')
  // The name every caller already tests for, including the one in `printer.ts`
  // that has to tell a cancelled upload apart from a failed one.
  error.name = 'AbortError'
  return error
}

function uploadWithProgress(
  endpoint: URL,
  form: FormData,
  onProgress: (fraction: number | null) => void,
  signal: AbortSignal | undefined,
): Promise<MoonrakerUploadResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(uploadAbortError())
      return
    }
    const request = new XMLHttpRequest()
    request.open('POST', endpoint.toString())
    request.responseType = 'json'

    /*
     * `lengthComputable` is false for a body the browser has not sized yet.
     * Reporting `null` rather than 0 matters: a bar pinned at zero for the
     * whole transfer reads as a stalled upload, where "no measurement" can be
     * rendered as the honest thing it is.
     */
    request.upload.addEventListener('progress', (event) => {
      onProgress(event.lengthComputable && event.total > 0 ? event.loaded / event.total : null)
    })
    request.addEventListener('load', () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`Moonraker file upload failed with ${request.status}`))
        return
      }
      // `responseType = 'json'` parses for us wherever it is honoured; where it
      // is not, the body arrives as text and still has to be read.
      const body: unknown =
        typeof request.response === 'string' ? JSON.parse(request.response) : request.response
      resolve(body as MoonrakerUploadResult)
    })
    request.addEventListener('error', () => reject(new Error('Moonraker file upload failed')))
    request.addEventListener('abort', () => reject(uploadAbortError()))
    signal?.addEventListener('abort', () => request.abort(), { once: true })
    request.send(form)
  })
}
