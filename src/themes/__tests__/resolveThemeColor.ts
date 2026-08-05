/*
 * A small sRGB resolver for theme-pack values, used only by tests.
 *
 * Packs express every token as a hex primitive, a `var()` reference, or a
 * `color-mix(in srgb, …)` of either, so the control-contrast test needs to
 * evaluate those three forms to reach real pixels. Nothing here is shipped.
 */

export type Rgba = readonly [number, number, number, number]

const TRANSPARENT: Rgba = [0, 0, 0, 0]

/** Comments may contain colons, semicolons, and braces, so remove them first. */
function stripComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, '')
}

export function parseDeclarations(block: string): Map<string, string> {
  const declarations = new Map<string, string>()

  for (const statement of stripComments(block).split(';')) {
    const separator = statement.indexOf(':')
    if (separator === -1) continue

    const name = statement.slice(0, separator).trim()
    if (!name.startsWith('--')) continue

    declarations.set(
      name,
      statement
        .slice(separator + 1)
        .trim()
        .replace(/\s+/g, ' '),
    )
  }

  return declarations
}

/** Returns the body of every rule whose selector list matches `pattern`. */
export function ruleBodies(source: string, pattern: RegExp): string[] {
  const bodies: string[] = []

  for (const [, selector, body] of stripComments(source).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selector !== undefined && body !== undefined && pattern.test(selector)) bodies.push(body)
  }

  return bodies
}

/** Splits on top-level commas, ignoring commas inside nested parentheses. */
function splitArguments(input: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (character === '(') depth += 1
    else if (character === ')') depth -= 1
    else if (character === ',' && depth === 0) {
      parts.push(input.slice(start, index))
      start = index + 1
    }
  }

  parts.push(input.slice(start))
  return parts.map((part) => part.trim())
}

function parseHex(value: string): Rgba | null {
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(value)
  if (short) {
    const [, r, g, b] = short
    return [
      Number.parseInt(`${r}${r}`, 16),
      Number.parseInt(`${g}${g}`, 16),
      Number.parseInt(`${b}${b}`, 16),
      1,
    ]
  }

  const long = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value)
  if (!long) return null

  const [, r, g, b] = long
  return [
    Number.parseInt(r as string, 16),
    Number.parseInt(g as string, 16),
    Number.parseInt(b as string, 16),
    1,
  ]
}

/**
 * Premultiplied sRGB interpolation, matching the CSS `color-mix()` definition.
 * Premultiplying matters here because packs mix chromatic values into
 * `transparent` to build translucent tints.
 */
function mixSrgb(first: Rgba, weight: number, second: Rgba): Rgba {
  const alpha = weight * first[3] + (1 - weight) * second[3]
  if (alpha === 0) return TRANSPARENT

  const channel = (index: 0 | 1 | 2): number =>
    (weight * first[3] * first[index] + (1 - weight) * second[3] * second[index]) / alpha

  return [channel(0), channel(1), channel(2), alpha]
}

export function resolveColor(
  expression: string,
  variables: Map<string, string>,
  seen: ReadonlySet<string> = new Set(),
): Rgba {
  const value = expression.trim()

  if (value === 'transparent') return TRANSPARENT

  const hex = parseHex(value)
  if (hex) return hex

  const reference = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value)
  if (reference) {
    const name = reference[1] as string
    if (seen.has(name)) throw new Error(`circular theme token reference: ${name}`)

    const referenced = variables.get(name)
    if (referenced === undefined) throw new Error(`unknown theme token: ${name}`)

    return resolveColor(referenced, variables, new Set([...seen, name]))
  }

  const mix = /^color-mix\(\s*in srgb\s*,([\s\S]+)\)$/.exec(value)
  if (mix) {
    const [first, second] = splitArguments(mix[1] as string)
    if (first === undefined || second === undefined) {
      throw new Error(`unsupported color-mix arity: ${value}`)
    }

    const percentage = /\s([\d.]+)%$/.exec(first)
    if (!percentage) throw new Error(`color-mix without a leading percentage: ${value}`)

    const weight = Number.parseFloat(percentage[1] as string) / 100
    const firstColor = resolveColor(first.slice(0, percentage.index), variables, seen)

    return mixSrgb(firstColor, weight, resolveColor(second, variables, seen))
  }

  throw new Error(`unsupported theme color expression: ${value}`)
}

/** Composites `foreground` over an opaque `background`. */
export function composite(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground[3]
  return [
    foreground[0] * alpha + background[0] * (1 - alpha),
    foreground[1] * alpha + background[1] * (1 - alpha),
    foreground[2] * alpha + background[2] * (1 - alpha),
    1,
  ]
}

function relativeLuminance([red, green, blue]: Rgba): number {
  const channel = (value: number): number => {
    const ratio = value / 255
    return ratio <= 0.04045 ? ratio / 12.92 : Math.pow((ratio + 0.055) / 1.055, 2.4)
  }

  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
}

/** WCAG 2.x contrast ratio. Both colors must already be opaque. */
export function contrastRatio(first: Rgba, second: Rgba): number {
  const a = relativeLuminance(first)
  const b = relativeLuminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
