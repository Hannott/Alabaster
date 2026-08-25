import { defineStore } from 'pinia'
import { ref, watch, type WatchStopHandle } from 'vue'

import type { JsonRpcNotification, MoonrakerSensorInfo } from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { useServerCapabilitiesStore } from '@/stores/serverCapabilities'
import { isRecord } from '@/utils/records'

export interface SensorReading {
  id: string
  friendlyName: string
  values: Record<string, number>
}

function toReading(info: MoonrakerSensorInfo): SensorReading {
  return { id: info.id, friendlyName: info.friendly_name, values: { ...info.values } }
}

export const useSensorsStore = defineStore('sensors', () => {
  const availability = useAvailabilityStore()
  const serverCapabilities = useServerCapabilitiesStore()
  const moonraker = useMoonrakerStore()

  const sensors = ref<SensorReading[]>([])

  const disposers: Array<() => void> = []
  let stopCapabilityWatch: WatchStopHandle | null = null
  let stopPrinterChangeReset: (() => void) | null = null
  let started = false
  let listGeneration = 0

  async function refreshList(): Promise<void> {
    const generation = ++listGeneration
    try {
      const result = await moonraker.rpcCall('server.sensors.list', {})
      if (generation !== listGeneration) return
      sensors.value = Object.values(result.sensors).map(toReading)
    } catch {
      // Either Moonraker has no `sensor` component — `requiresComponent`
      // already hides the card once the handshake has said so — or a
      // genuine request failure, which leaves the last-known readings on
      // screen rather than blanking a card that was working a moment ago.
    }
  }

  /**
   * `notify_sensor_update`'s payload carries every value the changed sensor
   * currently reports, not only the one that moved — Moonraker rebuilds a
   * sensor's whole value dict on any change — so a matching entry is
   * replaced outright rather than merged key by key.
   */
  function handleSensorUpdate(notification: JsonRpcNotification): void {
    const payload = notification.params[0]
    if (!isRecord(payload)) return
    sensors.value = sensors.value.map((sensor) => {
      const next = payload[sensor.id]
      if (!isRecord(next)) return sensor
      const values: Record<string, number> = {}
      for (const [key, value] of Object.entries(next)) {
        if (typeof value === 'number') values[key] = value
      }
      return { ...sensor, values }
    })
  }

  /** Which sensors exist and what they last read both describe the machine on the other end of the socket. */
  function printerChanged(): void {
    sensors.value = []
  }

  function start(): void {
    if (started) return
    started = true
    disposers.push(moonraker.onNotification('notify_sensor_update', handleSensorUpdate))
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    /*
     * Gated on `hasComponent` answering optimistically until Moonraker's own
     * handshake has said otherwise — a printer without the component never
     * asks at all, the same convention `spool.ts`'s own capability watch
     * follows for `spoolman`.
     */
    stopCapabilityWatch = watch(
      () => availability.isMoonrakerConnected && serverCapabilities.hasComponent('sensor'),
      (shouldRun) => {
        if (shouldRun) void refreshList()
      },
      { immediate: true },
    )
  }

  function stop(): void {
    if (!started) return
    started = false
    listGeneration += 1
    stopCapabilityWatch?.()
    stopCapabilityWatch = null
    stopPrinterChangeReset?.()
    stopPrinterChangeReset = null
    while (disposers.length > 0) disposers.pop()?.()
  }

  return {
    sensors,
    start,
    stop,
  }
})
