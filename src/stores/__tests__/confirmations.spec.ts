import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { confirmationKeys, useConfirmationsStore } from '@/stores/confirmations'

describe('confirmations store', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('confirms everything by default', () => {
    const confirmations = useConfirmationsStore()
    for (const key of confirmationKeys) {
      expect(confirmations.shouldConfirm(key)).toBe(true)
    }
  })

  it('skips only the key that was turned off', () => {
    const confirmations = useConfirmationsStore()
    confirmations.setSkip('removePrinter', true)

    expect(confirmations.shouldConfirm('removePrinter')).toBe(false)
    expect(confirmations.shouldConfirm('emergencyStop')).toBe(true)
  })

  it('skipAll overrides every individual key, on or off', () => {
    const confirmations = useConfirmationsStore()
    confirmations.setSkip('emergencyStop', false)
    confirmations.setSkipAll(true)

    for (const key of confirmationKeys) {
      expect(confirmations.shouldConfirm(key)).toBe(false)
    }

    confirmations.setSkipAll(false)
    expect(confirmations.shouldConfirm('emergencyStop')).toBe(true)
    expect(confirmations.shouldConfirm('removePrinter')).toBe(true)
  })

  it('persists across a fresh store instance', () => {
    const first = useConfirmationsStore()
    first.setSkip('deleteHistoryJob', true)
    first.setSkipAll(false)

    setActivePinia(createPinia())
    const second = useConfirmationsStore()

    expect(second.shouldConfirm('deleteHistoryJob')).toBe(false)
    expect(second.shouldConfirm('reprintJob')).toBe(true)
  })

  it('falls back to confirming everything when storage is corrupt', () => {
    window.localStorage.setItem('alabaster.confirmations.v1', '{not json')
    const confirmations = useConfirmationsStore()

    for (const key of confirmationKeys) {
      expect(confirmations.shouldConfirm(key)).toBe(true)
    }
  })

  it('ignores unrecognised keys from a future or hand-edited profile', () => {
    window.localStorage.setItem(
      'alabaster.confirmations.v1',
      JSON.stringify({ skipAll: false, skipByKey: { notARealKey: true, removePrinter: true } }),
    )
    const confirmations = useConfirmationsStore()

    expect(confirmations.shouldConfirm('removePrinter')).toBe(false)
    expect((confirmations.skipByKey as Record<string, boolean>).notARealKey).toBeUndefined()
  })

  describe('the pre-print maintenance reminder', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('never shows while off, which is the default', () => {
      const confirmations = useConfirmationsStore()
      expect(confirmations.shouldShowMaintenanceReminder()).toBe(false)
    })

    it('shows once turned on, with nothing suppressing it yet', () => {
      const confirmations = useConfirmationsStore()
      confirmations.setMaintenanceReminderEnabled(true)
      expect(confirmations.shouldShowMaintenanceReminder()).toBe(true)
    })

    it('quiets until the next local midnight once answered', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 7, 15, 14, 0, 0))
      const confirmations = useConfirmationsStore()
      confirmations.setMaintenanceReminderEnabled(true)

      confirmations.suppressMaintenanceReminderUntilTomorrow()
      expect(confirmations.shouldShowMaintenanceReminder()).toBe(false)

      vi.setSystemTime(new Date(2026, 7, 15, 23, 59, 59))
      expect(confirmations.shouldShowMaintenanceReminder()).toBe(false)

      vi.setSystemTime(new Date(2026, 7, 16, 0, 0, 1))
      expect(confirmations.shouldShowMaintenanceReminder()).toBe(true)
    })

    it('"not now" quiets it for seven days, well past the daily cap', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 7, 15, 14, 0, 0))
      const confirmations = useConfirmationsStore()
      confirmations.setMaintenanceReminderEnabled(true)

      confirmations.snoozeMaintenanceReminder()
      expect(confirmations.shouldShowMaintenanceReminder()).toBe(false)

      vi.setSystemTime(new Date(2026, 7, 16, 14, 0, 0))
      expect(confirmations.shouldShowMaintenanceReminder()).toBe(false)

      vi.setSystemTime(new Date(2026, 7, 22, 14, 0, 1))
      expect(confirmations.shouldShowMaintenanceReminder()).toBe(true)
    })

    it('persists the enabled flag and suppression across a fresh store instance', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 7, 15, 14, 0, 0))
      const first = useConfirmationsStore()
      first.setMaintenanceReminderEnabled(true)
      first.snoozeMaintenanceReminder()

      setActivePinia(createPinia())
      const second = useConfirmationsStore()

      expect(second.maintenanceReminderEnabled).toBe(true)
      expect(second.shouldShowMaintenanceReminder()).toBe(false)
    })
  })
})
