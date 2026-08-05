import { MoonrakerEndpointError } from '@/services/moonraker/errors'
import type { MoonrakerFileRoot } from '@/services/moonraker/types'

function defaultProtocol(baseUrl: string | undefined): 'ws:' | 'wss:' {
  if (!baseUrl) return 'ws:'

  try {
    return new URL(baseUrl).protocol === 'https:' ? 'wss:' : 'ws:'
  } catch {
    return 'ws:'
  }
}

export function normalizeMoonrakerWebSocketUrl(input: string, baseUrl?: string): string {
  const trimmedInput = input.trim()
  let candidate: string

  if (trimmedInput.length === 0) {
    if (!baseUrl) throw new MoonrakerEndpointError()
    candidate = baseUrl
  } else if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmedInput)) {
    candidate = trimmedInput
  } else {
    candidate = `${defaultProtocol(baseUrl)}//${trimmedInput}`
  }

  let url: URL

  try {
    url = new URL(candidate)
  } catch {
    throw new MoonrakerEndpointError()
  }

  if (url.protocol === 'http:') url.protocol = 'ws:'
  else if (url.protocol === 'https:') url.protocol = 'wss:'
  else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new MoonrakerEndpointError()

  if (!url.hostname || url.username || url.password) throw new MoonrakerEndpointError()

  const path = url.pathname.replace(/\/+$/, '')
  if (!path.endsWith('/websocket')) url.pathname = `${path}/websocket`.replace(/^\/\//, '/')

  url.hash = ''
  return url.toString()
}

export function defaultMoonrakerWebSocketUrl(locationUrl: string): string {
  return normalizeMoonrakerWebSocketUrl('', locationUrl)
}

export function moonrakerHttpBaseUrl(websocketEndpoint: string): URL {
  const endpoint = new URL(websocketEndpoint)
  endpoint.protocol = endpoint.protocol === 'wss:' ? 'https:' : 'http:'
  endpoint.pathname = '/'
  endpoint.search = ''
  endpoint.hash = ''
  return endpoint
}

export function moonrakerGcodeFileUrl(path: string, websocketEndpoint: string): string {
  return moonrakerFileUrl('gcodes', path.replace(/^gcodes\//i, ''), websocketEndpoint)
}

/**
 * Resolves an embedded thumbnail's `relative_path`, which Moonraker reports
 * relative to the directory holding the G-code file rather than to the gcodes
 * root, into a fetchable URL.
 */
export function moonrakerThumbnailUrl(
  gcodePath: string,
  relativePath: string,
  websocketEndpoint: string,
): string {
  const normalizedGcodePath = gcodePath.replace(/\\/g, '/').replace(/^gcodes\//i, '')
  const separatorIndex = normalizedGcodePath.lastIndexOf('/')
  const directory = separatorIndex < 0 ? '' : normalizedGcodePath.slice(0, separatorIndex)
  const normalizedRelativePath = relativePath.replace(/\\/g, '/').replace(/^\.\//, '')
  return moonrakerGcodeFileUrl(
    directory ? `${directory}/${normalizedRelativePath}` : normalizedRelativePath,
    websocketEndpoint,
  )
}

export function moonrakerFileUrl(
  root: MoonrakerFileRoot,
  path: string,
  websocketEndpoint: string,
): string {
  const relativePath = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const segments = relativePath.split('/')
  if (
    segments.length === 0 ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new MoonrakerEndpointError()
  }
  const endpoint = moonrakerHttpBaseUrl(websocketEndpoint)
  endpoint.pathname = `/server/files/${root}/${segments.map(encodeURIComponent).join('/')}`
  return endpoint.toString()
}
