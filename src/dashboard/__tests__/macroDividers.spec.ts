import { describe, expect, it } from 'vitest'

import {
  createDividerId,
  dividerId,
  isDividerEntry,
  makeDividerEntry,
} from '@/dashboard/macroDividers'

describe('macroDividers', () => {
  it('never mistakes a real macro name for a divider', () => {
    expect(isDividerEntry('CALIBRATE_MESH')).toBe(false)
    expect(dividerId('CALIBRATE_MESH')).toBeNull()
  })

  it('round-trips an id through the entry marker', () => {
    const entry = makeDividerEntry('abc123')
    expect(isDividerEntry(entry)).toBe(true)
    expect(dividerId(entry)).toBe('abc123')
  })

  it('mints ids that never collide across a run of calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createDividerId()))
    expect(ids.size).toBe(50)
  })
})
