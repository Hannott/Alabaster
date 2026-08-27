import { beforeEach, describe, expect, it, vi } from 'vitest'

// Built from local-time components, not a UTC ISO string, so the expected
// strings below don't depend on the timezone the test runner happens to use.
const referenceDate = new Date(2026, 0, 5, 15, 45, 9)

describe('formats', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  it('formats time using the locale default when the mode is auto', async () => {
    const { createTimeFormatter } = await import('@/i18n/formats')
    const auto = createTimeFormatter('en-GB').format(referenceDate)
    expect(auto).toBe('15:45')
  })

  it('forces a 24-hour cycle regardless of locale', async () => {
    const { createTimeFormatter, useDateTimeFormatMode } = await import('@/i18n/formats')
    useDateTimeFormatMode().setTimeMode('h23')
    expect(createTimeFormatter('en-US').format(referenceDate)).toBe('15:45')
  })

  it('forces a 12-hour cycle regardless of locale', async () => {
    const { createTimeFormatter, useDateTimeFormatMode } = await import('@/i18n/formats')
    useDateTimeFormatMode().setTimeMode('h12')
    expect(createTimeFormatter('en-GB').format(referenceDate)).toBe('03:45 pm')
  })

  it('includes seconds only when asked', async () => {
    const { createTimeFormatter, useDateTimeFormatMode } = await import('@/i18n/formats')
    useDateTimeFormatMode().setTimeMode('h23')
    expect(createTimeFormatter('en-GB', { seconds: true }).format(referenceDate)).toBe('15:45:09')
  })

  it('formats a medium date using the locale default when the mode is auto', async () => {
    const { createDateFormatter } = await import('@/i18n/formats')
    expect(createDateFormatter('en-US').format(referenceDate)).toBe('Jan 5, 2026')
  })

  it('formats a short date (no year) using the locale default when the mode is auto', async () => {
    const { createDateFormatter } = await import('@/i18n/formats')
    expect(createDateFormatter('en-US', { style: 'short' }).format(referenceDate)).toBe('Jan 5')
  })

  it('renders an ISO medium date regardless of locale', async () => {
    const { createDateFormatter, useDateTimeFormatMode } = await import('@/i18n/formats')
    useDateTimeFormatMode().setDateMode('iso')
    expect(createDateFormatter('nb').format(referenceDate)).toBe('2026-01-05')
  })

  it('renders an ISO short date (no year) regardless of locale', async () => {
    const { createDateFormatter, useDateTimeFormatMode } = await import('@/i18n/formats')
    useDateTimeFormatMode().setDateMode('iso')
    expect(createDateFormatter('nb', { style: 'short' }).format(referenceDate)).toBe('01-05')
  })

  it('combines date and time honoring both modes at once', async () => {
    const { createDateTimeFormatter, useDateTimeFormatMode } = await import('@/i18n/formats')
    const mode = useDateTimeFormatMode()
    mode.setDateMode('iso')
    mode.setTimeMode('h23')
    expect(createDateTimeFormatter('en-US').format(referenceDate)).toContain('2026-01-05')
    expect(createDateTimeFormatter('en-US').format(referenceDate)).toContain('15:45')
  })

  /**
   * The formatters behind these are memoized (`src/utils/intl.ts`), so the one
   * way that could go wrong is a cache key that does not carry the mode: the
   * second read would then hand back the first mode's formatter. Switching
   * modes inside a single session and formatting the same locale twice is the
   * test that catches it.
   */
  it('follows a mode changed after a value has already been formatted', async () => {
    const { createTimeFormatter, createDateFormatter, useDateTimeFormatMode } =
      await import('@/i18n/formats')
    const mode = useDateTimeFormatMode()

    expect(createTimeFormatter('en-GB').format(referenceDate)).toBe('15:45')
    mode.setTimeMode('h12')
    expect(createTimeFormatter('en-GB').format(referenceDate)).toContain('3:45')

    expect(createDateFormatter('en-GB').format(referenceDate)).toBe('5 Jan 2026')
    mode.setDateMode('iso')
    expect(createDateFormatter('en-GB').format(referenceDate)).toBe('2026-01-05')
  })

  it('persists both modes across a reload', async () => {
    const first = await import('@/i18n/formats')
    first.useDateTimeFormatMode().setTimeMode('h12')
    first.useDateTimeFormatMode().setDateMode('iso')

    vi.resetModules()
    const second = await import('@/i18n/formats')
    const mode = second.useDateTimeFormatMode()
    expect(mode.timeMode.value).toBe('h12')
    expect(mode.dateMode.value).toBe('iso')
  })

  it('falls back to auto for an unrecognized stored mode', async () => {
    window.localStorage.setItem('alabaster.format.time', 'bogus')
    window.localStorage.setItem('alabaster.format.date', 'bogus')
    const { useDateTimeFormatMode } = await import('@/i18n/formats')
    const mode = useDateTimeFormatMode()
    expect(mode.timeMode.value).toBe('auto')
    expect(mode.dateMode.value).toBe('auto')
  })
})
