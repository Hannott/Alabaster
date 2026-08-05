import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import en from '@/locales/en.json'
import nb from '@/locales/nb.json'

const sourceRoot = join(process.cwd(), 'src')

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesBelow(path) : [path]
  })
}

function resolve(key: string): unknown {
  return key.split('.').reduce<unknown>((current, part) => {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
    return (current as Record<string, unknown>)[part]
  }, en)
}

function messageKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [prefix]

  return Object.entries(value).flatMap(([key, child]) =>
    messageKeys(child, prefix ? `${prefix}.${key}` : key),
  )
}

describe('locale catalogs', () => {
  it('keeps every locale aligned with the English schema', () => {
    expect(messageKeys(nb).sort()).toEqual(messageKeys(en).sort())
  })

  /**
   * Every key a component asks for has to exist. Vue I18n answers a missing key
   * by rendering the key itself, which looks like copy nobody translated rather
   * than a bug — and a rename is exactly when it happens: moving `machineSystem.*`
   * under `machine.*` left two template-literal keys behind, and only the two
   * specs that happened to assert rendered text noticed.
   *
   * Keys built from a variable are checked as far as their static prefix, which
   * has to resolve to a group. That catches a moved namespace, which is the
   * failure this guards; it cannot catch a renamed leaf inside one.
   */
  it('resolves every message key the application asks for', () => {
    // The lookbehind matters: without it every `createElement('a')` and
    // `getContext('webgl2')` in the tree reads as a translation call, because
    // both end in the letter this pattern is looking for.
    const literal = /(?<![\w$])(?:\$?t|te)\(\s*'([a-zA-Z][\w.]*)'/g
    const interpolated = /(?<![\w$])(?:\$?t|te)\(\s*`([a-zA-Z][\w.]*?)\$\{/g
    const missing: string[] = []

    for (const path of filesBelow(sourceRoot).filter(
      (candidate) => candidate.endsWith('.vue') || candidate.endsWith('.ts'),
    )) {
      if (path.includes('__tests__')) continue
      const source = readFileSync(path, 'utf8')
      const name = relative(sourceRoot, path).replaceAll('\\', '/')

      for (const [, key] of source.matchAll(literal)) {
        if (typeof resolve(key) !== 'string') missing.push(`${name}: ${key}`)
      }
      for (const [, prefix] of source.matchAll(interpolated)) {
        const group = resolve(prefix.replace(/\.$/, ''))
        if (typeof group !== 'object' || group === null) missing.push(`${name}: ${prefix}*`)
      }
    }

    expect(missing).toEqual([])
  })

  it('does not leave empty messages', () => {
    const messages = [en, nb]

    for (const locale of messages) {
      const emptyKeys = messageKeys(locale).filter((key) => {
        const value = key.split('.').reduce<unknown>((current, part) => {
          if (typeof current !== 'object' || current === null || Array.isArray(current)) {
            return undefined
          }

          return (current as Record<string, unknown>)[part]
        }, locale)

        return typeof value !== 'string' || value.trim().length === 0
      })

      expect(emptyKeys).toEqual([])
    }
  })
})
