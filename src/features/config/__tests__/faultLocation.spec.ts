import { describe, expect, it } from 'vitest'

import { faultReference, locateFault } from '@/features/config/faultLocation'
import { indexConfig } from '@/features/config/optionLocator'

function index(files: Record<string, string>) {
  const map = new Map(Object.entries(files))
  return indexConfig('printer.cfg', map, map.keys())
}

describe('faultReference', () => {
  it('reads the section from an unknown-section error, with its span in the message', () => {
    const message =
      "Section 'autotune_tmc extruder' is not a valid config section\n\nOnce the underlying issue is corrected…"
    const reference = faultReference(message)
    expect(reference).toMatchObject({ section: 'autotune_tmc extruder', option: null })
    expect(message.slice(reference!.start, reference!.end)).toBe('autotune_tmc extruder')
  })

  it('reads the option alongside the section in each of Klipper option-error shapes', () => {
    expect(
      faultReference("Option 'rotation_dist' is not valid in section 'extruder'"),
    ).toMatchObject({ section: 'extruder', option: 'rotation_dist' })
    expect(
      faultReference("Option 'max_temp' in section 'heater_bed' must be specified"),
    ).toMatchObject({ section: 'heater_bed', option: 'max_temp' })
    expect(
      faultReference(
        "Choice 'bogus' for option 'sensor_type' in section 'extruder' is not a valid choice",
      ),
    ).toMatchObject({ section: 'extruder', option: 'sensor_type' })
  })

  it('finds nothing in a fault that names no section', () => {
    expect(faultReference("MCU 'mcu' shutdown: ADC out of range")).toBeNull()
    expect(faultReference('Option not valid in section')).toBeNull()
  })
})

describe('locateFault', () => {
  const config = index({
    'printer.cfg': ['[include hardware.cfg]', '', '[extruder]', 'rotation_distance: 22'].join('\n'),
    'hardware.cfg': [
      '[stepper_x]',
      'step_pin: PA1',
      '',
      '[autotune_tmc extruder]',
      'motor: x',
    ].join('\n'),
  })

  it('finds a section in the included file that holds it', () => {
    const reference = faultReference(
      "Section 'autotune_tmc extruder' is not a valid config section",
    )
    expect(locateFault(config, reference!)).toEqual({ path: 'hardware.cfg', line: 3 })
  })

  it("lands on the option's own line when it is written down", () => {
    const reference = faultReference(
      "Option 'rotation_distance' is not valid in section 'extruder'",
    )
    expect(locateFault(config, reference!)).toEqual({ path: 'printer.cfg', line: 3 })
  })

  it('falls back to the section header for an option that is missing', () => {
    const reference = faultReference("Option 'dir_pin' in section 'stepper_x' must be specified")
    expect(locateFault(config, reference!)).toEqual({ path: 'hardware.cfg', line: 0 })
  })

  it('matches the section without case, as Klipper reports it lowered', () => {
    const reference = faultReference(
      "Section 'Autotune_TMC extruder' is not a valid config section",
    )
    expect(locateFault(config, reference!)).toEqual({ path: 'hardware.cfg', line: 3 })
  })

  it('has no location for a section the config does not hold', () => {
    const reference = faultReference("Section 'missing' is not a valid config section")
    expect(locateFault(config, reference!)).toBeNull()
  })
})
