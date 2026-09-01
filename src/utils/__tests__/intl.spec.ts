import { describe, expect, it } from 'vitest'

import { dateTimeFormat, numberFormat } from '@/utils/intl'

/**
 * The point of this module is that the same request returns the same object —
 * constructing an `Intl` formatter is roughly fifty times the cost of using
 * one, and a list that builds one per row pays that per row. Identity is
 * therefore the behavior under test, not an implementation detail.
 */
describe('memoized Intl formatters', () => {
  it('returns one instance for the same locale and options', () => {
    const first = dateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' })
    const second = dateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' })
    expect(second).toBe(first)
  })

  it('ignores the order the options were written in', () => {
    const first = dateTimeFormat('en', { month: 'short', day: 'numeric' })
    const second = dateTimeFormat('en', { day: 'numeric', month: 'short' })
    expect(second).toBe(first)
  })

  it('keeps different locales, options and formatter kinds apart', () => {
    const english = dateTimeFormat('en', { month: 'short' })
    expect(dateTimeFormat('nb', { month: 'short' })).not.toBe(english)
    expect(dateTimeFormat('en', { month: 'long' })).not.toBe(english)
    expect(numberFormat('en', { maximumFractionDigits: 1 })).not.toBe(
      numberFormat('en', { maximumFractionDigits: 2 }),
    )
  })

  it('caches a formatter asked for with no options at all', () => {
    expect(numberFormat('en')).toBe(numberFormat('en'))
    expect(numberFormat('en')).not.toBe(numberFormat('nb'))
  })

  it('still formats what the underlying constructor would', () => {
    const date = new Date(2026, 0, 5)
    expect(
      dateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date),
    ).toBe(
      new Intl.DateTimeFormat('en-GB', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(date),
    )
    expect(numberFormat('nb', { maximumFractionDigits: 1 }).format(1234.56)).toBe(
      new Intl.NumberFormat('nb', { maximumFractionDigits: 1 }).format(1234.56),
    )
  })
})
