import { describe, expect, it } from 'vitest'

import {
  availableCalibrationStages,
  resolveCalibrationStage,
  type CalibrationCapabilities,
} from '@/features/calibration/stages'

function capabilities(overrides: Partial<CalibrationCapabilities> = {}): CalibrationCapabilities {
  return {
    hasBedMesh: false,
    hasProbe: false,
    hasLeveling: false,
    hasCalibratableHeater: false,
    hasResonance: false,
    hasExtruder: false,
    hasRunoutSensors: false,
    ...overrides,
  }
}

describe('availableCalibrationStages', () => {
  /**
   * The destination itself is ungated for this reason, and the rail has to
   * follow it: endstops exist on any machine with steppers, so a printer with
   * no probe, no accelerometer and no heater worth calibrating still has a job
   * here.
   */
  it('always offers the axes stage, on a machine that reports nothing else', () => {
    expect(availableCalibrationStages(capabilities())).toEqual(['axes'])
  })

  /**
   * Three different pieces of hardware answer the same sitting, and any one of
   * them is enough: a printer with bed screws and no probe still levels a bed,
   * and a printer with a probe and no `bed_mesh` still measures repeatability.
   */
  it.each([['hasBedMesh'], ['hasProbe'], ['hasLeveling']] as const)(
    'offers the bed stage on %s alone',
    (capability) => {
      expect(availableCalibrationStages(capabilities({ [capability]: true }))).toContain('bed')
    },
  )

  it('offers the heaters stage only where a heater has constants to fit', () => {
    expect(availableCalibrationStages(capabilities())).not.toContain('heaters')
    expect(availableCalibrationStages(capabilities({ hasCalibratableHeater: true }))).toContain(
      'heaters',
    )
  })

  it('offers the extrusion stage for an extruder or for filament sensors alone', () => {
    expect(availableCalibrationStages(capabilities({ hasExtruder: true }))).toContain('extrusion')
    expect(availableCalibrationStages(capabilities({ hasRunoutSensors: true }))).toContain(
      'extrusion',
    )
  })

  /**
   * The order is the order the physical dependencies run, not the order the
   * capabilities happened to be discovered in — the frame is squared before the
   * bed is mapped, and the bed is mapped before a resonance peak is chased.
   */
  it('keeps the dependency order whatever the machine reports', () => {
    const stages = availableCalibrationStages(
      capabilities({
        hasBedMesh: true,
        hasCalibratableHeater: true,
        hasResonance: true,
        hasExtruder: true,
      }),
    )
    expect(stages).toEqual(['axes', 'bed', 'heaters', 'resonance', 'extrusion'])
  })
})

describe('resolveCalibrationStage', () => {
  it('takes the requested stage when the machine offers it', () => {
    expect(resolveCalibrationStage('resonance', ['axes', 'resonance'])).toBe('resonance')
  })

  /**
   * A bookmark made on a printer with a probe, opened on one without, is a
   * stale link — not an error worth a message, and certainly not a reason to
   * render an empty canvas.
   */
  it('falls back to the first available stage for one this machine cannot do', () => {
    expect(resolveCalibrationStage('bed', ['axes'])).toBe('axes')
  })

  it('falls back for a query that is missing, repeated, or nonsense', () => {
    expect(resolveCalibrationStage(undefined, ['axes', 'bed'])).toBe('axes')
    expect(resolveCalibrationStage(['bed', 'axes'], ['axes', 'bed'])).toBe('axes')
    expect(resolveCalibrationStage('sharpening', ['axes', 'bed'])).toBe('axes')
  })
})
