import { describe, expect, it } from 'vitest'

import type { ProcedureResultRow } from '@/features/calibration/procedures'
import { sparklinePoints, trendSeries, type TrendEntry } from '@/features/calibration/trends'

function accuracy(range: string, deviation?: string): TrendEntry {
  const rows: ProcedureResultRow[] = [{ label: { key: 'calibration.probe.range' }, after: range }]
  if (deviation !== undefined) {
    rows.push({ label: { key: 'calibration.probe.standardDeviation' }, after: deviation })
  }
  return { values: {}, rows, outcome: 'measured' }
}

describe('trends from the log', () => {
  it('draws a series only once three runs have reported it', () => {
    expect(trendSeries('probeAccuracy', [accuracy('0.01'), accuracy('0.02')])).toEqual([])
    expect(
      trendSeries('probeAccuracy', [accuracy('0.01'), accuracy('0.02'), accuracy('0.015')]),
    ).toEqual([{ label: { key: 'calibration.probe.range' }, values: [0.01, 0.02, 0.015] }])
  })

  it('skips a run without the row, and a failed one, rather than drawing a gap', () => {
    const entries: TrendEntry[] = [
      accuracy('0.01', '0.004'),
      { values: {}, rows: [], outcome: 'failed' },
      accuracy('0.02'),
      {
        values: {},
        rows: [{ label: { key: 'calibration.probe.range' }, after: '' }],
        outcome: 'measured',
      },
      accuracy('0.03', '0.005'),
      accuracy('0.02', '0.003'),
    ]
    expect(trendSeries('probeAccuracy', entries)).toEqual([
      { label: { key: 'calibration.probe.range' }, values: [0.01, 0.02, 0.03, 0.02] },
      { label: { key: 'calibration.probe.standardDeviation' }, values: [0.004, 0.005, 0.003] },
    ])
  })

  it('reads the number a row starts with, past its unit', () => {
    const mesh = (range: string): TrendEntry => ({
      values: {},
      rows: [{ label: { key: 'calibration.result.range' }, after: range }],
      outcome: 'staged',
    })
    expect(trendSeries('bedMesh', [mesh('0.144 mm'), mesh('0.150 mm'), mesh('0.139 mm')])).toEqual([
      { label: { key: 'calibration.result.range' }, values: [0.144, 0.15, 0.139] },
    ])
  })

  it('keeps a heater model series to the heater the newest run tuned', () => {
    const pid = (heater: string, kp: string): TrendEntry => ({
      values: { HEATER: heater },
      rows: [
        { label: { literal: 'pid_Kp' }, after: kp },
        { label: { literal: 'pid_Ki' }, after: '1' },
        { label: { literal: 'pid_Kd' }, after: '100' },
      ],
      outcome: 'staged',
    })
    const entries = [
      pid('extruder', '20'),
      pid('heater_bed', '60'),
      pid('extruder', '21'),
      pid('heater_bed', '61'),
      pid('extruder', '22'),
      pid('heater_bed', '62'),
    ]
    expect(trendSeries('heaterModel', entries).map((series) => series.values)).toEqual([
      [60, 61, 62],
      [1, 1, 1],
      [100, 100, 100],
    ])
    // A procedure with nothing worth drawing draws nothing, whatever it logged.
    expect(trendSeries('probeZOffset', entries)).toEqual([])
  })

  it('spreads runs across the box, oldest at the left, and a flat series through the middle', () => {
    expect(sparklinePoints([1, 3, 2], 80, 16, 2)).toEqual([
      { x: 2, y: 14 },
      { x: 40, y: 2 },
      { x: 78, y: 8 },
    ])
    expect(sparklinePoints([5, 5, 5], 80, 16, 2).map((point) => point.y)).toEqual([8, 8, 8])
    expect(sparklinePoints([], 80, 16, 2)).toEqual([])
  })
})
