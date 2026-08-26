import { computed, ref, watch, type WatchStopHandle } from 'vue'
import { defineStore } from 'pinia'

import { readScoped, writeScoped } from '@/stores/printerScope'
import { usePrintersStore } from '@/stores/printers'
import { isRecord } from '@/utils/records'

export interface ServerInfoWarnings {
  failed_components?: unknown
  warnings?: unknown
}

export interface ServerNotice {
  id: string
  kind: 'failedComponent' | 'warning'
  /** The component name Moonraker could parse out of a `failed_components` entry, if any. */
  component: string | null
  message: string
}

const storageKey = 'alabaster.serverWarnings.muted.v1'

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function toFailedComponentNotice(entry: string): ServerNotice {
  const separator = entry.indexOf(': ')
  const component = separator > 0 ? entry.slice(0, separator) : null
  const message = separator > 0 ? entry.slice(separator + 2) : entry
  return { id: `failed:${entry}`, kind: 'failedComponent', component, message }
}

function toWarningNotice(entry: string): ServerNotice {
  return { id: `warning:${entry}`, kind: 'warning', component: null, message: entry }
}

function parsedStorage(): unknown {
  try {
    return JSON.parse(window.localStorage.getItem(storageKey) ?? 'null')
  } catch {
    return null
  }
}

/** Scoped per printer, like every other table tied to one machine's identity — a warning muted on one printer says nothing about another's. */
function savedMutedIds(scopeKeys: readonly string[]): Set<string> {
  const stored = parsedStorage()
  const scoped = isRecord(stored) ? readScoped(stored, scopeKeys) : null
  return new Set(readStringList(scoped))
}

function persistMutedIds(scopeKeys: readonly string[], mutedIds: ReadonlySet<string>): void {
  const stored = parsedStorage()
  const table = isRecord(stored) ? stored : {}
  window.localStorage.setItem(
    storageKey,
    JSON.stringify(writeScoped(table, scopeKeys, [...mutedIds])),
  )
}

/**
 * `server.info`'s `failed_components` and `warnings` — a component Moonraker
 * could not load (a sensor referencing an `[mqtt]` section that was never
 * configured, the case this store exists for) or another startup condition
 * worth surfacing. Neither has a notification of its own: both are decided
 * once, at Moonraker's own startup, so the re-read `ADR 0002` already performs
 * on every reconnect and lifecycle poll is what keeps this current — fixing
 * the config takes a Moonraker restart either way.
 *
 * Two different ways to stop seeing one, matching the choice offered where
 * this was designed from: "next reboot" (`snooze`) is local and by content,
 * not an RPC — unlike `server.announcements.dismiss`, Moonraker has no
 * endpoint to acknowledge a warning — so it stays hidden only until its exact
 * text disappears from a later report, or the session ends. "Never" (`mute`)
 * is the same idea made durable: persisted per printer in local storage,
 * because it is a promise across reloads that Moonraker itself cannot keep on
 * this store's behalf.
 */
export const useServerWarningsStore = defineStore('serverWarnings', () => {
  const printers = usePrintersStore()

  const notices = ref<ServerNotice[]>([])
  const snoozedIds = ref<Set<string>>(new Set())
  const readIds = ref<Set<string>>(new Set())
  const mutedIds = ref<Set<string>>(savedMutedIds(printers.activeScopeKeys))

  let started = false
  let stopScopeWatch: WatchStopHandle | null = null

  const visibleNotices = computed(() =>
    notices.value.filter(
      (notice) => !snoozedIds.value.has(notice.id) && !mutedIds.value.has(notice.id),
    ),
  )
  const hasNotices = computed(() => visibleNotices.value.length > 0)
  const hasUnread = computed(() =>
    visibleNotices.value.some((notice) => !readIds.value.has(notice.id)),
  )

  function applyServerInfo(serverInfo: ServerInfoWarnings): void {
    notices.value = [
      ...readStringList(serverInfo.failed_components).map(toFailedComponentNotice),
      ...readStringList(serverInfo.warnings).map(toWarningNotice),
    ]
  }

  /** Opening the notifications menu is what "reading" one of these means. */
  function markRead(): void {
    readIds.value = new Set([...readIds.value, ...notices.value.map((notice) => notice.id)])
  }

  function snooze(id: string): void {
    snoozedIds.value = new Set(snoozedIds.value).add(id)
  }

  function mute(id: string): void {
    mutedIds.value = new Set(mutedIds.value).add(id)
    persistMutedIds(printers.activeScopeKeys, mutedIds.value)
  }

  /** Another printer's Moonraker loads its own components and reports its own warnings. */
  function reset(): void {
    notices.value = []
    snoozedIds.value = new Set()
    readIds.value = new Set()
  }

  /**
   * Muted ids are reloaded once `activeScopeKeys` actually points at the new
   * printer, not on the printer-change instant itself: `reset` above already
   * clears `notices` synchronously on that instant (`moonraker.ts`'s
   * `connect`), so `visibleNotices` is empty regardless during the brief
   * window before the id moves — there is nothing for a stale mute list to
   * mismatch against.
   */
  function scopeChanged(): void {
    mutedIds.value = savedMutedIds(printers.activeScopeKeys)
  }

  function start(): void {
    if (started) return
    started = true
    stopScopeWatch = watch(() => printers.activeScopeKeys.join(','), scopeChanged)
  }

  function stop(): void {
    if (!started) return
    started = false
    stopScopeWatch?.()
    stopScopeWatch = null
  }

  return {
    notices,
    visibleNotices,
    hasNotices,
    hasUnread,
    snoozedIds,
    readIds,
    mutedIds,
    applyServerInfo,
    markRead,
    snooze,
    mute,
    reset,
    start,
    stop,
  }
})
