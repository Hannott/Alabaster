import { describe, expect, it } from 'vitest'

import {
  buildTowerScript,
  macroRangeWords,
  matchesStart,
  nextTower,
  rangeAround,
  readingFromValues,
  readingToValues,
  readNpaConfig,
  sessionPath,
  sessionReadings,
  startingChanges,
  suggestFor,
  valueAtHeight,
  type NpaReading,
} from '@/features/calibration/nonlinearPressureAdvance'

function reading(overrides: Partial<NpaReading>): NpaReading {
  return {
    at: 1,
    path: 'direct',
    tower: 'offset',
    range: { from: 0, to: 0.25 },
    towerHeight: 50,
    side: null,
    front: null,
    linearAdvance: 0,
    nonlinearOffset: 0,
    ...overrides,
  }
}

describe('tower range', () => {
  /*
   * The guide macro's arithmetic, restated: PA_VALUE - PA_RANGE <= 0 starts at
   * zero with a span of PA_RANGE; otherwise it sweeps PA_VALUE ± PA_RANGE.
   */
  function macroSweep(value: number, range: number): { start: number; span: number } {
    if (value - range <= 0) return { start: 0, span: range }
    return { start: value - range, span: 2 * range }
  }

  it('sweeps exactly From–To through the guide macro', () => {
    for (const range of [
      { from: 0, to: 0.5 },
      { from: 0.08, to: 0.16 },
      { from: 0.001, to: 0.004 },
    ]) {
      const words = macroRangeWords(range)
      const sweep = macroSweep(words.value, words.range)
      expect(sweep.start).toBeCloseTo(range.from, 9)
      expect(sweep.start + sweep.span).toBeCloseTo(range.to, 9)
    }
  })

  it('reads a height back into the value the tower printed there', () => {
    // The guide's SV06 example: 27 mm on a 0.005 mm⁻¹ offset tower is 0.135.
    expect(valueAtHeight({ from: 0, to: 0.25 }, 50, 27)).toBeCloseTo(0.135, 9)
    expect(valueAtHeight({ from: 0.1, to: 0.2 }, 50, 60)).toBe(0.2)
    expect(valueAtHeight({ from: 0.1, to: 0.2 }, 50, -3)).toBe(0.1)
  })

  it('centres a second look on the value found', () => {
    expect(rangeAround('offset', 0.12)).toEqual({ from: 0.08, to: 0.16 })
  })

  it('builds the RUN_PA_TEST line, and refuses one it cannot build', () => {
    expect(
      buildTowerScript({
        tower: 'advance',
        range: { from: 0, to: 0.05 },
        nozzle: 0.4,
        targetTemp: 215,
        bedTemp: 60,
      }),
    ).toBe(
      'RUN_PA_TEST NOZZLE=0.4 TARGET_TEMP=215 BED_TEMP=60 TESTPARAM=0 PA_VALUE=0.05 PA_RANGE=0.05',
    )
    expect(
      buildTowerScript({
        tower: 'offset',
        range: { from: 0.2, to: 0.1 },
        nozzle: 0.4,
        targetTemp: 215,
        bedTemp: 60,
      }),
    ).toBeNull()
    expect(
      buildTowerScript({
        tower: 'offset',
        range: { from: 0, to: 0.1 },
        nozzle: 0,
        targetTemp: 215,
        bedTemp: 60,
      }),
    ).toBeNull()
  })
})

describe('config', () => {
  it('reads the model and its coefficients', () => {
    const config = readNpaConfig({
      pressure_advance_model: 'recipr',
      linear_advance: 0.017,
      nonlinear_offset: 0.12,
      linearization_velocity: 1,
      pressure_advance_smooth_time: 0.02,
      pressure_advance_time_offset: 0.0018,
    })
    expect(config).toMatchObject({
      model: 'recipr',
      linearAdvance: 0.017,
      nonlinearOffset: 0.12,
      timeOffset: 0.0018,
      hasLinearAdvanceOption: false,
    })
  })

  it('knows the starting values, and that a linear pressure_advance line breaks them', () => {
    const start = Object.fromEntries(
      startingChanges('direct', 'recipr').map((change) => [
        change.option,
        change.option === 'pressure_advance_model' ? change.value : Number(change.value),
      ]),
    )
    expect(matchesStart(readNpaConfig(start), 'direct')).toBe(true)
    expect(matchesStart(readNpaConfig(start), 'bowden')).toBe(false)
    expect(matchesStart(readNpaConfig({ ...start, pressure_advance: 0.04 }), 'direct')).toBe(false)
  })
})

describe('suggestions, direct drive', () => {
  it('waits for every height the tower is read at', () => {
    expect(suggestFor(reading({ tower: 'advance', side: 20 }), [])).toBeNull()
  })

  it('keeps the offset from the side of the offset tower, then moves to advance', () => {
    expect(suggestFor(reading({ side: 27 }), [])).toEqual({
      kind: 'keep',
      option: 'nonlinear_offset',
      value: '0.135',
      next: 'advance',
    })
  })

  it('lowers the offset when the side converges below the front', () => {
    const advance = reading({
      tower: 'advance',
      range: { from: 0, to: 0.05 },
      side: 5,
      front: 20,
      nonlinearOffset: 0.135,
    })
    expect(suggestFor(advance, [])).toEqual({
      kind: 'nudge',
      option: 'nonlinear_offset',
      value: '0.1215',
      direction: 'down',
      step: 0.1,
      reprint: 'advance',
    })
  })

  it('halves the step when the direction reverses', () => {
    const first = reading({ tower: 'advance', side: 5, front: 20, nonlinearOffset: 0.135 })
    const second = reading({ tower: 'advance', side: 25, front: 18, nonlinearOffset: 0.1215 })
    const suggestion = suggestFor(second, [first])
    expect(suggestion).toMatchObject({ kind: 'nudge', direction: 'up', step: 0.05 })
  })

  it('keeps the advance where both sides agree, then moves to the time offset', () => {
    // The guide's SV06 example: both converge at 17 mm on a 0.001 mm⁻¹ tower.
    const converged = reading({
      tower: 'advance',
      range: { from: 0, to: 0.05 },
      side: 17.5,
      front: 16.5,
      nonlinearOffset: 0.12,
    })
    expect(suggestFor(converged, [])).toEqual({
      kind: 'keep',
      option: 'linear_advance',
      value: '0.017',
      next: 'timeOffset',
    })
  })

  it('sends the reader to the offset tower when there is no offset to nudge', () => {
    const noOffset = reading({ tower: 'advance', side: 5, front: 20, nonlinearOffset: 0 })
    expect(suggestFor(noOffset, [])).toEqual({
      kind: 'unreadable',
      option: 'nonlinear_offset',
      first: 'offset',
    })
  })

  it('finishes after the time offset', () => {
    const time = reading({ tower: 'timeOffset', range: { from: 0, to: 0.005 }, front: 18 })
    expect(suggestFor(time, [])).toEqual({
      kind: 'keep',
      option: 'pressure_advance_time_offset',
      value: '0.0018',
      next: null,
    })
  })
})

describe('suggestions, Bowden', () => {
  it('keeps 80% of the first advance reading', () => {
    const advance = reading({
      path: 'bowden',
      tower: 'advance',
      range: { from: 0, to: 0.5 },
      front: 20,
    })
    expect(suggestFor(advance, [])).toEqual({
      kind: 'keep',
      option: 'linear_advance',
      value: '0.16',
      ideal: '0.2',
      next: 'offset',
    })
  })

  it('raises the advance when the side converges below the front', () => {
    const offset = reading({
      path: 'bowden',
      tower: 'offset',
      range: { from: 0, to: 1 },
      side: 10,
      front: 20,
      linearAdvance: 0.16,
    })
    expect(suggestFor(offset, [])).toMatchObject({
      kind: 'nudge',
      option: 'linear_advance',
      value: '0.176',
      direction: 'up',
    })
  })

  it('returns to the offset tower once after the time offset, then finishes', () => {
    const offset = reading({ path: 'bowden', tower: 'offset', side: 20, front: 20 })
    const time = reading({ path: 'bowden', tower: 'timeOffset', front: 18 })
    expect(suggestFor(offset, [])).toMatchObject({ kind: 'keep', next: 'timeOffset' })
    expect(suggestFor(time, [offset])).toMatchObject({ kind: 'keep', next: 'offset' })
    expect(suggestFor(offset, [offset, time])).toMatchObject({ kind: 'keep', next: null })
  })
})

describe('session', () => {
  it('opens on the first tower of the path, then follows the latest reading', () => {
    expect(nextTower('direct', [])).toBe('offset')
    expect(nextTower('bowden', [])).toBe('advance')
    expect(nextTower('direct', [reading({ side: 27 })])).toBe('advance')
    expect(
      nextTower('direct', [
        reading({ tower: 'advance', side: 5, front: 20, nonlinearOffset: 0.1 }),
      ]),
    ).toBe('advance')
  })

  it('round-trips a reading through the log, and starts over at a start entry', () => {
    const original = reading({ side: 27, at: 5 })
    const values = readingToValues(original)
    expect(readingFromValues(5, values)).toEqual(original)
    const entries = [
      { at: 1, values: readingToValues(reading({ side: 10 })) },
      { at: 2, values: { kind: 'start', path: 'bowden' } },
      { at: 5, values },
    ]
    expect(sessionReadings(entries)).toEqual([original])
    expect(sessionPath(entries)).toBe('direct')
    expect(readingFromValues(1, { kind: 'reading', path: 'direct' })).toBeNull()
  })
})
