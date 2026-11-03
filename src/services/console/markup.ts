/**
 * Markup in what the printer says. A macro or plugin that wants to hand the
 * reader a result — a calibration graph it wrote under Moonraker's `logs` root,
 * a link to a page explaining a failure — can emit a small set of HTML tags in
 * its `RESPOND`/`M117` output, and the transcript renders them instead of
 * printing the angle brackets.
 *
 * Kept free of Vue so the allowlist can be tested against real Klipper lines.
 * Nothing here ever produces an HTML string: the output is a tree the renderer
 * turns into VNodes attribute by attribute, so there is no `innerHTML` for a
 * crafted line to reach and no re-parse for a mutation to hide in.
 */

import { moonrakerHttpBaseUrl } from '@/services/moonraker/url'

export type ConsoleInlineTag = 'b' | 'strong' | 'i' | 'em' | 'code'

export type ConsoleMarkupNode =
  | { type: 'text'; text: string }
  | { type: 'break' }
  | { type: 'inline'; tag: ConsoleInlineTag; children: ConsoleMarkupNode[] }
  | { type: 'link'; href: string; children: ConsoleMarkupNode[] }
  | { type: 'image'; src: string; alt: string }

const inlineTags: ReadonlySet<string> = new Set<ConsoleInlineTag>([
  'b',
  'strong',
  'i',
  'em',
  'code',
])

/**
 * Elements whose text is not something the reader was meant to see. Anything
 * else that is not allowlisted is unwrapped to its children, so `<div>` and
 * `<span>` cost nothing but their tags.
 */
const droppedTags: ReadonlySet<string> = new Set([
  'script',
  'style',
  'template',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'noscript',
])

/**
 * A line is treated as markup only when it carries a tag the transcript would
 * render. An HTML parser would also swallow `Unknown command:"<G1"` and a
 * `x<b` comparison in a macro's output, and losing a character the reader
 * needed is a worse failure than printing a stray tag a macro author got wrong.
 */
const markupPattern = /<\/?(?:a|img|br|b|strong|i|em|code)[\s/>]/i

export function hasConsoleMarkup(text: string): boolean {
  return text.includes('<') && markupPattern.test(text)
}

/**
 * Where a relative URL in the printer's output points. A macro cannot know what
 * address the browser reached Moonraker on — a reverse proxy, a VPN or an
 * off-printer host all change it — so it emits the path Moonraker serves the
 * file at and Alabaster, which does know, fills in the origin. `null` when
 * there is no connection to resolve against.
 */
export function consoleLinkBase(websocketEndpoint: string | null | undefined): URL | null {
  if (!websocketEndpoint) return null
  try {
    return moonrakerHttpBaseUrl(websocketEndpoint)
  } catch {
    return null
  }
}

/**
 * The one place a URL from the printer is admitted. Only `http:` and `https:`
 * survive, which is what rejects `javascript:` — a `RESPOND` in a downloaded
 * G-code file is untrusted input, even though it reaches the browser through
 * the owner's own printer. An image may additionally be a `data:image/...` URI,
 * so a plugin can inline a chart without writing a file anywhere.
 */
export function resolveConsoleUrl(
  raw: string,
  base: URL | null,
  kind: 'link' | 'image',
): string | null {
  const value = raw.trim()
  if (value === '') return null
  if (kind === 'image' && /^data:image\//i.test(value)) return value
  let url: URL
  try {
    url = base ? new URL(value, base) : new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url.href
}

function textNode(text: string): ConsoleMarkupNode {
  return { type: 'text', text }
}

function convertChildren(parent: Node, base: URL | null): ConsoleMarkupNode[] {
  const nodes: ConsoleMarkupNode[] = []
  for (const child of Array.from(parent.childNodes)) {
    nodes.push(...convertNode(child, base))
  }
  return nodes
}

function convertNode(node: Node, base: URL | null): ConsoleMarkupNode[] {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ? [textNode(node.textContent)] : []
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return []
  const element = node as Element
  const tag = element.tagName.toLowerCase()
  if (droppedTags.has(tag)) return []
  if (tag === 'br') return [{ type: 'break' }]
  if (tag === 'img') {
    const src = resolveConsoleUrl(element.getAttribute('src') ?? '', base, 'image')
    const alt = (element.getAttribute('alt') ?? '').trim()
    if (src) return [{ type: 'image', src, alt }]
    return alt ? [textNode(alt)] : []
  }
  const children = convertChildren(element, base)
  if (tag === 'a') {
    const href = resolveConsoleUrl(element.getAttribute('href') ?? '', base, 'link')
    return href ? [{ type: 'link', href, children }] : children
  }
  if (inlineTags.has(tag)) {
    return [{ type: 'inline', tag: tag as ConsoleInlineTag, children }]
  }
  return children
}

/**
 * The line as a tree the transcript can render. A line without markup — nearly
 * every line — is returned as one text node without touching a parser, which is
 * what keeps a chatty print from paying for a feature it never uses.
 */
export function parseConsoleMarkup(text: string, base: URL | null): ConsoleMarkupNode[] {
  if (!hasConsoleMarkup(text) || typeof DOMParser === 'undefined') return [textNode(text)]
  const document = new DOMParser().parseFromString(text, 'text/html')
  return convertChildren(document.body, base)
}

function flattenText(nodes: readonly ConsoleMarkupNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return node.text
        case 'break':
          return '\n'
        case 'image':
          return node.alt
        default:
          return flattenText(node.children)
      }
    })
    .join('')
}

/**
 * The words a marked-up line carries, with the tags gone. This is what the
 * calibration and leveling parsers match against: a tag wrapped around a probe
 * reading must not stop the regex that reads the number from finding it.
 */
export function consoleMarkupText(text: string): string {
  if (!hasConsoleMarkup(text)) return text
  return flattenText(parseConsoleMarkup(text, null))
}
