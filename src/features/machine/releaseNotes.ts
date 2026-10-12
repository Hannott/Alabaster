/**
 * Release notes for a `web` or `zip` update source, read from GitHub.
 *
 * Moonraker reports a downloaded-release source's installed and available
 * versions and the GitHub repository it comes from, but no changelog — unlike
 * a `git_repo` source, whose `commits_behind` is one. The notes therefore come
 * from GitHub's releases API, fetched by the browser. That request leaves the
 * printer's network, so it is made only when someone opens the confirmation,
 * cached for the session, and allowed to fail quietly: the confirmation keeps
 * its link to the release page either way.
 *
 * The body is Markdown. Only the subset release notes are written in is read
 * — headings, bulleted lists, paragraphs, inline code, bold, and links — into
 * a small tree the view renders as elements, never as HTML, so nothing in a
 * release body can inject markup. Anything else is kept as plain text.
 */

export type NoteInline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; children: NoteInline[] }
  | { kind: 'link'; href: string; children: NoteInline[] }

export type NoteBlock =
  | { kind: 'heading'; inlines: NoteInline[] }
  | { kind: 'list'; items: NoteInline[][] }
  | { kind: 'paragraph'; inlines: NoteInline[] }

export interface ReleaseNote {
  tag: string
  name: string
  url: string
  /** ISO 8601, or null where GitHub gives no publish date. */
  publishedAt: string | null
  blocks: NoteBlock[]
}

interface ParsedVersion {
  numbers: [number, number, number]
  prerelease: string | null
}

export function parseVersion(tag: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(tag.trim())
  if (!match) return null
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null,
  }
}

/** Negative when `a` is older. A prerelease sorts before its own release. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = a.numbers[index]! - b.numbers[index]!
    if (difference !== 0) return difference
  }
  if (a.prerelease === b.prerelease) return 0
  if (a.prerelease === null) return 1
  if (b.prerelease === null) return -1
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true })
}

const inlinePattern = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g

export function parseInline(source: string): NoteInline[] {
  const result: NoteInline[] = []
  let last = 0
  for (const match of source.matchAll(inlinePattern)) {
    const index = match.index ?? 0
    if (index > last) result.push({ kind: 'text', text: source.slice(last, index) })
    if (match[1] !== undefined) {
      result.push({ kind: 'code', text: match[1] })
    } else if (match[2] !== undefined) {
      result.push({ kind: 'strong', children: parseInline(match[2]) })
    } else if (match[3] !== undefined && match[4] !== undefined) {
      // Only web links: anything else (`javascript:` above all) stays as its text.
      if (/^https?:\/\//i.test(match[4])) {
        result.push({ kind: 'link', href: match[4], children: parseInline(match[3]) })
      } else {
        result.push(...parseInline(match[3]))
      }
    }
    last = index + match[0].length
  }
  if (last < source.length) result.push({ kind: 'text', text: source.slice(last) })
  return result
}

export function parseNotes(body: string): NoteBlock[] {
  const blocks: NoteBlock[] = []
  let paragraph: string[] = []
  let list: string[] | null = null

  function flush(): void {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', inlines: parseInline(paragraph.join(' ')) })
      paragraph = []
    }
    if (list !== null) {
      blocks.push({ kind: 'list', items: list.map(parseInline) })
      list = null
    }
  }

  for (const raw of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    const trimmed = line.trim()
    if (trimmed === '') {
      flush()
      continue
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(trimmed)
    if (heading) {
      flush()
      blocks.push({ kind: 'heading', inlines: parseInline(heading[1]!) })
      continue
    }
    const item = /^[-*+]\s+(.*)$/.exec(trimmed)
    if (item) {
      if (paragraph.length > 0) flush()
      list ??= []
      list.push(item[1]!)
      continue
    }
    // An indented line under a list item continues that item.
    if (list !== null && /^\s/.test(line)) {
      list[list.length - 1] += ` ${trimmed}`
      continue
    }
    if (list !== null) flush()
    paragraph.push(trimmed)
  }
  flush()
  return blocks
}

interface GithubRelease {
  tag_name?: unknown
  name?: unknown
  html_url?: unknown
  published_at?: unknown
  body?: unknown
  draft?: unknown
}

/**
 * The published releases after `installed`, up to and including `available`,
 * newest first. A prerelease is included only when the available version is
 * one itself, matching the channel Moonraker offered it on.
 */
export function releasesBetween(
  releases: readonly GithubRelease[],
  installed: string,
  available: string,
): ReleaseNote[] {
  const from = parseVersion(installed)
  const to = parseVersion(available)
  if (!from || !to) return []
  const notes: Array<{ version: ParsedVersion; note: ReleaseNote }> = []
  for (const release of releases) {
    if (release.draft === true || typeof release.tag_name !== 'string') continue
    const version = parseVersion(release.tag_name)
    if (!version) continue
    if (version.prerelease !== null && to.prerelease === null) continue
    if (compareVersions(version, from) <= 0 || compareVersions(version, to) > 0) continue
    notes.push({
      version,
      note: {
        tag: release.tag_name,
        name:
          typeof release.name === 'string' && release.name.trim() !== ''
            ? release.name
            : release.tag_name,
        url: typeof release.html_url === 'string' ? release.html_url : '',
        publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
        blocks: parseNotes(typeof release.body === 'string' ? release.body : ''),
      },
    })
  }
  return notes
    .sort((left, right) => compareVersions(right.version, left.version))
    .map((entry) => entry.note)
}

const cache = new Map<string, Promise<ReleaseNote[] | null>>()

/**
 * Resolves to null when GitHub could not be reached or answered with an error
 * — a rate limit included — and is retried on the next request for the same
 * range rather than remembered.
 */
export function fetchReleaseNotes(
  owner: string,
  repo: string,
  installed: string,
  available: string,
): Promise<ReleaseNote[] | null> {
  const key = [owner, repo, installed, available].join('\u0000')
  const cached = cache.get(key)
  if (cached) return cached
  const url = `https://api.github.com/repos/${[owner, repo].map(encodeURIComponent).join('/')}/releases?per_page=30`
  const request = fetch(url, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10_000),
  })
    .then(async (response) => {
      if (!response.ok) return null
      const body: unknown = await response.json()
      return Array.isArray(body) ? releasesBetween(body, installed, available) : null
    })
    .catch(() => null)
    .then((notes) => {
      if (notes === null) cache.delete(key)
      return notes
    })
  cache.set(key, request)
  return request
}
