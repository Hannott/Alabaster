export type MachineFileKind = 'text' | 'image' | 'html' | 'unsupported'

/** Klipper's root configuration file — the one `[include]` bookkeeping and the file icon both key off. */
export const PRIMARY_CONFIG = 'printer.cfg'

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'])

const HTML_EXTENSIONS = new Set(['html', 'htm'])

const TEXT_EXTENSIONS = new Set([
  'bkp',
  'cfg',
  'conf',
  'cnf',
  'ini',
  'toml',
  'txt',
  'md',
  'markdown',
  'json',
  'yaml',
  'yml',
  'log',
  'py',
  'sh',
  'service',
  'list',
  'csv',
  'gcode',
  'nc',
  'env',
  'xml',
])

export const LARGE_TEXT_FILE_BYTES = 2 * 1024 * 1024
export const LARGE_IMAGE_FILE_BYTES = 20 * 1024 * 1024

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLocaleLowerCase()
}

/**
 * A rotated log keeps its real extension (`.log`) and appends a rotation
 * timestamp Moonraker and Klipper both use — `klippy.log.2024-01-15` or
 * `moonraker.log.2024-01-15_00-00-00`. Read naively, `extensionOf` sees the
 * date as the extension and neither set recognizes it, so every rotated log
 * fell to `unsupported` and warned on open. Stripping a trailing date (with
 * an optional time suffix) before classifying restores the real extension
 * underneath it.
 */
const DATE_ROTATION_SUFFIX = /[._-](\d{4}-\d{2}-\d{2}|\d{8})(?:_\d{2}-\d{2}-\d{2})?$/

function stripDateRotationSuffix(name: string): string {
  const match = name.match(DATE_ROTATION_SUFFIX)
  return match ? name.slice(0, name.length - match[0].length) : name
}

export function classifyFileKind(name: string): MachineFileKind {
  const extension = fileExtension(stripDateRotationSuffix(name))
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (HTML_EXTENSIONS.has(extension)) return 'html'
  if (!extension || TEXT_EXTENSIONS.has(extension)) return 'text'
  return 'unsupported'
}

export function isLargeFile(kind: MachineFileKind, size: number): boolean {
  const limit = kind === 'image' ? LARGE_IMAGE_FILE_BYTES : LARGE_TEXT_FILE_BYTES
  return size > limit
}
