import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { JsonRpcNotification, ObjectSnapshotHandler } from '@/services/moonraker'
import { useExcludeObjectStore } from '@/stores/excludeObject'
import { useMoonrakerStore } from '@/stores/moonraker'

function wireStore() {
  const moonraker = useMoonrakerStore()
  let snapshotHandler: ObjectSnapshotHandler | undefined
  let statusHandler: ((notification: JsonRpcNotification) => void) | undefined
  vi.spyOn(moonraker, 'setObjectSubscription').mockResolvedValue(undefined)
  vi.spyOn(moonraker, 'removeObjectSubscription').mockResolvedValue(undefined)
  vi.spyOn(moonraker, 'onObjectSnapshot').mockImplementation((handler) => {
    snapshotHandler = handler
    return () => undefined
  })
  vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
    if (method === 'notify_status_update') statusHandler = handler
    return () => undefined
  })

  const store = useExcludeObjectStore()
  store.start()
  return {
    store,
    snapshot: (status: Record<string, unknown>) => snapshotHandler?.({ eventtime: 1, status }),
    update: (params: readonly unknown[]) =>
      statusHandler?.({ jsonrpc: '2.0', method: 'notify_status_update', params }),
  }
}

describe('exclude object store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('reads the defined objects, the excluded list, and the current one', () => {
    const { store, snapshot } = wireStore()

    snapshot({
      exclude_object: {
        objects: [
          { name: 'cube_1', center: [10, 10] },
          { name: 'cube_2', center: [50, 50] },
        ],
        excluded_objects: ['cube_1'],
        current_object: 'cube_2',
      },
    })

    expect(store.objects).toEqual([
      { name: 'cube_1', center: [10, 10], polygon: null, area: 0 },
      { name: 'cube_2', center: [50, 50], polygon: null, area: 0 },
    ])
    expect(store.excludedSet.has('cube_1')).toBe(true)
    expect(store.currentObjectName).toBe('cube_2')
    expect(store.pendingObjects.map((object) => object.name)).toEqual(['cube_2'])
  })

  it('ignores an object with no name and a malformed center', () => {
    const { store, snapshot } = wireStore()

    snapshot({
      exclude_object: {
        objects: [
          { name: '', center: [1, 2] },
          { name: 'cube_1', center: 'nonsense' },
        ],
        excluded_objects: [],
        current_object: '',
      },
    })

    expect(store.objects).toEqual([{ name: 'cube_1', center: null, polygon: null, area: 0 }])
    expect(store.currentObjectName).toBeNull()
  })

  it('applies a live status-update delta the same way as the initial snapshot', () => {
    const { store, snapshot, update } = wireStore()

    snapshot({
      exclude_object: {
        objects: [{ name: 'cube_1', center: [10, 10] }],
        excluded_objects: [],
        current_object: 'cube_1',
      },
    })
    expect(store.hasObjects).toBe(true)

    update([{ exclude_object: { excluded_objects: ['cube_1'] } }])

    expect(store.excludedSet.has('cube_1')).toBe(true)
    // A delta that omits a field leaves it as last reported, not reset.
    expect(store.objects).toEqual([{ name: 'cube_1', center: [10, 10], polygon: null, area: 0 }])
  })

  it('keeps the footprint outline and its area, whatever its winding', () => {
    const { store, snapshot } = wireStore()

    snapshot({
      exclude_object: {
        objects: [
          {
            name: 'clockwise',
            center: [5, 5],
            polygon: [
              [0, 0],
              [0, 10],
              [10, 10],
              [10, 0],
            ],
          },
          {
            name: 'triangle',
            center: [2, 1],
            polygon: [
              [0, 0],
              [4, 0],
              [0, 3],
            ],
          },
        ],
      },
    })

    expect(store.objects.map((object) => object.area)).toEqual([100, 6])
    expect(store.objects[1]?.polygon).toEqual([
      [0, 0],
      [4, 0],
      [0, 3],
    ])
  })

  it('drops an outline with too few points or a malformed one, keeping the center', () => {
    const { store, snapshot } = wireStore()

    snapshot({
      exclude_object: {
        objects: [
          {
            name: 'line',
            center: [1, 1],
            polygon: [
              [0, 0],
              [2, 2],
            ],
          },
          {
            name: 'broken',
            center: [3, 3],
            polygon: [
              [0, 0],
              [4, 'x'],
              [0, 4],
            ],
          },
        ],
      },
    })

    expect(store.objects).toEqual([
      { name: 'line', center: [1, 1], polygon: null, area: 0 },
      { name: 'broken', center: [3, 3], polygon: null, area: 0 },
    ])
  })
})
