import { describe, expect, it } from 'vitest'

import { readSavedMeshProfile } from '@/features/bedMesh/savedProfile'

describe('readSavedMeshProfile', () => {
  it('returns null for a profile name with no matching section', () => {
    expect(readSavedMeshProfile(null)).toBeNull()
  })

  /**
   * `configfile.settings` echoes the value Klipper's own config access
   * tracking recorded — the parsed `float` list `ProfileManager` builds via
   * `config.getlists(..., parser=float)`, not the config file's raw text.
   * This is the shape every real printer reports; the compare-profile
   * overlay drew nothing at all before this parser understood it.
   */
  it('parses the nested-array shape a real printer reports', () => {
    const section = {
      version: 1,
      points: [
        [0.01, 0.02, 0.03],
        [0.04, 0.05, 0.06],
      ],
      min_x: 10,
      max_x: 340,
      min_y: 10,
      max_y: 340,
      x_count: 3,
      y_count: 2,
    }

    expect(readSavedMeshProfile(section)).toEqual({
      matrix: [
        [0.01, 0.02, 0.03],
        [0.04, 0.05, 0.06],
      ],
      area: { minX: 10, minY: 10, maxX: 340, maxY: 340 },
    })
  })

  /**
   * Kept as a defensive fallback in case a Klipper build ever reports the
   * on-disk config text instead of the parsed value — `ProfileManager.
   * save_profile` writes each row as `"\n  " + values joined by ", "`, with
   * that row's own trailing ", " stripped before the next row starts.
   */
  it('also parses the raw comma-separated string format, if ever reported', () => {
    const section = {
      version: 1,
      points: '\n  0.010000, 0.020000, 0.030000\n  0.040000, 0.050000, 0.060000',
      min_x: 10,
      max_x: 340,
      min_y: 10,
      max_y: 340,
      x_count: 3,
      y_count: 2,
    }

    expect(readSavedMeshProfile(section)).toEqual({
      matrix: [
        [0.01, 0.02, 0.03],
        [0.04, 0.05, 0.06],
      ],
      area: { minX: 10, minY: 10, maxX: 340, maxY: 340 },
    })
  })

  it('tolerates whatever whitespace the config value survived as', () => {
    const section = {
      points: '0.01,0.02\n0.03,0.04',
      min_x: 0,
      max_x: 200,
      min_y: 0,
      max_y: 200,
    }

    expect(readSavedMeshProfile(section)?.matrix).toEqual([
      [0.01, 0.02],
      [0.03, 0.04],
    ])
  })

  it('returns null when points is missing or unparseable', () => {
    expect(readSavedMeshProfile({ min_x: 0, max_x: 1, min_y: 0, max_y: 1 })).toBeNull()
    expect(readSavedMeshProfile({ points: '', min_x: 0, max_x: 1, min_y: 0, max_y: 1 })).toBeNull()
  })

  it('returns null when the area bounds are missing or degenerate', () => {
    const points = '0.01, 0.02\n0.03, 0.04'
    expect(readSavedMeshProfile({ points })).toBeNull()
    // A zero-width or zero-height area cannot be divided into cells.
    expect(readSavedMeshProfile({ points, min_x: 10, max_x: 10, min_y: 0, max_y: 200 })).toBeNull()
  })
})
