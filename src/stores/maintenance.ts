import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import {
  maintenanceIntervalState,
  type MaintenanceIntervalKind,
  type MaintenanceIntervalResult,
} from '@/features/history/maintenance'
import { useHistoryStore } from '@/stores/history'
import { useMoonrakerStore } from '@/stores/moonraker'
import { readScoped, writeScoped } from '@/stores/printerScope'
import { usePrintersStore } from '@/stores/printers'
import { isRecord } from '@/utils/records'

/**
 * Service reminders counted against a printer's own lifetime print time,
 * filament, or the calendar — the actionable half of the History destination,
 * per `docs/design/navigation-plan.md`: "the numbers are a page and the
 * consequence is a card." A reminder nobody scrolls to is not a reminder,
 * which is why this store's overdue state also drives Print's own header
 * action rather than living only inside this module's own card.
 */
export interface MaintenanceInterval {
  id: string
  name: string
  kind: MaintenanceIntervalKind
  /** Hours for `printtime`, metres for `filament`, days for `date`. */
  value: number
  baselinePrintTime: number
  baselineFilament: number
  baselineDate: number
}

const storageKey = 'alabaster.maintenance.intervals.v1'

function parsedStorage(): unknown {
  try {
    return JSON.parse(window.localStorage.getItem(storageKey) ?? 'null')
  } catch {
    return null
  }
}

function isMaintenanceInterval(value: unknown): value is MaintenanceInterval {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (value.kind === 'printtime' || value.kind === 'filament' || value.kind === 'date') &&
    typeof value.value === 'number' &&
    typeof value.baselinePrintTime === 'number' &&
    typeof value.baselineFilament === 'number' &&
    typeof value.baselineDate === 'number'
  )
}

/** Scoped per printer, like every other table tied to one machine's identity. */
function savedIntervals(scopeKeys: readonly string[]): MaintenanceInterval[] {
  const stored = parsedStorage()
  const scoped = isRecord(stored) ? readScoped(stored, scopeKeys) : null
  if (!Array.isArray(scoped)) return []
  return scoped.filter(isMaintenanceInterval)
}

function persistIntervals(
  scopeKeys: readonly string[],
  intervals: readonly MaintenanceInterval[],
): void {
  const stored = parsedStorage()
  const table = isRecord(stored) ? stored : {}
  window.localStorage.setItem(storageKey, JSON.stringify(writeScoped(table, scopeKeys, intervals)))
}

export interface MaintenanceIntervalRow {
  interval: MaintenanceInterval
  result: MaintenanceIntervalResult
}

export const useMaintenanceStore = defineStore('maintenance', () => {
  const history = useHistoryStore()
  const moonraker = useMoonrakerStore()
  const printers = usePrintersStore()

  const intervals = ref<MaintenanceInterval[]>(savedIntervals(printers.activeScopeKeys))
  let started = false
  let stopScopeWatch: WatchStopHandle | null = null
  let stopPrinterChangeReset: (() => void) | null = null

  const rows = computed<MaintenanceIntervalRow[]>(() =>
    intervals.value.map((interval) => ({
      interval,
      result: maintenanceIntervalState(interval, history.totals, Math.floor(Date.now() / 1000)),
    })),
  )

  const overdueRows = computed(() => rows.value.filter((row) => row.result.status === 'overdue'))
  const hasOverdue = computed(() => overdueRows.value.length > 0)

  function persist(): void {
    persistIntervals(printers.activeScopeKeys, intervals.value)
  }

  /**
   * Not `crypto.randomUUID()`: that API is withheld outside a secure context,
   * and ADR 0003 commits this app to serving over plain HTTP off-printer. A
   * timestamp paired with a small random suffix is unique enough for a list a
   * person creates one entry at a time by hand, never synced across devices.
   */
  function nextIntervalId(): string {
    return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
  }

  function addInterval(name: string, kind: MaintenanceIntervalKind, value: number): void {
    const now = Math.floor(Date.now() / 1000)
    intervals.value = [
      ...intervals.value,
      {
        id: nextIntervalId(),
        name,
        kind,
        value,
        baselinePrintTime: history.totals.printTime,
        baselineFilament: history.totals.filamentUsed,
        baselineDate: now,
      },
    ]
    persist()
  }

  /** Re-anchors the interval to the printer's current totals — the one action that clears `needsBaseline` too. */
  function markPerformed(id: string): void {
    const now = Math.floor(Date.now() / 1000)
    intervals.value = intervals.value.map((interval) =>
      interval.id === id
        ? {
            ...interval,
            baselinePrintTime: history.totals.printTime,
            baselineFilament: history.totals.filamentUsed,
            baselineDate: now,
          }
        : interval,
    )
    persist()
  }

  function deleteInterval(id: string): void {
    intervals.value = intervals.value.filter((interval) => interval.id !== id)
    persist()
  }

  /**
   * `onPrinterChange` fires before `printers.addPrinter` has retargeted
   * `activeId` — reading `activeScopeKeys` here would still answer with the
   * printer being left, so this clears unconditionally instead of trying to
   * read the new printer's data early. `scopeChanged` below, watching
   * `activeScopeKeys` itself, is what loads that printer's own intervals once
   * the id has actually moved.
   */
  function printerChanged(): void {
    intervals.value = []
  }

  function scopeChanged(): void {
    intervals.value = savedIntervals(printers.activeScopeKeys)
  }

  function start(): void {
    if (started) return
    started = true
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    stopScopeWatch = watch(() => printers.activeScopeKeys.join(','), scopeChanged)
  }

  function stop(): void {
    if (!started) return
    started = false
    stopScopeWatch?.()
    stopScopeWatch = null
    stopPrinterChangeReset?.()
    stopPrinterChangeReset = null
  }

  return {
    intervals,
    rows,
    overdueRows,
    hasOverdue,
    addInterval,
    markPerformed,
    deleteInterval,
    start,
    stop,
  }
})
