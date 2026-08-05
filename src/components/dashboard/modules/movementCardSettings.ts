import { configBoolean } from '@/dashboard/context'

/**
 * The Movement card's promotable switches — each key and default in one place,
 * shared by `MovementModule.vue` and `MovementCardSettingsFields.vue` so the
 * two cannot drift. Each pair used to live in both files, and a default
 * changed in one produces a settings row whose checkbox disagrees with the
 * card it controls, which is worse than either state alone.
 */
export const movementCardDefaults = {
  showBedPlan: true,
  showParking: true,
  showZOffset: true,
  /**
   * The speed factor — `M220`, a multiplier on every move the machine makes,
   * which is why it is on this card rather than filed under the job it happens
   * to be scaling. Defaults on because it was unconditional on the Print card
   * before it moved here, so defaulting off would silently take away a control
   * people already use.
   */
  showSpeedFactor: true,
  /**
   * Some printers move the bed rather than the gantry, so their Z 0 sits at
   * the top of the travel instead of the bottom — a drawing choice for the
   * slider, never a change to the Z values `moveTo` sends.
   */
  swapZDirection: false,
  /**
   * The jog matrix and every leveling button hide unconditionally while
   * printing — a manual move or a bed probe over a running job is not a
   * choice to expose. The bed plan is different: it is also a live position
   * readout, which stays useful to glance at mid-print, so whether it keeps
   * drawing then is its own setting rather than following the same hard rule.
   * Defaults off because the plan's own controls (tap-to-move, the Z slider)
   * are still disabled by `printer.isPrinting` regardless of this setting, so
   * turning it on trades a plan someone can only look at for the fallback
   * axis boxes any printer without one already shows.
   */
  showBedPlanWhilePrinting: false,
} as const

export type MovementCardSettingKey = keyof typeof movementCardDefaults

/** Whether this card instance draws the block, from its stored configuration. */
export function readMovementCardSetting(
  config: Record<string, unknown>,
  key: MovementCardSettingKey,
): boolean {
  return configBoolean(config, key, movementCardDefaults[key])
}
