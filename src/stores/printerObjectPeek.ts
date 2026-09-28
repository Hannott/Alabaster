import { defineStore } from 'pinia'
import { ref, watch, type WatchStopHandle } from 'vue'

import type {
  JsonRpcNotification,
  ObjectSnapshotHandler,
  PrinterObjectSnapshot,
} from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { isRecord } from '@/utils/records'

const subscriptionKey = 'alabaster.editor.objectPeek'

/**
 * One printer object, watched only while something is looking at it — the
 * configuration editor's context menu, showing what `printer.toolhead.homed_axes`
 * reads right now.
 *
 * A value read once when the menu opened would be a snapshot left to go stale
 * while the reader looks at it, which the application's core rule forbids, so
 * the object is subscribed for exactly as long as the menu is open and released
 * when it closes. The subscription is field-scoped to the one object and joins
 * the merged subscription every other store already uses, rather than holding a
 * socket of its own.
 */
export const usePrinterObjectPeekStore = defineStore('printerObjectPeek', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()

  const object = ref<string | null>(null)
  const status = ref<Record<string, unknown> | null>(null)
  const disposers: Array<() => void> = []
  let stopReadyWatch: WatchStopHandle | null = null

  function merge(update: unknown): void {
    const name = object.value
    if (!name || !isRecord(update)) return
    const part = update[name]
    if (isRecord(part)) status.value = { ...(status.value ?? {}), ...part }
  }

  function handleSnapshot(snapshot: PrinterObjectSnapshot): void {
    merge(snapshot.status)
  }

  function handleStatusUpdate(notification: JsonRpcNotification): void {
    merge(notification.params[0])
  }

  function release(): void {
    if (object.value === null) return
    object.value = null
    status.value = null
    stopReadyWatch?.()
    stopReadyWatch = null
    while (disposers.length > 0) disposers.pop()?.()
    void moonraker.removeObjectSubscription(subscriptionKey).catch(() => undefined)
  }

  function watchObject(name: string): void {
    if (object.value === name) return
    release()
    object.value = name
    disposers.push(
      moonraker.onObjectSnapshot(handleSnapshot as ObjectSnapshotHandler),
      moonraker.onNotification('notify_status_update', handleStatusUpdate),
      moonraker.onPrinterChange(release),
    )
    stopReadyWatch = watch(
      () => availability.isKlipperReady,
      (ready) => {
        if (!ready || object.value !== name) return
        void moonraker
          .setObjectSubscription(subscriptionKey, { [name]: null })
          .catch(() => undefined)
      },
      { immediate: true },
    )
  }

  return { object, status, watchObject, release }
})

/** The value at `attributes` inside a watched object, formatted for one line, or null. */
export function peekValue(
  status: Record<string, unknown> | null,
  attributes: readonly string[],
): string | null {
  if (!status || attributes.length === 0) return null
  let value: unknown = status
  for (const attribute of attributes) {
    if (!isRecord(value)) return null
    value = value[attribute]
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') return String(Number(value.toFixed(4)))
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (value === null) return 'None'
  if (Array.isArray(value) && value.every((item) => typeof item !== 'object')) {
    return `[${value.map((item) => (typeof item === 'number' ? Number(item.toFixed(4)) : String(item))).join(', ')}]`
  }
  return null
}
