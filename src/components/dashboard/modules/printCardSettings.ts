import { configBoolean, configNumber, configString } from '@/dashboard/context'

/**
 * The Print card's promotable settings — each key's default, and the estimate
 * source's allow-list, in one place shared by `PrintModule.vue`,
 * `PrintCardSettingsFields.vue`, and `PrintSettingsPane.vue` so no two of them
 * can drift. Each of these used to be read independently on both sides, and a
 * default or validator changed in one file produces a settings row whose
 * control disagrees with the card it configures, which is worse than either
 * state alone.
 */
export const printCardDefaults = {
  showThumbnail: true,
  showFilament: true,
  showDrift: true,
} as const

export type PrintCardSettingKey = keyof typeof printCardDefaults

/** Whether this card instance draws the block, from its stored configuration. */
export function readPrintCardSetting(
  config: Record<string, unknown>,
  key: PrintCardSettingKey,
): boolean {
  return configBoolean(config, key, printCardDefaults[key])
}

/**
 * The specific remaining-time estimates the card can be pinned to. `auto` is
 * deliberately not one of them: it is the absence of a pin, kept apart so the
 * pane can render it as its own leading choice rather than a fourth source.
 */
export const printEstimateSources = ['slicer', 'file', 'filament'] as const

export type PrintEstimateSource = (typeof printEstimateSources)[number]

/**
 * The pinned estimate source, or `auto` when none is pinned — including when
 * the stored value names a source that no longer exists, which degrades to the
 * default rather than being trusted.
 */
export function readPrintEstimateSource(
  config: Record<string, unknown>,
): PrintEstimateSource | 'auto' {
  const stored = configString(config, 'estimateSource', 'auto')
  return (printEstimateSources as readonly string[]).includes(stored)
    ? (stored as PrintEstimateSource)
    : 'auto'
}

/**
 * The drift percentage the card starts warning at, clamped at zero because a
 * negative threshold has no meaning the card could draw.
 */
export function readPrintDriftThreshold(config: Record<string, unknown>): number {
  return Math.max(0, configNumber(config, 'driftThresholdPercent', 10))
}

/** The three progress readings `printProgressFraction` chooses between. */
export interface PrintProgressReadings {
  /** File position against the metadata's G-code byte range. */
  file: number
  /** `M73`, or null on a file that carries none. */
  slicer: number | null
  /** Filament consumed against the file's total; 0 when the total is unknown. */
  filament: number
}

/**
 * How far along the card says the print is.
 *
 * Whichever remaining-time source is pinned implies its own idea of "how far
 * along", so the percentage, the bar, and the drift figure all read from this
 * one fraction and can never disagree with each other. "Auto" has no source of
 * its own to imply one, so it keeps the standalone `M73` toggle as its
 * tiebreaker — the slicer's own progress is time-based and therefore better
 * than any byte measurement, but only a file sliced with `M73` output carries
 * it, so it is opt in and falls back rather than showing nothing.
 *
 * Here rather than inside the card because the collapsed card's header
 * summary has to answer the same question the expanded card does, and it
 * cannot mount the module to ask. Computed from an instance's own
 * configuration for the same reason the settings above are: two Print cards
 * may be pinned to different sources, and a single global reading would be
 * wrong for one of them.
 */
export function printProgressFraction(
  config: Record<string, unknown>,
  readings: PrintProgressReadings,
): number {
  const source = readPrintEstimateSource(config)
  if (source === 'slicer') return readings.slicer ?? readings.file
  if (source === 'filament') return readings.filament || readings.file
  if (source === 'file') return readings.file
  return configBoolean(config, 'useSlicerProgress', false)
    ? (readings.slicer ?? readings.file)
    : readings.file
}
