import { formatNumber } from '@/features/calibration/axisRotation'

/**
 * Kalico's `[pa_test]` section: the shape and speeds of the tower
 * `RUN_PA_TEST` prints. The panel offers it as an advanced layer because the
 * guide asks for the speeds to be set near the printer's own, and a reader
 * would otherwise have to leave for the configuration editor and back.
 *
 * Kalico refuses to start on a value outside its own bounds, and a write here
 * restarts Klipper, so every bound `pa_test.py` checks is checked here first:
 * a bad value is refused in the panel rather than taking the printer down
 * into a configuration error.
 */

export type PaTestOption =
  | 'height'
  | 'size_x'
  | 'size_y'
  | 'origin_x'
  | 'origin_y'
  | 'layer_height'
  | 'first_layer_height'
  | 'perimeters'
  | 'brim_width'
  | 'slow_velocity'
  | 'medium_velocity'
  | 'fast_velocity'
  | 'filament_diameter'
  | 'fan_speed'

export type PaTestUnit = 'millimetres' | 'millimetresPerSecond' | null

export const paTestOptions: readonly { option: PaTestOption; unit: PaTestUnit }[] = [
  { option: 'slow_velocity', unit: 'millimetresPerSecond' },
  { option: 'medium_velocity', unit: 'millimetresPerSecond' },
  { option: 'fast_velocity', unit: 'millimetresPerSecond' },
  { option: 'height', unit: 'millimetres' },
  { option: 'size_x', unit: 'millimetres' },
  { option: 'size_y', unit: 'millimetres' },
  { option: 'origin_x', unit: 'millimetres' },
  { option: 'origin_y', unit: 'millimetres' },
  { option: 'layer_height', unit: 'millimetres' },
  { option: 'first_layer_height', unit: 'millimetres' },
  { option: 'perimeters', unit: null },
  { option: 'brim_width', unit: 'millimetres' },
  { option: 'filament_diameter', unit: 'millimetres' },
  { option: 'fan_speed', unit: null },
]

export type PaTestValues = Record<PaTestOption, number | null>

/** `pa_test.py`'s `SLOW_NOTCH_SIZE` and `MAX_YX_SIZE_RATIO`. */
const slowNotchSize = 10
const maxYxSizeRatio = 0.8

function numberOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** The section as Klipper loaded it, defaults included; a missing origin stays null. */
export function readPaTest(section: Record<string, unknown> | null): PaTestValues {
  return Object.fromEntries(
    paTestOptions.map(({ option }) => [option, numberOf(section?.[option])]),
  ) as PaTestValues
}

export type PaTestProblem =
  | { kind: 'required'; option: PaTestOption }
  | { kind: 'above'; option: PaTestOption; than: PaTestOption | number }
  | { kind: 'atLeast'; option: PaTestOption; min: number }
  | { kind: 'atMost'; option: PaTestOption; max: number }
  | { kind: 'whole'; option: PaTestOption }

/** The first value Kalico would refuse, or null when the section would load. */
export function paTestProblem(values: PaTestValues): PaTestProblem | null {
  const required: PaTestOption[] = [
    'height',
    'layer_height',
    'first_layer_height',
    'perimeters',
    'brim_width',
    'slow_velocity',
    'medium_velocity',
    'fast_velocity',
    'filament_diameter',
    'fan_speed',
  ]
  for (const option of required) if (values[option] === null) return { kind: 'required', option }
  const v = values as Record<PaTestOption, number> & Pick<PaTestValues, 'size_x' | 'size_y'>
  if (v.height <= 0) return { kind: 'above', option: 'height', than: 0 }
  if (v.layer_height <= 0) return { kind: 'above', option: 'layer_height', than: 0 }
  if (v.first_layer_height <= v.layer_height) {
    return { kind: 'above', option: 'first_layer_height', than: 'layer_height' }
  }
  if (!Number.isInteger(v.perimeters)) return { kind: 'whole', option: 'perimeters' }
  if (v.perimeters < 1) return { kind: 'atLeast', option: 'perimeters', min: 1 }
  if (v.brim_width < 2) return { kind: 'atLeast', option: 'brim_width', min: 2 }
  if (v.slow_velocity <= 0) return { kind: 'above', option: 'slow_velocity', than: 0 }
  if (v.medium_velocity <= v.slow_velocity) {
    return { kind: 'above', option: 'medium_velocity', than: 'slow_velocity' }
  }
  if (v.fast_velocity <= v.medium_velocity) {
    return { kind: 'above', option: 'fast_velocity', than: 'medium_velocity' }
  }
  if (v.filament_diameter <= 0) return { kind: 'above', option: 'filament_diameter', than: 0 }
  if (v.fan_speed < 0) return { kind: 'atLeast', option: 'fan_speed', min: 0 }
  if (v.fan_speed > 1) return { kind: 'atMost', option: 'fan_speed', max: 1 }
  const sizeX = v.size_x ?? 0
  const sizeY = v.size_y ?? 0
  if (sizeX < 0) return { kind: 'atLeast', option: 'size_x', min: 0 }
  if (sizeY < 0) return { kind: 'atLeast', option: 'size_y', min: 0 }
  // Zero for both lets Kalico size the tower itself; either one set checks both.
  if (sizeX !== 0 || sizeY !== 0) {
    if (sizeX < slowNotchSize * 4) {
      return { kind: 'atLeast', option: 'size_x', min: slowNotchSize * 4 }
    }
    if (sizeY < slowNotchSize * 3) {
      return { kind: 'atLeast', option: 'size_y', min: slowNotchSize * 3 }
    }
    const maxY = Number(formatNumber(maxYxSizeRatio * sizeX, 3))
    if (sizeY > maxY) return { kind: 'atMost', option: 'size_y', max: maxY }
  }
  return null
}

/**
 * The lines to write: every option whose value differs from what Klipper
 * loaded. An origin cleared to nothing is not written, because removing it
 * would be a second kind of change; the field just stays as it was.
 */
export function paTestChanges(
  loaded: PaTestValues,
  edited: PaTestValues,
): { option: PaTestOption; value: string }[] {
  return paTestOptions.flatMap(({ option }) => {
    const value = edited[option]
    if (value === null || value === loaded[option]) return []
    return [{ option, value: String(value) }]
  })
}
