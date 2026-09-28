/*
 * Regenerates src/features/machine/docsAnchors.json from Klipper's and Kalico's
 * own documentation sources, so the configuration editor's reference links
 * land on an anchor that exists instead of a slug guessed from a section name.
 *
 *   node scripts/extract-docs-anchors.mjs
 *   npx prettier --write src/features/machine/docsAnchors.json
 *
 * Re-run when either project adds a config section, a command, or a status
 * object. Anchors are computed the way both sites' MkDocs builds compute them
 * (Python-Markdown's `toc` slugify with its `_1` suffix on a repeated heading),
 * and headings inside fenced code blocks are skipped, since Config_Reference
 * quotes bracketed names in its examples.
 */

import { writeFile } from 'node:fs/promises'

const sites = {
  klipper: { repo: 'Klipper3d/klipper', branch: 'master' },
  kalico: { repo: 'KalicoCrew/kalico', branch: 'main' },
}

const templateTopicPatterns = {
  parameters: /macro parameters/i,
  rawparams: /rawparams/i,
  printer: /the "printer" variable/i,
  actions: /^actions$/i,
  variables: /^variables$/i,
}

function slugify(text) {
  return text
    .normalize('NFKD')
    .replace(/[^ -~]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '-')
}

function headings(markdown) {
  const seen = new Map()
  const result = []
  let fenced = false
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (!match) continue
    const text = match[2].replace(/`/g, '')
    const base = slugify(text)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    result.push({ level: match[1].length, text, anchor: count === 0 ? base : `${base}_${count}` })
  }
  return result
}

async function fetchText(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return response.text()
}

async function extract({ repo, branch }) {
  const raw = (page) =>
    fetchText(`https://raw.githubusercontent.com/${repo}/${branch}/docs/${page}.md`)
  const listing = JSON.parse(
    await fetchText(`https://api.github.com/repos/${repo}/contents/docs?ref=${branch}`),
  )
  const pages = listing
    .filter((entry) => entry.type === 'file' && entry.name.endsWith('.md'))
    .map((entry) => entry.name.slice(0, -3))
    .sort()

  const configSections = {}
  for (const heading of headings(await raw('Config_Reference'))) {
    const section = /^\[([^\]]+)\]$/.exec(heading.text.trim())
    if (section && !(section[1] in configSections)) configSections[section[1]] = heading.anchor
  }

  const commands = {}
  for (const heading of headings(await raw('G-Codes'))) {
    const command = /^([A-Z][A-Z0-9_]*):?$/.exec(heading.text.trim())
    if (heading.level >= 4 && command && !(command[1] in commands)) {
      commands[command[1]] = heading.anchor
    }
  }

  const statusObjects = {}
  for (const heading of headings(await raw('Status_Reference'))) {
    if (heading.level === 2) statusObjects[heading.text.trim()] = heading.anchor
  }

  const templateTopics = {}
  for (const heading of headings(await raw('Command_Templates'))) {
    const text = heading.text.trim()
    for (const [topic, pattern] of Object.entries(templateTopicPatterns)) {
      if (!(topic in templateTopics) && pattern.test(text)) templateTopics[topic] = heading.anchor
    }
  }

  return { pages, configSections, commands, statusObjects, templateTopics }
}

const output = {}
for (const [site, source] of Object.entries(sites)) output[site] = await extract(source)

const target = new URL('../src/features/machine/docsAnchors.json', import.meta.url)
await writeFile(target, `${JSON.stringify(output, null, 2)}\n`)
console.log(`Wrote ${target.pathname}`)
