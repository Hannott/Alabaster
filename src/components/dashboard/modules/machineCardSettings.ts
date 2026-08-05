import { configBoolean } from '@/dashboard/context'

/**
 * The Machine card's promotable switches — key and default in one place,
 * shared by `MachineModule.vue` and `MachineCardSettingsFields.vue` so the two
 * cannot drift, the same split `movementCardSettings.ts` and
 * `controlsCardSettings.ts` use for their own cards.
 */
export const machineCardDefaults = {
  /**
   * Off by default: tuning velocity or acceleration mid-print is an
   * established way to fix a quality problem without reslicing, not a mistake
   * this card should guard against on every printer. Locking the fields is an
   * opt-in for whoever wants that guard rail rather than the card's ordinary
   * behaviour.
   */
  lockDuringPrint: false,
} as const

export type MachineCardSettingKey = keyof typeof machineCardDefaults

/** Whether this card instance draws the block, from its stored configuration. */
export function readMachineCardSetting(
  config: Record<string, unknown>,
  key: MachineCardSettingKey,
): boolean {
  return configBoolean(config, key, machineCardDefaults[key])
}
