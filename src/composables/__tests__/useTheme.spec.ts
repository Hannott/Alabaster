import { beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (event: MediaQueryListEvent) => void

function stubMatchMedia(initialMatches: boolean) {
  let matches = initialMatches
  const listeners: Listener[] = []
  window.matchMedia = ((query: string) => ({
    get matches() {
      return matches
    },
    media: query,
    addEventListener: (_type: string, listener: Listener) => {
      listeners.push(listener)
    },
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia

  return {
    setSystemDark(next: boolean): void {
      matches = next
      for (const listener of listeners) {
        listener({ matches: next } as MediaQueryListEvent)
      }
    },
  }
}

describe('useTheme', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    vi.resetModules()
  })

  it('follows the system preference by default', async () => {
    stubMatchMedia(true)
    const { useTheme } = await import('@/composables/useTheme')
    const { isDark, mode } = useTheme()

    expect(mode.value).toBe('system')
    expect(isDark.value).toBe(true)
  })

  it('keeps following the system after it changes, while in system mode', async () => {
    const system = stubMatchMedia(false)
    const { useTheme } = await import('@/composables/useTheme')
    const { isDark } = useTheme()
    expect(isDark.value).toBe(false)

    system.setSystemDark(true)
    expect(isDark.value).toBe(true)
  })

  it('stops following the system once an explicit mode is chosen', async () => {
    const system = stubMatchMedia(false)
    const { useTheme } = await import('@/composables/useTheme')
    const { isDark, setMode } = useTheme()

    setMode('dark')
    expect(isDark.value).toBe(true)

    // The OS switching afterward must not override the explicit choice.
    system.setSystemDark(false)
    expect(isDark.value).toBe(true)
  })

  it('can return to system after an explicit choice', async () => {
    stubMatchMedia(true)
    const { useTheme } = await import('@/composables/useTheme')
    const { isDark, mode, setMode } = useTheme()

    setMode('light')
    expect(isDark.value).toBe(false)

    setMode('system')
    expect(mode.value).toBe('system')
    expect(isDark.value).toBe(true)
  })

  it('persists the explicit mode across a reload', async () => {
    stubMatchMedia(false)
    const first = await import('@/composables/useTheme')
    first.useTheme().setMode('dark')

    vi.resetModules()
    stubMatchMedia(false)
    const second = await import('@/composables/useTheme')
    expect(second.useTheme().mode.value).toBe('dark')
  })

  it('toggling sets an explicit mode, never system', async () => {
    stubMatchMedia(true)
    const { useTheme } = await import('@/composables/useTheme')
    const { isDark, mode, toggleTheme } = useTheme()
    expect(isDark.value).toBe(true)

    toggleTheme()
    expect(mode.value).toBe('light')
    expect(isDark.value).toBe(false)
  })

  describe('a pack with a locked mode', () => {
    it('overrides the light/dark preference without changing it', async () => {
      stubMatchMedia(false)
      const { useTheme } = await import('@/composables/useTheme')
      const { isDark, mode, lockedMode, setMode, setThemePack } = useTheme()

      setMode('light')
      expect(isDark.value).toBe(false)

      // Terminal locks dark — see registry.ts's `lockedMode`.
      setThemePack('terminal')
      expect(lockedMode.value).toBe('dark')
      expect(isDark.value).toBe(true)
      // The stated preference itself is untouched by the lock.
      expect(mode.value).toBe('light')
    })

    it('restores the prior preference once an unlocked pack is chosen again', async () => {
      stubMatchMedia(false)
      const { useTheme } = await import('@/composables/useTheme')
      const { isDark, lockedMode, setMode, setThemePack } = useTheme()

      setMode('light')
      setThemePack('terminal')
      expect(isDark.value).toBe(true)

      setThemePack('alabaster')
      expect(lockedMode.value).toBeNull()
      expect(isDark.value).toBe(false)
    })

    it('ignores system preference changes while active', async () => {
      const system = stubMatchMedia(false)
      const { useTheme } = await import('@/composables/useTheme')
      const { isDark, setThemePack } = useTheme()

      setThemePack('terminal')
      expect(isDark.value).toBe(true)

      // Neither direction of an OS flip may pull a locked pack out of its mode.
      system.setSystemDark(true)
      expect(isDark.value).toBe(true)
      system.setSystemDark(false)
      expect(isDark.value).toBe(true)
    })
  })
})
