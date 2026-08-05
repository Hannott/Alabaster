import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import { nextAvailableProfileName } from '@/features/bedMesh/profileNames'
import type {
  JsonRpcNotification,
  ObjectSnapshotHandler,
  PrinterObjectSelection,
  PrinterObjectSnapshot,
} from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { readScoped, writeScoped } from '@/stores/printerScope'
import { usePrintersStore } from '@/stores/printers'
import { isRecord } from '@/utils/records'

const bedMeshSubscriptionKey = 'alabaster.bedMesh'

/**
 * Klipper never records the temperature a mesh was probed at, so this is
 * Alabaster's own bookkeeping — never written to `printer.cfg`, never sent to
 * Klipper, and never read by another Klipper web interface. A profile saved
 * here, elsewhere, or before this existed simply has no entry, which is why
 * every lookup below is an optional one rather than a guarantee.
 */
const probeTemperatureStorageKey = 'alabaster.bedMesh.probeTemperatures.v1'

const bedMeshSelection: PrinterObjectSelection = {
  bed_mesh: ['profile_name', 'mesh_min', 'mesh_max', 'probed_matrix', 'mesh_matrix', 'profiles'],
}

export interface MeshCell {
  row: number
  column: number
  deviation: number
}

/**
 * A saved profile, summarized from the points Klipper already reports with it.
 * Reading a profile's spread therefore costs nothing: the alternative is
 * loading each one onto the printer in turn to look at it, which changes the
 * machine's state in order to answer a question about a file.
 */
export interface MeshProfileSummary {
  name: string
  lowest: number
  highest: number
  range: number
  isActive: boolean
}

function finitePair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const [first, second] = value
  if (typeof first !== 'number' || typeof second !== 'number') return null
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null
  return [first, second]
}

function probeTemperatureTable(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(probeTemperatureStorageKey) ?? '{}',
    )
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function temperaturesFrom(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {}
  const entries = Object.entries(value).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]),
  )
  return Object.fromEntries(entries)
}

/**
 * Scoped per printer, because a profile name is not unique across machines:
 * every Klipper install has a `default`, so one flat table hands one printer's
 * probe temperature to another and the mismatch warning then fires — or stays
 * silent — on a figure measured from a different bed.
 *
 * The original flat shape predates scoping entirely and is read as the current
 * printer's, since it is the only one that could have written it. A write
 * absorbs it, so a second printer cannot inherit it too.
 */
function readProbeTemperatures(scopeKeys: readonly string[]): Record<string, number> {
  const table = probeTemperatureTable()
  const scoped = readScoped(table, scopeKeys)
  if (isRecord(scoped)) return temperaturesFrom(scoped)
  return temperaturesFrom(table)
}

function writeProbeTemperatures(scopeKeys: readonly string[], value: Record<string, number>): void {
  const table = probeTemperatureTable()
  const scopedOnly = Object.entries(table).filter(([, scoped]) => isRecord(scoped))
  window.localStorage.setItem(
    probeTemperatureStorageKey,
    JSON.stringify(writeScoped(Object.fromEntries(scopedOnly), scopeKeys, value)),
  )
}

export function normalizeMatrix(value: unknown): number[][] {
  if (!Array.isArray(value)) return []
  const rows = value.flatMap((row) => {
    if (!Array.isArray(row)) return []
    const cells = row.filter(
      (cell): cell is number => typeof cell === 'number' && Number.isFinite(cell),
    )
    return cells.length > 0 ? [cells] : []
  })
  const width = rows[0]?.length ?? 0
  return rows.every((row) => row.length === width) ? rows : []
}

export const useBedMeshStore = defineStore('bedMesh', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()
  const printers = usePrintersStore()
  const profileName = ref('')
  const meshMin = ref<[number, number] | null>(null)
  const meshMax = ref<[number, number] | null>(null)
  const probedMatrix = ref<number[][]>([])
  const meshMatrix = ref<number[][]>([])
  const profiles = ref<string[]>([])
  const profilePoints = ref<Record<string, number[][]>>({})
  const probeTemperatures = ref<Record<string, number>>(
    readProbeTemperatures(printers.activeScopeKeys),
  )
  /**
   * The bed's actual temperature at the moment `BED_MESH_CALIBRATE` last
   * completed, not yet tied to a saved name. `saveBedMeshProfile` commits it;
   * an unrelated calibration overwrites it before it is ever committed.
   */
  const pendingProbeTemperature = ref<number | null>(null)
  const disposers: Array<() => void> = []
  let stopAvailabilityWatch: WatchStopHandle | null = null
  let stopPrinterChangeReset: (() => void) | null = null
  let stopScopeWatch: WatchStopHandle | null = null
  let started = false

  const isActive = computed(() => profileName.value !== '' && probedMatrix.value.length > 0)
  const activeProbeTemperature = computed(() =>
    profileName.value !== '' ? (probeTemperatures.value[profileName.value] ?? null) : null,
  )
  const values = computed(() => probedMatrix.value.flat())
  const lowest = computed(() => (values.value.length > 0 ? Math.min(...values.value) : null))
  const highest = computed(() => (values.value.length > 0 ? Math.max(...values.value) : null))
  const range = computed(() =>
    lowest.value === null || highest.value === null ? null : highest.value - lowest.value,
  )
  const cells = computed<MeshCell[]>(() =>
    probedMatrix.value.flatMap((row, rowIndex) =>
      row.map((deviation, columnIndex) => ({
        row: rowIndex,
        column: columnIndex,
        deviation,
      })),
    ),
  )
  const columnCount = computed(() => probedMatrix.value[0]?.length ?? 0)
  const rowCount = computed(() => probedMatrix.value.length)

  /**
   * What the height map draws. Klipper already interpolates the probed points
   * into `mesh_matrix` — the correction it will actually apply — so drawing that
   * shows the bed the printer believes in rather than a second interpolation
   * invented here. A mesh loaded from an older profile may carry only the probed
   * points, which then stand in unchanged.
   */
  const surfaceMatrix = computed(() =>
    meshMatrix.value.length > 0 ? meshMatrix.value : probedMatrix.value,
  )

  const profileSummaries = computed<MeshProfileSummary[]>(() =>
    profiles.value.map((name) => {
      const points = (profilePoints.value[name] ?? []).flat()
      const lowest = points.length > 0 ? Math.min(...points) : 0
      const highest = points.length > 0 ? Math.max(...points) : 0
      return {
        name,
        lowest,
        highest,
        range: highest - lowest,
        isActive: name === profileName.value,
      }
    }),
  )

  /**
   * What a save dialog should default to: `profileName` itself when saving
   * under it would replace nothing, otherwise the first numbered variant that
   * would not. Klipper names every anonymous calibration "default", so this is
   * the guard against silently overwriting whichever profile already carries
   * that name — the field stays editable, this only decides what it starts
   * with.
   */
  const suggestedProfileName = computed(() =>
    nextAvailableProfileName(profileName.value || 'default', profiles.value),
  )

  /**
   * How wide the probed area is against how deep, from the bounds Klipper
   * reports. The matrix shape cannot answer this — `probe_count` sets each axis
   * separately — and without it a rectangular bed is drawn square.
   */
  const aspect = computed(() => {
    const minimum = meshMin.value
    const maximum = meshMax.value
    if (!minimum || !maximum) return 1
    const width = maximum[0] - minimum[0]
    const depth = maximum[1] - minimum[1]
    return width > 0 && depth > 0 ? width / depth : 1
  })

  function mergeStatus(status: Record<string, unknown>): void {
    const bedMesh = status.bed_mesh
    if (!isRecord(bedMesh)) return

    if (typeof bedMesh.profile_name === 'string') profileName.value = bedMesh.profile_name
    const minimum = finitePair(bedMesh.mesh_min)
    if (minimum) meshMin.value = minimum
    const maximum = finitePair(bedMesh.mesh_max)
    if (maximum) meshMax.value = maximum
    if ('probed_matrix' in bedMesh) probedMatrix.value = normalizeMatrix(bedMesh.probed_matrix)
    if ('mesh_matrix' in bedMesh) meshMatrix.value = normalizeMatrix(bedMesh.mesh_matrix)
    if (isRecord(bedMesh.profiles)) {
      profiles.value = Object.keys(bedMesh.profiles).sort()
      profilePoints.value = Object.fromEntries(
        Object.entries(bedMesh.profiles).map(([name, profile]) => [
          name,
          isRecord(profile) ? normalizeMatrix(profile.points) : [],
        ]),
      )
    }
  }

  function handleSnapshot(snapshot: PrinterObjectSnapshot): void {
    mergeStatus(snapshot.status)
  }

  function handleStatusUpdate(notification: JsonRpcNotification): void {
    const status = notification.params[0]
    if (isRecord(status)) mergeStatus(status)
  }

  /**
   * The mesh and the saved profile list describe whatever is on the other end of
   * the socket, so they go when the connection is retargeted.
   */
  function printerChanged(): void {
    profileName.value = ''
    meshMin.value = null
    meshMax.value = null
    probedMatrix.value = []
    meshMatrix.value = []
    profiles.value = []
    profilePoints.value = {}
  }

  function start(): void {
    if (started) return
    started = true
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    /*
     * Recorded temperatures follow the printer's identity, not its address:
     * re-pointing one printer at a new host keeps them, while selecting a
     * different printer reads that printer's own.
     */
    stopScopeWatch = watch(
      () => printers.activeScopeKeys.join(','),
      () => {
        probeTemperatures.value = readProbeTemperatures(printers.activeScopeKeys)
      },
    )
    disposers.push(
      moonraker.onObjectSnapshot(handleSnapshot as ObjectSnapshotHandler),
      moonraker.onNotification('notify_status_update', handleStatusUpdate),
    )
    stopAvailabilityWatch = watch(
      () => availability.isKlipperReady,
      (isReady) => {
        if (!isReady) return
        void moonraker
          .setObjectSubscription(bedMeshSubscriptionKey, bedMeshSelection)
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
    stopScopeWatch?.()
    stopScopeWatch = null
    while (disposers.length > 0) disposers.pop()?.()
    void moonraker.removeObjectSubscription(bedMeshSubscriptionKey)
  }

  function persistProbeTemperatures(): void {
    writeProbeTemperatures(printers.activeScopeKeys, probeTemperatures.value)
  }

  /** Called once `BED_MESH_CALIBRATE` has finished probing. */
  function recordCalibration(temperature: number | null): void {
    pendingProbeTemperature.value = temperature
  }

  /**
   * Called once a mesh is saved under `toName`. Prefers the temperature just
   * calibrated; falls back to whatever `fromName` (the mesh being saved, if
   * any) already has on record, so duplicating a known profile under a new
   * name carries its temperature forward. Records nothing when neither is
   * known, rather than guessing.
   */
  function commitProfileTemperature(fromName: string, toName: string): void {
    const temperature =
      pendingProbeTemperature.value ??
      (fromName !== '' ? (probeTemperatures.value[fromName] ?? null) : null)
    pendingProbeTemperature.value = null
    if (temperature === null) return
    probeTemperatures.value = { ...probeTemperatures.value, [toName]: temperature }
    persistProbeTemperatures()
  }

  function dropProfileTemperature(name: string): void {
    if (!(name in probeTemperatures.value)) return
    const next = { ...probeTemperatures.value }
    delete next[name]
    probeTemperatures.value = next
    persistProbeTemperatures()
  }

  /**
   * A counter the height map watches, bumped when someone types the word into
   * the console. See `features/bedMesh/voyage.ts`.
   *
   * A counter rather than a boolean, so asking twice runs it twice, and so the
   * card never has to reach back and clear a flag it did not set. It lives in
   * this store because the request is about the mesh viewer and the console is
   * where it arrives; nothing else in the application needs to know.
   */
  const voyageRequests = ref(0)

  function requestVoyage(): void {
    voyageRequests.value += 1
  }

  return {
    profileName,
    meshMin,
    meshMax,
    probedMatrix,
    meshMatrix,
    profiles,
    isActive,
    values,
    lowest,
    highest,
    range,
    cells,
    columnCount,
    rowCount,
    profileSummaries,
    suggestedProfileName,
    surfaceMatrix,
    aspect,
    activeProbeTemperature,
    recordCalibration,
    commitProfileTemperature,
    dropProfileTemperature,
    voyageRequests,
    requestVoyage,
    start,
    stop,
  }
})
