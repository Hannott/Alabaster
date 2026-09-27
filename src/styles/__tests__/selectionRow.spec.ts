import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * A selected row is one shared treatment — `selection-row` in components.css,
 * documented under "Selected rows" in button-system.md. It replaced a leading
 * `inset 0.22rem 0` bar that five row families each wrote for themselves, and
 * that a rounded row bent around its corners into a curved bracket. These
 * checks keep the bar from coming back one family at a time, and keep every
 * row that borrows the shared geometry actually composing the class that
 * defines it.
 */

const projectRoot = process.cwd()
const sourceRoot = join(projectRoot, 'src')
const stylesRoot = join(sourceRoot, 'styles')

function designDoc(name: string): string | null {
  const path = join(projectRoot, 'docs', 'design', name)
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesBelow(path) : [path]
  })
}

const styleSheets = filesBelow(stylesRoot).filter((path) => path.endsWith('.css'))
const vueFiles = filesBelow(sourceRoot).filter(
  (path) => path.endsWith('.vue') && !path.includes('__tests__'),
)

/** Every innermost `selector { body }` rule, comments removed. */
function rules(source: string): { selector: string; body: string }[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: (selector ?? '').trim(),
    body: body ?? '',
  }))
}

/** Splits on top-level commas, ignoring commas inside parentheses. */
function topLevel(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    else if (char === ',' && depth === 0) {
      parts.push(value.slice(start, index))
      start = index + 1
    }
  }
  parts.push(value.slice(start))
  return parts.map((part) => part.trim())
}

function isZero(length: string | undefined): boolean {
  return length === undefined || /^-?0(\.0+)?([a-z%]+)?$/i.test(length)
}

/**
 * Whether one `box-shadow` layer is an edge bar: inset, offset along exactly
 * one axis, with no blur and no spread. That is the shape of the dropped
 * leading bar on either side and in either writing direction, whatever its
 * thickness or color.
 */
function isEdgeBar(layer: string): boolean {
  const tokens = layer.replace(/\([^()]*(\([^()]*\))*[^()]*\)/g, '()').split(/\s+/)
  if (!tokens.includes('inset')) return false
  const lengths = tokens.filter((token) => /^-?[\d.]+([a-z%]+)?$/i.test(token))
  const [x, y, blur, spread] = lengths
  return isZero(x) !== isZero(y) && isZero(blur) && isZero(spread)
}

/** Every opening tag in a template, as its attribute text. Quote-aware, so `=>` does not end one. */
function openingTags(source: string): string[] {
  const tags: string[] = []
  for (const match of source.matchAll(/<[a-zA-Z][\w-]*/g)) {
    let index = match.index + match[0].length
    let quote: string | null = null
    while (index < source.length) {
      const char = source[index]
      if (quote !== null) {
        if (char === quote) quote = null
      } else if (char === '"' || char === "'") quote = char
      else if (char === '>') break
      index += 1
    }
    tags.push(source.slice(match.index + match[0].length, index))
  }
  return tags
}

function staticClasses(tag: string): string[] {
  const match = /(?:^|\s)class="([^"]*)"/.exec(tag)
  return match ? match[1]!.split(/\s+/).filter(Boolean) : []
}

const selectionState =
  /--(selected|active|current|compared|chosen|open)\b|\[aria-(current|selected|pressed)/

describe('selected row contract', () => {
  it('never marks a selected row with an inset edge bar', () => {
    const offenders: string[] = []

    for (const path of styleSheets) {
      for (const { selector, body } of rules(readFileSync(path, 'utf8'))) {
        if (!selectionState.test(selector) && !selector.includes('selection-row')) continue
        const shadow = /(?:^|;)\s*box-shadow\s*:\s*([^;]+)/.exec(body)?.[1]
        if (shadow === undefined) continue
        if (topLevel(shadow).some(isEdgeBar)) {
          offenders.push(`${relative(projectRoot, path)}: ${selector.replace(/\s+/g, ' ')}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('reserves the border at rest and draws the selection from the accent', () => {
    const components = rules(readFileSync(join(stylesRoot, 'components.css'), 'utf8'))
    const body = (selector: string): string =>
      components.find((rule) => rule.selector === selector)?.body ?? ''

    const base = body('.selection-row')
    expect(base).toMatch(/--selection-row-border:\s*1px/)
    expect(base).toMatch(/border:\s*var\(--selection-row-border\)\s+solid\s+transparent/)
    expect(base).toMatch(
      /--selection-row-wash:\s*color-mix\(in srgb,\s*var\(--action-primary\)\s+\d+%,\s*transparent\)/,
    )

    const marked = body(
      '.selection-row.selection-row--selected,\n.selection-row.selection-row--compared',
    )
    expect(marked).toMatch(/border-color:\s*var\(--action-primary\)/)
    expect(body('.selection-row.selection-row--selected')).toMatch(
      /background-image:\s*linear-gradient\(var\(--selection-row-wash\),\s*var\(--selection-row-wash\)\)/,
    )
  })

  /*
   * A family that subtracts `--selection-row-border` from its padding depends
   * on the variable `selection-row` defines. On an element without the class
   * the `calc()` is invalid and the padding silently falls to zero — which is
   * why every row of such a family composes the class, folders and the parent
   * row included, whether or not it can ever be selected.
   */
  it('composes selection-row on every element whose family borrows its border', () => {
    const borrowers = new Set<string>()
    for (const path of styleSheets) {
      for (const { selector, body } of rules(readFileSync(path, 'utf8'))) {
        if (!body.includes('var(--selection-row-border)')) continue
        // Only the element the rule lays out — the last compound of each
        // selector — not the ancestors that scope it.
        for (const complex of topLevel(selector)) {
          const subject = complex.split(/[\s>+~]+/).pop() ?? ''
          for (const [, name] of subject.matchAll(/\.([\w-]+)/g)) {
            if (name !== 'selection-row') borrowers.add(name!)
          }
        }
      }
    }
    expect(borrowers.size).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const path of vueFiles) {
      for (const tag of openingTags(readFileSync(path, 'utf8'))) {
        const classes = staticClasses(tag)
        const borrowed = classes.filter((name) => borrowers.has(name))
        if (borrowed.length > 0 && !classes.includes('selection-row')) {
          offenders.push(`${relative(projectRoot, path)}: ${borrowed.join(' ')}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('binds the selection states only on a selection-row, beside an ARIA state', () => {
    const offenders: string[] = []

    for (const path of vueFiles) {
      const source = readFileSync(path, 'utf8')
      if (!source.includes('selection-row--')) continue

      for (const tag of openingTags(source)) {
        if (!/selection-row--(selected|compared)/.test(tag)) continue
        if (!staticClasses(tag).includes('selection-row')) {
          offenders.push(`${relative(projectRoot, path)}: state class without selection-row`)
        }
      }

      // The state is never the color alone: whatever row carries it, the file
      // also exposes the selection to assistive technology.
      if (!source.includes(':aria-current=')) {
        offenders.push(`${relative(projectRoot, path)}: no aria-current beside the selection`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('lists every row family that composes selection-row in button-system.md', () => {
    const document = designDoc('button-system.md')
    if (document === null) return

    const start = document.indexOf('\n## Selected rows')
    expect(start, 'button-system.md must have a "Selected rows" section').toBeGreaterThan(-1)
    const end = document.indexOf('\n## ', start + 1)
    const section = document.slice(start, end === -1 ? undefined : end)

    const families = new Set<string>()
    for (const path of vueFiles) {
      for (const tag of openingTags(readFileSync(path, 'utf8'))) {
        const classes = staticClasses(tag)
        if (!classes.includes('selection-row')) continue
        const family = classes.find(
          (name) => name !== 'selection-row' && name !== 'file-select' && !name.includes('--'),
        )
        if (family !== undefined) families.add(family)
      }
    }

    const missing = [...families].filter((family) => !section.includes(`\`${family}\``))
    expect(missing).toEqual([])
  })
})
