import { describe, expect, it } from 'vitest'

import {
  defaultSensorColorKey,
  isCustomSensorColor,
  sensorColorKey,
  sensorColorTokens,
  sensorColorVariable,
  sensorCustomColor,
  sensorRowIcon,
} from '@/components/dashboard/modules/temperatureSensors'
import type { SensorReading } from '@/stores/telemetry'

function sensor(overrides: Partial<SensorReading>): SensorReading {
  return {
    objectName: 'temperature_sensor chamber',
    name: 'chamber',
    kind: 'sensor',
    temperature: 25,
    target: null,
    power: null,
    speed: null,
    isSettable: false,
    ...overrides,
  }
}

describe('sensor colors', () => {
  it('offers a fixed seven-hue palette before any custom pick', () => {
    // New chromatic color reaching every consumer of `dashboardColorTokens` is
    // restricted to the Okabe-Ito hues, so shared chrome stays theme-coherent
    // and contrast-checked. A sensor's own chart line is exempt from that —
    // see `isCustomSensorColor` below — but the seven fixed tokens are still
    // the whole of what a token key can name.
    expect(sensorColorTokens).toHaveLength(7)
    for (const token of sensorColorTokens) {
      expect(token.variable).toMatch(/^var\(--color-data-[a-z]+\)$/)
    }
  })

  it('runs the hotend hot and the bed cold', () => {
    expect(defaultSensorColorKey('extruder')).toBe('orange')
    expect(defaultSensorColorKey('heater_bed')).toBe('sky')
  })

  /*
   * The failure this replaced: colors were indexed by where a sensor sat in
   * the discovery order, so plugging in one new thermistor silently recolored
   * every sensor after it. A chart whose colors mean something different today
   * than yesterday is worse than one with no colors at all.
   */
  it('gives a sensor the same color whatever else the printer reports', () => {
    const chamber = defaultSensorColorKey('temperature_sensor chamber')
    const stepper = defaultSensorColorKey('temperature_sensor y_stepper')

    // Derived from the name, so it cannot depend on discovery order at all.
    expect(defaultSensorColorKey('temperature_sensor chamber')).toBe(chamber)
    expect(defaultSensorColorKey('temperature_sensor y_stepper')).toBe(stepper)

    // And never lands on the two that are spoken for.
    for (const objectName of [
      'temperature_sensor chamber',
      'temperature_sensor y_stepper',
      'heater_generic warmer',
      'temperature_fan exhaust',
      'temperature_sensor mcu',
    ]) {
      expect(['orange', 'sky']).not.toContain(defaultSensorColorKey(objectName))
    }
  })

  it('lets a card override the default, and ignores an override it cannot honor', () => {
    expect(sensorColorKey('extruder', { extruder: 'green' })).toBe('green')
    expect(sensorColorVariable('extruder', { extruder: 'green' })).toBe('var(--color-data-green)')

    // A hand-edited profile naming a color that is neither a token nor a valid
    // hex falls back rather than producing an empty stroke.
    expect(sensorColorKey('extruder', { extruder: 'chartreuse' })).toBe('orange')
    expect(sensorColorVariable('extruder', { extruder: 'chartreuse' })).toBe(
      'var(--color-data-orange)',
    )
  })

  it('lets a sensor take a custom hex outside the seven-hue palette', () => {
    expect(isCustomSensorColor('#ff0000')).toBe(true)
    expect(isCustomSensorColor('#f00')).toBe(true)
    expect(isCustomSensorColor('green')).toBe(false)
    expect(isCustomSensorColor('chartreuse')).toBe(false)

    // A custom color is drawn literally, never resolved through a token — and
    // it is never mistaken for one of the seven when deciding which swatch,
    // if any, renders pressed.
    expect(sensorColorVariable('extruder', { extruder: '#ff0000' })).toBe('#ff0000')
    expect(sensorColorKey('extruder', { extruder: '#ff0000' })).toBeNull()
    expect(sensorCustomColor('extruder', { extruder: '#ff0000' })).toBe('#ff0000')

    // No override at all is not a custom color either — it is still the
    // sensor's own default token.
    expect(sensorCustomColor('extruder', {})).toBeNull()
  })
})

describe('sensor row icon', () => {
  it('gives the hotend and the bed their own fixed glyph regardless of temperature', () => {
    expect(sensorRowIcon(sensor({ objectName: 'extruder', target: 0 }), 25)).toBe('nozzleHeat')
    expect(sensorRowIcon(sensor({ objectName: 'extruder', target: 240 }), 239)).toBe('nozzleHeat')
    expect(sensorRowIcon(sensor({ objectName: 'heater_bed', target: 60 }), 60)).toBe(
      'heatingSquare',
    )
  })

  /*
   * A fixed 10-100°C scale, not one measured against a target: a read-only
   * sensor (an MCU, a host, a chamber probe) has no target to measure
   * against at all, and a settable one still climbing toward a low target —
   * a heated chamber at 35°C, say — is genuinely barely warm, not "arrived".
   */
  it('steps everything else through the five fill levels on a fixed 10-100°C scale', () => {
    const passive = sensor({ target: null })
    expect(sensorRowIcon(passive, 10)).toBe('thermometerEmpty')
    expect(sensorRowIcon(passive, 32.5)).toBe('thermometerQuarter')
    expect(sensorRowIcon(passive, 55)).toBe('thermometerHalf')
    expect(sensorRowIcon(passive, 77.5)).toBe('thermometerThreeQuarters')
    expect(sensorRowIcon(passive, 100)).toBe('thermometerFull')

    // Never over- or under-shoots the scale, and a missing reading reads cold.
    expect(sensorRowIcon(passive, -10)).toBe('thermometerEmpty')
    expect(sensorRowIcon(passive, 150)).toBe('thermometerFull')
    expect(sensorRowIcon(passive, null)).toBe('thermometerEmpty')

    // A target changes nothing — a settable heater reads the same fixed scale.
    const heater = sensor({
      objectName: 'heater_generic warmer',
      kind: 'heater',
      isSettable: true,
      target: 35,
    })
    expect(sensorRowIcon(heater, 10)).toBe('thermometerEmpty')
    expect(sensorRowIcon(heater, 20)).toBe('thermometerEmpty')
  })
})
