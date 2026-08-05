import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import type { MoonrakerWebcam } from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { createGuardedLoad } from '@/stores/guardedLoad'
import { useMoonrakerStore } from '@/stores/moonraker'

export function resolveWebcamUrl(streamUrl: string, websocketEndpoint: string): string {
  const endpoint = new URL(websocketEndpoint)
  endpoint.protocol = endpoint.protocol === 'wss:' ? 'https:' : 'http:'
  endpoint.pathname = '/'
  endpoint.search = ''
  endpoint.hash = ''
  return new URL(streamUrl, endpoint).toString()
}

export const useWebcamsStore = defineStore('webcams', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()
  const webcams = ref<MoonrakerWebcam[]>([])
  const isLoading = ref(false)
  const failed = ref(false)
  let stopAvailabilityWatch: WatchStopHandle | null = null
  let stopWebcamNotifications: (() => void) | null = null
  let stopPrinterChangeReset: (() => void) | null = null
  let started = false
  const load = createGuardedLoad({ isLoading, failed })

  const primaryWebcam = computed(() => webcams.value.find((webcam) => webcam.enabled) ?? null)
  const primaryStreamUrl = computed(() =>
    primaryWebcam.value
      ? resolveWebcamUrl(primaryWebcam.value.stream_url, moonraker.endpoint)
      : null,
  )

  /** The camera list is the other machine's hardware; it goes with the switch. */
  function printerChanged(): void {
    load.invalidate()
    webcams.value = []
    failed.value = false
  }

  async function refresh(): Promise<void> {
    await load.run(
      () => moonraker.rpcCall('server.webcams.list'),
      (result) => {
        webcams.value = result.webcams
      },
    )
  }

  function start(): void {
    if (started) return
    started = true
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    stopAvailabilityWatch = watch(
      () => availability.isMoonrakerConnected,
      (isConnected) => {
        if (isConnected) void refresh()
      },
      { immediate: true },
    )
    // A camera added or renamed from another client has to appear without a
    // reload; this is the notification Moonraker fires when its webcam list
    // changes.
    try {
      stopWebcamNotifications = moonraker.onNotification('notify_webcams_changed', () => {
        void refresh()
      })
    } catch {
      stopWebcamNotifications = null
    }
  }

  function stop(): void {
    if (!started) return
    started = false
    load.invalidate()
    stopAvailabilityWatch?.()
    stopAvailabilityWatch = null
    stopWebcamNotifications?.()
    stopWebcamNotifications = null
    stopPrinterChangeReset?.()
    stopPrinterChangeReset = null
  }

  return { webcams, primaryWebcam, primaryStreamUrl, isLoading, failed, start, stop, refresh }
})
