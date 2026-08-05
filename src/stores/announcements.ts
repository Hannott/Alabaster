import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import type { JsonRpcNotification, MoonrakerAnnouncementEntry } from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { isRecord } from '@/utils/records'

function readEntry(value: unknown): MoonrakerAnnouncementEntry | null {
  if (!isRecord(value)) return null
  const entryId = typeof value.entry_id === 'string' ? value.entry_id : ''
  if (entryId === '') return null
  return {
    entry_id: entryId,
    url: typeof value.url === 'string' ? value.url : '',
    title: typeof value.title === 'string' ? value.title : '',
    description: typeof value.description === 'string' ? value.description : '',
    priority: value.priority === 'high' ? 'high' : 'normal',
    date: typeof value.date === 'number' ? value.date : 0,
    dismissed: value.dismissed === true,
    date_dismissed: typeof value.date_dismissed === 'number' ? value.date_dismissed : null,
    dismiss_wake: typeof value.dismiss_wake === 'number' ? value.dismiss_wake : null,
    source: typeof value.source === 'string' ? value.source : '',
    feed: typeof value.feed === 'string' ? value.feed : '',
  }
}

function readEntryList(value: unknown): MoonrakerAnnouncementEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    const entry = readEntry(candidate)
    return entry ? [entry] : []
  })
}

/**
 * `server.announcements.*` — Moonraker/Klipper/component release notices, the
 * one header notice `docs/design/navigation-plan.md` names as a real gap: it
 * belongs beside the existing notification menu, not the rail, since it is a
 * reading rather than a destination.
 */
export const useAnnouncementsStore = defineStore('announcements', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()

  const entries = ref<MoonrakerAnnouncementEntry[]>([])
  const dismissingIds = ref<Set<string>>(new Set())

  const disposers: Array<() => void> = []
  let stopAvailabilityWatch: WatchStopHandle | null = null
  let stopPrinterChangeReset: (() => void) | null = null
  let started = false

  const hasEntries = computed(() => entries.value.length > 0)
  const hasHighPriority = computed(() => entries.value.some((entry) => entry.priority === 'high'))

  async function refresh(): Promise<void> {
    try {
      const result = await moonraker.rpcCall('server.announcements.list', {
        include_dismissed: false,
      })
      entries.value = readEntryList(result.entries)
    } catch {
      // An ancient Moonraker predating this feature reports nothing rather
      // than an error banner nobody configured a section to gate against.
      entries.value = []
    }
  }

  function handleUpdate(notification: JsonRpcNotification): void {
    const payload = notification.params[0]
    if (!isRecord(payload)) return
    entries.value = readEntryList(payload.entries)
  }

  function handleDismissed(notification: JsonRpcNotification): void {
    const payload = notification.params[0]
    if (!isRecord(payload) || typeof payload.entry_id !== 'string') return
    entries.value = entries.value.filter((entry) => entry.entry_id !== payload.entry_id)
  }

  async function dismiss(entryId: string): Promise<boolean> {
    if (dismissingIds.value.has(entryId)) return false
    dismissingIds.value = new Set(dismissingIds.value).add(entryId)
    try {
      await moonraker.rpcCall('server.announcements.dismiss', { entry_id: entryId })
      entries.value = entries.value.filter((entry) => entry.entry_id !== entryId)
      return true
    } catch {
      return false
    } finally {
      const next = new Set(dismissingIds.value)
      next.delete(entryId)
      dismissingIds.value = next
    }
  }

  /** Another printer's Moonraker follows its own feeds. */
  function printerChanged(): void {
    entries.value = []
    dismissingIds.value = new Set()
  }

  function start(): void {
    if (started) return
    started = true
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    disposers.push(
      moonraker.onNotification('notify_announcement_update', handleUpdate),
      moonraker.onNotification('notify_announcement_dismissed', handleDismissed),
    )
    stopAvailabilityWatch = watch(
      () => availability.isMoonrakerConnected,
      (isConnected) => {
        if (isConnected) void refresh()
      },
      { immediate: true },
    )
  }

  function stop(): void {
    if (!started) return
    started = false
    stopAvailabilityWatch?.()
    stopAvailabilityWatch = null
    stopPrinterChangeReset?.()
    stopPrinterChangeReset = null
    while (disposers.length > 0) disposers.pop()?.()
  }

  return {
    entries,
    dismissingIds,
    hasEntries,
    hasHighPriority,
    refresh,
    dismiss,
    start,
    stop,
  }
})
