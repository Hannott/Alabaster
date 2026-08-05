import { configBoolean } from '@/dashboard/context'

/**
 * The Controls card's two optional sections — each key and default in one
 * place, shared by `ControlsModule.vue` and `ControlsCardSettingsFields.vue`
 * so the two cannot drift. Each pair used to live in both files, and a default
 * changed in one produces a settings row whose checkbox disagrees with the
 * card it controls, which is worse than either state alone.
 */
export const controlsCardDefaults = {
  showOutputPins: true,
  showMonitoredFans: true,
} as const

export type ControlsCardSettingKey = keyof typeof controlsCardDefaults

/** Whether this card instance draws the section, from its stored configuration. */
export function readControlsCardSetting(
  config: Record<string, unknown>,
  key: ControlsCardSettingKey,
): boolean {
  return configBoolean(config, key, controlsCardDefaults[key])
}
