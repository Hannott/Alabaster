import { describe, expect, it } from 'vitest'

import {
  formatPressureAdvanceLabel,
  hasNonlinearPressureAdvance,
  readPressureAdvanceSettings,
} from '@/components/dashboard/modules/pressureAdvanceSettings'

/** What mainline Klipper resolves an `[extruder]` to, trimmed to what matters here. */
const klipperExtruder = {
  nozzle_diameter: 0.4,
  min_extrude_temp: 170,
  pressure_advance: 0.045,
  pressure_advance_smooth_time: 0.04,
}

/** Kalico's bleeding-edge non-linear form, from a machine running it. */
const kalicoExtruder = {
  nozzle_diameter: 0.4,
  min_extrude_temp: 170,
  pressure_advance: 0,
  pressure_advance_model: 'tanh',
  linearization_velocity: 2,
  pressure_advance_smooth_time: 0.02,
  nonlinear_offset: 0.245,
  linear_advance: 0.01,
  pressure_advance_time_offset: 0.002,
}

describe('pressureAdvanceSettings', () => {
  it('labels a setting with its own name, readable and otherwise unchanged', () => {
    // The identifiers the user typed into printer.cfg, so what the card says
    // and what they can search their own config for stay the same words.
    expect(formatPressureAdvanceLabel('nonlinear_offset')).toBe('Nonlinear Offset')
    expect(formatPressureAdvanceLabel('linearization_velocity')).toBe('Linearization Velocity')
  })

  /*
   * The block is headed "Pressure advance model", so four labels restating that
   * prefix wrapped to a second line each in a dashboard column and said nothing
   * the heading had not. What is left is still the identifier's own words, so
   * "Time Offset" is findable as `pressure_advance_time_offset`.
   */
  it('elides the prefix the block heading already states', () => {
    expect(formatPressureAdvanceLabel('pressure_advance_model')).toBe('Model')
    expect(formatPressureAdvanceLabel('pressure_advance_time_offset')).toBe('Time Offset')
    expect(formatPressureAdvanceLabel('pressure_advance_smooth_time')).toBe('Smooth Time')
  })

  /*
   * Only the prefix carrying a trailing underscore is stripped. The bare key is
   * the scalar every guide calls "pressure advance", and reducing it to an empty
   * label to satisfy the rule above would be the rule misapplied.
   */
  it('keeps the bare key labelled in full', () => {
    expect(formatPressureAdvanceLabel('pressure_advance')).toBe('Pressure Advance')
    expect(formatPressureAdvanceLabel('pressure_advance_')).toBe('Pressure Advance')
  })

  it('detects the model from the configuration, never from a firmware name', () => {
    expect(hasNonlinearPressureAdvance(kalicoExtruder)).toBe(true)
    expect(hasNonlinearPressureAdvance(klipperExtruder)).toBe(false)
    expect(hasNonlinearPressureAdvance(null)).toBe(false)
  })

  it('reads only the pressure advance settings, leaving the rest of the section alone', () => {
    const settings = readPressureAdvanceSettings(klipperExtruder)
    expect(settings.map((setting) => setting.key)).toEqual([
      'pressure_advance',
      'pressure_advance_smooth_time',
    ])
    expect(settings[0]?.value).toBe('0.045')
  })

  it('orders the model first and its coefficients under it', () => {
    expect(readPressureAdvanceSettings(kalicoExtruder).map((setting) => setting.key)).toEqual([
      'pressure_advance_model',
      'pressure_advance',
      'linear_advance',
      'nonlinear_offset',
      'linearization_velocity',
      'pressure_advance_time_offset',
      'pressure_advance_smooth_time',
    ])
  })

  /*
   * The point of matching a shape rather than keeping a list: a firmware that
   * adds a coefficient renders it without a release here. A hardcoded Kalico
   * field list would silently hide it, which is the failure this whole module
   * is written to avoid.
   */
  it('renders a pressure advance key nobody anticipated, after the ones it knows', () => {
    const settings = readPressureAdvanceSettings({
      ...kalicoExtruder,
      pressure_advance_future_term: 0.5,
    })
    expect(settings.at(-1)).toEqual({
      key: 'pressure_advance_future_term',
      label: 'Future Term',
      value: '0.5',
    })
  })

  it('renders values as the machine wrote them, so the card and printer.cfg agree', () => {
    const settings = readPressureAdvanceSettings(kalicoExtruder)
    const byKey = Object.fromEntries(settings.map((setting) => [setting.key, setting.value]))
    expect(byKey.pressure_advance_model).toBe('tanh')
    expect(byKey.nonlinear_offset).toBe('0.245')
    expect(byKey.linearization_velocity).toBe('2')
  })

  it('drops a value it cannot state rather than printing a placeholder as data', () => {
    const settings = readPressureAdvanceSettings({
      pressure_advance: null,
      pressure_advance_smooth_time: 0.04,
      pressure_advance_model: '  ',
    })
    expect(settings.map((setting) => setting.key)).toEqual(['pressure_advance_smooth_time'])
  })

  it('has nothing to say before the configuration has loaded', () => {
    expect(readPressureAdvanceSettings(null)).toEqual([])
    expect(readPressureAdvanceSettings({})).toEqual([])
  })
})
