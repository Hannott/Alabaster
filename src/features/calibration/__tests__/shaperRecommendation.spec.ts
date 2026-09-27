import { describe, expect, it } from 'vitest'

import {
  latestShaperRecommendations,
  setInputShaperCommand,
} from '@/features/calibration/shaperRecommendation'

/** A two-axis v5/v6 run, line for line as `respond_info` delivers it. */
const twoAxisRun = [
  'AXES_SHAPER_CALIBRATION',
  '// Measuring axis_X...',
  '// X axis frequency profile generation...',
  '// This may take some time (1-3min)',
  '// Peaks detected on the graph: 2 @ 46.2, 88.0 Hz (1 above effect threshold)',
  '// Recommended filters:',
  '//     -> For performance: MZV @ 48.2 Hz (with a damping ratio of 0.052)',
  '//     -> For low vibrations: EI @ 52.0 Hz (with a damping ratio of 0.052)',
  '// Measuring axis_Y...',
  '// Y axis frequency profile generation...',
  '// Recommended filters:',
  '//     -> Best shaper: ZV @ 39.6 Hz (with a damping ratio of 0.061)',
]

describe('shaper recommendations', () => {
  it('reads every recommendation and names its axis from the line before it', () => {
    expect(latestShaperRecommendations(twoAxisRun)).toEqual([
      { axis: 'x', kind: 'performance', shaperType: 'mzv', frequency: 48.2 },
      { axis: 'x', kind: 'lowVibrations', shaperType: 'ei', frequency: 52 },
      { axis: 'y', kind: 'best', shaperType: 'zv', frequency: 39.6 },
    ])
  })

  it("reads Shake&Tune v4's single recommendation line", () => {
    const lines = [
      'AXES_SHAPER_CALIBRATION AXIS=X',
      '// X axis frequency profile generation...',
      '// ',
      '// -> Recommended shaper is MZV @ 47.4 Hz (when using a square corner velocity of 5.0 and a damping ratio of 0.100)',
    ]
    expect(latestShaperRecommendations(lines)).toEqual([
      { axis: 'x', kind: 'best', shaperType: 'mzv', frequency: 47.4 },
    ])
  })

  it('takes the axis from the command when only one axis was measured', () => {
    const lines = ['AXES_SHAPER_CALIBRATION AXIS=y', '//     -> Best shaper: MZV @ 41.0 Hz']
    expect(latestShaperRecommendations(lines)).toEqual([
      { axis: 'y', kind: 'best', shaperType: 'mzv', frequency: 41 },
    ])
  })

  /**
   * A recommendation with no axis to attach it to is dropped rather than
   * guessed: applying X's shaper to Y is worse than offering nothing.
   */
  it('drops a recommendation whose axis is unknown', () => {
    const lines = ['AXES_SHAPER_CALIBRATION', '//     -> Best shaper: MZV @ 41.0 Hz']
    expect(latestShaperRecommendations(lines)).toEqual([])
  })

  it("never mixes an older run's result into a newer run still measuring", () => {
    const lines = [...twoAxisRun, 'AXES_SHAPER_CALIBRATION', '// Measuring axis_X...']
    expect(latestShaperRecommendations(lines)).toEqual([])
  })

  it('reports nothing before any run', () => {
    expect(latestShaperRecommendations(['G28', '// ok'])).toEqual([])
  })

  it('builds the until-restart command, and refuses values that are not a shaper', () => {
    expect(
      setInputShaperCommand({ axis: 'x', kind: 'best', shaperType: 'mzv', frequency: 48.2 }),
    ).toBe('SET_INPUT_SHAPER SHAPER_TYPE_X=mzv SHAPER_FREQ_X=48.2')
    expect(
      setInputShaperCommand({ axis: 'y', kind: 'best', shaperType: 'mzv; G28', frequency: 48.2 }),
    ).toBeNull()
    expect(
      setInputShaperCommand({ axis: 'y', kind: 'best', shaperType: 'mzv', frequency: 0 }),
    ).toBeNull()
  })
})
