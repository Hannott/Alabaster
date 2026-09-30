import { describe, expect, it } from 'vitest'

import {
  axisCrossCheck,
  beltKinematics,
  beltsFor,
  beltVerdict,
  pairPeaks,
  parsePeaks,
} from '@/features/calibration/beltGuide'

describe('beltsFor', () => {
  it("names the stepper that alone turns during each of Shake&Tune's belt runs", () => {
    expect(beltsFor('corexy')).toEqual([
      { name: 'A', stepper: 'stepper_y' },
      { name: 'B', stepper: 'stepper_x' },
    ])
    expect(beltsFor('corexz')).toEqual([
      { name: 'X', stepper: 'stepper_x' },
      { name: 'Z', stepper: 'stepper_z' },
    ])
  })

  it('recognises only the kinematics the belt test runs on', () => {
    expect(beltKinematics('limited_corexy')).toBe('corexy')
    expect(beltKinematics('CoreXZ')).toBe('corexz')
    expect(beltKinematics('cartesian')).toBeNull()
    expect(beltKinematics(null)).toBeNull()
  })
})

describe('parsePeaks', () => {
  it('reads peaks separated by commas, semicolons or spaces, ascending', () => {
    expect(parsePeaks('126, 78')).toEqual([78, 126])
    expect(parsePeaks('78;126 131.5')).toEqual([78, 126, 131.5])
    expect(parsePeaks('  ')).toEqual([])
  })

  it('rejects the whole entry when any peak is not a frequency', () => {
    expect(parsePeaks('78, abc')).toBeNull()
    expect(parsePeaks('78, -4')).toBeNull()
  })
})

describe('pairPeaks', () => {
  it('pairs the closest peaks first and counts what is left over', () => {
    expect(pairPeaks([78, 126], [84, 131])).toEqual({
      pairs: [
        { first: 78, second: 84 },
        { first: 126, second: 131 },
      ],
      unpaired: 0,
    })
    expect(pairPeaks([78], [84, 160]).unpaired).toBe(1)
  })
})

describe('beltVerdict', () => {
  const base = { unpaired: 0, atTarget: null } as const

  it('waits for peaks on both curves', () => {
    expect(beltVerdict({ ...base, first: [78], second: [] })).toEqual({ kind: 'incomplete' })
  })

  it('withholds tension advice while any peak is unpaired', () => {
    expect(beltVerdict({ ...base, first: [78], second: [84], unpaired: 2 })).toEqual({
      kind: 'beltPath',
      unpaired: 2,
    })
    expect(beltVerdict({ ...base, first: [78], second: [84, 160] }).kind).toBe('beltPath')
  })

  it('reports pairs that disagree on which belt is higher as the belt path', () => {
    expect(beltVerdict({ ...base, first: [78, 131], second: [84, 126] }).kind).toBe('disagree')
  })

  it('calls a gap below reading precision matched', () => {
    expect(beltVerdict({ ...base, first: [80], second: [80.8] }).kind).toBe('matched')
  })

  it('names the lower belt as looser, with the gap in frequency', () => {
    const verdict = beltVerdict({ ...base, first: [78, 126], second: [84, 131] })
    expect(verdict).toMatchObject({ kind: 'looser', looser: 0, action: 'either' })
    expect(verdict.kind === 'looser' && verdict.offset).toBeCloseTo(0.056, 3)
    expect(beltVerdict({ ...base, first: [84], second: [78] })).toMatchObject({ looser: 1 })
  })

  it('adjusts the belt that was not measured at target tension', () => {
    const peaks = { first: [78], second: [84], unpaired: 0 }
    expect(beltVerdict({ ...peaks, atTarget: 1 })).toMatchObject({ action: 'tightenLooser' })
    expect(beltVerdict({ ...peaks, atTarget: 0 })).toMatchObject({ action: 'loosenTighter' })
  })
})

describe('axisCrossCheck', () => {
  const pair = { first: 80, second: 80 }

  it('predicts X above and Y below the belt peak from the two masses', () => {
    const check = axisCrossCheck({
      pair,
      toolheadGrams: 800,
      gantryGrams: 600,
      measuredX: null,
      measuredY: null,
    })!
    // 80·√(2.2/1.6) and 80·√(2.2/2.8).
    expect(check.x.expected).toBeCloseTo(93.81, 1)
    expect(check.y.expected).toBeCloseTo(70.91, 1)
    expect(check.x.verdict).toBeNull()
  })

  it('tells a belt-set axis from one something softer sets', () => {
    const check = axisCrossCheck({
      pair,
      toolheadGrams: 800,
      gantryGrams: 600,
      measuredX: 91,
      measuredY: 52,
    })!
    expect(check.x.verdict).toBe('belts')
    expect(check.y.verdict).toBe('softer')
    expect(check.y.offset).toBeCloseTo(-0.267, 2)
    expect(
      axisCrossCheck({
        pair,
        toolheadGrams: 800,
        gantryGrams: 600,
        measuredX: 120,
        measuredY: null,
      })!.x.verdict,
    ).toBe('stiffer')
  })

  it('needs a toolhead mass to predict anything', () => {
    expect(
      axisCrossCheck({ pair, toolheadGrams: 0, gantryGrams: 600, measuredX: 91, measuredY: 52 }),
    ).toBeNull()
  })
})
