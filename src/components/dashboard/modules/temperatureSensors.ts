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
 * The colours a sensor may be drawn in — `dashboardColorTokens`, the shared
 * seven-hue palette, re-exported under this module's own name so nothing
 * calling it has to change. Each carries a name, because a swatch identified
 * only by its colour is unusable to anyone choosing between two hues they
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
 * A stable default colour for a sensor, derived from its own name.
 *
 * Derived rather than assigned by position, which is what this replaced: the
 * previous version indexed into the palette by where a sensor happened to sit
 * in the discovery order, so plugging in one new thermistor silently recoloured
 * every sensor after it — and a chart whose colours mean something different
 * today than yesterday is worse than one with no colours at all.
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

/** The CSS variable for a sensor, honouring the card's own choice if it has one. */
export function sensorColorVariable(
  objectName: string,
  overrides: Record<string, string> = {},
): string {
  const chosen = overrides[objectName]
  return (
    colorByKey.get(chosen as SensorColorKey) ??
    colorByKey.get(defaultSensorColorKey(objectName)) ??
    'var(--color-data-sky)'
  )
}

export function sensorColorKey(
  objectName: string,
  overrides: Record<string, string> = {},
): SensorColorKey {
  const chosen = overrides[objectName]
  return colorByKey.has(chosen as SensorColorKey)
    ? (chosen as SensorColorKey)
    : defaultSensorColorKey(objectName)
}
