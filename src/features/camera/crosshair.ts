import { dashboardColorTokens, type DashboardColorKey } from '@/dashboard/colorTokens'

import type { Camera } from './camera'

/**
 * The crosshair overlay's stored settings.
 *
 * The color is stored twice, on purpose, and each copy has one owner:
 *
 * - **`alabasterCrosshairColor`** holds one of the seven Okabe-Ito keys from
 *   `dashboardColorTokens`. This is what Alabaster reads and what the swatch
 *   picker writes, and it is a *key* rather than a value so the drawn crosshair
 *   follows the active theme pack — the same reason every other user-chosen
 *   color in the product is stored as a key.
 * - **`nozzleCrosshairColor`** holds the resolved hex. Nothing here reads it
 *   unless the key is absent; it exists so a crosshair configured in Alabaster
 *   still appears in Mainsail, which stores a free hex in that field and would
 *   otherwise show no crosshair at all.
 *
 * Reading in that order is what makes a crosshair configured in *either*
 * interface work in both: Mainsail's own hex has no key beside it and is drawn
 * as the literal color the user picked there, which is the honest reading of
 * it.
 */
export interface CameraCrosshairSettings {
  enabled: boolean
  /** The chosen palette entry, when one was chosen in Alabaster. */
  colorKey: DashboardColorKey | null
  /** A hex from another interface, used only when `colorKey` is absent. */
  colorLiteral: string | null
  /** Fraction of the frame's smaller side, 0.01–1. */
  size: number
}

const keys = new Set<string>(dashboardColorTokens.map((token) => token.key))

export const crosshairDefaultSize = 0.1

export function cameraCrosshair(camera: Camera): CameraCrosshairSettings {
  const data = camera.extraData
  const storedKey = data.alabasterCrosshairColor
  const storedLiteral = data.nozzleCrosshairColor
  const storedSize = data.nozzleCrosshairSize

  return {
    enabled: data.nozzleCrosshair === true,
    colorKey:
      typeof storedKey === 'string' && keys.has(storedKey)
        ? (storedKey as DashboardColorKey)
        : null,
    colorLiteral:
      typeof storedLiteral === 'string' && storedLiteral.trim() !== '' ? storedLiteral : null,
    size:
      typeof storedSize === 'number' && Number.isFinite(storedSize)
        ? Math.min(1, Math.max(0.01, storedSize))
        : crosshairDefaultSize,
  }
}

/** The CSS color to draw with, or null to leave the stylesheet's own default. */
export function crosshairColorValue(settings: CameraCrosshairSettings): string | null {
  if (settings.colorKey !== null) {
    return dashboardColorTokens.find((token) => token.key === settings.colorKey)?.variable ?? null
  }
  return settings.colorLiteral
}

/**
 * The `#rrggbb` the browser computes for a palette token, so the hex written
 * for other interfaces is the color Alabaster actually drew rather than a
 * second, hand-maintained copy of the palette.
 *
 * Null where custom properties cannot be resolved at all — a test environment,
 * or a call made before the theme stylesheet has applied. The caller then
 * leaves the interoperability field alone rather than writing a wrong color
 * into it.
 */
export function resolveTokenHex(variable: string): string | null {
  if (typeof document === 'undefined') return null
  const probe = document.createElement('span')
  probe.style.color = variable
  probe.style.display = 'none'
  document.body.appendChild(probe)
  const computed = getComputedStyle(probe).color
  probe.remove()

  const match = computed.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/)
  if (!match) return null
  const channels = [match[1], match[2], match[3]].map((value) =>
    Math.max(0, Math.min(255, Math.round(Number(value)))),
  )
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}
