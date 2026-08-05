import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { useFont } from '@/composables/useFont'
import { useWakeLock } from '@/composables/useWakeLock'
import { useConfirmationsStore } from '@/stores/confirmations'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'

/*
 * `@/settings/bundle` pulls in `useTheme`, which reads `window.matchMedia`
 * the moment its module first evaluates — jsdom has no implementation at
 * all. A static import here would run before `beforeAll` installs the stub
 * below and fail every time, since ES module evaluation happens at import
 * time regardless of where the `import` keyword sits in the file. See
 * `SettingsView.spec.ts` for the same shape.
 */
let applySettingsBundle: (typeof import('@/settings/bundle'))['applySettingsBundle']
let collectSettingsBundle: (typeof import('@/settings/bundle'))['collectSettingsBundle']
let defaultSettingsBundle: (typeof import('@/settings/bundle'))['defaultSettingsBundle']
let useTheme: (typeof import('@/composables/useTheme'))['useTheme']

beforeAll(async () => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
  ;({ applySettingsBundle, collectSettingsBundle, defaultSettingsBundle } =
    await import('@/settings/bundle'))
  ;({ useTheme } = await import('@/composables/useTheme'))
})

describe('settings bundle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('round-trips theme, font, and confirmations through collect and apply', async () => {
    const theme = useTheme()
    const font = useFont()
    const confirmations = useConfirmationsStore()

    theme.setMode('light')
    font.setFontId('sourceCodePro')
    confirmations.setSkip('removePrinter', false)

    const bundle = collectSettingsBundle()
    expect(bundle.theme.mode).toBe('light')
    expect(bundle.font).toBe('sourceCodePro')
    expect(bundle.confirmations.skipByKey.removePrinter).toBe(false)

    // Move every collected value away from what was captured, then restore
    // the captured bundle and confirm every one of them comes back.
    theme.setMode('dark')
    confirmations.setSkip('removePrinter', true)

    await applySettingsBundle(bundle)

    expect(theme.mode.value).toBe('light')
    expect(confirmations.skipByKey.removePrinter).toBe(false)
  })

  it('leaves every field untouched when given something that is not a record', async () => {
    const theme = useTheme()
    theme.setMode('dark')

    await applySettingsBundle('not an object')

    expect(theme.mode.value).toBe('dark')
  })

  it('skips an unrecognized value rather than writing it through', async () => {
    const theme = useTheme()
    theme.setMode('light')

    await applySettingsBundle({ theme: { mode: 'nonsense' } })

    expect(theme.mode.value).toBe('light')
  })

  it('excludes device ergonomics — wake lock is never read or written', async () => {
    const wakeLock = useWakeLock()
    wakeLock.setEnabled(true)

    const bundle = collectSettingsBundle() as unknown as Record<string, unknown>
    expect(bundle.wakeLock).toBeUndefined()
    expect(bundle.sidebar).toBeUndefined()

    await applySettingsBundle({ ...bundle, wakeLockEnabled: false })
    expect(wakeLock.enabled.value).toBe(true)
  })

  it('builds a default bundle with every confirmation key present and an empty dashboard preset', () => {
    const bundle = defaultSettingsBundle()

    expect(bundle.confirmations.skipAll).toBe(false)
    expect(bundle.confirmations.skipByKey.removePrinter).toBe(false)
    expect(bundle.dashboardProfile.instances.length).toBeGreaterThan(0)
  })

  it('applying the default bundle resets a store back to its own default', async () => {
    const layout = useDashboardLayoutStore()
    layout.setVisible('desktop', layout.profile.instances[0]!.instanceId, false)
    expect(
      layout.profile.placements.desktop.find(
        (p) => p.instanceId === layout.profile.instances[0]!.instanceId,
      )?.visible,
    ).toBe(false)

    await applySettingsBundle(defaultSettingsBundle())

    expect(layout.profile).toEqual(defaultSettingsBundle().dashboardProfile)
  })
})
