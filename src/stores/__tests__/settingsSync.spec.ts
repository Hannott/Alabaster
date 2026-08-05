import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, describe, expect, it, vi } from 'vitest'

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

  it('enabling sync with nothing stored yet pushes the current bundle', async () => {
    const { moonraker } = setup()
    const printers = usePrintersStore()
    const entry = printers.addPrinter('voron.local:7125')!

    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'server.database.get_item') return Promise.reject(new Error('Key not found'))
      if (method === 'server.database.post_item') {
        return Promise.resolve({ namespace: 'alabaster', key: 'default', value: {} }) as never
      }
      throw new Error(`unexpected method ${String(method)}`)
    })

    const settingsSync = useSettingsSyncStore()
    await settingsSync.setEnabled(entry.id, true)

    expect(rpcCall).toHaveBeenCalledWith('server.database.get_item', {
      namespace: 'alabaster',
      key: 'default',
    })
    expect(rpcCall).toHaveBeenCalledWith(
      'server.database.post_item',
      expect.objectContaining({ namespace: 'alabaster', key: 'default' }),
    )
    expect(settingsSync.lastSyncedAt).not.toBeNull()
    expect(printers.entries[0]?.dbSyncEnabled).toBe(true)
  })

  it('enabling sync with an existing remote profile pulls and applies it live', async () => {
    const { moonraker } = setup()
    const printers = usePrintersStore()
    const entry = printers.addPrinter('voron.local:7125')!
    const theme = useTheme()
    theme.setMode('light')

    const remote = emptyRemoteBundle()
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'server.database.get_item') {
        return Promise.resolve({ namespace: 'alabaster', key: 'default', value: remote }) as never
      }
      throw new Error(`unexpected method ${String(method)}`)
    })

    const settingsSync = useSettingsSyncStore()
    await settingsSync.setEnabled(entry.id, true)

    expect(theme.mode.value).toBe('dark')
    expect(settingsSync.lastSyncedAt).toBe(remote.updatedAt)
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
