import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { useConsoleSettings } from '@/composables/useConsoleSettings'
import { useFont } from '@/composables/useFont'
import { useMachineFilePins } from '@/composables/useMachineFilePins'
import { useMachineFilesSettings } from '@/composables/useMachineFilesSettings'
import { useHistoryStore } from '@/stores/history'
import { useMaintenanceStore } from '@/stores/maintenance'
import { useServerWarningsStore } from '@/stores/serverWarnings'
import { useWakeLock } from '@/composables/useWakeLock'
import { useTooltipPreferences } from '@/composables/useTooltipPreferences'
import { useCommandPreferencesStore } from '@/stores/commandPreferences'
import { useConfirmationsStore } from '@/stores/confirmations'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'
import { useDocumentationSiteStore } from '@/stores/documentationSite'
import { useZMotionStore } from '@/stores/zMotion'
import { useBeltGuideStore } from '@/stores/beltGuide'

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

  it("carries the active printer's Z motion, and repairs a malformed one to the default", async () => {
    const zMotion = useZMotionStore()
    zMotion.setMovingPart('bed')
    zMotion.setZPlus('up')
    const bundle = collectSettingsBundle()
    expect(bundle.zMotion).toEqual({ movingPart: 'bed', zPlus: 'up' })

    await applySettingsBundle({ zMotion: { movingPart: 'gantry', zPlus: 'up' } })
    expect(zMotion.motion).toEqual({ movingPart: 'nozzle', zPlus: 'up' })

    await applySettingsBundle(bundle)
    expect(zMotion.motion).toEqual({ movingPart: 'bed', zPlus: 'up' })
  })

  it("carries the active printer's documentation site, and clears one it does not know", async () => {
    const documentationSite = useDocumentationSiteStore()
    documentationSite.setSite('kalico')
    const bundle = collectSettingsBundle()
    expect(bundle.documentationSite).toBe('kalico')

    await applySettingsBundle({ documentationSite: 'marlin' })
    expect(documentationSite.stored).toBeNull()

    await applySettingsBundle(bundle)
    expect(documentationSite.stored).toBe('kalico')
  })

  it("carries the active printer's belt guide values, and clears them on a null", async () => {
    const beltGuide = useBeltGuideStore()
    beltGuide.update({ toolheadGrams: 800, gantryGrams: 600 })
    const bundle = collectSettingsBundle()
    expect(bundle.beltGuide).toMatchObject({ toolheadGrams: 800, gantryGrams: 600 })

    await applySettingsBundle({ beltGuide: null })
    expect(beltGuide.stored).toBeNull()

    await applySettingsBundle(bundle)
    expect(beltGuide.values).toMatchObject({ toolheadGrams: 800, gantryGrams: 600 })
  })

  it('carries the console, file list, history, maintenance, and muted-warning settings', async () => {
    const consoleSettings = useConsoleSettings()
    const machineFiles = useMachineFilesSettings()
    const pins = useMachineFilePins()
    const history = useHistoryStore()
    const maintenance = useMaintenanceStore()
    const serverWarnings = useServerWarningsStore()
    const pin = {
      kind: 'file' as const,
      root: 'config' as const,
      path: 'printer.cfg',
      name: 'printer.cfg',
      size: 1,
      modified: 1,
      permissions: 'rw',
    }

    consoleSettings.update({ compact: true })
    machineFiles.setSortKey('size')
    pins.pinFile(pin)
    history.setPeriod('12m')
    maintenance.addInterval('Belts', 'printtime', 200)
    serverWarnings.mute('warning:x')
    const bundle = collectSettingsBundle()

    consoleSettings.update({ compact: false })
    machineFiles.setSortKey('name')
    pins.unpinFile('config', 'printer.cfg')
    history.setPeriod('30d')
    maintenance.replaceIntervals([])
    serverWarnings.replaceMuted([])
    await applySettingsBundle(JSON.parse(JSON.stringify(bundle)))

    expect(consoleSettings.settings.value.compact).toBe(true)
    expect(machineFiles.sortKey.value).toBe('size')
    expect(pins.isPinned('config', 'printer.cfg')).toBe(true)
    expect(history.period).toBe('12m')
    expect(maintenance.intervals.map((interval) => interval.name)).toEqual(['Belts'])
    expect([...serverWarnings.mutedIds]).toEqual(['warning:x'])

    // Reset restores preferences but keeps what the reader made.
    await applySettingsBundle(defaultSettingsBundle())
    expect(machineFiles.sortKey.value).toBe('name')
    expect(pins.isPinned('config', 'printer.cfg')).toBe(true)
    expect(maintenance.intervals).toHaveLength(1)
  })

  it('carries the command preferences with or without a logged-in user', async () => {
    const preferences = useCommandPreferencesStore()
    preferences.setDispatch('wait')
    preferences.setShowQueue(true)
    const bundle = collectSettingsBundle()
    expect(bundle.commands).toEqual({ dispatch: 'wait', showQueue: true })

    preferences.setDispatch('queue')
    // A bundle written before the field existed leaves the device's own value.
    await applySettingsBundle({ commands: null })
    expect(preferences.dispatch).toBe('queue')
    await applySettingsBundle(bundle)
    expect(preferences.dispatch).toBe('wait')
    expect(preferences.showQueue).toBe(true)
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

  it('carries tooltip preferences, and a bundle that predates them leaves them alone', async () => {
    const tooltips = useTooltipPreferences()
    tooltips.setAnimate(false)
    tooltips.setDurationMs(900)
    tooltips.setDelayMs(120)

    const bundle = collectSettingsBundle()
    expect(bundle.tooltips).toEqual({ animate: false, durationMs: 900, delayMs: 120 })

    tooltips.reset()
    await applySettingsBundle(bundle)
    expect(tooltips.preferences.value).toEqual({ animate: false, durationMs: 900, delayMs: 120 })

    await applySettingsBundle({ theme: { mode: 'light' } })
    expect(tooltips.preferences.value.durationMs).toBe(900)

    expect(defaultSettingsBundle().tooltips).toEqual({
      animate: true,
      durationMs: 280,
      delayMs: 300,
    })
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
