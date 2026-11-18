import { configBoolean, configNumber, configString } from '@/dashboard/context'

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

/**
 * The height of the separate heater-power strip for each chart height, in rem.
 * Added below the temperature plot rather than taken from it, so a preset
 * keeps meaning the same temperature plot whichever way power is drawn.
 */
export const chartPowerStripRem: Record<ChartHeightOption, number> = {
  compact: 2,
  standard: 2.5,
  tall: 3.25,
}

/** Where heater duty is drawn: nowhere, over the temperatures, or in a strip below them. */
export const chartPowerModeOptions = ['off', 'overlay', 'separate'] as const

export type ChartPowerMode = (typeof chartPowerModeOptions)[number]

/**
 * A profile saved before the strip existed stored a boolean `chartShowPower`,
 * which only ever meant the overlay. Read as that until the reader picks a mode,
 * so a synced profile does not change appearance on its own.
 */
export function readChartPowerMode(config: Record<string, unknown>): ChartPowerMode {
  const legacy: ChartPowerMode = configBoolean(config, 'chartShowPower', false) ? 'overlay' : 'off'
  const stored = configString(config, 'chartPowerMode', legacy)
  return (chartPowerModeOptions as readonly string[]).includes(stored)
    ? (stored as ChartPowerMode)
    : legacy
}

/** Minutes of history the plot holds on screen. */
export const chartWindowOptions = [1, 5, 10, 20] as const

export function readChartWindowMinutes(config: Record<string, unknown>): number {
  const stored = configNumber(config, 'chartWindowMinutes', 5)
  return (chartWindowOptions as readonly number[]).includes(stored) ? stored : 5
}
