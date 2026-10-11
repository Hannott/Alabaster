import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { i18n } from '@/i18n'
import { applySettingsBundle, collectSettingsBundle, type SettingsBundle } from '@/settings/bundle'
import { createCommandRunner } from '@/stores/commandRunner'
import { useAuthStore } from '@/stores/auth'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrintersStore } from '@/stores/printers'
import { useToastsStore } from '@/stores/toasts'
import { isRecord } from '@/utils/records'

/** Every synced profile lives under this one namespace in a printer's own Moonraker database. */
const namespace = 'alabaster'

const metaStorageKey = 'alabaster.settingsSync.v1'

/**
 * When this browser last pushed or accepted a pull, per printer and user:
 * the status line, and the floor `checkForRemoteUpdate` will not apply an
 * older profile below. Per user because each user's profile is its own —
 * one user's last sync says nothing about another's on the same printer.
 */
function metaKey(printerId: string, user: string): string {
  return `${printerId}|${user}`
}

function readLastSyncedAt(key: string): string | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(metaStorageKey) ?? 'null')
    const value = isRecord(parsed) ? parsed[key] : undefined
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

function writeLastSyncedAt(key: string, updatedAt: string | null): void {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(metaStorageKey) ?? '{}')
    const record: Record<string, string> = {}
    if (isRecord(parsed)) {
      for (const [id, value] of Object.entries(parsed)) {
        if (typeof value === 'string') record[id] = value
      }
    }
    if (updatedAt === null) delete record[key]
    else record[key] = updatedAt
    window.localStorage.setItem(metaStorageKey, JSON.stringify(record))
  } catch {
    // A full or unavailable store costs the status line, never the sync itself.
  }
}

const syncCommandKeys = ['push', 'pull', 'forget'] as const
type SyncCommandKey = (typeof syncCommandKeys)[number]

/**
 * Settings/layout persistence phase 3 — the Moonraker-DB sync seam the
 * Settings plan left open. Every setting and the dashboard layout are saved to
 * the logged-in Moonraker user's profile, automatically, in the active
 * printer's own database — never a profile that follows a user across
 * different printers. Without a login nothing is synced: each browser keeps
 * its own settings, so a screen at the printer and a computer elsewhere never
 * overwrite each other. See `docs/architecture/0008-settings-and-layout-sync.md`.
 *
 * `server.database` is a core Moonraker component, unlike `authorization` or
 * `spoolman` — no `hasComponent` gate guards any call here.
 */
export const useSettingsSyncStore = defineStore('settingsSync', () => {
  const moonraker = useMoonrakerStore()
  const printers = usePrintersStore()
  const auth = useAuthStore()
  const toasts = useToastsStore()

  const commands = createCommandRunner<SyncCommandKey>(syncCommandKeys)
  const { pendingCommands, lastCommandError, lastCommandErrorMessage, clearCommandError } = commands

  const disposers: Array<() => void> = []
  let stopPrinterChangeReset: (() => void) | null = null
  let started = false
  let pushDebounceTimer: ReturnType<typeof setTimeout> | null = null

  const syncKey = computed(() => auth.currentUser?.username ?? null)
  const isEnabled = computed(() => syncKey.value !== null)
  const activeMetaKey = computed(() =>
    printers.activeId && syncKey.value !== null ? metaKey(printers.activeId, syncKey.value) : null,
  )

  /**
   * `localStorage` is not itself reactive, so a write bumps this to force
   * `lastSyncedAt` to re-read — and reading `printers.activeId` live, rather
   * than snapshotting it into a plain ref from `printerChanged()`, sidesteps
   * `moonraker.ts`'s `connect()` ordering: on some paths the registered
   * printer-change resets run *before* `printers.activeId` itself updates
   * (`connect`'s own comment explains why), so anything that captured the id
   * at reset time would read the printer just left, not the one arriving.
   */
  const syncMetaVersion = ref(0)
  const lastSyncedAt = computed<string | null>(() => {
    void syncMetaVersion.value
    return activeMetaKey.value ? readLastSyncedAt(activeMetaKey.value) : null
  })

  function recordSynced(updatedAt: string): void {
    if (!activeMetaKey.value) return
    writeLastSyncedAt(activeMetaKey.value, updatedAt)
    syncMetaVersion.value += 1
  }

  function clearSynced(): void {
    if (!activeMetaKey.value) return
    writeLastSyncedAt(activeMetaKey.value, null)
    syncMetaVersion.value += 1
  }

  /**
   * Moonraker raises an RPC error for a namespace/key that has never been
   * written — every call here uses a fixed, always-valid namespace and key,
   * so any RPC error from `get_item` specifically can only mean "nothing
   * synced here yet," not a malformed request.
   */
  async function pull(): Promise<SettingsBundle | null> {
    const key = syncKey.value
    if (!moonraker.isConnected || key === null) return null
    let result: SettingsBundle | null = null
    await commands.run('pull', async () => {
      try {
        const response = await moonraker.rpcCall('server.database.get_item', { namespace, key })
        result = isRecord(response.value) ? (response.value as unknown as SettingsBundle) : null
      } catch {
        result = null
      }
    })
    return result
  }

  async function push(): Promise<boolean> {
    const key = syncKey.value
    if (!moonraker.isConnected || key === null) return false
    return commands.run('push', async () => {
      const bundle = collectSettingsBundle()
      await moonraker.rpcCall('server.database.post_item', { namespace, key, value: bundle })
      recordSynced(bundle.updatedAt)
    })
  }

  async function forget(): Promise<boolean> {
    const key = syncKey.value
    if (!moonraker.isConnected || key === null) return false
    return commands.run('forget', async () => {
      await moonraker.rpcCall('server.database.delete_item', { namespace, key })
      clearSynced()
    })
  }

  /**
   * Runs whenever a user's profile becomes reachable — a login, a reconnect, a
   * printer switch. A user with no profile on this printer yet starts one
   * from this browser's current settings; an existing one newer than this
   * browser last applied replaces them, and an older one is left alone, so a
   * reconnect never rolls back an edit this browser has not pushed yet.
   */
  async function syncProfile(): Promise<void> {
    if (!isEnabled.value) return
    const remote = await pull()
    if (!remote) {
      await push()
      return
    }
    if (lastSyncedAt.value !== null && remote.updatedAt <= lastSyncedAt.value) return
    await applySettingsBundle(remote)
    recordSynced(remote.updatedAt)
    toasts.push(i18n.global.t('backup.sync.restoredToast'))
  }

  /**
   * `collectSettingsBundle()`'s own `updatedAt` changes on every call, so it
   * is excluded here — otherwise every reactive re-evaluation would look like
   * a change and push on a timer regardless of whether anything moved.
   */
  function comparableSnapshot(): string {
    return JSON.stringify({ ...collectSettingsBundle(), updatedAt: undefined })
  }

  function scheduleAutoPush(): void {
    if (pushDebounceTimer) clearTimeout(pushDebounceTimer)
    pushDebounceTimer = setTimeout(() => void push(), 1500)
  }

  function printerChanged(): void {
    commands.reset()
    if (pushDebounceTimer) clearTimeout(pushDebounceTimer)
    pushDebounceTimer = null
  }

  function start(): void {
    if (started) return
    started = true

    disposers.push(
      // Only a real change while sync is live schedules a push — the
      // transition into a reachable profile is `syncProfile`'s job, not
      // this watcher's.
      watch(
        () => (isEnabled.value && moonraker.isConnected ? comparableSnapshot() : null),
        (value, oldValue) => {
          if (value !== null && oldValue !== null && value !== oldValue) scheduleAutoPush()
        },
      ),
      watch(
        () => (moonraker.isConnected ? activeMetaKey.value : null),
        (key) => {
          if (key !== null) void syncProfile()
        },
        { immediate: true },
      ),
    )
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
  }

  function stop(): void {
    if (!started) return
    started = false
    if (pushDebounceTimer) clearTimeout(pushDebounceTimer)
    pushDebounceTimer = null
    stopPrinterChangeReset?.()
    stopPrinterChangeReset = null
    while (disposers.length > 0) disposers.pop()?.()
  }

  return {
    isEnabled,
    lastSyncedAt,
    pendingCommands,
    lastCommandError,
    lastCommandErrorMessage,
    clearCommandError,
    push,
    pull,
    forget,
    start,
    stop,
  }
})
