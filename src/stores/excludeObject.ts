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

export type ObjectPoint = [number, number]

/**
 * One object Klipper's `[exclude_object]` parsed out of the running file's
 * `EXCLUDE_OBJECT_DEFINE` header, in the file's own coordinate frame.
 *
 * `polygon` is the slicer's outline of the object's footprint and is optional
 * in the G-code — a post-processor that writes only `CENTER` leaves it out —
 * so `center` stays as the fallback mark. `area` is the outline's footprint in
 * mm², kept so a plate picture can draw large objects first: drawn in file
 * order, a skirt or a large part defined after a small one covers it and makes
 * the small one impossible to pick out.
 */
export interface ExcludeObjectDefinition {
  name: string
  center: ObjectPoint | null
  polygon: ObjectPoint[] | null
  area: number
}

function readPoint(value: unknown): ObjectPoint | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const [x, y] = value
  if (typeof x !== 'number' || typeof y !== 'number') return null
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return [x, y]
}

/**
 * Fewer than three valid points is not an outline, and one bad point makes the
 * whole outline untrustworthy rather than a shape with a corner missing.
 */
function readPolygon(value: unknown): ObjectPoint[] | null {
  if (!Array.isArray(value) || value.length < 3) return null
  const points: ObjectPoint[] = []
  for (const candidate of value) {
    const point = readPoint(candidate)
    if (!point) return null
    points.push(point)
  }
  return points
}

/** The shoelace formula, unsigned: winding order is the slicer's choice. */
export function polygonArea(polygon: readonly ObjectPoint[]): number {
  let twiceArea = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const [x1, y1] = polygon[index]!
    const [x2, y2] = polygon[(index + 1) % polygon.length]!
    twiceArea += x1 * y2 - x2 * y1
  }
  return Math.abs(twiceArea) / 2
}

function readObjects(value: unknown): ExcludeObjectDefinition[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return []
    const name = typeof candidate.name === 'string' ? candidate.name : ''
    if (name === '') return []
    const polygon = readPolygon(candidate.polygon)
    return [
      {
        name,
        center: readPoint(candidate.center),
        polygon,
        area: polygon ? polygonArea(polygon) : 0,
      },
    ]
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
