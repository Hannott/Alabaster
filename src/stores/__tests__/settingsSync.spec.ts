import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { MoonrakerRequestTimeoutError } from '@/services/moonraker/errors'
import { useAuthStore } from '@/stores/auth'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrintersStore } from '@/stores/printers'

/*
 * `@/stores/settingsSync` pulls in `@/settings/bundle`, which pulls in
 * `useTheme` — and `useTheme` reads `window.matchMedia` the moment its
 * module first evaluates, which jsdom does not implement at all. Both go
 * through a dynamic import after `beforeAll` installs the stub below, for
 * the same reason `SettingsView.spec.ts` does.
 */
let useTheme: (typeof import('@/composables/useTheme'))['useTheme']
let useSettingsSyncStore: (typeof import('@/stores/settingsSync'))['useSettingsSyncStore']

beforeAll(async () => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
  ;({ useTheme } = await import('@/composables/useTheme'))
  ;({ useSettingsSyncStore } = await import('@/stores/settingsSync'))
})

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function emptyRemoteBundle(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    theme: { mode: 'dark', pack: 'alabaster' },
    font: 'sourceCodePro',
    textWeight: 'regular',
    consoleFont: 'match',
    consoleWeight: 'regular',
    locale: 'en',
    dateFormat: 'auto',
    timeFormat: 'auto',
    confirmations: {
      skipAll: false,
      skipByGroup: { printInterrupting: false },
      skipByKey: {},
      maintenanceReminderEnabled: false,
      maintenanceReminderSuppressedUntil: null,
    },
    dashboardProfile: {
      instances: [],
      placements: { desktop: [], tablet: [], mobile: [] },
      columnWidths: {},
    },
    ...overrides,
  }
}

describe('settings sync store', () => {
  function setup() {
    setActivePinia(createPinia())
    window.localStorage.clear()
    const moonraker = useMoonrakerStore()
    moonraker.connectionPhase = 'connected'
    return { moonraker }
  }

  function logIn(username = 'ada'): void {
    useAuthStore().currentUser = { username, source: 'moonraker' } as never
  }

  it('never calls Moonraker while disconnected', async () => {
    const { moonraker } = setup()
    moonraker.connectionPhase = 'connecting'
    const rpcCall = vi.spyOn(moonraker, 'rpcCall')

    const settingsSync = useSettingsSyncStore()
    await settingsSync.push()
    await settingsSync.pull()
    await settingsSync.forget()

    expect(rpcCall).not.toHaveBeenCalled()
  })

  it('keeps every setting in this browser while nobody is logged in', async () => {
    const { moonraker } = setup()
    usePrintersStore().addPrinter('voron.local:7125')
    const rpcCall = vi.spyOn(moonraker, 'rpcCall')

    const settingsSync = useSettingsSyncStore()
    settingsSync.start()
    await flushPromises()

    expect(settingsSync.isEnabled).toBe(false)
    expect(await settingsSync.push()).toBe(false)
    expect(rpcCall).not.toHaveBeenCalled()
    settingsSync.stop()
  })

  it("starts a user's profile from this browser's settings when the printer has none yet", async () => {
    const { moonraker } = setup()
    usePrintersStore().addPrinter('voron.local:7125')
    logIn()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'server.database.get_item') return Promise.reject(new Error('Key not found'))
      if (method === 'server.database.post_item') {
        return Promise.resolve({ namespace: 'alabaster', key: 'ada', value: {} }) as never
      }
      throw new Error(`unexpected method ${String(method)}`)
    })

    const settingsSync = useSettingsSyncStore()
    settingsSync.start()
    await flushPromises()

    expect(rpcCall).toHaveBeenCalledWith('server.database.get_item', {
      namespace: 'alabaster',
      key: 'ada',
    })
    expect(rpcCall).toHaveBeenCalledWith(
      'server.database.post_item',
      expect.objectContaining({ namespace: 'alabaster', key: 'ada' }),
    )
    expect(settingsSync.lastSyncedAt).not.toBeNull()
    settingsSync.stop()
  })

  it("applies a logged-in user's existing profile live", async () => {
    const { moonraker } = setup()
    usePrintersStore().addPrinter('voron.local:7125')
    const theme = useTheme()
    theme.setMode('light')

    const remote = emptyRemoteBundle()
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'server.database.get_item') {
        return Promise.resolve({ namespace: 'alabaster', key: 'ada', value: remote }) as never
      }
      throw new Error(`unexpected method ${String(method)}`)
    })

    const settingsSync = useSettingsSyncStore()
    settingsSync.start()
    logIn()
    await flushPromises()

    expect(theme.mode.value).toBe('dark')
    expect(settingsSync.lastSyncedAt).toBe(remote.updatedAt)
    settingsSync.stop()
  })

  /*
   * A push writes the whole bundle — pins included — over the user's profile.
   * A read that got no answer was once taken for "no profile yet", so a browser
   * whose settings were still defaults wrote them over the real ones.
   */
  describe('a profile that could not be reached', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    function timeOut() {
      return new MoonrakerRequestTimeoutError('server.database.get_item', 5000)
    }

    it('is left as it is, and nothing is written over it', async () => {
      const { moonraker } = setup()
      usePrintersStore().addPrinter('voron.local:7125')
      logIn()
      const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
        if (method === 'server.database.get_item') return Promise.reject(timeOut())
        throw new Error(`unexpected method ${String(method)}`)
      })

      const settingsSync = useSettingsSyncStore()
      settingsSync.start()
      await flushPromises()

      expect(rpcCall).not.toHaveBeenCalledWith('server.database.post_item', expect.anything())
      expect(settingsSync.lastSyncedAt).toBeNull()
      settingsSync.stop()
    })

    it('is not written over by the next edit either', async () => {
      const { moonraker } = setup()
      usePrintersStore().addPrinter('voron.local:7125')
      logIn()
      const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
        if (method === 'server.database.get_item') return Promise.reject(timeOut())
        throw new Error(`unexpected method ${String(method)}`)
      })

      const settingsSync = useSettingsSyncStore()
      settingsSync.start()
      await flushPromises()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      useTheme().setMode('light')
      await flushPromises()
      await vi.advanceTimersByTimeAsync(5000)

      expect(rpcCall).not.toHaveBeenCalledWith('server.database.post_item', expect.anything())
      settingsSync.stop()
    })

    it('is read on the next reconnect, and edits sync again once it has been', async () => {
      const { moonraker } = setup()
      usePrintersStore().addPrinter('voron.local:7125')
      logIn()
      let reachable = false
      const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
        if (method === 'server.database.get_item') {
          return reachable
            ? (Promise.resolve({
                namespace: 'alabaster',
                key: 'ada',
                value: emptyRemoteBundle(),
              }) as never)
            : Promise.reject(timeOut())
        }
        if (method === 'server.database.post_item') {
          return Promise.resolve({ namespace: 'alabaster', key: 'ada', value: {} }) as never
        }
        throw new Error(`unexpected method ${String(method)}`)
      })

      const settingsSync = useSettingsSyncStore()
      settingsSync.start()
      await flushPromises()

      reachable = true
      moonraker.connectionPhase = 'connecting'
      await flushPromises()
      moonraker.connectionPhase = 'connected'
      await flushPromises()
      expect(settingsSync.lastSyncedAt).toBe('2026-01-01T00:00:00.000Z')

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      useTheme().setMode('light')
      await flushPromises()
      await vi.advanceTimersByTimeAsync(2000)

      expect(rpcCall).toHaveBeenCalledWith(
        'server.database.post_item',
        expect.objectContaining({ namespace: 'alabaster', key: 'ada' }),
      )
      settingsSync.stop()
    })
  })

  it('treats a pull RPC error as "nothing synced yet" rather than a failure', async () => {
    const { moonraker } = setup()
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'server.database.get_item') return Promise.reject(new Error('Key not found'))
      throw new Error(`unexpected method ${String(method)}`)
    })

    const settingsSync = useSettingsSyncStore()
    const result = await settingsSync.pull()

    expect(result).toBeNull()
    expect(settingsSync.lastCommandError).toBeNull()
  })

  it('surfaces a genuine push failure through the command runner without retrying it', async () => {
    const { moonraker } = setup()
    logIn()
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'server.database.post_item') return Promise.reject(new Error('write failed'))
      throw new Error(`unexpected method ${String(method)}`)
    })

    const settingsSync = useSettingsSyncStore()
    const result = await settingsSync.push()

    expect(result).toBe(false)
    expect(settingsSync.lastCommandError).toBe('push')
    expect(settingsSync.lastSyncedAt).toBeNull()
  })

  it('resets pending command state on a printer switch', async () => {
    const realWebSocket = globalThis.WebSocket
    globalThis.WebSocket = class {
      static readonly CONNECTING = 0
      readyState = 0
      close(): void {}
      send(): void {}
    } as unknown as typeof WebSocket

    try {
      setActivePinia(createPinia())
      window.localStorage.clear()
      const moonraker = useMoonrakerStore()
      moonraker.connect('printer-a.local:7125')
      moonraker.connectionPhase = 'connected'
      logIn()

      const pushDeferred = createDeferred<{ namespace: string; key: string; value: unknown }>()
      vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
        if (method === 'server.database.post_item') return pushDeferred.promise as never
        throw new Error(`unexpected method ${String(method)}`)
      })

      const settingsSync = useSettingsSyncStore()
      settingsSync.start()
      const pending = settingsSync.push()
      expect(settingsSync.pendingCommands.push).toBe(true)

      moonraker.connect('printer-b.local:7125')

      expect(settingsSync.pendingCommands.push).toBe(false)

      pushDeferred.resolve({ namespace: 'alabaster', key: 'default', value: {} })
      await pending
      settingsSync.stop()
    } finally {
      globalThis.WebSocket = realWebSocket
    }
  })
})
