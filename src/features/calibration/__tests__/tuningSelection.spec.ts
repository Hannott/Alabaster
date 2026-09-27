import { describe, expect, it } from 'vitest'

import {
  newestTuningResult,
  resolveTuningComparison,
  resolveTuningSelection,
} from '@/features/calibration/tuningSelection'

const older = { path: 'input_shaper/a.png', modified: 100 }
const newer = { path: 'belts/b.png', modified: 300 }
const middle = { path: 'input_shaper/c.png', modified: 200 }
const results = [older, newer, middle]

describe('tuning selection', () => {
  it('finds the newest result across categories, whatever order they arrive in', () => {
    expect(newestTuningResult(results)).toBe(newer)
    expect(newestTuningResult([])).toBeNull()
  })

  it('keeps the requested graph while it exists', () => {
    expect(resolveTuningSelection(older.path, results)).toBe(older)
  })

  it('falls back to the newest graph when nothing, or a vanished file, is requested', () => {
    expect(resolveTuningSelection(null, results)).toBe(newer)
    expect(resolveTuningSelection('input_shaper/deleted.png', results)).toBe(newer)
    expect(resolveTuningSelection(null, [])).toBeNull()
  })

  it('never substitutes a comparison the reader did not choose', () => {
    expect(resolveTuningComparison(middle.path, results, newer)).toBe(middle)
    expect(resolveTuningComparison('input_shaper/deleted.png', results, newer)).toBeNull()
    expect(resolveTuningComparison(null, results, newer)).toBeNull()
  })

  it('never compares a graph against itself', () => {
    expect(resolveTuningComparison(newer.path, results, newer)).toBeNull()
  })
})
