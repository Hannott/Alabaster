import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ProcedureText } from '@/features/calibration/procedures'
import { createDateTimeFormatter, createTimeFormatter } from '@/i18n/formats'

/**
 * Turns the registry's text-as-data into what is shown, and a run's time into
 * "today 14:02" or "41 days ago" — the shape a reader scans a list of
 * calibrations in, where an absolute date would have to be subtracted first.
 */
export function useProcedureText() {
  const { locale, t } = useI18n({ useScope: 'global' })

  const timeFormatter = computed(() => createTimeFormatter(locale.value))
  const dateFormatter = computed(() => createDateTimeFormatter(locale.value))
  const relativeFormatter = computed(
    () => new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' }),
  )

  function text(value: ProcedureText): string {
    return 'literal' in value ? value.literal : t(value.key, value.params ?? {})
  }

  function lastRun(at: number | null, now: number = Date.now()): string {
    if (at === null) return t('calibration.bench.never')
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    if (at >= start.getTime()) {
      return t('calibration.bench.today', { time: timeFormatter.value.format(at) })
    }
    const days = Math.ceil((start.getTime() - at) / 86_400_000)
    return relativeFormatter.value.format(-days, 'day')
  }

  function when(at: number): string {
    return dateFormatter.value.format(at)
  }

  return { text, lastRun, when }
}
