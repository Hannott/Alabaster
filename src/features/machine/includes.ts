/*
 * Klipper `[include ...]` bookkeeping.
 *
 * Moving a config file out from under an include silently breaks the printer's
 * configuration: Klipper fails to start and the only clue is a parse error
 * naming a path that no longer exists. Moonraker will happily perform the move,
 * so the include has to be reconciled by us.
 *
 * Include paths are relative to the directory of the file that declares them,
 * and Klipper accepts glob patterns. Pure functions here so the matching and
 * rewriting can be tested without a printer.
 */

/** One `[include]` section header found in a config file. */
export interface ConfigInclude {
  /** The path exactly as written, relative to the declaring file. */
  target: string
  /** Byte offset of `target` within the source, for an exact replacement. */
  start: number
  end: number
}

const INCLUDE_PATTERN = /^[ \t]*\[[ \t]*include[ \t]+([^\]\r\n]+?)[ \t]*\][ \t]*$/gim

/** Every `[include]` in `source`, in document order. */
export function findConfigIncludes(source: string): ConfigInclude[] {
  const includes: ConfigInclude[] = []
  INCLUDE_PATTERN.lastIndex = 0
  for (let match = INCLUDE_PATTERN.exec(source); match; match = INCLUDE_PATTERN.exec(source)) {
    const target = match[1]
    if (target === undefined) continue
    const start = match.index + match[0].indexOf(target)
    includes.push({ target, start, end: start + target.length })
  }
  return includes
}

/** Collapses `a//b`, `./b` and `a/../b` so two spellings of one path compare equal. */
export function normalizeConfigPath(path: string): string {
  const parts: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
      else parts.push('..')
      continue
    }
    parts.push(segment)
  }
  return parts.join('/')
}

/**
 * Resolves an include target against the directory holding the declaring file,
 * both relative to the config root.
 */
export function resolveIncludeTarget(declaringFilePath: string, target: string): string {
  const directory = declaringFilePath.includes('/')
    ? declaringFilePath.slice(0, declaringFilePath.lastIndexOf('/'))
    : ''
  return normalizeConfigPath(directory ? `${directory}/${target}` : target)
}

/**
 * Re-expresses `targetPath` relative to the directory of `declaringFilePath`.
 * Klipper resolves includes from the declaring file, so a file that moves into a
 * subdirectory needs the subdirectory prefix, and one that moves up needs `../`.
 */
export function includeTargetFor(declaringFilePath: string, targetPath: string): string {
  const fromParts = normalizeConfigPath(
    declaringFilePath.includes('/')
      ? declaringFilePath.slice(0, declaringFilePath.lastIndexOf('/'))
      : '',
  )
    .split('/')
    .filter(Boolean)
  const toParts = normalizeConfigPath(targetPath).split('/').filter(Boolean)

  let shared = 0
  while (
    shared < fromParts.length &&
    shared < toParts.length &&
    fromParts[shared] === toParts[shared]
  ) {
    shared += 1
  }

  const upwards = Array.from({ length: fromParts.length - shared }, () => '..')
  return [...upwards, ...toParts.slice(shared)].join('/')
}

/**
 * Whether a literal include target refers to exactly `filePath`. Glob patterns
 * are reported separately by {@link findIncludeRewrite} because rewriting one
 * safely is not possible — the pattern may cover other files too.
 */
export function isGlob(target: string): boolean {
  return target.includes('*') || target.includes('?')
}

/**
 * Resolves a literal `[include]` target to the path the editor's Ctrl+click
 * hotlink should open, or null when it isn't a single navigable file: a glob
 * covers an unknown set of files, and a target that resolves above the
 * config root isn't something Moonraker's `config` root API can open.
 */
export function resolvableIncludeTarget(declaringFilePath: string, target: string): string | null {
  if (isGlob(target)) return null
  const resolved = resolveIncludeTarget(declaringFilePath, target)
  return resolved.startsWith('..') ? null : resolved
}

export const INCLUDABLE_EXTENSIONS = new Set(['cfg', 'conf'])

/** Whether `path`'s extension is one Klipper's `[include]` directive can target. */
export function isIncludableConfigPath(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return false
  return INCLUDABLE_EXTENSIONS.has(name.slice(dot + 1).toLocaleLowerCase())
}

/**
 * Every path a literal `[include]` in `source` resolves to, relative to the
 * config root. Globs are omitted: matching one against the file list is a
 * separate concern that callers checking "is this file wired in" don't need.
 */
export function resolvedIncludePaths(source: string, declaringFilePath: string): Set<string> {
  const resolved = new Set<string>()
  for (const include of findConfigIncludes(source)) {
    if (isGlob(include.target)) continue
    resolved.add(resolveIncludeTarget(declaringFilePath, include.target))
  }
  return resolved
}

/**
 * Whether a literal include in `source` already resolves to `targetPath`. A
 * glob is not proof either way, so it is not treated as covering the file.
 * Both paths are relative to the config root.
 */
export function isConfigIncluded(
  source: string,
  declaringFilePath: string,
  targetPath: string,
): boolean {
  return resolvedIncludePaths(source, declaringFilePath).has(normalizeConfigPath(targetPath))
}

/**
 * Klipper writes its `SAVE_CONFIG` block at the end of the file it belongs to
 * and rewrites everything from this marker down on every save. An include
 * appended below it would be pushed around by that rewrite, so new includes
 * are inserted above it instead.
 */
const SAVE_CONFIG_MARKER = /^[ \t]*#\*#[ \t]*<-+[ \t]*SAVE_CONFIG[ \t]*-+>[ \t]*$/m

/**
 * Appends an `[include target]` for `targetPath` to `source`, unless a
 * literal include already resolves to it. Returns null when nothing needs to
 * change. Both paths are relative to the config root.
 */
export function addConfigInclude(
  source: string,
  declaringFilePath: string,
  targetPath: string,
): string | null {
  if (isConfigIncluded(source, declaringFilePath, targetPath)) return null

  const target = includeTargetFor(declaringFilePath, normalizeConfigPath(targetPath))
  const line = `[include ${target}]`

  const marker = SAVE_CONFIG_MARKER.exec(source)
  if (marker) {
    const before = source.slice(0, marker.index).replace(/[ \t\n]+$/, '')
    const prefix = before.length === 0 ? '' : `${before}\n`
    return `${prefix}${line}\n\n${source.slice(marker.index)}`
  }

  const separator = source.length === 0 || source.endsWith('\n') ? '' : '\n'
  return `${source}${separator}${line}\n`
}

/**
 * Removes the literal include line in `source` that resolves to `targetPath`.
 * Returns null when no such include exists. Both paths are relative to the
 * config root.
 */
export function removeConfigInclude(
  source: string,
  declaringFilePath: string,
  targetPath: string,
): string | null {
  const target = normalizeConfigPath(targetPath)
  for (const include of findConfigIncludes(source)) {
    if (isGlob(include.target)) continue
    if (resolveIncludeTarget(declaringFilePath, include.target) !== target) continue

    const lineStart = source.lastIndexOf('\n', include.start) + 1
    const nextNewline = source.indexOf('\n', include.end)
    const lineEnd = nextNewline === -1 ? source.length : nextNewline + 1
    return source.slice(0, lineStart) + source.slice(lineEnd)
  }
  return null
}

export interface IncludeRewrite {
  /** The include exactly as written today. */
  from: string
  /** What it must say to keep pointing at the moved file. */
  to: string
  /** `source` with that one include replaced. */
  content: string
}

/**
 * Finds the include in `source` that pointed at `previousPath` and rewrites it
 * for `nextPath`. Returns null when nothing needs changing: no include matched,
 * or the include is a glob that still covers the file, or the rewrite would be
 * a no-op.
 *
 * All three paths are relative to the config root.
 */
export function findIncludeRewrite(
  source: string,
  declaringFilePath: string,
  previousPath: string,
  nextPath: string,
): IncludeRewrite | null {
  const previous = normalizeConfigPath(previousPath)
  const next = normalizeConfigPath(nextPath)
  if (previous === next) return null

  for (const include of findConfigIncludes(source)) {
    if (isGlob(include.target)) continue
    if (resolveIncludeTarget(declaringFilePath, include.target) !== previous) continue

    const to = includeTargetFor(declaringFilePath, next)
    if (to === include.target) return null

    return {
      from: include.target,
      to,
      content: `${source.slice(0, include.start)}${to}${source.slice(include.end)}`,
    }
  }

  return null
}
