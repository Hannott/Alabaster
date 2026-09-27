import { describe, expect, it } from 'vitest'

import {
  axisLetter,
  axisSteppers,
  beltRotationDistance,
  companionSteppers,
  driveGearRotationDistance,
  gearRatioFactor,
  gearRatioText,
  leadScrewRotationDistance,
  likelyDrive,
  measuredRotationDistance,
  motionResolution,
  stepAngleFor,
  stepperDrive,
  suggestedFullSteps,
} from '@/features/calibration/axisRotation'

describe('rotation distance from the hardware', () => {
  it('is belt pitch times pulley teeth', () => {
    expect(beltRotationDistance(2, 20)).toBe(40)
    expect(beltRotationDistance(2, 16)).toBe(32)
    expect(beltRotationDistance(2, 20.5)).toBeNull()
    expect(beltRotationDistance(0, 20)).toBeNull()
  })

  it('is screw pitch times thread starts', () => {
    expect(leadScrewRotationDistance(2, 4)).toBe(8)
    expect(leadScrewRotationDistance(2, 1)).toBe(2)
    expect(leadScrewRotationDistance(2, 0)).toBeNull()
  })

  it('is the drive gear circumference at its effective diameter', () => {
    expect(driveGearRotationDistance(7.22)).toBeCloseTo(22.68, 2)
    expect(driveGearRotationDistance(-1)).toBeNull()
  })
})

describe('gear ratio', () => {
  it('multiplies its stages, in either form the config gives it', () => {
    expect(gearRatioFactor('80:20')).toBe(4)
    expect(gearRatioFactor('57:11, 2:1')).toBeCloseTo((57 / 11) * 2)
    expect(gearRatioFactor([[50, 17]])).toBeCloseTo(50 / 17)
    expect(gearRatioFactor(undefined)).toBe(1)
    expect(gearRatioFactor('')).toBe(1)
    expect(gearRatioFactor('50/17')).toBeNull()
    expect(gearRatioFactor('50:0')).toBeNull()
  })

  it('reads back as the file spells it', () => {
    expect(gearRatioText([[50, 17]])).toBe('50:17')
    expect(
      gearRatioText([
        [57.0, 11.0],
        [2, 1],
      ]),
    ).toBe('57:11, 2:1')
    expect(gearRatioText(' 80:20 ')).toBe('80:20')
    expect(gearRatioText(undefined)).toBe('')
  })
})

describe('the step angle', () => {
  it('lives in full_steps_per_rotation, defaulting to a 1.8° motor', () => {
    expect(stepperDrive({ rotation_distance: 40, microsteps: 16 })).toEqual({
      rotationDistance: 40,
      gearRatio: '',
      fullSteps: 200,
      microsteps: 16,
    })
    expect(stepAngleFor(200)).toBe('1.8')
    expect(stepAngleFor(400)).toBe('0.9')
    expect(stepAngleFor(48)).toBeNull()
  })

  it('doubles steps per mm and halves travel per step, with the same rotation distance', () => {
    const coarse = motionResolution({
      rotationDistance: 40,
      gearRatio: '',
      fullSteps: 200,
      microsteps: 16,
    })
    const fine = motionResolution({
      rotationDistance: 40,
      gearRatio: '',
      fullSteps: 400,
      microsteps: 16,
    })
    expect(coarse?.stepsPerMm).toBe(80)
    expect(coarse?.fullStepMm).toBe(0.2)
    expect(fine?.stepsPerMm).toBe(160)
    expect(fine?.fullStepMm).toBe(0.1)
  })

  it('counts the gear ratio into steps per mm', () => {
    expect(
      motionResolution({ rotationDistance: 8, gearRatio: '2:1', fullSteps: 200, microsteps: 16 })
        ?.stepsPerMm,
    ).toBe(800)
    expect(
      motionResolution({ rotationDistance: 8, gearRatio: '', fullSteps: 200, microsteps: null })
        ?.stepsPerMm,
    ).toBeNull()
  })
})

describe('a measured move', () => {
  it("scales rotation distance by Klipper's actual over commanded", () => {
    expect(measuredRotationDistance(8, 100, 102)).toBeCloseTo(8.16)
    expect(measuredRotationDistance(8, 100, 0)).toBeNull()
  })

  it('points at the step angle, not the pulley, when it is off by a factor of two', () => {
    expect(suggestedFullSteps(200, 10, 5)).toBe(400)
    expect(suggestedFullSteps(200, 10, 5.1)).toBe(400)
    expect(suggestedFullSteps(400, 10, 20)).toBe(200)
    expect(suggestedFullSteps(200, 10, 10.2)).toBeNull()
    expect(suggestedFullSteps(400, 10, 5)).toBeNull()
    expect(suggestedFullSteps(200, 10, 20)).toBeNull()
  })
})

describe('steppers', () => {
  const sections = ['printer', 'stepper_x', 'stepper_y', 'stepper_z', 'stepper_z1', 'extruder']

  it('lists the axis steppers, not the extruder', () => {
    expect(axisSteppers(sections)).toEqual(['stepper_x', 'stepper_y', 'stepper_z', 'stepper_z1'])
  })

  it('writes the Z motors together, and a CoreXY pair together', () => {
    expect(companionSteppers('stepper_z', sections, 'cartesian')).toEqual(['stepper_z1'])
    expect(companionSteppers('stepper_x', sections, 'corexy')).toEqual(['stepper_y'])
    expect(companionSteppers('stepper_x', sections, 'cartesian')).toEqual([])
  })

  it('measures a single axis only where one stepper moves it', () => {
    expect(axisLetter('stepper_z1', 'cartesian')).toBe('Z')
    expect(axisLetter('stepper_a', 'delta')).toBeNull()
  })

  it('guesses a screw for Z and a belt elsewhere', () => {
    expect(likelyDrive('stepper_z', 'corexy')).toBe('leadScrew')
    expect(likelyDrive('stepper_z', 'corexz')).toBe('belt')
    expect(likelyDrive('stepper_y', 'cartesian')).toBe('belt')
    expect(likelyDrive('extruder', null)).toBe('driveGear')
  })
})
