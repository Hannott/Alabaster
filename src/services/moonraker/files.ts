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
  return /\.(gcode|g|gco|ufp|nc)$/i.test(name)
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

export async function uploadMoonrakerFile(
  root: MoonrakerFileRoot,
  directory: string,
  file: Blob,
  filename: string,
  websocketEndpoint: string,
  fetcher: typeof fetch = fetch,
): Promise<MoonrakerUploadResult> {
  if (!validMoonrakerFilename(filename)) throw new MoonrakerEndpointError()
  const normalizedDirectory = normalizeMoonrakerRelativePath(directory)
  const form = new FormData()
  form.append('file', file, filename.trim())
  form.append('root', root)
  form.append('path', normalizedDirectory)
  const endpoint = moonrakerHttpBaseUrl(websocketEndpoint)
  endpoint.pathname = '/server/files/upload'
  const response = await fetcher(endpoint, { method: 'POST', body: form })
  if (!response.ok) throw new Error(`Moonraker file upload failed with ${response.status}`)
  return (await response.json()) as MoonrakerUploadResult
}
