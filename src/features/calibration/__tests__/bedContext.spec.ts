import { describe, expect, it } from 'vitest'

import {
  levelingLayout,
  onPlan,
  planBox,
  probeSamples,
  probeSummaryOf,
  readPoints,
  sampleScale,
  summarize,
} from '@/features/calibration/bedContext'

describe('probeSamples', () => {
  it('reads both of the sample lines Klipper has printed', () => {
    expect(
      probeSamples([
        'PROBE_ACCURACY at X:150.000 Y:150.000 Z:10.000 (samples=3 retract=2.000 speed=5.0 lift_speed=5.0)',
        '// probe at 150.000,150.000 is z=1.987500',
        'probe: at 150.000,150.000 bed will contact at z=1.990000',
        '// probe accuracy results: maximum 1.990000, minimum 1.987500, range 0.002500, average 1.988750, median 1.988750, standard deviation 0.001250',
      ]),
    ).toEqual([1.9875, 1.99])
  })

  it('reads samples out of a multi-line console entry', () => {
    expect(probeSamples(['probe at 1,2 is z=0.5\nprobe at 1,2 is z=0.6'])).toEqual([0.5, 0.6])
  })
})

describe('probe summaries', () => {
  it('summarizes samples as the logged result does', () => {
    const summary = summarize([1, 2, 3, 4])!
    expect(summary.minimum).toBe(1)
    expect(summary.maximum).toBe(4)
    expect(summary.average).toBe(2.5)
    expect(summary.median).toBe(2.5)
    expect(summary.standardDeviation).toBeCloseTo(1.118, 3)
    expect(summarize([])).toBeNull()
  })

  it('reads a logged run back by its row keys', () => {
    const row = (name: string, after: string) => ({
      label: { key: `calibration.probe.${name}` },
      after,
    })
    expect(
      probeSummaryOf({
        rows: [row('maximum', '1.99'), row('minimum', '1.98'), row('average', '1.985')],
      }),
    ).toEqual({
      maximum: 1.99,
      minimum: 1.98,
      average: 1.985,
      median: null,
      standardDeviation: null,
    })
    expect(probeSummaryOf({ rows: [] })).toBeNull()
    expect(probeSummaryOf(undefined)).toBeNull()
  })

  it('stretches the spread to the plot, but never below the floor', () => {
    const wide = sampleScale({
      maximum: 2,
      minimum: 1,
      average: null,
      median: null,
      standardDeviation: null,
    })
    expect(wide.at(2)).toBeGreaterThan(0)
    expect(wide.at(1)).toBeLessThan(1)
    expect(wide.at(2)).toBeLessThan(wide.at(1))

    const tight = sampleScale({
      maximum: 1.0001,
      minimum: 1,
      average: null,
      median: null,
      standardDeviation: null,
    })
    expect(tight.top - tight.bottom).toBeCloseTo(0.012, 6)
  })
})

describe('levelling layouts', () => {
  it('reads point lists as parsed settings or as raw text', () => {
    expect(
      readPoints([
        [0, 0],
        [10, 5],
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
    ])
    expect(readPoints('\n0, 0\n10, 5')).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
    ])
    expect(readPoints([3, 4])).toEqual([{ x: 3, y: 4 }])
    expect(readPoints(null)).toEqual([])
  })

  it('takes z_tilt pivots as they are listed', () => {
    expect(
      levelingLayout('zTilt', {
        z_positions: [
          [-50, 18],
          [125, 298],
          [300, 18],
        ],
        points: [
          [30, 5],
          [125, 195],
          [220, 5],
        ],
      }),
    ).toEqual({
      steppers: [
        { x: -50, y: 18 },
        { x: 125, y: 298 },
        { x: 300, y: 18 },
      ],
      points: [
        { x: 30, y: 5 },
        { x: 125, y: 195 },
        { x: 220, y: 5 },
      ],
    })
  })

  it('derives a quad gantry’s four steppers in Klipper’s order', () => {
    expect(
      levelingLayout('quadGantryLevel', {
        gantry_corners: [
          [360, -10],
          [-60, 370],
        ],
        points: [],
      })?.steppers,
    ).toEqual([
      { x: -60, y: -10 },
      { x: -60, y: 370 },
      { x: 360, y: 370 },
      { x: 360, y: -10 },
    ])
    expect(levelingLayout('zTilt', null)).toBeNull()
  })
})

describe('plan geometry', () => {
  it('grows the plan to take in marks off the bed, and puts the rear at the top', () => {
    const box = planBox({ minimum: [0, 0, 0], maximum: [200, 100, 200] }, [{ x: -50, y: 50 }])!
    expect(box.minimumX).toBeLessThan(-50)
    expect(box.minimumX + box.width).toBeGreaterThan(200)
    expect(onPlan({ x: 0, y: 100 }, box).y).toBeLessThan(onPlan({ x: 0, y: 0 }, box).y)
  })

  it('has no plan without a bed or anything on it', () => {
    expect(planBox({ minimum: [null, null], maximum: [null, null] }, [])).toBeNull()
  })
})
