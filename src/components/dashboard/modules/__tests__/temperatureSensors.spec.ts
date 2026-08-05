import { describe, expect, it } from 'vitest'

import {
  defaultSensorColorKey,
  sensorColorKey,
  sensorColorTokens,
  sensorColorVariable,
} from '@/components/dashboard/modules/temperatureSensors'

describe('sensor colours', () => {
  it('offers only the palette this product has', () => {
    // A full hex picker cannot ship here: new chromatic colour is restricted to
    // the Okabe-Ito hues so the themes stay coherent and every one keeps its
    // measured contrast.
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
   * The failure this replaced: colours were indexed by where a sensor sat in
   * the discovery order, so plugging in one new thermistor silently recoloured
   * every sensor after it. A chart whose colours mean something different today
   * than yesterday is worse than one with no colours at all.
   */
  it('gives a sensor the same colour whatever else the printer reports', () => {
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

  it('lets a card override the default, and ignores an override it cannot honour', () => {
    expect(sensorColorKey('extruder', { extruder: 'green' })).toBe('green')
    expect(sensorColorVariable('extruder', { extruder: 'green' })).toBe('var(--color-data-green)')

    // A hand-edited profile naming a colour that is not in the palette falls
    // back rather than producing an empty stroke.
    expect(sensorColorKey('extruder', { extruder: '#ff0000' })).toBe('orange')
    expect(sensorColorVariable('extruder', { extruder: 'chartreuse' })).toBe(
      'var(--color-data-orange)',
    )
  })
})
