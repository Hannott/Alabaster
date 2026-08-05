import { describe, expect, it } from 'vitest'

import {
  maintenanceIntervalState,
  type MaintenanceIntervalBaseline,
} from '@/features/history/maintenance'

function interval(
  overrides: Partial<MaintenanceIntervalBaseline> = {},
): MaintenanceIntervalBaseline {
  return {
    kind: 'printtime',
    value: 100,
    baselinePrintTime: 0,
    baselineFilament: 0,
    baselineDate: 0,
    ...overrides,
  }
}

describe('maintenanceIntervalState', () => {
  it('reports ok well before the interval elapses', () => {
    const result = maintenanceIntervalState(
      interval({ kind: 'printtime', value: 100 }),
      { printTime: 10 * 3600, filamentUsed: 0 },
      0,
    )
    expect(result.status).toBe('ok')
  })

  it('reports due once inside the warning threshold', () => {
    const result = maintenanceIntervalState(
      interval({ kind: 'printtime', value: 100 }),
      { printTime: 90 * 3600, filamentUsed: 0 },
      0,
    )
    expect(result.status).toBe('due')
  })

  it('reports overdue once the interval has fully elapsed', () => {
    const result = maintenanceIntervalState(
      interval({ kind: 'printtime', value: 100 }),
      { printTime: 101 * 3600, filamentUsed: 0 },
      0,
    )
    expect(result.status).toBe('overdue')
    expect(result.progress).toBeGreaterThan(1)
  })

  it('measures a filament interval in millimetres against a metre value', () => {
    const result = maintenanceIntervalState(
      interval({ kind: 'filament', value: 50, baselineFilament: 0 }),
      { printTime: 0, filamentUsed: 49_000 },
      0,
    )
    expect(result.status).toBe('due')
  })

  it('measures a date interval in days against the current moment', () => {
    const now = 30 * 86400
    const result = maintenanceIntervalState(
      interval({ kind: 'date', value: 30, baselineDate: 0 }),
      { printTime: 0, filamentUsed: 0 },
      now,
    )
    expect(result.status).toBe('overdue')
  })

  it('needs a new baseline when print-time totals fall below it, rather than reporting a number', () => {
    const result = maintenanceIntervalState(
      interval({ kind: 'printtime', value: 100, baselinePrintTime: 500 * 3600 }),
      { printTime: 10 * 3600, filamentUsed: 0 },
      0,
    )
    expect(result.status).toBe('needsBaseline')
  })

  it('needs a new baseline when filament totals fall below it', () => {
    const result = maintenanceIntervalState(
      interval({ kind: 'filament', value: 50, baselineFilament: 500_000 }),
      { printTime: 0, filamentUsed: 1000 },
      0,
    )
    expect(result.status).toBe('needsBaseline')
  })

  it('never needs a baseline from a date interval, since the calendar cannot regress', () => {
    const result = maintenanceIntervalState(
      interval({ kind: 'date', value: 30, baselineDate: 1_000_000 }),
      { printTime: 0, filamentUsed: 0 },
      500_000,
    )
    expect(result.status).not.toBe('needsBaseline')
  })
})
