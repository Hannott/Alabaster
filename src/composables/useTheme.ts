import { computed, readonly, ref } from 'vue'

import { defaultThemePackId, isThemePackId, type ThemePackId, themePacks } from '@/themes/registry'

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
const theme = ref<EffectiveTheme>(effectiveTheme(mode.value))
const themePack = ref<ThemePackId>(getInitialThemePack())

function applyTheme(nextTheme: EffectiveTheme): void {
  theme.value = nextTheme
  document.documentElement.dataset.theme = nextTheme
}

/**
 * `system` has to keep following the OS after it is chosen, not just read it
 * once — otherwise switching the OS theme while Alabaster is open would do
 * nothing until the next reload, which is the one thing "system" promises.
 */
function handleSystemPreferenceChange(event: MediaQueryListEvent): void {
  if (mode.value === 'system') applyTheme(event.matches ? 'dark' : 'light')
}

if (typeof window.matchMedia === 'function') {
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', handleSystemPreferenceChange)
}

function setMode(nextMode: ThemeMode): void {
  mode.value = nextMode
  localStorage.setItem(themeStorageKey, nextMode)
  applyTheme(effectiveTheme(nextMode))
}

function setThemePack(nextThemePack: ThemePackId): void {
  themePack.value = nextThemePack
  document.documentElement.dataset.themePack = nextThemePack
  localStorage.setItem(themePackStorageKey, nextThemePack)
}

applyTheme(theme.value)
setThemePack(themePack.value)

export function useTheme() {
  const isDark = computed(() => theme.value === 'dark')

  return {
    isDark,
    setThemePack,
    setMode,
    theme: readonly(theme),
    /** The user's stated preference — `dark`/`light`/`system` — not the resolved theme. */
    mode: readonly(mode),
    themePack: readonly(themePack),
    themePacks,
    /**
     * The header's quick toggle: an explicit choice, same as it always was.
     * It never re-enters `system` — the Settings page is the only way back
     * there, since a binary icon has no third state to represent.
     */
    toggleTheme: () => setMode(isDark.value ? 'light' : 'dark'),
  }
}
