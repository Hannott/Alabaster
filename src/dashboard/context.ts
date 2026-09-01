import {
  computed,
  inject,
  onUnmounted,
  ref,
  watchEffect,
  type ComputedRef,
  type InjectionKey,
} from 'vue'

import type { AppIconName } from '@/components/AppIcon.vue'
import type { DashboardModuleId } from '@/dashboard/layout'

export interface DashboardModuleContext {
  instanceId: string
  moduleId: DashboardModuleId
  config: ComputedRef<Record<string, unknown>>
  updateConfig: (patch: Record<string, unknown>) => void
  /** The card's own short disclosure layer, holding what changes what the card shows. */
  isSettingsOpen: ComputedRef<boolean>
  openSettings: () => void
  closeSettings: () => void
  /**
   * The settings surface, which docks this card beside its full configuration.
   * See `docs/design/settings-surface.md`.
   */
  isSurfaceOpen: ComputedRef<boolean>
  openSurface: () => void
  closeSurface: () => void
  /**
   * Whether `openSurface` actually leads anywhere. `undefined`/`true` for every
   * real dashboard card, which docks into `SettingsSurface` via the choreography
   * `DashboardView` owns. `false` for a module hosted directly on a page outside
   * that dashboard — the Calibration page's bed-mesh viewer, so far the only
   * caller — where there is no grid of cards to dock away from and so no surface
   * for the popout link to open. `ModuleSettingsLink` reads this to hide itself
   * rather than rendering a link whose click would set `isSurfaceOpen` with
   * nothing on screen watching it.
   */
  canOpenSurface?: boolean
}

export const dashboardModuleContextKey: InjectionKey<DashboardModuleContext> =
  Symbol('dashboardModuleContext')

/**
 * Lets a `supportsMultiple` module's own settings pane move the surface to a
 * sibling instance of the same module without the user closing and reopening
 * it by hand — Macros' group switcher is the first caller. This is narrower
 * than "swap the docked card for an unrelated module": `settings-surface.md`
 * still holds "one card at a time" as an absolute — the previous instance
 * fully closes (its own fade home) before the target one opens (its own fade
 * out and dock), so there is never a moment with two docked cards. A pane
 * outside a real surface — a unit test, a module reused elsewhere — gets no
 * injected value and treats switching as unavailable rather than crashing.
 */
export const dashboardSurfaceGroupSwitchKey: InjectionKey<{
  switchTo: (instanceId: string) => void
}> = Symbol('dashboardSurfaceGroupSwitch')

/** `null` outside a real settings surface; see `dashboardSurfaceGroupSwitchKey`. */
export function useDashboardSurfaceGroupSwitch(): ((instanceId: string) => void) | null {
  return inject(dashboardSurfaceGroupSwitchKey, null)?.switchTo ?? null
}

/**
 * A single quiet icon action a module offers straight from the card header,
 * beside Settings and Collapse. Reserved for a "want" frequent enough to
 * earn that spot rather than living behind the gear — see interface-standards.md.
 *
 * A module has exactly one slot. Print's own instance is conditional — it
 * renders only while a Maintenance interval is overdue, per
 * `interface-standards.md`'s History contract — and a conditional notice wins
 * the slot while it is showing, since it is present only because it has
 * something to say. If Print ever wants a second, unconditional action too,
 * that is the rule to resolve the collision by, not first-registered-wins.
 */
export interface DashboardModuleHeaderAction {
  icon: AppIconName
  label: string
  disabled?: boolean
  onClick: () => void
}

export const dashboardModuleHeaderActionKey: InjectionKey<{
  setHeaderAction: (action: DashboardModuleHeaderAction | null) => void
}> = Symbol('dashboardModuleHeaderAction')

/**
 * Registers this module's header action with the enclosing card, if any, and
 * withdraws it on unmount. Collapsing already unmounts the module, so the
 * action disappears with it rather than needing an explicit collapsed guard.
 */
export function useDashboardModuleHeaderAction(
  action: ComputedRef<DashboardModuleHeaderAction | null>,
): void {
  const card = inject(dashboardModuleHeaderActionKey, null)
  if (!card) return
  watchEffect(() => card.setHeaderAction(action.value))
  onUnmounted(() => card.setHeaderAction(null))
}

/**
 * Modules read and write their own slice of the dashboard profile through this
 * context. Outside a dashboard card — unit tests, or a module reused on another
 * page — the same API is backed by local state so the component still works.
 */
export function useDashboardModule(moduleId: DashboardModuleId): DashboardModuleContext {
  const injected = inject(dashboardModuleContextKey, null)
  if (injected) return injected

  const config = ref<Record<string, unknown>>({})
  const settingsOpen = ref(false)
  const surfaceOpen = ref(false)

  return {
    instanceId: moduleId,
    moduleId,
    config: computed(() => config.value),
    updateConfig: (patch) => {
      config.value = { ...config.value, ...patch }
    },
    isSettingsOpen: computed(() => settingsOpen.value),
    openSettings: () => {
      settingsOpen.value = true
    },
    closeSettings: () => {
      settingsOpen.value = false
    },
    isSurfaceOpen: computed(() => surfaceOpen.value),
    openSurface: () => {
      surfaceOpen.value = true
    },
    closeSurface: () => {
      surfaceOpen.value = false
    },
  }
}

export function configString(
  config: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = config[key]
  return typeof value === 'string' && value.trim() !== '' ? value : fallback
}

export function configNumber(
  config: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = config[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function configBoolean(
  config: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = config[key]
  return typeof value === 'boolean' ? value : fallback
}

export function configStringList(config: Record<string, unknown>, key: string): string[] {
  const value = config[key]
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
}

/**
 * A list of positive, finite numbers, for a module that lets the user edit the
 * actual set of values a control offers rather than choosing among named
 * presets. Zero, negative and non-finite entries are dropped rather than
 * trusted — a hand-edited or imported profile degrades to whatever entries
 * are still usable instead of handing a module a step of `0` or `-Infinity`
 * to divide the toolhead by. Returns `[]`, never a fallback, on the same
 * reasoning `configStringList` does: what an empty list means is the caller's
 * business, since only it knows whether that means "use the built-in default"
 * or "the user removed every value on purpose".
 */
export function configNumberList(config: Record<string, unknown>, key: string): number[] {
  const value = config[key]
  if (!Array.isArray(value)) return []
  return value.filter(
    (entry): entry is number => typeof entry === 'number' && Number.isFinite(entry) && entry > 0,
  )
}

/**
 * Like `configStringList`, but distinguishes a key that was never written from
 * one explicitly stored as an empty list — `null` for the former, `[]` for the
 * latter. `configStringList` collapses both to `[]`, which is right wherever
 * "empty" already means "everything" or "nothing configured yet". It is wrong
 * for `quickSettings` (see `useQuickSettings`), where a user emptying their
 * card's quick layer on purpose has to be stored differently from an instance
 * that has never been customized, or the module could never tell them apart.
 */
export function configOptionalStringList(
  config: Record<string, unknown>,
  key: string,
): string[] | null {
  const value = config[key]
  if (!Array.isArray(value)) return null
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
}

/**
 * A map of short strings, for a per-thing choice a module stores against an
 * identifier it did not invent — a sensor's color against its Klipper object
 * name. Entries that are not strings are dropped rather than trusted, so a
 * hand-edited profile degrades to the defaults for those keys alone.
 */
export function configStringMap(
  config: Record<string, unknown>,
  key: string,
): Record<string, string> {
  const value = config[key]
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== '',
    ),
  )
}

/**
 * A list of records, for the rows of a small editable table. The shape is
 * guaranteed here; what the fields mean is the module's business, since only
 * it knows whether a missing number is a default or a reason to drop the row.
 */
export function configRecordList(
  config: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] {
  const value = config[key]
  if (!Array.isArray(value)) return []
  return value.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry),
  )
}
