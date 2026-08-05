import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import { useHistoryStore } from '@/stores/history'
import { useMaintenanceStore } from '@/stores/maintenance'
import { usePrintersStore } from '@/stores/printers'

describe('maintenance store', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('starts with no intervals and nothing overdue', () => {
    const maintenance = useMaintenanceStore()
    expect(maintenance.intervals).toEqual([])
    expect(maintenance.hasOverdue).toBe(false)
  })

  it('anchors a new interval to the printer’s current totals', () => {
    const history = useHistoryStore()
    history.totals = {
      jobs: 1,
      totalTime: 0,
      printTime: 360_000,
      filamentUsed: 12_000,
      longestJob: 0,
      longestPrint: 0,
      auxiliaryTotals: [],
    }
    const maintenance = useMaintenanceStore()

    maintenance.addInterval('Belt tension', 'printtime', 100)

    expect(maintenance.intervals).toHaveLength(1)
    expect(maintenance.intervals[0]).toMatchObject({
      name: 'Belt tension',
      kind: 'printtime',
      value: 100,
      baselinePrintTime: 360_000,
      baselineFilament: 12_000,
    })
  })

  it('reports overdue once an interval elapses, and reaches the header gate through hasOverdue', () => {
    const history = useHistoryStore()
    history.totals = {
      jobs: 1,
      totalTime: 0,
      printTime: 0,
      filamentUsed: 0,
      longestJob: 0,
      longestPrint: 0,
      auxiliaryTotals: [],
    }
    const maintenance = useMaintenanceStore()
    maintenance.addInterval('Belt tension', 'printtime', 10)

    history.totals = { ...history.totals, printTime: 11 * 3600 }

    expect(maintenance.hasOverdue).toBe(true)
    expect(maintenance.overdueRows).toHaveLength(1)
  })

  it('clears an overdue interval by marking it performed, re-anchoring to the current totals', () => {
    const history = useHistoryStore()
    history.totals = {
      jobs: 1,
      totalTime: 0,
      printTime: 20 * 3600,
      filamentUsed: 0,
      longestJob: 0,
      longestPrint: 0,
      auxiliaryTotals: [],
    }
    const maintenance = useMaintenanceStore()
    maintenance.addInterval('Belt tension', 'printtime', 10)
    history.totals = { ...history.totals, printTime: 31 * 3600 }
    expect(maintenance.hasOverdue).toBe(true)

    const id = maintenance.intervals[0]!.id
    maintenance.markPerformed(id)

    expect(maintenance.hasOverdue).toBe(false)
    expect(maintenance.intervals[0]!.baselinePrintTime).toBe(31 * 3600)
  })

  it('removes an interval', () => {
    const maintenance = useMaintenanceStore()
    maintenance.addInterval('Belt tension', 'printtime', 10)
    const id = maintenance.intervals[0]!.id

    maintenance.deleteInterval(id)

    expect(maintenance.intervals).toEqual([])
  })

  /**
   * server.history.reset_totals leaves nothing behind except the totals
   * themselves falling — that is the one signal a baseline has gone stale,
   * and it must not be reported as freshly overdue.
   */
  it('needs a new baseline, not an alarm, when the printer’s totals regress under it', () => {
    const history = useHistoryStore()
    history.totals = {
      jobs: 1,
      totalTime: 0,
      printTime: 500 * 3600,
      filamentUsed: 0,
      longestJob: 0,
      longestPrint: 0,
      auxiliaryTotals: [],
    }
    const maintenance = useMaintenanceStore()
    maintenance.addInterval('Belt tension', 'printtime', 100)

    history.totals = { ...history.totals, printTime: 10 * 3600 }

    expect(maintenance.hasOverdue).toBe(false)
    expect(maintenance.rows[0]?.result.status).toBe('needsBaseline')
  })

  it('persists intervals across a reload of the store', () => {
    const maintenance = useMaintenanceStore()
    maintenance.addInterval('Belt tension', 'printtime', 10)

    setActivePinia(createPinia())
    const reloaded = useMaintenanceStore()

    expect(reloaded.intervals).toHaveLength(1)
    expect(reloaded.intervals[0]?.name).toBe('Belt tension')
  })

  /**
   * `onPrinterChange` fires before the printers store has retargeted its own
   * `activeId`, so a switch clears immediately and reloads the new printer's
   * own intervals once `activeScopeKeys` actually catches up — the same
   * two-step `console.ts` uses, and the reason it is two functions rather
   * than one.
   */
  it('reloads the new printer’s own intervals once the scope key catches up', async () => {
    const printers = usePrintersStore()
    const printerA = printers.addPrinter('printer-a.local:7125')!
    printers.selectPrinter(printerA.id)
    const maintenance = useMaintenanceStore()
    maintenance.start()
    maintenance.addInterval('Belt tension', 'printtime', 10)
    expect(maintenance.intervals).toHaveLength(1)

    const printerB = printers.addPrinter('printer-b.local:7125')!
    printers.selectPrinter(printerB.id)
    await nextTick()

    expect(maintenance.intervals).toEqual([])

    printers.selectPrinter(printerA.id)
    await nextTick()

    expect(maintenance.intervals).toHaveLength(1)
    expect(maintenance.intervals[0]?.name).toBe('Belt tension')
  })
})
