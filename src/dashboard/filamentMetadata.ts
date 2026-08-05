import type { MoonrakerGcodeMetadata } from '@/services/moonraker'

/**
 * One filament a file uses, ready to render as a chip: a color swatch, a
 * material name, and the weight it costs. Built from `server.files.metadata`,
 * which is never as simple as it looks for a multi-material file — see
 * `parseMultiValueField` below for the trap this exists to avoid.
 */
export interface FilamentChip {
  color: string | null
  type: string | null
  weightGrams: number | null
}

/**
 * `filament_type` and `filament_name` are a single plain string for a
 * one-filament file, but PrusaSlicer-family slicers report a **JSON-encoded
 * array string** — `'["PLA","PETG"]'`, not `"PLA,PETG"` — for a multi-material
 * one. Moonraker's own `metadata.py` does exactly this
 * (`json.dumps(result)` when more than one value is found), so treating the
 * field as a plain comma-separated string would silently show
 * `["PLA","PETG"]` as a single, wrong material name instead of parsing it.
 */
function parseMultiValueField(value: string | undefined): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is string => typeof entry === 'string')
    }
  } catch {
    // Not JSON — a single-material file's plain string.
  }
  return [value]
}

function normalizeHexColor(color: string): string {
  return color.startsWith('#') ? color : `#${color}`
}

/**
 * One chip per filament the file uses. A single-material file that reports
 * only its totals (no per-tool arrays at all) still gets one chip, built
 * from `filament_type` and `filament_weight_total`, so the reader always
 * sees the same shape whether the file is one filament or six.
 */
export function filamentChips(metadata: MoonrakerGcodeMetadata | null | undefined): FilamentChip[] {
  if (!metadata) return []
  const colors = metadata.filament_colors ?? []
  const types = parseMultiValueField(metadata.filament_type)
  const weights = metadata.filament_weights ?? []
  const count = Math.max(colors.length, weights.length)

  if (count === 0) {
    if (metadata.filament_type === undefined && metadata.filament_weight_total === undefined) {
      return []
    }
    return [
      {
        color: null,
        type: metadata.filament_type ?? null,
        weightGrams: metadata.filament_weight_total ?? null,
      },
    ]
  }

  return Array.from({ length: count }, (_, index) => ({
    color: colors[index] ? normalizeHexColor(colors[index]) : null,
    type: types[index] ?? (types.length === 1 ? types[0] : null) ?? null,
    weightGrams:
      typeof weights[index] === 'number' && Number.isFinite(weights[index]) ? weights[index] : null,
  }))
}
