import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { usePrintersStore } from '@/stores/printers'
import { useServerWarningsStore } from '@/stores/serverWarnings'

describe('server warnings store', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('reports no notices until Moonraker has said otherwise', () => {
    const warnings = useServerWarningsStore()

    expect(warnings.hasNotices).toBe(false)
    expect(warnings.notices).toEqual([])
  })

  it('splits a failed component entry into its component name and reason', () => {
    const warnings = useServerWarningsStore()

    warnings.applyServerInfo({
      failed_components: ['mqtt: An error was detected while loading the moonraker component'],
    })

    expect(warnings.notices).toEqual([
      {
        id: 'failed:mqtt: An error was detected while loading the moonraker component',
        kind: 'failedComponent',
        component: 'mqtt',
        message: 'An error was detected while loading the moonraker component',
      },
    ])
  })

  it('falls back to the raw text when a failed component entry carries no name', () => {
    const warnings = useServerWarningsStore()

    warnings.applyServerInfo({ failed_components: ['could not initialize'] })

    expect(warnings.notices).toEqual([
      {
        id: 'failed:could not initialize',
        kind: 'failedComponent',
        component: null,
        message: 'could not initialize',
      },
    ])
  })

  it('carries a general warning as its own notice, untouched', () => {
    const warnings = useServerWarningsStore()

    warnings.applyServerInfo({
      warnings: ["Failed to configure sensor [sensor my_sensor]\nNo section: 'mqtt'"],
    })

    expect(warnings.notices).toEqual([
      {
        id: "warning:Failed to configure sensor [sensor my_sensor]\nNo section: 'mqtt'",
        kind: 'warning',
        component: null,
        message: "Failed to configure sensor [sensor my_sensor]\nNo section: 'mqtt'",
      },
    ])
  })

  it('ignores entries that are not strings rather than trusting the payload', () => {
    const warnings = useServerWarningsStore()

    warnings.applyServerInfo({
      failed_components: ['mqtt: broken', 7, null] as unknown as string[],
      warnings: 'not a list' as unknown as string[],
    })

    expect(warnings.notices).toHaveLength(1)
    expect(warnings.notices[0]?.component).toBe('mqtt')
  })

  it('replaces the list on a later report instead of merging it', () => {
    const warnings = useServerWarningsStore()

    warnings.applyServerInfo({ warnings: ['first'] })
    warnings.applyServerInfo({ warnings: ['second'] })

    expect(warnings.notices.map((notice) => notice.message)).toEqual(['second'])
  })

  it('hides a snoozed notice without discarding an unsnoozed one', () => {
    const warnings = useServerWarningsStore()
    warnings.applyServerInfo({ warnings: ['keep', 'go away'] })
    const target = warnings.notices.find((notice) => notice.message === 'go away')

    warnings.snooze(target!.id)

    expect(warnings.hasNotices).toBe(true)
    expect(warnings.visibleNotices.map((notice) => notice.message)).toEqual(['keep'])
  })

  it('hides a muted notice the same as a snoozed one', () => {
    const warnings = useServerWarningsStore()
    warnings.applyServerInfo({ warnings: ['keep', 'muted'] })
    const target = warnings.notices.find((notice) => notice.message === 'muted')

    warnings.mute(target!.id)

    expect(warnings.visibleNotices.map((notice) => notice.message)).toEqual(['keep'])
  })

  it('persists a muted notice across a fresh store — "never" survives a reload, unlike a snooze', () => {
    const printers = usePrintersStore()
    printers.addPrinter('ws://voron.local/websocket')
    const warnings = useServerWarningsStore()
    warnings.applyServerInfo({ warnings: ['annoying'] })
    warnings.mute(warnings.notices[0]!.id)

    setActivePinia(createPinia())
    const reloadedPrinters = usePrintersStore()
    reloadedPrinters.addPrinter('ws://voron.local/websocket')
    const reloaded = useServerWarningsStore()
    reloaded.applyServerInfo({ warnings: ['annoying'] })

    expect(reloaded.visibleNotices).toEqual([])
  })

  it('reports everything unread until the menu has been opened', () => {
    const warnings = useServerWarningsStore()
    warnings.applyServerInfo({ warnings: ['fresh'] })

    expect(warnings.hasUnread).toBe(true)

    warnings.markRead()

    expect(warnings.hasUnread).toBe(false)
  })

  it('marks a newly reported notice unread again even after the rest were read', () => {
    const warnings = useServerWarningsStore()
    warnings.applyServerInfo({ warnings: ['first'] })
    warnings.markRead()
    expect(warnings.hasUnread).toBe(false)

    warnings.applyServerInfo({ warnings: ['first', 'second'] })

    expect(warnings.hasUnread).toBe(true)
  })

  it('forgets snoozes, read state and notices on reset, but not a permanent mute', () => {
    const warnings = useServerWarningsStore()
    warnings.applyServerInfo({ warnings: ['keep', 'muted'] })
    warnings.snooze(warnings.notices.find((notice) => notice.message === 'keep')!.id)
    warnings.mute(warnings.notices.find((notice) => notice.message === 'muted')!.id)
    warnings.markRead()

    warnings.reset()

    expect(warnings.notices).toEqual([])
    expect(warnings.snoozedIds.size).toBe(0)
    expect(warnings.readIds.size).toBe(0)
    expect(warnings.hasNotices).toBe(false)
    expect(warnings.mutedIds.size).toBe(1)
  })
})
