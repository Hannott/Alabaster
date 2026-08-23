import { computed, type ComputedRef } from 'vue'

import { configOptionalStringList } from '@/dashboard/context'

/**
 * Which of a module's settings are also reachable from its card's own
 * gear-opened disclosure layer, one setting at a time — never a move, the
 * setting stays exactly where its logical group put it in the full settings
 * surface, and this only decides whether the same bound control *also*
 * renders in the card's quick layer.
 */
export interface QuickSettingsController {
  quickKeys: ComputedRef<string[]>
  isQuick: (key: string) => boolean
  setQuick: (key: string, shown: boolean) => void
  /**
   * Whether a promotable row renders at all: the pane shows every row, the
   * card's quick layer only the promoted ones. This is half of the
   * choreography `docs/design/settings-surface.md` requires of every
   * promotable row (the other half — only the pane carries the pin toggle —
   * lives in each row's `v-if="mode === 'pane'"`). One implementation here
   * because it used to be copied into every fields component, and a copy
   * whose comparison drifts shows unpromoted rows in a card layer or hides
   * rows from the pane.
   */
  visible: (key: string) => boolean
}

/**
 * `defaultKeys` is what a never-customized instance shows. The moment the
 * user changes any one of them the whole resulting set is written out
 * explicitly, so an instance can end up showing nothing at all without that
 * reading as "never configured" — see `configOptionalStringList`.
 */
export function useQuickSettings(
  config: ComputedRef<Record<string, unknown>>,
  updateConfig: (patch: Record<string, unknown>) => void,
  defaultKeys: readonly string[],
  /** The consuming surface, for `visible`. A caller without one is a pane. */
  mode: () => 'pane' | 'quick' = () => 'pane',
): QuickSettingsController {
  const quickKeys = computed(
    () => configOptionalStringList(config.value, 'quickSettings') ?? [...defaultKeys],
  )

  const isQuick = (key: string): boolean => quickKeys.value.includes(key)

  return {
    quickKeys,
    isQuick,
    setQuick: (key, shown) => {
      const withoutKey = quickKeys.value.filter((entry) => entry !== key)
      updateConfig({ quickSettings: shown ? [...withoutKey, key] : withoutKey })
    },
    visible: (key) => mode() === 'pane' || isQuick(key),
  }
}

/**
 * Whether a module currently shows anything in its card's quick layer — the
 * one place this has to be answered without mounting the module: the card
 * header's gear button falls back to opening the full settings surface once
 * there is nothing left for it to disclose (see `DashboardView`'s
 * `toggleSettings`). A module that has not adopted per-setting promotion
 * (`quickSettingsDefaultKeys` unset on its registry entry) keeps its old
 * fixed quick-settings component, which always has something to show.
 */
export function moduleHasQuickSettings(
  definition: {
    quickSettingsDefaultKeys?: readonly string[]
    quickSettingRowVisible?: (key: string, config: Record<string, unknown>) => boolean
  },
  config: Record<string, unknown>,
): boolean {
  const defaultKeys = definition.quickSettingsDefaultKeys
  if (!defaultKeys) return true
  const stored = configOptionalStringList(config, 'quickSettings')
  const promoted = stored ?? defaultKeys
  // A promoted row can still be conditional — Camera's arrangement switch means
  // nothing on a card showing one camera and renders nothing there. Counting
  // keys alone therefore said "has settings" for a layer that opened empty, so a
  // module with conditional rows says which of its keys are live right now.
  const isVisible = definition.quickSettingRowVisible
  if (!isVisible) return promoted.length > 0
  return promoted.some((key) => isVisible(key, config))
}
