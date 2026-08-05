import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import type { JsonRpcNotification, MoonrakerPowerDevice } from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { useServerCapabilitiesStore } from '@/stores/serverCapabilities'
import { isRecord } from '@/utils/records'

function readDevice(value: unknown): MoonrakerPowerDevice | null {
  if (!isRecord(value)) return null
  const device = typeof value.device === 'string' ? value.device : ''
  if (device === '') return null
  return {
    device,
    status: typeof value.status === 'string' ? value.status : '',
    locked_while_printing: value.locked_while_printing === true,
    type: typeof value.type === 'string' ? value.type : '',
  }
}

function readDeviceList(value: unknown): MoonrakerPowerDevice[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    const device = readDevice(candidate)
    return device ? [device] : []
  })
}

/**
 * `machine.device_power.*` — switches Moonraker can drive independently of
 * Klipper, which is exactly why the header power menu is where they live
 * (`docs/design/navigation-plan.md`) rather than a dashboard module: a
 * printer whose PSU is off is precisely when a `klipper`-gated module would
 * be unavailable to turn it back on.
 */
export const useDevicePowerStore = defineStore('devicePower', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()
  const serverCapabilities = useServerCapabilitiesStore()

  const devices = ref<MoonrakerPowerDevice[]>([])
  const isLoading = ref(false)
  const failed = ref(false)
  /** Devices with a request in flight, so one slow relay never disables every row. */
  const pendingDevices = ref<Set<string>>(new Set())

  const disposers: Array<() => void> = []
  let stopCapabilityWatch: WatchStopHandle | null = null
  let stopPrinterChangeReset: (() => void) | null = null
  let started = false

  const hasDevices = computed(() => devices.value.length > 0)

  function upsertDevice(device: MoonrakerPowerDevice): void {
    const index = devices.value.findIndex((entry) => entry.device === device.device)
    if (index === -1) {
      devices.value = [...devices.value, device]
      return
    }
    const next = devices.value.slice()
    next[index] = device
    devices.value = next
  }

  async function refresh(): Promise<void> {
    if (isLoading.value) return
    isLoading.value = true
    try {
      const result = await moonraker.rpcCall('machine.device_power.devices')
      devices.value = readDeviceList(result.devices)
      failed.value = false
    } catch {
      // A printer with no `[power]` devices, or one whose Moonraker refuses
      // the call outright, reports nothing rather than an error banner: the
      // menu section simply stays empty, the same posture every other
      // optional component takes.
      failed.value = true
    } finally {
      isLoading.value = false
    }
  }

  function handlePowerChanged(notification: JsonRpcNotification): void {
    const device = readDevice(notification.params[0])
    if (device) upsertDevice(device)
  }

  /**
   * `action` is always the explicit target rather than `'toggle'`: deriving it
   * from the device's own last-known status means a stale read sends the
   * wrong direction only as often as the status itself is stale, and Klipper
   * never has to guess which way "toggle" meant.
   */
  async function setDevice(name: string, action: 'on' | 'off'): Promise<boolean> {
    if (pendingDevices.value.has(name)) return false
    pendingDevices.value = new Set(pendingDevices.value).add(name)
    try {
      const result = await moonraker.rpcCall('machine.device_power.post_device', {
        device: name,
        action,
      })
      const status = result[name]
      if (typeof status === 'string') {
        const existing = devices.value.find((entry) => entry.device === name)
        upsertDevice({
          device: name,
          status,
          locked_while_printing: existing?.locked_while_printing ?? false,
          type: existing?.type ?? '',
        })
      }
      return true
    } catch {
      return false
    } finally {
      const next = new Set(pendingDevices.value)
      next.delete(name)
      pendingDevices.value = next
    }
  }

  /** Another machine's `moonraker.conf` declares different devices, or none. */
  function printerChanged(): void {
    devices.value = []
    failed.value = false
    pendingDevices.value = new Set()
  }

  function start(): void {
    if (started) return
    started = true
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    disposers.push(moonraker.onNotification('notify_power_changed', handlePowerChanged))
    stopCapabilityWatch = watch(
      () => availability.isMoonrakerConnected && serverCapabilities.hasComponent('power'),
      (shouldRun) => {
        if (shouldRun) void refresh()
      },
      { immediate: true },
    )
  }

  function stop(): void {
    if (!started) return
    started = false
    stopCapabilityWatch?.()
    stopCapabilityWatch = null
    stopPrinterChangeReset?.()
    stopPrinterChangeReset = null
    while (disposers.length > 0) disposers.pop()?.()
  }

  return {
    devices,
    isLoading,
    failed,
    pendingDevices,
    hasDevices,
    refresh,
    setDevice,
    start,
    stop,
  }
})
