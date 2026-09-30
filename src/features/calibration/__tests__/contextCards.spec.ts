import { describe, expect, it } from 'vitest'

import {
  defaultShaperPicks,
  parseShakeTuneShaper,
  parseShaperCalibrate,
  shaperActionsFor,
} from '@/features/calibration/procedures'
import { shaperFits } from '@/features/calibration/shaperFits'
import { planDirectionKey, stepperMotion } from '@/features/calibration/stepperMotion'

/** `shaper_calibrate.py` and `resonance_tester.py`, as they print one axis. */
function axisOutput(axis: 'x' | 'y', recommended: string): string[] {
  return [
    `Fitted shaper 'zv' frequency = 58.2 Hz (vibrations = 6.9%, smoothing ~= 0.041)`,
    `To avoid too much smoothing with 'zv', suggested max_accel <= 14600 mm/sec^2`,
    `Fitted shaper 'mzv' frequency = 53.8 Hz (vibrations = 1.6%, smoothing ~= 0.050)`,
    `To avoid too much smoothing with 'mzv', suggested max_accel <= 12000 mm/sec^2`,
    `Fitted shaper 'ei' frequency = 64.4 Hz (vibrations = 1.0%, smoothing ~= 0.062)`,
    `To avoid too much smoothing with 'ei', suggested max_accel <= 9700 mm/sec^2`,
    `Recommended shaper_type_${axis} = ${recommended}, shaper_freq_${axis} = 53.8 Hz`,
  ]
}

describe('shaperFits', () => {
  it('reads every fit of each axis with its suggested acceleration', () => {
    const [x, y] = shaperFits([...axisOutput('x', 'mzv'), ...axisOutput('y', 'ei')])
    expect(x).toMatchObject({ axis: 'x', recommended: 'mzv' })
    expect(x!.fits.map((fit) => fit.name)).toEqual(['zv', 'mzv', 'ei'])
    expect(x!.fits[1]).toEqual({
      name: 'mzv',
      frequency: 53.8,
      vibrations: 1.6,
      smoothing: 0.05,
      maxAccel: 12000,
    })
    expect(y).toMatchObject({ axis: 'y', recommended: 'ei' })
  })

  it('keeps the newest run of an axis, and leaves out fits no axis claimed', () => {
    const fits = shaperFits([
      ...axisOutput('x', 'zv'),
      ...axisOutput('x', 'mzv'),
      `Fitted shaper 'zv' frequency = 40.0 Hz (vibrations = 9.0%, smoothing ~= 0.090)`,
    ])
    expect(fits).toHaveLength(1)
    expect(fits[0]!.recommended).toBe('mzv')
    expect(fits[0]!.fits).toHaveLength(3)
  })

  it('reads a console entry holding several lines', () => {
    expect(shaperFits([axisOutput('x', 'mzv').join('\n')])).toHaveLength(1)
  })
})

describe('stepperMotion', () => {
  it('moves a Cartesian stepper along its own axis', () => {
    expect(stepperMotion('stepper_x', 'cartesian')).toEqual({ kind: 'plan', x: 1, y: 0 })
    expect(stepperMotion('stepper_y', 'cartesian')).toEqual({ kind: 'plan', x: 0, y: 1 })
    expect(stepperMotion('stepper_z1', 'cartesian')).toEqual({ kind: 'z', index: 1 })
  })

  it('moves a CoreXY motor diagonally, by Klipper’s rails', () => {
    const a = stepperMotion('stepper_x', 'corexy')
    const b = stepperMotion('stepper_y', 'corexy')
    expect(a).toMatchObject({ kind: 'plan' })
    expect(b).toMatchObject({ kind: 'plan' })
    if (a?.kind !== 'plan' || b?.kind !== 'plan') return
    expect(a.x).toBeGreaterThan(0)
    expect(a.y).toBeGreaterThan(0)
    expect(b.x).toBeGreaterThan(0)
    expect(b.y).toBeLessThan(0)
    expect(planDirectionKey(a.x, a.y)).toBe('calibration.context.motion.direction.backRight')
    expect(planDirectionKey(b.x, b.y)).toBe('calibration.context.motion.direction.frontRight')
  })

  it('names delta towers, extruders, and nothing it cannot draw', () => {
    expect(stepperMotion('stepper_b', 'delta')).toEqual({ kind: 'tower', tower: 'b' })
    expect(stepperMotion('extruder', 'corexy')).toEqual({ kind: 'extruder' })
    expect(stepperMotion('stepper_x', 'hybrid_corexy')).toBeNull()
    expect(stepperMotion('stepper_x', null)).toBeNull()
  })

  it('names straight moves by their side', () => {
    expect(planDirectionKey(1, 0)).toBe('calibration.context.motion.direction.right')
    expect(planDirectionKey(0, 1)).toBe('calibration.context.motion.direction.back')
  })
})

describe('shaper choices', () => {
  const shakeTuneLines = [
    'X axis frequency profile generation...',
    '-> For performance: MZV @ 48.2 Hz (with a damping ratio of 0.052)',
    '-> For low vibrations: EI @ 52.0 Hz (with a damping ratio of 0.052)',
    'Y axis frequency profile generation...',
    '-> Best shaper: MZV @ 40.0 Hz',
  ]

  it('offers both of Shake&Tune’s picks and starts from the one for performance', () => {
    const result = parseShakeTuneShaper(shakeTuneLines)!
    const candidates = result.shaperCandidates!
    expect(candidates.filter((candidate) => candidate.axis === 'x')).toHaveLength(2)
    expect(defaultShaperPicks(candidates).x).toMatchObject({
      shaperType: 'mzv',
      kind: 'performance',
    })
  })

  it('offers every shaper Klipper fitted, recommended first', () => {
    const result = parseShaperCalibrate(axisOutput('x', 'mzv'), {})!
    expect(result.shaperCandidates!.map((candidate) => candidate.shaperType)).toEqual([
      'zv',
      'mzv',
      'ei',
    ])
    expect(defaultShaperPicks(result.shaperCandidates!).x?.shaperType).toBe('mzv')
  })

  it('applies and saves the shapers the reader chose', () => {
    const actions = shaperActionsFor([
      { axis: 'y', shaperType: 'mzv', frequency: 40 },
      { axis: 'x', shaperType: 'ei', frequency: 52 },
    ])
    expect(actions[0]).toMatchObject({
      kind: 'gcode',
      command:
        'SET_INPUT_SHAPER SHAPER_TYPE_X=ei SHAPER_FREQ_X=52 SHAPER_TYPE_Y=mzv SHAPER_FREQ_Y=40',
    })
    expect(actions[1]).toMatchObject({
      kind: 'persist',
      changes: [
        { option: 'shaper_type_x', value: 'ei' },
        { option: 'shaper_freq_x', value: '52' },
        { option: 'shaper_type_y', value: 'mzv' },
        { option: 'shaper_freq_y', value: '40' },
      ],
    })
  })
})
