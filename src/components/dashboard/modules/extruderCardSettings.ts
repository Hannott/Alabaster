import { configBoolean } from '@/dashboard/context'

/**
 * The Extruder card's optional blocks — each switch's key and default in one
 * place, shared by the card and its settings rows so the two cannot drift.
 * These pairs used to live twice, once in `ExtruderModule.vue` and once in
 * `ExtruderCardSettingsFields.vue`, and had to move together by hand: a
 * default changed in one file produces a settings row whose checkbox disagrees
 * with the card it controls, which is worse than either state alone.
 */
export const extruderCardDefaults = {
  /**
   * On by default, and the one block here whose absence leaves the card
   * unable to do the thing it is named for. It is a toggle at all for the
   * printer whose filament is only ever moved by a macro — a load/unload pack
   * or a filament-change sequence — where two fields and two buttons that
   * duplicate what the macro already does are just height.
   */
  showManualExtrusion: true,
  showLoadMacros: true,
  /**
   * On by default, unlike pressure advance: the block only exists at all where
   * the printer reports `[firmware_retraction]`, and that section is something
   * its owner configured on purpose. The discovery gate is doing the work a
   * default-off toggle would otherwise have to.
   */
  showRetraction: true,
  /**
   * Off by default. The block is 120.8 px — 41% of the card's body — for a
   * control most people touch once per filament, while extrude and retract,
   * the reason the module exists, are 36 px. It stays one toggle away for a
   * tuning session.
   */
  showPressureAdvance: false,
} as const

export type ExtruderCardSettingKey = keyof typeof extruderCardDefaults

/** Whether this card instance draws the block, from its stored configuration. */
export function readExtruderCardSetting(
  config: Record<string, unknown>,
  key: ExtruderCardSettingKey,
): boolean {
  return configBoolean(config, key, extruderCardDefaults[key])
}
