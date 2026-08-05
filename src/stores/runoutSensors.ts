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

const runoutSensorsSubscriptionKey = 'alabaster.runoutSensors'
const runoutSensorPrefixes = ['filament_switch_sensor ', 'filament_motion_sensor '] as const

export type RunoutSensorKind = 'switch' | 'motion'

export interface RunoutSensorReading {
  /** Klipper's own object name, e.g. `filament_switch_sensor runout`. */
  objectName: string
  /** The configured name after the section type, e.g. `runout`. */
  name: string
  kind: RunoutSensorKind
  /** Whether runout detection is currently armed for this sensor. */
  enabled: boolean
  filamentDetected: boolean
}

interface RunoutSensorStatus {
  enabled: boolean
  filamentDetected: boolean
}

function isRunoutSensorObject(objectName: string): boolean {
  return runoutSensorPrefixes.some((prefix) => objectName.startsWith(prefix))
}

function sensorKind(objectName: string): RunoutSensorKind {
  return objectName.startsWith('filament_motion_sensor ') ? 'motion' : 'switch'
}

function sensorName(objectName: string): string {
  return objectName.slice(objectName.indexOf(' ') + 1)
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * `filament_switch_sensor`/`filament_motion_sensor` states — whether runout
 * detection is armed, and whether filament is currently seen — read the same
 * way Temperatures discovers its sensors: `printer.objects.list`, rather than
 * parsing `configfile.settings`, because it reports what Klipper actually
 * loaded rather than what the config file merely asked for. Nothing here ever
 * arms, disarms, or otherwise controls a sensor: that belongs with the print it
 * protects, on the Print module, and this store is states only.
 *
 * Started from `main.ts`, not from the Calibration page that is its only
 * reader today — the same choice `bedScrews.ts` and `manualProbe.ts` make, and
 * for the same reason: `onObjectSnapshot`/`onNotification` need a live
 * Moonraker client, which a page-scoped `start()` would only ever have while
 * that one page happened to be mounted, silently missing a runout that
 * triggers while the user is looking at Movement instead.
 */
export const useRunoutSensorsStore = defineStore('runoutSensors', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()

  const objectNames = ref<string[]>([])
  const statusByObject = ref<Record<string, RunoutSensorStatus>>({})

  const readings = computed<RunoutSensorReading[]>(() =>
    objectNames.value
      .map((objectName) => {
        const status = statusByObject.value[objectName]
        return {
          objectName,
          name: sensorName(objectName),
          kind: sensorKind(objectName),
          enabled: status?.enabled ?? false,
          filamentDetected: status?.filamentDetected ?? false,
        }
      })
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true })),
  )
  const hasSensors = computed(() => readings.value.length > 0)

  let discoveryGeneration = 0
  let configuredSelection = ''
  const disposers: Array<() => void> = []
  let stopAvailabilityWatch: WatchStopHandle | null = null
  let stopPrinterChangeReset: (() => void) | null = null
  let started = false

  function mergeStatus(status: Record<string, unknown>): void {
    let changed = false
    const next = { ...statusByObject.value }
    for (const objectName of objectNames.value) {
      const update = status[objectName]
      if (!isRecord(update)) continue
      const current = next[objectName] ?? { enabled: false, filamentDetected: false }
      next[objectName] = {
        enabled: readBoolean(update.enabled, current.enabled),
        filamentDetected: readBoolean(update.filament_detected, current.filamentDetected),
      }
      changed = true
    }
    if (changed) statusByObject.value = next
  }

  function handleSnapshot(snapshot: PrinterObjectSnapshot): void {
    mergeStatus(snapshot.status)
  }

  function handleStatusUpdate(notification: JsonRpcNotification): void {
    const status = notification.params[0]
    if (isRecord(status)) mergeStatus(status)
  }

  /**
   * A sensor that disappeared from the configuration must not keep reporting
   * its last value as if it were live — the same rule telemetry's own
   * `discoverSensors` applies to heaters and fans.
   */
  async function discoverSensors(): Promise<void> {
    const generation = ++discoveryGeneration
    try {
      const result = await moonraker.rpcCall('printer.objects.list')
      if (generation !== discoveryGeneration) return

      const discovered = result.objects.filter(isRunoutSensorObject)
      objectNames.value = discovered
      statusByObject.value = Object.fromEntries(
        Object.entries(statusByObject.value).filter(([objectName]) =>
          discovered.includes(objectName),
        ),
      )

      const selection: PrinterObjectSelection = {}
      for (const objectName of discovered) selection[objectName] = ['enabled', 'filament_detected']

      const nextConfiguredSelection = JSON.stringify(selection)
      if (nextConfiguredSelection === configuredSelection) return
      configuredSelection = nextConfiguredSelection
      await moonraker.setObjectSubscription(runoutSensorsSubscriptionKey, selection)
    } catch {
      // A lifecycle change retries discovery once Klipper is ready again.
    }
  }

  function clear(): void {
    discoveryGeneration += 1
    objectNames.value = []
    statusByObject.value = {}
    configuredSelection = ''
  }

  function start(): void {
    if (started) return
    started = true
    stopPrinterChangeReset = moonraker.onPrinterChange(clear)
    disposers.push(
      moonraker.onObjectSnapshot(handleSnapshot as ObjectSnapshotHandler),
      moonraker.onNotification('notify_status_update', handleStatusUpdate),
    )
    stopAvailabilityWatch = watch(
      () => availability.isKlipperReady,
      (isReady) => {
        if (!isReady) {
          clear()
          return
        }
        void discoverSensors()
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
    void moonraker.removeObjectSubscription(runoutSensorsSubscriptionKey)
  }

  return { readings, hasSensors, start, stop }
})
