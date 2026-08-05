/**
 * How a duration or a filament length reads anywhere in History — the job
 * list, the lifetime totals, the outcome table, and the trend chart's
 * tooltip. Kept in one place because these are the same quantity shown in
 * different views of the same data: they must always agree, not merely
 * happen to look alike, so a display rule changed here changes everywhere at
 * once rather than drifting out of sync one caller at a time.
 */

type Translate = (key: string, params?: Record<string, unknown>) => string

export function formatHistoryDuration(seconds: number, t: Translate): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return t('history.noValue')
  const totalMinutes = Math.round(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0
    ? t('dashboard.duration.hoursMinutes', { hours, minutes })
    : t('dashboard.duration.minutes', { minutes })
}

export function formatHistoryFilament(millimetres: number, t: Translate, locale: string): string {
  if (!Number.isFinite(millimetres) || millimetres <= 0) return t('history.noValue')
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  return t('history.filamentValue', { value: formatter.format(millimetres / 1000) })
}
