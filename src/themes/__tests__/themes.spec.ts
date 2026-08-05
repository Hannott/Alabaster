import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { semanticThemeTokens } from '@/themes/contract'
import { themePacks } from '@/themes/registry'

const themeRoot = join(process.cwd(), 'src', 'themes')
const indexSource = readFileSync(join(themeRoot, 'index.css'), 'utf8')
const guideSource = readFileSync(join(themeRoot, 'README.md'), 'utf8')

describe('theme authoring contract', () => {
  it.each(themePacks)('$id defines every semantic token for light and dark modes', ({ id }) => {
    const packSource = readFileSync(join(themeRoot, 'packs', `${id}.css`), 'utf8')

    expect(indexSource).toContain(`@import './packs/${id}.css';`)
    expect(packSource).toContain(`[data-theme-pack='${id}'][data-theme='light']`)
    expect(packSource).toContain(`[data-theme-pack='${id}'][data-theme='dark']`)

    for (const token of semanticThemeTokens) {
      const declarationCount = [...packSource.matchAll(new RegExp(`${token}\\s*:`, 'g'))].length

      expect(declarationCount, `${id} must define ${token} in both modes`).toBeGreaterThanOrEqual(2)
    }
  })

  it('documents every required semantic token', () => {
    for (const token of semanticThemeTokens) {
      expect(guideSource).toContain(`\`${token}\``)
    }
  })
})
