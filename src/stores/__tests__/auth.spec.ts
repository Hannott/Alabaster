import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { JsonRpcNotification, NotificationHandler } from '@/services/moonraker'
import { useAuthStore } from '@/stores/auth'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrintersStore } from '@/stores/printers'

function spyNotifications() {
  const moonraker = useMoonrakerStore()
  const handlers = new Map<string, NotificationHandler>()
  vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
    handlers.set(method, handler)
    return () => handlers.delete(method)
  })
  return handlers
}

function fire(handlers: Map<string, NotificationHandler>, method: string, payload: unknown): void {
  const notification: JsonRpcNotification = { jsonrpc: '2.0', method, params: [payload] }
  handlers.get(method)?.(notification)
}

describe('auth store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setActivePinia(createPinia())
    window.localStorage.clear()
    const moonraker = useMoonrakerStore()
    moonraker.connectionPhase = 'connected'
  })

  it('never asks Moonraker anything while disconnected', async () => {
    const moonraker = useMoonrakerStore()
    moonraker.connectionPhase = 'connecting'
    const rpcCall = vi.spyOn(moonraker, 'rpcCall')

    const auth = useAuthStore()
    await auth.load()
    await auth.loadUsers()
    await auth.loadApiKey()

    expect(rpcCall).not.toHaveBeenCalled()
  })

  it('reads authorization info and the current user on demand', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'access.info') {
        return Promise.resolve({
          default_source: 'moonraker',
          available_sources: ['moonraker'],
          login_required: true,
          trusted: false,
        }) as never
      }
      if (method === 'access.get_user') {
        return Promise.resolve({
          username: 'alice',
          source: 'moonraker',
          created_on: 1_700_000_000,
        }) as never
      }
      throw new Error(`unexpected method ${String(method)}`)
    })

    const auth = useAuthStore()
    await auth.load()

    expect(auth.info?.login_required).toBe(true)
    expect(auth.currentUser?.username).toBe('alice')
  })

  it('treats "no current user" as null rather than a fabricated entry', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'access.info') {
        return Promise.resolve({
          default_source: 'moonraker',
          available_sources: ['moonraker'],
          login_required: false,
          trusted: true,
        }) as never
      }
      if (method === 'access.get_user') {
        return Promise.resolve({ username: null, source: null, created_on: null }) as never
      }
      throw new Error(`unexpected method ${String(method)}`)
    })

    const auth = useAuthStore()
    await auth.load()

    expect(auth.currentUser).toBeNull()
  })

  it('logs in, persists the refresh token against the active printer, and reports success', async () => {
    const printers = usePrintersStore()
    const entry = printers.addPrinter('voron.local:7125')
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'access.login') {
        return Promise.resolve({
          username: 'alice',
          token: 'access-token',
          refresh_token: 'refresh-token',
          action: 'user_logged_in',
          source: 'moonraker',
        }) as never
      }
      if (method === 'access.info') {
        return Promise.resolve({
          default_source: 'moonraker',
          available_sources: ['moonraker'],
          login_required: true,
          trusted: false,
        }) as never
      }
      if (method === 'access.get_user') {
        return Promise.resolve({
          username: 'alice',
          source: 'moonraker',
          created_on: 1_700_000_000,
        }) as never
      }
      throw new Error(`unexpected method ${String(method)}`)
    })

    const auth = useAuthStore()
    const success = await auth.login('alice', 'hunter2')

    expect(success).toBe(true)
    expect(auth.currentUser?.username).toBe('alice')
    expect(printers.entries.find((candidate) => candidate.id === entry!.id)?.refreshToken).toBe(
      'refresh-token',
    )
    expect(rpcCall).toHaveBeenCalledWith('access.login', { username: 'alice', password: 'hunter2' })
  })

  it('reports a failed login without touching any stored session', async () => {
    const printers = usePrintersStore()
    printers.addPrinter('voron.local:7125')
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'access.login') return Promise.reject(new Error('Invalid Password'))
      throw new Error(`unexpected method ${String(method)}`)
    })

    const auth = useAuthStore()
    const success = await auth.login('alice', 'wrong')

    expect(success).toBe(false)
    expect(auth.lastCommandError).toBe('login')
    expect(auth.currentUser).toBeNull()
  })

  it('logs out, clearing both the session and the stored refresh token', async () => {
    const printers = usePrintersStore()
    const entry = printers.addPrinter('voron.local:7125')
    printers.setRefreshToken(entry!.id, 'refresh-token')
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'access.logout') {
        return Promise.resolve({ username: 'alice', action: 'user_logged_out' }) as never
      }
      throw new Error(`unexpected method ${String(method)}`)
    })

    const auth = useAuthStore()
    const success = await auth.logout()

    expect(success).toBe(true)
    expect(auth.currentUser).toBeNull()
    expect(printers.entries.find((candidate) => candidate.id === entry!.id)?.refreshToken).toBe(
      undefined,
    )
  })

  it("creating a user logs this connection in as them, matching Moonraker's own behavior", async () => {
    const printers = usePrintersStore()
    const entry = printers.addPrinter('voron.local:7125')
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'access.post_user') {
        return Promise.resolve({
          username: 'bob',
          token: 'access-token',
          refresh_token: 'bobs-refresh-token',
          action: 'user_created',
          source: 'moonraker',
        }) as never
      }
      if (method === 'access.info') {
        return Promise.resolve({
          default_source: 'moonraker',
          available_sources: ['moonraker'],
          login_required: true,
          trusted: false,
        }) as never
      }
      if (method === 'access.get_user') {
        return Promise.resolve({
          username: 'bob',
          source: 'moonraker',
          created_on: 1_700_000_000,
        }) as never
      }
      if (method === 'access.users.list') {
        return Promise.resolve({
          users: [{ username: 'bob', source: 'moonraker', created_on: 1 }],
        }) as never
      }
      throw new Error(`unexpected method ${String(method)}`)
    })

    const auth = useAuthStore()
    const success = await auth.createUser('bob', 'hunter2')

    expect(success).toBe(true)
    expect(auth.currentUser?.username).toBe('bob')
    expect(printers.entries.find((candidate) => candidate.id === entry!.id)?.refreshToken).toBe(
      'bobs-refresh-token',
    )
  })

  it('deletes a user and refreshes the list, never targeting the current session', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'access.delete_user') {
        return Promise.resolve({ username: 'bob', action: 'user_deleted' }) as never
      }
      if (method === 'access.users.list') return Promise.resolve({ users: [] }) as never
      throw new Error(`unexpected method ${String(method)}`)
    })

    const auth = useAuthStore()
    const success = await auth.deleteUser('bob')

    expect(success).toBe(true)
    expect(rpcCall).toHaveBeenCalledWith('access.delete_user', { username: 'bob' })
    expect(auth.users).toEqual([])
  })

  it('changes the password through the command runner', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'access.user.password') {
        return Promise.resolve({ username: 'alice', action: 'user_password_reset' }) as never
      }
      throw new Error(`unexpected method ${String(method)}`)
    })

    const auth = useAuthStore()
    const success = await auth.changePassword('old', 'new')

    expect(success).toBe(true)
    expect(rpcCall).toHaveBeenCalledWith('access.user.password', {
      password: 'old',
      new_password: 'new',
    })
  })

  it('regenerates the API key', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'access.post_api_key') return Promise.resolve('new-key-value') as never
      throw new Error(`unexpected method ${String(method)}`)
    })

    const auth = useAuthStore()
    await auth.regenerateApiKey()

    expect(auth.apiKey).toBe('new-key-value')
  })

  it('resets on a printer switch, since none of it describes the new printer', async () => {
    const realWebSocket = globalThis.WebSocket
    globalThis.WebSocket = class {
      static readonly CONNECTING = 0
      readyState = 0
      close(): void {}
      send(): void {}
    } as unknown as typeof WebSocket

    try {
      const moonraker = useMoonrakerStore()
      moonraker.connect('printer-a.local:7125')
      moonraker.connectionPhase = 'connected'
      vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
        if (method === 'access.info') {
          return Promise.resolve({
            default_source: 'moonraker',
            available_sources: ['moonraker'],
            login_required: true,
            trusted: false,
          }) as never
        }
        if (method === 'access.get_user') {
          return Promise.resolve({
            username: 'alice',
            source: 'moonraker',
            created_on: 1,
          }) as never
        }
        throw new Error(`unexpected method ${String(method)}`)
      })

      const auth = useAuthStore()
      auth.start()
      await auth.load()
      expect(auth.currentUser?.username).toBe('alice')

      moonraker.connect('printer-b.local:7125')

      expect(auth.currentUser).toBeNull()
      expect(auth.info).toBeNull()
      auth.stop()
    } finally {
      globalThis.WebSocket = realWebSocket
    }
  })

  it('reacts to notify_user_logged_out for this exact account, not any other', async () => {
    const handlers = spyNotifications()
    const moonraker = useMoonrakerStore()
    const printers = usePrintersStore()
    const entry = printers.addPrinter('voron.local:7125')
    printers.setRefreshToken(entry!.id, 'refresh-token')
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'access.info') {
        return Promise.resolve({
          default_source: 'moonraker',
          available_sources: ['moonraker'],
          login_required: true,
          trusted: false,
        }) as never
      }
      if (method === 'access.get_user') {
        return Promise.resolve({ username: 'alice', source: 'moonraker', created_on: 1 }) as never
      }
      throw new Error(`unexpected method ${String(method)}`)
    })

    const auth = useAuthStore()
    auth.start()
    await auth.load()
    expect(auth.currentUser?.username).toBe('alice')

    fire(handlers, 'notify_user_logged_out', { username: 'someone-else' })
    expect(auth.currentUser?.username).toBe('alice')

    fire(handlers, 'notify_user_logged_out', { username: 'alice' })
    expect(auth.currentUser).toBeNull()
    expect(printers.entries.find((candidate) => candidate.id === entry!.id)?.refreshToken).toBe(
      undefined,
    )
    auth.stop()
  })
})
