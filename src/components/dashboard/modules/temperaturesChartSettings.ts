import { configNumber, configString } from '@/dashboard/context'

/**
 * The temperature chart's sized options — each option list, its fallback, and
 * the validation that degrades an unknown stored value back to that fallback —
 * shared by `TemperaturesModule.vue` and `TemperaturesChartSettingsFields.vue`
 * so the two cannot drift. Both sides used to repeat the list and the
 * `includes()` check, and a value added to one produces a settings row whose
 * selection disagrees with the chart it controls, which is worse than either
 * state alone.
 */
export const chartHeightOptions = ['compact', 'standard', 'tall'] as const

export type ChartHeightOption = (typeof chartHeightOptions)[number]

export function readChartHeight(config: Record<string, unknown>): ChartHeightOption {
  const stored = configString(config, 'chartHeight', 'compact')
  return (chartHeightOptions as readonly string[]).includes(stored)
    ? (stored as ChartHeightOption)
    : 'compact'
}

/** Minutes of history the plot holds on screen. */
export const chartWindowOptions = [1, 5, 10, 20] as const

export function readChartWindowMinutes(config: Record<string, unknown>): number {
  const stored = configNumber(config, 'chartWindowMinutes', 5)
  return (chartWindowOptions as readonly number[]).includes(stored) ? stored : 5
}
