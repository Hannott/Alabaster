import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { JsonRpcNotification, MoonrakerAnnouncementEntry } from '@/services/moonraker'
import { useAnnouncementsStore } from '@/stores/announcements'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'

function makeEntry(
  overrides: Partial<MoonrakerAnnouncementEntry> = {},
): MoonrakerAnnouncementEntry {
  return {
    entry_id: '1',
    url: 'https://example.invalid/notice',
    title: 'Moonraker update available',
    description: '',
    priority: 'normal',
    date: 1,
    dismissed: false,
    date_dismissed: null,
    dismiss_wake: null,
    source: 'moonlight',
    feed: 'moonraker',
    ...overrides,
  }
}

function wireStore() {
  const moonraker = useMoonrakerStore()
  const availability = useAvailabilityStore()
  let updateHandler: ((notification: JsonRpcNotification) => void) | undefined
  let dismissedHandler: ((notification: JsonRpcNotification) => void) | undefined
  const rpcCall = vi.spyOn(moonraker, 'rpcCall')
  vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
    if (method === 'notify_announcement_update') updateHandler = handler
    if (method === 'notify_announcement_dismissed') dismissedHandler = handler
    return () => undefined
  })
  vi.spyOn(moonraker, 'onPrinterChange').mockImplementation(() => () => undefined)
  availability.moonrakerConnected({ klippy_connected: false, klippy_state: 'disconnected' })

  const store = useAnnouncementsStore()
  return {
    store,
    rpcCall,
    update: (entries: unknown[]) =>
      updateHandler?.({
        jsonrpc: '2.0',
        method: 'notify_announcement_update',
        params: [{ entries }],
      }),
    dismissed: (entryId: string) =>
      dismissedHandler?.({
        jsonrpc: '2.0',
        method: 'notify_announcement_dismissed',
        params: [{ entry_id: entryId }],
      }),
  }
}

describe('announcements store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('reads undismissed entries once Moonraker connects', async () => {
    const { store, rpcCall } = wireStore()
    rpcCall.mockResolvedValue({ entries: [makeEntry()], feeds: ['moonraker'] })

    store.start()
    await Promise.resolve()
    await Promise.resolve()

    expect(rpcCall).toHaveBeenCalledWith('server.announcements.list', {
      include_dismissed: false,
    })
    expect(store.hasEntries).toBe(true)
    expect(store.entries[0]?.title).toBe('Moonraker update available')
  })

  it('treats a refused call as no announcements rather than an error', async () => {
    const { store, rpcCall } = wireStore()
    rpcCall.mockRejectedValue(new Error('method not found'))

    store.start()
    await Promise.resolve()
    await Promise.resolve()

    expect(store.entries).toEqual([])
  })

  it('replaces the list on a live update and removes one on dismissal', async () => {
    const { store, rpcCall, update, dismissed } = wireStore()
    rpcCall.mockResolvedValue({ entries: [], feeds: [] })
    store.start()
    await Promise.resolve()
    await Promise.resolve()

    update([makeEntry({ entry_id: '1' }), makeEntry({ entry_id: '2', priority: 'high' })])
    expect(store.entries).toHaveLength(2)
    expect(store.hasHighPriority).toBe(true)

    dismissed('1')
    expect(store.entries.map((entry) => entry.entry_id)).toEqual(['2'])
  })

  it('dismisses through the RPC and drops the entry on success', async () => {
    const { store, rpcCall } = wireStore()
    rpcCall.mockResolvedValueOnce({ entries: [makeEntry({ entry_id: '1' })], feeds: [] })
    store.start()
    await Promise.resolve()
    await Promise.resolve()

    rpcCall.mockResolvedValueOnce({ entry_id: '1' })
    const succeeded = await store.dismiss('1')

    expect(succeeded).toBe(true)
    expect(rpcCall).toHaveBeenCalledWith('server.announcements.dismiss', { entry_id: '1' })
    expect(store.entries).toEqual([])
    expect(store.dismissingIds.has('1')).toBe(false)
  })
})
