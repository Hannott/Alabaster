import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { defaultThemePackId, themePacks } from '@/themes/registry'

import {
  composite,
  contrastRatio,
  parseDeclarations,
  resolveColor,
  ruleBodies,
  type Rgba,
} from './resolveThemeColor'

/*
 * The button system in docs/design/button-system.md is only safe if every
 * variant clears 4.5:1 against every surface it can sit on, in every
 * interaction state. Some margins are thin—`--status-danger-text` in dark mode
 * passes by 0.15—so a pack author changing one surface, veil, or status token
 * has no other way to discover they broke a control. This test is that
 * discovery.
 *
 * Three budgets, asserted separately, because a single one hid a real defect:
 * 4.5:1 for a label over its fill, 4.5:1 for a label under the caution veil,
 * and 3:1 for the boundary tokens. When `--status-danger-border` was folded
 * onto the label value "because the 4.5:1 assertion already covers it", the
 * border was left as washed-out as the text beside it and nothing failed.
 */

const MINIMUM_CONTRAST = 4.5
const themeRoot = join(process.cwd(), 'src', 'themes')

/*
 * Only the canonical pack owes this contract. src/themes/README.md's "Custom
 * packs may break every other rule" exempts every other pack from the WCAG
 * floors this file asserts — a non-canonical pack shipping low contrast on
 * purpose is exercising that exemption, not failing a check that forgot to
 * exclude it.
 */
const canonicalPacks = themePacks.filter((pack) => pack.id === defaultThemePackId)

const paletteVariables = parseDeclarations(
  ruleBodies(readFileSync(join(themeRoot, 'palette.css'), 'utf8'), /:root/).join(';'),
)

type Mode = 'light' | 'dark'

function packVariables(packId: string, mode: Mode): Map<string, string> {
  const source = readFileSync(join(themeRoot, 'packs', `${packId}.css`), 'utf8')
  const bodies = ruleBodies(source, new RegExp(`\\[data-theme='${mode}'\\]`))

  expect(bodies, `${packId} must declare a ${mode} block`).not.toHaveLength(0)

  return new Map([...paletteVariables, ...parseDeclarations(bodies.join(';'))])
}

/** Every variant as `[name, fill, label]`; a null fill means transparent. */
function variants(): [string, string | null, string][] {
  return [
    ['neutral', 'var(--surface-soft)', 'var(--text-primary)'],
    ['neutral on-soft', 'var(--surface-raised)', 'var(--text-primary)'],
    ['selected', 'var(--surface-raised)', 'var(--text-primary)'],
    ['primary', 'var(--action-primary)', 'var(--action-on-primary)'],
    ['critical', 'var(--status-danger-strong)', 'var(--status-on-danger)'],
    ['danger', null, 'var(--status-danger-text)'],
    ['danger-quiet', null, 'var(--status-danger-text)'],
    ['alert banner', 'var(--status-danger-soft)', 'var(--status-danger-text)'],
    ['quiet at rest', null, 'var(--text-muted)'],
    ['quiet on hover', null, 'var(--text-primary)'],
  ]
}

/** The two variants that hover by `filter: brightness()` rather than a veil. */
function solidFill(name: string): boolean {
  return name === 'primary' || name === 'critical'
}

/**
 * `filter: brightness(f)` multiplies each channel of the already-composited
 * pixel, so it is applied to the rendered fill rather than blended into it.
 * Alpha is untouched, which is why an opaque fill stays opaque.
 */
function brightness(color: Rgba, factor: number): Rgba {
  return [
    Math.min(255, color[0] * factor),
    Math.min(255, color[1] * factor),
    Math.min(255, color[2] * factor),
    color[3],
  ]
}

describe('control contrast contract', () => {
  it.each(canonicalPacks)('$id keeps every control readable in every state', ({ id }) => {
    const failures: string[] = []

    for (const mode of ['light', 'dark'] as const) {
      const variables = packVariables(id, mode)
      const resolve = (expression: string): Rgba => resolveColor(expression, variables)

      const veils: [string, Rgba][] = [
        ['at rest', [0, 0, 0, 0]],
        ['on hover', resolve('var(--interaction-veil)')],
        ['pressed', resolve('var(--interaction-veil-strong)')],
      ]

      const panels = ['--surface-raised', '--surface-soft', '--surface-canvas'] as const

      for (const [name, fill, label] of variants()) {
        // `quiet at rest` never receives a veil; its hover row covers those.
        // `alert banner` is static text, not an interactive control—it never
        // receives one either.
        //
        // `primary` and `critical` receive no veil at all: they hover and press
        // by `filter: brightness()`, asserted separately below. Modeling them
        // with the veil is what capped --status-danger-strong at 78%, because
        // dark mode's white veil lightened a fill that carries a white label.
        const applicable = solidFill(name)
          ? veils.slice(0, 1)
          : name === 'quiet at rest' || name === 'alert banner'
            ? veils.slice(0, 1)
            : veils
        const foreground = resolve(label)

        for (const panelToken of panels) {
          const panel = resolve(`var(${panelToken})`)
          const base = fill === null ? panel : composite(resolve(fill), panel)

          for (const [state, veil] of applicable) {
            const background = composite(veil, base)
            const ratio = contrastRatio(composite(foreground, background), background)

            if (ratio < MINIMUM_CONTRAST) {
              failures.push(`${mode} ${name} ${state} on ${panelToken}: ${ratio.toFixed(2)}:1`)
            }
          }
        }
      }
    }

    expect(failures, `${id} control contrast failures:\n${failures.join('\n')}`).toEqual([])
  })

  /*
   * `primary` and `critical` are excluded from the veil walk above, so their
   * interaction states are asserted here instead. Both directions only ever
   * raise contrast against their own label, which is the property that lets
   * --status-danger-strong sit at 88%: this test is what proves the direction
   * rather than assuming it.
   */
  it.each(canonicalPacks)('$id keeps a solid fill readable under brightness', ({ id }) => {
    const failures: string[] = []

    for (const mode of ['light', 'dark'] as const) {
      const variables = packVariables(id, mode)
      const resolve = (expression: string): Rgba => resolveColor(expression, variables)

      // From button-system.md's brightness table. `critical` darkens in both
      // modes because --status-on-danger is white in both; `primary`'s label
      // flips with the theme, so its direction does too.
      const cases: [string, string, string, number[]][] = [
        [
          'primary',
          'var(--action-primary)',
          'var(--action-on-primary)',
          mode === 'light' ? [1, 0.82, 0.7] : [1, 1.15, 1.3],
        ],
        ['critical', 'var(--status-danger-strong)', 'var(--status-on-danger)', [1, 0.82, 0.68]],
      ]

      for (const [name, fill, label, factors] of cases) {
        const foreground = resolve(label)

        for (const panelToken of ['--surface-raised', '--surface-soft', '--surface-canvas']) {
          const panel = resolve(`var(${panelToken})`)

          for (const factor of factors) {
            const background = brightness(composite(resolve(fill), panel), factor)
            const ratio = contrastRatio(composite(foreground, background), background)

            if (ratio < MINIMUM_CONTRAST) {
              failures.push(
                `${mode} ${name} at brightness(${factor}) on ${panelToken}: ${ratio.toFixed(2)}:1`,
              )
            }
          }
        }
      }
    }

    expect(failures, `${id} brightness failures:\n${failures.join('\n')}`).toEqual([])
  })

  /*
   * Labels that are not button variants, and so were invisible to the walk
   * above. --status-caution-text sat at 3.83:1 in light mode for as long as it
   * existed because nothing here looked at it: its percentage had been copied
   * from --status-danger-text on the assumption that an equal share of a
   * different hue gives an equal ratio, and orange starts far lighter than
   * vermillion. Add a token here whenever one starts carrying text.
   */
  it.each(canonicalPacks)('$id keeps every standalone label readable', ({ id }) => {
    const failures: string[] = []

    for (const mode of ['light', 'dark'] as const) {
      const variables = packVariables(id, mode)
      const resolve = (expression: string): Rgba => resolveColor(expression, variables)

      for (const token of ['--status-caution-text', '--status-danger-text'] as const) {
        const foreground = resolve(`var(${token})`)

        for (const panelToken of ['--surface-raised', '--surface-soft', '--surface-canvas']) {
          const panel = resolve(`var(${panelToken})`)

          for (const [state, veil] of [
            ['at rest', null],
            ['on hover', '--interaction-veil'],
            ['pressed', '--interaction-veil-strong'],
          ] as const) {
            const background = veil === null ? panel : composite(resolve(`var(${veil})`), panel)
            const ratio = contrastRatio(composite(foreground, background), background)

            if (ratio < MINIMUM_CONTRAST) {
              failures.push(`${mode} ${token} ${state} on ${panelToken}: ${ratio.toFixed(2)}:1`)
            }
          }
        }
      }
    }

    expect(failures, `${id} standalone label failures:\n${failures.join('\n')}`).toEqual([])
  })

  /*
   * A control's caution treatment composites --status-caution-veil over the
   * resting fill in place of the neutral hover veil, so every label that can
   * receive it needs the same 4.5:1 it gets at rest. `primary` is the binding
   * case: an orange veil over blue moves the background toward the label.
   */
  it.each(canonicalPacks)('$id keeps a label readable under the caution veil', ({ id }) => {
    const failures: string[] = []

    for (const mode of ['light', 'dark'] as const) {
      const variables = packVariables(id, mode)
      const resolve = (expression: string): Rgba => resolveColor(expression, variables)
      const veil = resolve('var(--status-caution-veil)')

      for (const [name, fill, label] of variants()) {
        // Only the variants a tier-2 control can wear, in the state that can
        // wear them. `danger`, `critical` and the alert banner never take a
        // caution veil: an action is disruptive or it is terminal, never marked
        // as both at once. `quiet at rest` is excluded for the reason the test
        // above gives—a veil is a hover treatment, and quiet's label has moved
        // to --text-primary by the time one arrives.
        if (
          name.startsWith('danger') ||
          name === 'critical' ||
          name === 'alert banner' ||
          name === 'quiet at rest'
        ) {
          continue
        }

        const foreground = resolve(label)

        for (const panelToken of ['--surface-raised', '--surface-soft', '--surface-canvas']) {
          const panel = resolve(`var(${panelToken})`)
          const base = fill === null ? panel : composite(resolve(fill), panel)
          const background = composite(veil, base)
          const ratio = contrastRatio(composite(foreground, background), background)

          if (ratio < MINIMUM_CONTRAST) {
            failures.push(
              `${mode} ${name} under caution veil on ${panelToken}: ${ratio.toFixed(2)}:1`,
            )
          }
        }
      }
    }

    expect(failures, `${id} caution veil failures:\n${failures.join('\n')}`).toEqual([])
  })

  /*
   * WCAG 1.4.11: a border and a ring are non-text boundaries at 3:1. Each is
   * measured against both sides it separates—the panel outside it and the
   * control's own hovered fill inside—because clearing one side is not enough
   * to make an outline visible.
   *
   * This is a second contrast budget, deliberately kept apart from the 4.5:1
   * one above. Folding the border back onto --status-danger-text is what made
   * it invisible; a test that only checked labels could not see that happen.
   */
  it.each(canonicalPacks)('$id keeps every outline visible on every surface', ({ id }) => {
    const failures: string[] = []

    for (const mode of ['light', 'dark'] as const) {
      const variables = packVariables(id, mode)
      const resolve = (expression: string): Rgba => resolveColor(expression, variables)
      const hover = resolve('var(--interaction-veil)')

      for (const token of ['--status-danger-border', '--status-caution-border'] as const) {
        const line = resolve(`var(${token})`)

        for (const panelToken of ['--surface-raised', '--surface-soft', '--surface-canvas']) {
          const panel = resolve(`var(${panelToken})`)

          for (const [side, background] of [
            ['at rest', panel],
            ['on hover', composite(hover, panel)],
          ] as const) {
            const ratio = contrastRatio(composite(line, background), background)
            if (ratio < 3) {
              failures.push(`${mode} ${token} ${side} on ${panelToken}: ${ratio.toFixed(2)}:1`)
            }
          }
        }
      }
    }

    expect(failures, `${id} outline visibility failures:\n${failures.join('\n')}`).toEqual([])
  })

  it.each(canonicalPacks)('$id keeps the focus ring visible on every surface', ({ id }) => {
    // WCAG 1.4.11: the focus indicator is a non-text boundary and needs 3:1.
    // The danger and caution outlines carry their own budget, asserted above.
    for (const mode of ['light', 'dark'] as const) {
      const variables = packVariables(id, mode)
      const ring = resolveColor('var(--focus-ring)', variables)

      for (const panelToken of ['--surface-raised', '--surface-soft', '--surface-canvas']) {
        const panel = resolveColor(`var(${panelToken})`, variables)
        const ratio = contrastRatio(composite(ring, panel), panel)

        expect(ratio, `${id} ${mode} focus ring on ${panelToken}`).toBeGreaterThanOrEqual(3)
      }
    }
  })
})
