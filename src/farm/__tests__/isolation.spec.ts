import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

const sourceRoot = join(process.cwd(), 'src')

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesBelow(path) : [path]
  })
}

function sources(directory: string): Array<[string, string]> {
  return filesBelow(join(sourceRoot, directory))
    .filter(
      (path) => (path.endsWith('.ts') || path.endsWith('.vue')) && !path.includes('__tests__'),
    )
    .map((path) => [relative(sourceRoot, path).split(sep).join('/'), readFileSync(path, 'utf8')])
}

/**
 * The farm page holds one page-scoped connection per visible printer. That is
 * the single exception to ADR 0005's "one connection, retargeted", and it is
 * only an exception while it stays sealed inside this page.
 *
 * The failure this prevents is a convenience nobody would argue for out loud
 * and everybody would take at 11pm: a store reaching into the farm's
 * connections for a value it could not otherwise get — a temperature from
 * another printer, a queue from a machine nobody is driving — which turns a
 * page-scoped read-mostly socket into part of the application's data model and
 * makes ADR 0005's simplification false everywhere.
 */
describe('farm connections stay inside the farm page', () => {
  it('is imported by no domain store but its own', () => {
    const offenders = sources('stores')
      .filter(
        ([path]) => !path.endsWith(`stores${'\\'}farm.ts`) && !path.endsWith('stores/farm.ts'),
      )
      .filter(([, source]) => /from '@\/farm\/(connection|snapshot)'/.test(source))
      .map(([path]) => path)

    expect(
      offenders,
      `These stores reach into the farm page's own connections:\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('is reached from no component outside the farm page and its view', () => {
    const offenders = [...sources('components'), ...sources('views'), ...sources('composables')]
      .filter(([path]) => !path.includes('farm') && !path.includes('Farm'))
      .filter(([, source]) => /from '@\/(farm\/|stores\/farm')/.test(source))
      .map(([path]) => path)

    expect(offenders).toEqual([])
  })

  /*
   * The other direction of the same rule. The farm store reads the live stores
   * to build the active printer's column — that is deliberate, and it is what
   * spares that printer a second socket — but the connection itself must stay
   * transport-only, testable without Pinia and unable to touch domain state.
   */
  it('keeps the connection itself free of stores and Vue', () => {
    const connection = readFileSync(join(sourceRoot, 'farm', 'connection.ts'), 'utf8')
    expect(connection).not.toMatch(/from '@\/stores\//)
    expect(connection).not.toMatch(/from 'vue'/)
    expect(connection).not.toMatch(/from 'pinia'/)
  })
})
