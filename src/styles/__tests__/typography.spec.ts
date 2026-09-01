import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const typography = readFileSync(join(process.cwd(), 'src', 'styles', 'typography.css'), 'utf8')

/**
 * The closed scale, read out of the file as factors of `--type-base`.
 *
 * Resolved numerically rather than compared as step names, because the defect
 * these tests exist for was invisible at the name level: `small` and `body` are
 * both plausible-looking values for a control tier, and only the numbers say one
 * is larger than the other.
 */
function scaleFactors(): Record<string, number> {
  const factors: Record<string, number> = {}
  for (const [, name, expression] of typography.matchAll(/--type-scale-([a-z]+):\s*([^;]+);/g)) {
    if (!name || !expression) continue
    const multiple = expression.match(/var\(--type-base\)\s*\*\s*([\d.]+)/)
    if (multiple?.[1]) factors[name] = Number(multiple[1])
    else if (/^var\(--type-base\)$/.test(expression.trim())) factors[name] = 1
  }
  return factors
}

/** The step a role points at, as a number on the same scale. */
function roleFactor(role: string): number {
  const declaration = typography.match(new RegExp(`--${role}:\\s*var\\(--type-scale-([a-z]+)\\)`))
  const step = declaration?.[1]
  expect(step, `--${role} must point at a step on the scale, not a raw value`).toBeDefined()
  const factor = scaleFactors()[step as string]
  expect(factor, `--type-scale-${step} is not defined`).toBeDefined()
  return factor as number
}

describe('type scale', () => {
  it('defines every step as a factor of one base', () => {
    const factors = scaleFactors()
    expect(Object.keys(factors).sort()).toEqual(
      ['body', 'caption', 'headline', 'micro', 'small', 'subtitle', 'title'].sort(),
    )
    // Strictly ascending, or the step names stop meaning anything.
    const ascending = ['micro', 'caption', 'small', 'body', 'subtitle', 'title', 'headline']
    const values = ascending.map((step) => factors[step] as number)
    expect(values).toEqual([...values].sort((a, b) => a - b))
    expect(new Set(values).size, 'two steps resolve to the same factor').toBe(values.length)
  })

  /*
   * A control tier is never larger than the tier above it.
   *
   * This is the invariant that broke, and it broke in a commit whose message said
   * it was only moving hardcoded values into this file: `--control-field-sm-size`
   * went from `0.75rem` to `0.9rem` on the way, so `sm` drew larger text than
   * `md`'s `0.8rem` and larger than `xs`'s `0.75rem`. It survived that commit and
   * the one that closed the scale, because nothing about either line is wrong on
   * its own — the mistake exists only in the relationship between them, which is
   * the one thing reading a diff line by line cannot see.
   */
  it('never lets a smaller control tier draw larger text', () => {
    const fields = [
      roleFactor('control-field-md-size'),
      roleFactor('control-field-sm-size'),
      roleFactor('control-field-xs-size'),
    ]
    expect(fields, 'field tiers must not increase as the control shrinks').toEqual(
      [...fields].sort((a, b) => b - a),
    )

    const texts = [roleFactor('control-text-md-size'), roleFactor('control-text-sm-size')]
    expect(texts, 'button text tiers must not increase as the control shrinks').toEqual(
      [...texts].sort((a, b) => b - a),
    )

    const nav = [roleFactor('nav-text-md-size'), roleFactor('nav-text-sm-size')]
    expect(nav, 'nav tiers must not increase as the control shrinks').toEqual(
      [...nav].sort((a, b) => b - a),
    )
  })

  /*
   * A field's unit is smaller than the value it qualifies.
   *
   * Not merely different: at parity the two strings inside one box read as two
   * values, and the reader has to work out which one they came to read. The unit
   * borrowed `--text-meta-size` until that was inflated to `0.9rem` — the same
   * commit, the same kind of silent change — which put it level with the value
   * and later mapped both onto neighboring steps of the closed scale.
   */
  it('keeps a field unit a step below the value it qualifies', () => {
    expect(roleFactor('text-field-unit-size')).toBeLessThan(roleFactor('control-field-sm-size'))
  })

  /*
   * Tailwind's four size utilities are overridden onto the scale. They are still
   * written directly in templates, so if an override is dropped the utility
   * silently falls back to Tailwind's own ladder, which answers to no base and
   * lands between this file's steps — a second size system nobody declared.
   */
  it('keeps Tailwind size utilities on the scale', () => {
    for (const utility of ['text-xs', 'text-sm', 'text-base', 'text-xl']) {
      expect(typography, `--${utility} must be overridden onto a scale step`).toMatch(
        new RegExp(`--${utility}:\\s*var\\(--type-scale-[a-z]+\\)`),
      )
    }
    // The base must never be named `--text-base`: that is Tailwind's own
    // font-size namespace, so the scale's anchor would resolve through the
    // override that points back at a step calculated from it.
    expect(typography).toMatch(/--type-base:\s*[\d.]+rem/)
    expect(typography).not.toMatch(/--text-base:\s*[\d.]+rem/)
  })
})
