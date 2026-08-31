import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { defaultThemePackId, themePacks } from '@/themes/registry'

const sourceRoot = join(process.cwd(), 'src')
const paletteFile = join(sourceRoot, 'themes', 'palette.css')

/*
 * Every non-canonical pack file, exempted by src/themes/README.md's "Custom
 * packs may break every other rule": a pack reproducing a specific visual
 * identity (a CRT phosphor screen, a dot-matrix printout) picks its own raw
 * hues rather than deriving them from the Okabe-Ito primitives this guard
 * otherwise enforces everywhere else in the source tree. Mirrors the
 * canonicalPacks filter in controlContrast.spec.ts, which exempts the same
 * packs from the WCAG floors for the same reason.
 */
const exemptPackFiles = new Set(
  themePacks
    .filter((pack) => pack.id !== defaultThemePackId)
    .map((pack) => join(sourceRoot, 'themes', 'packs', `${pack.id}.css`)),
)

const allowedColors = new Set([
  '#000000',
  '#e69f00',
  '#56b4e9',
  '#009e73',
  '#f0e442',
  '#0072b2',
  '#d55e00',
  '#cc79a7',
  '#ffffff',
])

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(path)
    }

    return ['.css', '.ts', '.vue'].includes(extname(entry.name)) ? [path] : []
  })
}

function hexColors(source: string): string[] {
  return [...source.matchAll(/#[\da-f]{3,8}\b/gi)].map(([color]) => color.toLowerCase())
}

describe('color system', () => {
  it('keeps chromatic values inside the Okabe-Ito palette source', () => {
    const colors = hexColors(readFileSync(paletteFile, 'utf8'))

    expect(colors.length).toBeGreaterThan(0)
    expect(colors.filter((color) => !allowedColors.has(color))).toEqual([])
  })

  it('keeps color literals out of application components', () => {
    const violations = sourceFiles(sourceRoot)
      .filter((file) => file !== paletteFile && !exemptPackFiles.has(file))
      .flatMap((file) => hexColors(readFileSync(file, 'utf8')).map((color) => ({ color, file })))

    expect(violations).toEqual([])
  })
})
