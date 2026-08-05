import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import {
  isPrintableGcodeFilename,
  normalizeMoonrakerRelativePath,
  uploadMoonrakerFile,
  type JsonRpcNotification,
  type MoonrakerGcodeMetadata,
} from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import { useServerCapabilitiesStore } from '@/stores/serverCapabilities'
import { useToastsStore } from '@/stores/toasts'
import { isRecord } from '@/utils/records'

/**
 * The `gcodes` root, browsed as folders and printable files.
 *
 * Deliberately not the File Explorer store pointed at another root. The two
 * workspaces answer different questions — "which file shall I print" against
 * "what does this machine load" — and diverge in what a row shows, what opening
 * one does, and what the primary action is. Sharing a store would force one
 * shape onto both; what they genuinely share is the printable-file test and the
 * URL helpers, and those are shared.
 */

export interface GcodeFileEntry {
  /** Filename with no directory part, for display. */
  name: string
  /** Path relative to the gcodes root, which is what `printer.print.start` takes. */
  path: string
  size: number
  modified: number
}

export interface GcodeFolderEntry {
  name: string
  path: string
  modified: number
}

export type GcodeSortKey = 'name' | 'size' | 'modified'
export type GcodeSortDirection = 'ascending' | 'descending'

interface DiskUsage {
  total: number
  used: number
  free: number
}

const emptyDiskUsage: DiskUsage = { total: 0, used: 0, free: 0 }

function joinPath(base: string, name: string): string {
  if (!base) return name
  // Both sides can be empty — the root directory has no path of its own — and a
  // trailing separator would ask Moonraker for `gcodes/` rather than `gcodes`.
  if (!name) return base
  return `${base}/${name}`
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

export const useGcodeFilesStore = defineStore('gcodeFiles', () => {
  const moonraker = useMoonrakerStore()
  const availability = useAvailabilityStore()
  const printer = usePrinterStore()
  const serverCapabilities = useServerCapabilitiesStore()
  const toasts = useToastsStore()

  /** Path of the shown directory, relative to the gcodes root. Empty is the root. */
  const currentPath = ref('')
  const folders = ref<GcodeFolderEntry[]>([])
  const files = ref<GcodeFileEntry[]>([])
  const diskUsage = ref<DiskUsage>(emptyDiskUsage)
  const isLoading = ref(false)
  const failed = ref(false)

  const sortKey = ref<GcodeSortKey>('modified')
  const sortDirection = ref<GcodeSortDirection>('descending')

  /** Path of the file whose detail is shown, or null. */
  const selectedPath = ref<string | null>(null)
  const selectedMetadata = ref<MoonrakerGcodeMetadata | null>(null)
  const isMetadataLoading = ref(false)

  const isUploading = ref(false)

  /**
   * Whether `[analysis]`'s own estimator binary is ready to run — not merely
   * whether the component is configured, since Moonraker can still be
   * downloading it the first time anything asks. Stays `false` — hiding the
   * action — until a check has actually answered `true`, the opposite default
   * from a destination's capability gate: an action that turns out to fail is
   * worse than one that briefly stays hidden.
   */
  const isAnalysisReady = ref(false)
  const isProcessingEstimate = ref(false)
  const processEstimateFailed = ref(false)

  let directoryGeneration = 0
  let metadataGeneration = 0
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let started = false
  let stopAvailabilityWatch: WatchStopHandle | null = null
  let stopAnalysisWatch: WatchStopHandle | null = null
  let stopFileNotifications: (() => void) | null = null
  let stopPrinterChangeReset: (() => void) | null = null

  const breadcrumbs = computed(() => {
    const segments = currentPath.value ? currentPath.value.split('/') : []
    let walked = ''
    return segments.map((segment) => {
      walked = joinPath(walked, segment)
      return { name: segment, path: walked }
    })
  })

  const parentPath = computed(() => {
    if (!currentPath.value) return null
    const separatorIndex = currentPath.value.lastIndexOf('/')
    return separatorIndex < 0 ? '' : currentPath.value.slice(0, separatorIndex)
  })

  /**
   * Folders always precede files and sort among themselves, matching the File
   * Explorer contract: a directory is a place, and mixing places into a list of
   * things ordered by size or date puts them somewhere different every time the
   * sort changes.
   */
  const sortedFolders = computed(() => {
    const direction = sortDirection.value === 'ascending' ? 1 : -1
    return [...folders.value].sort((left, right) => {
      if (sortKey.value === 'modified') return (left.modified - right.modified) * direction
      return compareText(left.name, right.name) * direction
    })
  })

  const sortedFiles = computed(() => {
    const direction = sortDirection.value === 'ascending' ? 1 : -1
    return [...files.value].sort((left, right) => {
      if (sortKey.value === 'size') return (left.size - right.size) * direction
      if (sortKey.value === 'modified') return (left.modified - right.modified) * direction
      return compareText(left.name, right.name) * direction
    })
  })

  const selectedFile = computed(
    () => files.value.find((file) => file.path === selectedPath.value) ?? null,
  )

  const isEmpty = computed(() => folders.value.length === 0 && files.value.length === 0)

  function sortBy(key: GcodeSortKey): void {
    if (sortKey.value === key) {
      sortDirection.value = sortDirection.value === 'ascending' ? 'descending' : 'ascending'
      return
    }
    sortKey.value = key
    // Newest and largest first are what a print list is asked for; a name reads
    // forwards. Each key starts on the order it is usually wanted in.
    sortDirection.value = key === 'name' ? 'ascending' : 'descending'
  }

  async function loadDirectory(path: string): Promise<void> {
    const generation = ++directoryGeneration
    isLoading.value = true
    failed.value = false

    try {
      const result = await moonraker.rpcCall('server.files.get_directory', {
        path: joinPath('gcodes', path),
      })
      if (generation !== directoryGeneration) return

      folders.value = result.dirs.map((folder) => ({
        name: folder.dirname,
        path: joinPath(path, folder.dirname),
        modified: folder.modified,
      }))
      files.value = result.files
        .filter((file) => isPrintableGcodeFilename(file.filename))
        .map((file) => ({
          name: file.filename,
          path: joinPath(path, file.filename),
          size: file.size,
          modified: file.modified,
        }))
      diskUsage.value = result.disk_usage ?? emptyDiskUsage
    } catch {
      if (generation === directoryGeneration) {
        failed.value = true
        folders.value = []
        files.value = []
      }
    } finally {
      if (generation === directoryGeneration) isLoading.value = false
    }
  }

  /**
   * Navigation clears the previous folder's rows before the destination arrives,
   * per the motion rules in `interface-standards.md`: keeping them would show
   * rows that do not belong to the location the breadcrumbs now name.
   */
  async function navigateTo(path: string): Promise<void> {
    const normalized = normalizeMoonrakerRelativePath(path)
    currentPath.value = normalized
    folders.value = []
    files.value = []
    clearSelection()
    await loadDirectory(normalized)
  }

  async function navigateUp(): Promise<void> {
    if (parentPath.value === null) return
    await navigateTo(parentPath.value)
  }

  async function refreshDirectory(): Promise<void> {
    await loadDirectory(currentPath.value)
  }

  function clearSelection(): void {
    metadataGeneration += 1
    selectedPath.value = null
    selectedMetadata.value = null
    isMetadataLoading.value = false
  }

  /**
   * Selecting a file shows what the slicer said about it. Metadata is read
   * through the printer store, which already caches it per filename for the
   * session — the print card and this workspace asking the same question twice
   * would be two requests for one answer.
   */
  async function select(path: string): Promise<void> {
    const generation = ++metadataGeneration
    selectedPath.value = path
    selectedMetadata.value = null
    isMetadataLoading.value = true

    try {
      const metadata = await printer.loadMetadata(path)
      if (generation !== metadataGeneration) return
      selectedMetadata.value = metadata
    } finally {
      if (generation === metadataGeneration) isMetadataLoading.value = false
    }
  }

  async function checkAnalysisStatus(): Promise<void> {
    try {
      const status = await moonraker.rpcCall('server.analysis.status')
      isAnalysisReady.value = status.estimator_ready
    } catch {
      // No `[analysis]` section, or a Moonraker old enough not to know the
      // method at all — either way, the same absence as never configuring it.
      isAnalysisReady.value = false
    }
  }

  /**
   * Runs `klipper_estimator` against the file on disk, rewriting its own time
   * estimate and M73 commands in place. Safe to call on a file
   * `enable_auto_analysis` already processed on upload — Moonraker reports
   * `bypassed: true` and changes nothing — so the action needs no way to know
   * in advance whether the file was already accurate.
   */
  async function processEstimate(path: string): Promise<boolean> {
    if (isProcessingEstimate.value) return false
    isProcessingEstimate.value = true
    processEstimateFailed.value = false
    try {
      await moonraker.rpcCall('server.analysis.process', { filename: path })
      printer.invalidateMetadata(path)
      if (selectedPath.value === path) await select(path)
      return true
    } catch (error) {
      processEstimateFailed.value = true
      toasts.pushError(error)
      return false
    } finally {
      isProcessingEstimate.value = false
    }
  }

  /** Uploads into the shown folder, so where a file lands is where the user is looking. */
  async function upload(file: File): Promise<string | null> {
    isUploading.value = true
    try {
      const result = await uploadMoonrakerFile(
        'gcodes',
        currentPath.value,
        file,
        file.name,
        moonraker.endpoint,
      )
      await refreshDirectory()
      return result.item.path
    } catch {
      return null
    } finally {
      isUploading.value = false
    }
  }

  function scheduleRefresh(): void {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void refreshDirectory()
    }, 120)
  }

  /**
   * The listing refresh above is enough for rows the user isn't looking at,
   * but a file re-sliced and re-uploaded while its own detail pane is open
   * would otherwise keep showing the previous version's metadata until it is
   * deselected and picked again — the same staleness `processEstimate` above
   * already works around for its own trigger.
   */
  function handleFilelistChanged(notification: JsonRpcNotification): void {
    scheduleRefresh()
    const change = notification.params[0]
    if (!isRecord(change)) return
    if (change.action !== 'create_file' && change.action !== 'modify_file') return
    const item = change.item
    if (!isRecord(item) || item.root !== 'gcodes' || typeof item.path !== 'string') return
    if (selectedPath.value !== item.path) return
    printer.invalidateMetadata(item.path)
    void select(item.path)
  }

  /**
   * The listing, the selection, and the browsed path all name files on the
   * machine we just left — `currentPath` especially, since the folder it
   * points into may not exist on the new one. Sort order stays: it is the
   * user's preference, not the printer's data.
   */
  function printerChanged(): void {
    directoryGeneration += 1
    metadataGeneration += 1
    currentPath.value = ''
    folders.value = []
    files.value = []
    diskUsage.value = emptyDiskUsage
    selectedPath.value = null
    selectedMetadata.value = null
    isLoading.value = false
    isMetadataLoading.value = false
    failed.value = false
    isAnalysisReady.value = false
    processEstimateFailed.value = false
  }

  function start(): void {
    if (started) return
    started = true
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    stopAvailabilityWatch = watch(
      () => availability.isMoonrakerConnected,
      (connected) => {
        if (connected) void refreshDirectory()
        else {
          directoryGeneration += 1
          isLoading.value = false
        }
      },
      { immediate: true },
    )
    stopAnalysisWatch = watch(
      () => availability.isMoonrakerConnected && serverCapabilities.hasComponent('analysis'),
      (shouldCheck) => {
        if (shouldCheck) void checkAnalysisStatus()
      },
      { immediate: true },
    )
    // Uploads and deletions from any client change this listing, so the rows
    // follow the notification rather than waiting for the next visit.
    try {
      stopFileNotifications = moonraker.onNotification(
        'notify_filelist_changed',
        handleFilelistChanged,
      )
    } catch {
      stopFileNotifications = null
    }
  }

  function stop(): void {
    if (!started) return
    started = false
    directoryGeneration += 1
    metadataGeneration += 1
    stopAvailabilityWatch?.()
    stopAvailabilityWatch = null
    stopAnalysisWatch?.()
    stopAnalysisWatch = null
    stopFileNotifications?.()
    stopFileNotifications = null
    stopPrinterChangeReset?.()
    stopPrinterChangeReset = null
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = null
  }

  return {
    currentPath,
    folders,
    files,
    diskUsage,
    isLoading,
    failed,
    isEmpty,
    sortKey,
    sortDirection,
    sortedFolders,
    sortedFiles,
    breadcrumbs,
    parentPath,
    selectedPath,
    selectedFile,
    selectedMetadata,
    isMetadataLoading,
    isUploading,
    isAnalysisReady,
    isProcessingEstimate,
    processEstimateFailed,
    sortBy,
    navigateTo,
    navigateUp,
    refreshDirectory,
    select,
    clearSelection,
    upload,
    processEstimate,
    start,
    stop,
  }
})
