import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import type {
  JsonRpcNotification,
  ObjectSnapshotHandler,
  PrinterObjectSelection,
  PrinterObjectSnapshot,
} from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { isRecord } from '@/utils/records'

const excludeObjectSubscriptionKey = 'alabaster.excludeObject'

const excludeObjectSelection: PrinterObjectSelection = {
  exclude_object: ['objects', 'excluded_objects', 'current_object'],
}

/**
 * One object Klipper's `[exclude_object]` parsed out of the running file's
 * `EXCLUDE_OBJECT_DEFINE` header. `center` is the only placement Klipper
 * reports directly — a polygon exists too, but a plate picture only needs
 * somewhere to put a tap target, not the object's outline.
 */
export interface ExcludeObjectDefinition {
  name: string
  center: [number, number] | null
}

function readCenter(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const [x, y] = value
  if (typeof x !== 'number' || typeof y !== 'number') return null
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return [x, y]
}

function readObjects(value: unknown): ExcludeObjectDefinition[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return []
    const name = typeof candidate.name === 'string' ? candidate.name : ''
    if (name === '') return []
    return [{ name, center: readCenter(candidate.center) }]
  })
}

function readNameList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

/**
 * `exclude_object.objects`, `.excluded_objects`, and `.current_object` — a
 * different population from bed mesh or print stats, so it gets its own
 * subscription rather than crowding `printer.ts`'s already-large selection.
 * Requested unconditionally, the same as `printer.ts` already does for
 * `firmware_retraction`: a printer whose file declares no objects, or whose
 * config has no `[exclude_object]` section at all, simply never reports the
 * object, and asking for it costs nothing.
 */
export const useExcludeObjectStore = defineStore('excludeObject', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()

  const objects = ref<ExcludeObjectDefinition[]>([])
  const excludedNames = ref<string[]>([])
  const currentObjectName = ref<string | null>(null)

  const disposers: Array<() => void> = []
  let stopAvailabilityWatch: WatchStopHandle | null = null
  let stopPrinterChangeReset: (() => void) | null = null
  let started = false

  const hasObjects = computed(() => objects.value.length > 0)
  const excludedSet = computed(() => new Set(excludedNames.value))

  /** Objects a print could still be told to skip — defined, but not already excluded. */
  const pendingObjects = computed(() =>
    objects.value.filter((object) => !excludedSet.value.has(object.name)),
  )

  function mergeStatus(status: Record<string, unknown>): void {
    const update = status.exclude_object
    if (!isRecord(update)) return
    if ('objects' in update) objects.value = readObjects(update.objects)
    if ('excluded_objects' in update) excludedNames.value = readNameList(update.excluded_objects)
    if ('current_object' in update) {
      currentObjectName.value =
        typeof update.current_object === 'string' && update.current_object !== ''
          ? update.current_object
          : null
    }
  }

  function handleSnapshot(snapshot: PrinterObjectSnapshot): void {
    mergeStatus(snapshot.status)
  }

  function handleStatusUpdate(notification: JsonRpcNotification): void {
    const status = notification.params[0]
    if (isRecord(status)) mergeStatus(status)
  }

  /** Another machine's plate, or the same machine before a new file loaded. */
  function printerChanged(): void {
    objects.value = []
    excludedNames.value = []
    currentObjectName.value = null
  }

  function start(): void {
    if (started) return
    started = true
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    disposers.push(
      moonraker.onObjectSnapshot(handleSnapshot as ObjectSnapshotHandler),
      moonraker.onNotification('notify_status_update', handleStatusUpdate),
    )
    stopAvailabilityWatch = watch(
      () => availability.isKlipperReady,
      (isReady) => {
        if (!isReady) return
        void moonraker
          .setObjectSubscription(excludeObjectSubscriptionKey, excludeObjectSelection)
          .catch(() => undefined)
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
    void moonraker.removeObjectSubscription(excludeObjectSubscriptionKey)
  }

  return {
    objects,
    excludedNames,
    currentObjectName,
    hasObjects,
    excludedSet,
    pendingObjects,
    start,
    stop,
  }
})
