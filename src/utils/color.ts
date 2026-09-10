/**
 * Color arithmetic for the one place the application lets a person pick an
 * arbitrary color: `ColorPickerDialog`. Everything here is pure except
 * `resolveCssColor`, which is how a `var(--color-data-orange)` a sensor is
 * already drawn in becomes a hue the picker can open on — the same
 * resolve-once trick `src/themes/README.md` prescribes for canvases, which
 * cannot read a custom property either.
 *
 * No literal hex value appears in this file on purpose: `palette.spec.ts`
 * keeps every hex literal outside `palette.css`, and a picker has no business
 * being the exception — it converts what it is given, it never supplies a
 * color of its own.
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

/** Hue in degrees (0–360), saturation and value as fractions (0–1). */
export interface Hsv {
  h: number
  s: number
  v: number
}

const hexPattern = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

export function isHexColor(value: string): boolean {
  return hexPattern.test(value.trim())
}

/**
 * A six-digit lowercase hex with its leading hash, from anything a person
 * might have typed — a missing hash, a three-digit shorthand, capitals — or
 * `null` when it is not a hex color at all.
 */
export function normalizeHex(value: string): string | null {
  let hex = value.trim()
  if (!hex.startsWith('#')) hex = `#${hex}`
  if (!hexPattern.test(hex)) return null
  if (hex.length === 4) {
    hex = `#${[...hex.slice(1)].map((digit) => digit + digit).join('')}`
  }
  return hex.toLowerCase()
}

export function hexToRgb(value: string): Rgb | null {
  const hex = normalizeHex(value)
  if (!hex) return null
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  }
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const channel = (value: number) =>
    Math.round(clamp(value, 0, 255))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min

  let h = 0
  if (delta > 0) {
    if (max === red) h = ((green - blue) / delta) % 6
    else if (max === green) h = (blue - red) / delta + 2
    else h = (red - green) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }

  return { h, s: max === 0 ? 0 : delta / max, v: max }
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hue = (((h % 360) + 360) % 360) / 60
  const chroma = v * s
  const x = chroma * (1 - Math.abs((hue % 2) - 1))
  const m = v - chroma

  const sector = (): [number, number, number] => {
    if (hue < 1) return [chroma, x, 0]
    if (hue < 2) return [x, chroma, 0]
    if (hue < 3) return [0, chroma, x]
    if (hue < 4) return [0, x, chroma]
    if (hue < 5) return [x, 0, chroma]
    return [chroma, 0, x]
  }
  const [red, green, blue] = sector()

  return { r: (red + m) * 255, g: (green + m) * 255, b: (blue + m) * 255 }
}

export function hexToHsv(value: string): Hsv | null {
  const rgb = hexToRgb(value)
  return rgb ? rgbToHsv(rgb) : null
}

export function hsvToHex(hsv: Hsv): string {
  return rgbToHex(hsvToRgb(hsv))
}

/**
 * A hex color or the `rgb()`/`rgba()` form `getComputedStyle` reports, in
 * either the comma or the space-separated syntax. Anything else is `null`.
 */
export function parseCssColor(value: string): Rgb | null {
  const hex = hexToRgb(value)
  if (hex) return hex

  const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(value.trim())
  if (!match) return null
  const [, r, g, b] = match
  return { r: Number(r), g: Number(g), b: Number(b) }
}

/**
 * Whatever a CSS color expression paints as, read back through the document
 * — the only way to learn what `var(--color-data-orange)` is right now. Null
 * when there is no document to ask (a unit test) or when the browser could
 * not make sense of the value.
 */
export function resolveCssColor(value: string): Rgb | null {
  const direct = parseCssColor(value)
  if (direct) return direct
  if (typeof document === 'undefined') return null

  const probe = document.createElement('span')
  probe.style.color = value
  document.body.appendChild(probe)
  const computed = getComputedStyle(probe).color
  probe.remove()
  return parseCssColor(computed)
}
