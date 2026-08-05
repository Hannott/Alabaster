import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import { moonrakerFileUrl } from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'

/**
 * Rendered timelapses, from the `timelapse` root the Moonraker component
 * registers.
 *
 * Only finished videos are listed. The component also leaves the captured frames
 * there while it works, and a folder of ten thousand PNGs is not what anyone
 * came to this page for.
 */

const VIDEO_PATTERN = /\.(mp4|webm|mov|mkv)$/i

export interface TimelapseVideo {
  name: string
  path: string
  size: number
  modified: number
}

export const useTimelapseStore = defineStore('timelapse', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()

  const videos = ref<TimelapseVideo[]>([])
  const isLoading = ref(false)
  const failed = ref(false)
  const selectedPath = ref<string | null>(null)

  let generation = 0
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let started = false
  let stopAvailabilityWatch: WatchStopHandle | null = null
  let stopFileNotifications: (() => void) | null = null
  let stopPrinterChangeReset: (() => void) | null = null

  const hasVideos = computed(() => videos.value.length > 0)
  const selected = computed(
    () => videos.value.find((video) => video.path === selectedPath.value) ?? null,
  )

  /** A playable URL for `video`, or null if the endpoint cannot form one. */
  function urlFor(video: TimelapseVideo): string | null {
    try {
      return moonrakerFileUrl('timelapse', video.path, moonraker.endpoint)
    } catch {
      return null
    }
  }

  async function refresh(): Promise<boolean> {
    if (!availability.isMoonrakerConnected) return false
    const current = ++generation
    isLoading.value = true

    try {
      const result = await moonraker.rpcCall('server.files.get_directory', { path: 'timelapse' })
      if (current !== generation) return false

      videos.value = (result?.files ?? [])
        .filter((file) => VIDEO_PATTERN.test(file.filename))
        .map((file) => ({
          name: file.filename,
          path: file.filename,
          size: file.size,
          modified: file.modified,
        }))
        // Newest first: the timelapse anyone opens this page for is the one from
        // the print that just finished.
        .sort((left, right) => right.modified - left.modified)

      if (selectedPath.value && !videos.value.some((v) => v.path === selectedPath.value)) {
        selectedPath.value = null
      }
      failed.value = false
      return true
    } catch {
      if (current === generation) {
        failed.value = true
        videos.value = []
      }
      return false
    } finally {
      if (current === generation) isLoading.value = false
    }
  }

  function select(path: string | null): void {
    selectedPath.value = path
  }

  async function remove(video: TimelapseVideo): Promise<boolean> {
    if (!availability.isMoonrakerConnected) return false
    try {
      await moonraker.rpcCall('server.files.delete_file', { path: `timelapse/${video.path}` })
      videos.value = videos.value.filter((entry) => entry.path !== video.path)
      if (selectedPath.value === video.path) selectedPath.value = null
      return true
    } catch {
      failed.value = true
      return false
    }
  }

  function scheduleRefresh(): void {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void refresh()
    }, 120)
  }

  /** The gallery lists one machine's renders; they go with the switch. */
  function printerChanged(): void {
    generation += 1
    videos.value = []
    selectedPath.value = null
    isLoading.value = false
    failed.value = false
  }

  function start(): void {
    if (started) return
    started = true
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    stopAvailabilityWatch = watch(
      () => availability.isMoonrakerConnected,
      (connected) => {
        if (connected) void refresh()
      },
      { immediate: true },
    )
    // A render finishing writes into this root, so the gallery follows the same
    // notification the file workspaces do rather than waiting for a revisit.
    try {
      stopFileNotifications = moonraker.onNotification('notify_filelist_changed', scheduleRefresh)
    } catch {
      stopFileNotifications = null
    }
  }

  function stop(): void {
    if (!started) return
    started = false
    generation += 1
    isLoading.value = false
    stopAvailabilityWatch?.()
    stopAvailabilityWatch = null
    stopFileNotifications?.()
    stopFileNotifications = null
    stopPrinterChangeReset?.()
    stopPrinterChangeReset = null
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = null
  }

  return {
    videos,
    hasVideos,
    isLoading,
    failed,
    selectedPath,
    selected,
    urlFor,
    refresh,
    select,
    remove,
    start,
    stop,
  }
})
