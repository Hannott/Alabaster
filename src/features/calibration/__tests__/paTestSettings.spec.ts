import { describe, expect, it } from 'vitest'

import {
  paTestChanges,
  paTestProblem,
  readPaTest,
  type PaTestValues,
} from '@/features/calibration/paTestSettings'

// The guide's own [pa_test] section.
const guide: PaTestValues = readPaTest({
  size_x: 100,
  size_y: 50,
  height: 50,
  origin_x: 100,
  origin_y: 100,
  layer_height: 0.2,
  first_layer_height: 0.24,
  perimeters: 2,
  brim_width: 6,
  slow_velocity: 20,
  medium_velocity: 50,
  fast_velocity: 150,
  filament_diameter: 1.75,
  fan_speed: 0.5,
})

describe('pa_test settings', () => {
  it('accepts the guide section and lets Kalico size the tower when both sizes are 0', () => {
    expect(paTestProblem(guide)).toBeNull()
    expect(paTestProblem({ ...guide, size_x: 0, size_y: 0 })).toBeNull()
  })

  it('refuses what Kalico would refuse to start with', () => {
    expect(paTestProblem({ ...guide, medium_velocity: 20 })).toEqual({
      kind: 'above',
      option: 'medium_velocity',
      than: 'slow_velocity',
    })
    expect(paTestProblem({ ...guide, first_layer_height: 0.2 })?.option).toBe('first_layer_height')
    expect(paTestProblem({ ...guide, brim_width: 1 })?.option).toBe('brim_width')
    expect(paTestProblem({ ...guide, perimeters: 1.5 })?.kind).toBe('whole')
    expect(paTestProblem({ ...guide, fan_speed: 2 })?.kind).toBe('atMost')
    expect(paTestProblem({ ...guide, size_y: 90 })).toEqual({
      kind: 'atMost',
      option: 'size_y',
      max: 80,
    })
    expect(paTestProblem({ ...guide, size_x: 30 })?.option).toBe('size_x')
    expect(paTestProblem({ ...guide, height: null })?.kind).toBe('required')
  })

  it('writes only what changed, and never an origin cleared to nothing', () => {
    expect(paTestChanges(guide, guide)).toEqual([])
    expect(paTestChanges(guide, { ...guide, fast_velocity: 300, origin_x: null })).toEqual([
      { option: 'fast_velocity', value: '300' },
    ])
  })
})
