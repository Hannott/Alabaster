import { describe, expect, it } from 'vitest'

import {
  filamentFitStatus,
  filamentTemperatureMismatch,
  filamentTemperatureMismatchThreshold,
  remainingFilamentNeeded,
} from '@/dashboard/printReadiness'

describe('remainingFilamentNeeded', () => {
  it('discounts the whole-job total by how much has already extruded', () => {
    expect(remainingFilamentNeeded(200, 0.25)).toBe(150)
    expect(remainingFilamentNeeded(200, 0)).toBe(200)
    expect(remainingFilamentNeeded(200, 1)).toBe(0)
  })

  it('is null when the file never reported a filament total', () => {
    expect(remainingFilamentNeeded(null, 0.5)).toBeNull()
    expect(remainingFilamentNeeded(undefined, 0.5)).toBeNull()
    expect(remainingFilamentNeeded(Number.NaN, 0.5)).toBeNull()
  })
})

describe('filamentFitStatus', () => {
  it('fits when the spool has at least as much as the job needs', () => {
    expect(filamentFitStatus(100, 150)).toBe('fits')
    expect(filamentFitStatus(150, 150)).toBe('fits')
  })

  it('is short when the job needs more than the spool has left', () => {
    expect(filamentFitStatus(200, 150)).toBe('short')
  })

  it('is unknown whenever either side was never reported', () => {
    expect(filamentFitStatus(null, 150)).toBe('unknown')
    expect(filamentFitStatus(100, undefined)).toBe('unknown')
    expect(filamentFitStatus(Number.NaN, 150)).toBe('unknown')
  })
})

describe('filamentTemperatureMismatch', () => {
  it('is null when the two temperatures are close enough', () => {
    expect(filamentTemperatureMismatch(210, 210 + filamentTemperatureMismatchThreshold)).toBeNull()
  })

  it('reports a mismatch once the gap passes the threshold', () => {
    expect(
      filamentTemperatureMismatch(210, 210 + filamentTemperatureMismatchThreshold + 1),
    ).toEqual({
      filamentExtruderTemp: 210,
      fileExtruderTemp: 210 + filamentTemperatureMismatchThreshold + 1,
    })
  })

  it('is null whenever either side was never reported', () => {
    expect(filamentTemperatureMismatch(null, 250)).toBeNull()
    expect(filamentTemperatureMismatch(210, undefined)).toBeNull()
  })
})
