import type { AppIconName } from '@/components/AppIcon.vue'
import { dashboardColorTokens } from '@/dashboard/colorTokens'
import type { SensorReading } from '@/stores/telemetry'

/**
 * Shared by the card and its settings pane, which list the same sensors: a
 * chart series named differently from the row it plots would be two names for
 * one thing.
 *
 * The two heaters everyone knows by role rather than by their Klipper object
 * name get that role; anything else keeps the name the printer reported.
 */
export function sensorLabel(sensor: SensorReading, t: (key: string) => string): string {
  if (sensor.objectName === 'extruder') return t('dashboard.hotend')
  if (sensor.objectName === 'heater_bed') return t('dashboard.bed')
  return sensor.name
}

/**
 * The colors a sensor may be drawn in — `dashboardColorTokens`, the shared
 * seven-hue palette, re-exported under this module's own name so nothing
 * calling it has to change. Each carries a name, because a swatch identified
 * only by its color is unusable to anyone choosing between two hues they
 * cannot tell apart; seven distinguishable choices is also more than a chart
 * of three or four sensors can use anyway.
 */
export const sensorColorTokens = dashboardColorTokens

export type SensorColorKey = (typeof sensorColorTokens)[number]['key']

const colorByKey = new Map(sensorColorTokens.map((token) => [token.key, token.variable]))

/** Orange runs hot and sky runs cold, which is also how the mesh reads. */
const pinnedColors: Record<string, SensorColorKey> = {
  extruder: 'orange',
  heater_bed: 'sky',
}

/** Everything else is assigned from the rest of the palette. */
const assignableColors = sensorColorTokens
  .map((token) => token.key)
  .filter((key) => key !== 'orange' && key !== 'sky')

/**
 * A stable default color for a sensor, derived from its own name.
 *
 * Derived rather than assigned by position, which is what this replaced: the
 * previous version indexed into the palette by where a sensor happened to sit
 * in the discovery order, so plugging in one new thermistor silently recolored
 * every sensor after it — and a chart whose colors mean something different
 * today than yesterday is worse than one with no colors at all.
 */
export function defaultSensorColorKey(objectName: string): SensorColorKey {
  const pinned = pinnedColors[objectName]
  if (pinned) return pinned

  let hash = 0
  for (let index = 0; index < objectName.length; index += 1) {
    hash = (hash * 31 + objectName.charCodeAt(index)) >>> 0
  }
  return assignableColors[hash % assignableColors.length] as SensorColorKey
}

/**
 * A user-chosen hex color, distinct from the seven-hue palette above.
 * `dashboardColorTokens`' own comment explains why new chromatic color is
 * restricted to Okabe-Ito hues for anything shared chrome reads as meaning —
 * a status, a button, a role every theme pack has to keep coherent and
 * contrast-checked. A sensor's chart line answers to none of that: its label
 * and live reading are always shown in text beside it, nothing else in the
 * interface infers meaning from which hue a reader assigned their own
 * thermistor, and it is personalization of already-identified data rather
 * than a second way to say something the seven tokens already say. That is
 * also why this lives here rather than loosening `dashboardColorTokens`
 * itself: every other consumer of that shared list — Settings' camera
 * crosshair color among them — stays restricted to the seven, and gets its
 * own version of this escape hatch only if it turns out to want one.
 * `spool.ts`'s filament colors already store an arbitrary hex value for the
 * same reason: a color a person picked for their own material, not a role.
 */
const hexColorPattern = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

export function isCustomSensorColor(value: string): boolean {
  return hexColorPattern.test(value)
}

/**
 * The CSS color for a sensor, honoring the card's own choice if it has one —
 * a literal hex for a custom pick, otherwise the token's `var()`. Both are
 * valid wherever a CSS color goes, which is every consumer: inline styles,
 * SVG strokes, and `ColorPickerDialog`, which resolves the `var()` through
 * the document to find the hue it should open on.
 */
export function sensorColorVariable(
  objectName: string,
  overrides: Record<string, string> = {},
): string {
  const chosen = overrides[objectName]
  if (chosen && isCustomSensorColor(chosen)) return chosen
  return (
    colorByKey.get(chosen as SensorColorKey) ??
    colorByKey.get(defaultSensorColorKey(objectName)) ??
    'var(--color-data-sky)'
  )
}

/**
 * The token currently selected, or `null` when the sensor is on a custom hex
 * color instead — which of the seven swatches, if any, renders pressed. A
 * custom color is never coerced back onto a token: only a value that is
 * neither a known key nor a valid hex (a hand-edited profile naming a color
 * this product never offered) falls back to the sensor's default token.
 */
export function sensorColorKey(
  objectName: string,
  overrides: Record<string, string> = {},
): SensorColorKey | null {
  const chosen = overrides[objectName]
  if (chosen && isCustomSensorColor(chosen)) return null
  return colorByKey.has(chosen as SensorColorKey)
    ? (chosen as SensorColorKey)
    : defaultSensorColorKey(objectName)
}

/** The custom hex assigned to a sensor, or `null` when it is on one of the seven tokens instead. */
export function sensorCustomColor(
  objectName: string,
  overrides: Record<string, string> = {},
): string | null {
  const chosen = overrides[objectName]
  return chosen && isCustomSensorColor(chosen) ? chosen : null
}

/** The five-level Font Awesome fill sequence, ordered coldest to hottest. */
const thermometerLevels: readonly AppIconName[] = [
  'thermometerEmpty',
  'thermometerQuarter',
  'thermometerHalf',
  'thermometerThreeQuarters',
  'thermometerFull',
]

/** Empty at or below this reading */
const thermometerFloorCelsius = 10
/** Full at or above this reading. */
const thermometerCeilingCelsius = 100

/**
 * The row's own leading icon. The hotend and the bed each get a fixed glyph
 * for what they physically are; everything else on the card — an extra
 * heater, a `temperature_fan`, a read-only MCU or host sensor — is drawn as
 * one of `thermometerLevels`, chosen by its own current reading against a
 * fixed 10–100°C scale rather than against a target: a read-only sensor has
 * no target to measure against at all, and a settable one still climbing
 * toward a low target (a heated chamber at 35°C, say) is genuinely barely
 * warm, not "arrived".
 */
export function sensorRowIcon(
  sensor: SensorReading,
  currentTemperature: number | null,
): AppIconName {
  if (sensor.objectName === 'extruder') return 'nozzleHeat'
  if (sensor.objectName === 'heater_bed') return 'heatingSquare'

  const current = currentTemperature ?? thermometerFloorCelsius
  const progress =
    (current - thermometerFloorCelsius) / (thermometerCeilingCelsius - thermometerFloorCelsius)
  const clamped = Math.min(1, Math.max(0, progress))
  return thermometerLevels[Math.round(clamped * (thermometerLevels.length - 1))]!
}
