import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

import type {
  JsonRpcNotification,
  MoonrakerAuthInfo,
  MoonrakerUserInfo,
} from '@/services/moonraker'
import { createCommandRunner } from '@/stores/commandRunner'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrintersStore } from '@/stores/printers'
import { isRecord } from '@/utils/records'

/** Moonraker's own reserved pseudo-users (`authorization.py`'s `RESERVED_USERS`) — never a real account. */
const reservedUsernames = ['_TRUSTED_USER_', '_API_KEY_USER_']

export const authCommandKeys = [
  'login',
  'logout',
  'createUser',
  'deleteUser',
  'changePassword',
  'regenerateApiKey',
] as const

export type AuthCommandKey = (typeof authCommandKeys)[number]

/**
 * Moonraker's `access.*` domain — real login against a printer whose Moonraker
 * enforces it (`force_logins` plus at least one configured user), and managing
 * that printer's own user accounts. Verified against Moonraker's own source
 * (`moonraker/components/authorization.py`) rather than the checklist's
 * earlier guessed method names; see `types.ts`'s `MoonrakerRpcMethods` comment
 * for what differs.
 *
 * The overwhelming majority of printers never see any of this: `access.info`
 * only reports `login_required: true` once an operator has deliberately
 * configured it, so every *display* of it is gated behind the caller checking
 * `serverCapabilities.hasComponent('authorization')` first, the same
 * optimistic-until-proven-otherwise precedent `spool.ts` already uses for
 * `spoolman`.
 *
 * `info` and `currentUser` are the exception to "read on demand" below: the
 * header's account shortcut (`App.vue`) has to know whether login is required
 * or someone is already signed in before the reader ever opens Settings, so
 * `start()` loads them itself the moment a connection exists rather than
 * waiting for a page to ask. `users` and the API key stay lazy, gated behind
 * Settings' Users category actually being open, since nothing outside that
 * card ever needs either.
 */
export const useAuthStore = defineStore('auth', () => {
  const moonraker = useMoonrakerStore()
  const printers = usePrintersStore()

  const info = ref<MoonrakerAuthInfo | null>(null)
  const currentUser = ref<MoonrakerUserInfo | null>(null)
  const users = ref<MoonrakerUserInfo[]>([])
  const apiKey = ref<string | null>(null)
  const isLoading = ref(false)
  const isLoadingUsers = ref(false)
  const isLoadingApiKey = ref(false)
  /** Whether `loadUsers()` has ever been asked for — gates whether the live-update notifications below bother re-fetching. */
  let usersRequested = false

  const commands = createCommandRunner<AuthCommandKey>(authCommandKeys)
  const { pendingCommands, lastCommandError, lastCommandErrorMessage } = commands

  const disposers: Array<() => void> = []
  let stopPrinterChangeReset: (() => void) | null = null
  let stopConnectionWatch: (() => void) | null = null
  let started = false

  /**
   * `access.info` + `access.get_user`. Unlike `loadUsers`/`loadApiKey` below,
   * this runs once automatically per connection (`start()`'s own watch) —
   * the header's account shortcut needs both before any page has asked for
   * them, so there is no "on demand" moment to defer this to.
   */
  async function load(): Promise<void> {
    if (!moonraker.isConnected) return
    isLoading.value = true
    try {
      info.value = await moonraker.rpcCall('access.info')
      const user = await moonraker.rpcCall('access.get_user')
      // A trusted connection has a "current user" too — Moonraker's own
      // reserved `_TRUSTED_USER_`/`_API_KEY_USER_` sentinels, verified live
      // against a printer whose [authorization] section trusts this LAN and
      // has no users configured. Neither is a real account: showing either
      // literally would read as "logged in as _TRUSTED_USER_" instead of the
      // plain "trusted connection" state `auth.info.trusted` already answers.
      currentUser.value =
        user.username === null || reservedUsernames.includes(user.username) ? null : user
    } catch {
      // No `authorization` component, or a genuine request failure — either
      // way the caller's own capability gate decides whether to show
      // anything, so whatever was already known is left in place.
    } finally {
      isLoading.value = false
    }
  }

  async function loadUsers(): Promise<void> {
    if (!moonraker.isConnected) return
    usersRequested = true
    isLoadingUsers.value = true
    try {
      const result = await moonraker.rpcCall('access.users.list')
      users.value = result.users
    } catch {
      users.value = []
    } finally {
      isLoadingUsers.value = false
    }
  }

  async function loadApiKey(): Promise<void> {
    if (!moonraker.isConnected) return
    isLoadingApiKey.value = true
    try {
      apiKey.value = await moonraker.rpcCall('access.get_api_key')
    } catch {
      apiKey.value = null
    } finally {
      isLoadingApiKey.value = false
    }
  }

  /**
   * Persists the refresh token against whichever printer this connection is
   * for — never the password itself. `moonraker.ts`'s `refreshIdentity` hook
   * is what exchanges it for a fresh access token on every future connection.
   */
  function storeRefreshToken(token: string | null): void {
    if (printers.activeEntry) printers.setRefreshToken(printers.activeEntry.id, token)
  }

  /**
   * `source` is only sent when the caller supplied one — most printers never
   * configure a second [ldap] source, and Moonraker already defaults to
   * `default_source` when it's omitted.
   */
  function login(username: string, password: string, source?: string): Promise<boolean> {
    return commands.run('login', async () => {
      const result = source
        ? await moonraker.rpcCall('access.login', { username, password, source })
        : await moonraker.rpcCall('access.login', { username, password })
      storeRefreshToken(result.refresh_token)
      await load()
    })
  }

  function logout(): Promise<boolean> {
    return commands.run('logout', async () => {
      await moonraker.rpcCall('access.logout')
      currentUser.value = null
      storeRefreshToken(null)
    })
  }

  /**
   * Moonraker's own behavior, not a choice made here: `access.post_user`
   * creates the account *and* logs this connection into it immediately,
   * returning the same token pair `access.login` would — there is no
   * "provision an account for someone else without touching my own session"
   * variant. The caller's own UI copy says so, so this isn't a surprise.
   */
  function createUser(username: string, password: string): Promise<boolean> {
    return commands.run('createUser', async () => {
      const result = await moonraker.rpcCall('access.post_user', { username, password })
      storeRefreshToken(result.refresh_token)
      await Promise.all([load(), loadUsers()])
    })
  }

  /** Moonraker itself refuses a request to delete the account making it — this never targets `currentUser`. */
  function deleteUser(username: string): Promise<boolean> {
    return commands.run('deleteUser', async () => {
      await moonraker.rpcCall('access.delete_user', { username })
      await loadUsers()
    })
  }

  function changePassword(password: string, newPassword: string): Promise<boolean> {
    return commands.run('changePassword', async () => {
      await moonraker.rpcCall('access.user.password', { password, new_password: newPassword })
    })
  }

  function regenerateApiKey(): Promise<boolean> {
    return commands.run('regenerateApiKey', async () => {
      apiKey.value = await moonraker.rpcCall('access.post_api_key')
    })
  }

  const clearCommandError = commands.clearCommandError

  /** `notify_user_created` — another connection (or this one) registered an account; the list must not go stale. */
  function handleUserCreated(): void {
    if (usersRequested) void loadUsers()
  }

  /** `notify_user_deleted` — same, and clears the session if the deleted account was this one's own. */
  function handleUserDeleted(notification: JsonRpcNotification): void {
    if (usersRequested) void loadUsers()
    const payload = notification.params[0]
    if (isRecord(payload) && payload.username === currentUser.value?.username) {
      currentUser.value = null
      storeRefreshToken(null)
    }
  }

  /** `notify_user_logged_out` — this exact account was logged out, possibly from elsewhere, not necessarily via this store's own `logout()`. */
  function handleUserLoggedOut(notification: JsonRpcNotification): void {
    const payload = notification.params[0]
    if (isRecord(payload) && payload.username === currentUser.value?.username) {
      currentUser.value = null
      storeRefreshToken(null)
    }
  }

  /** Whichever printer this was describing is no longer the one in front. */
  function printerChanged(): void {
    info.value = null
    currentUser.value = null
    users.value = []
    apiKey.value = null
    usersRequested = false
    commands.reset()
  }

  function start(): void {
    if (started) return
    started = true
    disposers.push(
      moonraker.onNotification('notify_user_created', handleUserCreated),
      moonraker.onNotification('notify_user_deleted', handleUserDeleted),
      moonraker.onNotification('notify_user_logged_out', handleUserLoggedOut),
    )
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    // Every printer this connects to gets one `load()`, connected or
    // reconnected, so the header's account shortcut never has to wait for a
    // page to visit Settings first — most printers answer with
    // `login_required: false` and no current user, which is the common case
    // this costs one cheap round trip on.
    stopConnectionWatch = watch(
      () => moonraker.isConnected,
      (connected) => {
        if (connected) void load()
      },
      { immediate: true },
    )
  }

  function stop(): void {
    if (!started) return
    started = false
    stopConnectionWatch?.()
    stopConnectionWatch = null
    stopPrinterChangeReset?.()
    stopPrinterChangeReset = null
    while (disposers.length > 0) disposers.pop()?.()
  }

  return {
    info,
    currentUser,
    users,
    apiKey,
    isLoading,
    isLoadingUsers,
    isLoadingApiKey,
    pendingCommands,
    lastCommandError,
    lastCommandErrorMessage,
    load,
    loadUsers,
    loadApiKey,
    login,
    logout,
    createUser,
    deleteUser,
    changePassword,
    regenerateApiKey,
    clearCommandError,
    start,
    stop,
  }
})
