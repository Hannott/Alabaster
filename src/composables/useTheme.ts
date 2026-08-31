import { computed, readonly, ref } from 'vue'

import {
  defaultThemePackId,
  isThemePackId,
  lockedModeFor,
  type ThemePackId,
  themePacks,
} from '@/themes/registry'

/** What the user asked for. `system` is not a fourth visual theme — it means "whatever `prefers-color-scheme` says right now." */
export type ThemeMode = 'dark' | 'light' | 'system'
type EffectiveTheme = 'dark' | 'light'

const themeStorageKey = 'alabaster.theme'
const themePackStorageKey = 'alabaster.theme.pack'

export function isThemeMode(value: string): value is ThemeMode {
  return value === 'dark' || value === 'light' || value === 'system'
}

function getInitialMode(): ThemeMode {
  const saved = localStorage.getItem(themeStorageKey)
  return saved !== null && isThemeMode(saved) ? saved : 'system'
}

function getInitialThemePack(): ThemePackId {
  const savedThemePack = localStorage.getItem(themePackStorageKey)

  return savedThemePack && isThemePackId(savedThemePack) ? savedThemePack : defaultThemePackId
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function effectiveTheme(mode: ThemeMode): EffectiveTheme {
  return mode === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : mode
}

const mode = ref<ThemeMode>(getInitialMode())
const themePack = ref<ThemePackId>(getInitialThemePack())

/**
 * The stored preference, overridden by the active pack's own lock when it has
 * one — see `registry.ts`'s `lockedMode`. The preference itself is never
 * touched here, so switching to an unlocked pack later resolves back to
 * whatever `mode` was already asking for.
 */
function resolvedTheme(): EffectiveTheme {
  return lockedModeFor(themePack.value) ?? effectiveTheme(mode.value)
}

const theme = ref<EffectiveTheme>(resolvedTheme())

function applyTheme(nextTheme: EffectiveTheme): void {
  theme.value = nextTheme
  document.documentElement.dataset.theme = nextTheme
}

function refreshTheme(): void {
  applyTheme(resolvedTheme())
}

/**
 * `system` has to keep following the OS after it is chosen, not just read it
 * once — otherwise switching the OS theme while Alabaster is open would do
 * nothing until the next reload, which is the one thing "system" promises.
 * Recomputing through `resolvedTheme` rather than applying `event.matches`
 * directly is what keeps a locked pack from being knocked out of its one mode
 * by an OS change that no longer has any say while that pack is active.
 */
function handleSystemPreferenceChange(): void {
  if (mode.value === 'system') refreshTheme()
}

if (typeof window.matchMedia === 'function') {
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', handleSystemPreferenceChange)
}

function setMode(nextMode: ThemeMode): void {
  mode.value = nextMode
  localStorage.setItem(themeStorageKey, nextMode)
  refreshTheme()
}

function setThemePack(nextThemePack: ThemePackId): void {
  themePack.value = nextThemePack
  document.documentElement.dataset.themePack = nextThemePack
  localStorage.setItem(themePackStorageKey, nextThemePack)
  refreshTheme()
}

// `setThemePack` both sets the pack attribute and applies the resolved theme,
// so this one call covers the `data-theme` attribute `applyTheme` would
// otherwise need a separate initial call to set.
setThemePack(themePack.value)

export function useTheme() {
  const isDark = computed(() => theme.value === 'dark')
  /** The active pack's own mode, when it has one — see `registry.ts`'s `lockedMode`. */
  const lockedMode = computed(() => lockedModeFor(themePack.value))

  return {
    isDark,
    setThemePack,
    setMode,
    theme: readonly(theme),
    /** The user's stated preference — `dark`/`light`/`system` — not the resolved theme. */
    mode: readonly(mode),
    themePack: readonly(themePack),
    themePacks,
    lockedMode,
    /**
     * A binary quick-toggle between light and dark, for a future control that
     * has no room for a third state. Always an explicit choice — it never
     * re-enters `system` — since the Settings page's Mode group is the only
     * way back there. No shipped UI calls this today.
     */
    toggleTheme: () => setMode(isDark.value ? 'light' : 'dark'),
  }
}
