import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import { MoonrakerDisconnectedError, MoonrakerRpcError } from '@/services/moonraker'
import type {
  JsonRpcNotification,
  MoonrakerCanbusUuid,
  MoonrakerProcStats,
  MoonrakerSerialDevice,
  MoonrakerSystemInfo,
  MoonrakerUpdateEntry,
  MoonrakerUpdateStatus,
  MoonrakerUsbDevice,
} from '@/services/moonraker'
import { useMoonrakerStore } from '@/stores/moonraker'
import { useAvailabilityStore, type KlipperState } from '@/stores/availability'
import { useSpoolStore } from '@/stores/spool'
import { isRecord } from '@/utils/records'

const machineMcuSubscriptionKey = 'alabaster.machine-mcus'
/** JSON-RPC's "method not found", which is how an older Moonraker rejects `upgrade`. */
const methodNotFoundCode = -32601
/** Enough scrollback to hold a full `apt` or `git` transcript without growing without bound. */
export const machineUpdateOutputLimit = 500
/**
 * The update manager answers only when the work is done, so these calls opt out
 * of the transport's local deadline instead of failing a refresh that is still
 * running on the host.
 */
const withoutLocalTimeout = { timeoutMs: null } as const

export interface MachineUpdateItem extends MoonrakerUpdateEntry {
  id: string
  displayName: string
}

export type MachineUpdateAvailability = 'attention' | 'available' | 'current'

export interface MachineUpdateOutputLine {
  /** Monotonic within a session, so a repeated message still gets a stable key. */
  id: number
  application: string
  message: string
}

export interface MachineMcuModule {
  id: string
  name: string
  isPrimary: boolean
  chip: string | null
  app: string | null
  version: string | null
  load: number | null
  frequency: number | null
  isDisconnected: boolean | null
}

/**
 * One CAN interface `system_info.canbus` reported, plus whatever unassigned
 * UUIDs `machine.peripherals.canbus` found on it. `uuids` is empty both when
 * nothing is unassigned and when the scan itself failed — Peripherals still
 * shows the interface either way, since knowing the interface exists and is
 * configured is itself useful without a pending node to report.
 */
export interface MachineCanbusInterface {
  interface: string
  bitrate: number | null
  driver: string | null
  uuids: MoonrakerCanbusUuid[]
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function truncateVersion(version: string | null): string | null {
  return version?.split('-').slice(0, 4).join('-') ?? null
}

/**
 * A repository's headline state. `attention` outranks `available` because a dirty
 * or corrupt repository has to be resolved before an upgrade can succeed at all.
 */
export function updateAvailability(update: MoonrakerUpdateEntry): MachineUpdateAvailability {
  if (update.is_dirty || update.corrupt || update.is_valid === false) return 'attention'
  if (
    (update.package_count ?? 0) > 0 ||
    (update.commits_behind_count ?? 0) > 0 ||
    (update.remote_version && update.version && update.remote_version !== update.version)
  )
    return 'available'
  return 'current'
}

/**
 * `machine.update.upgrade` supersedes the per-item methods, but a Pi that has not
 * updated Moonraker itself answers only the older ones — and that is exactly the
 * machine most likely to have an update waiting.
 */
type LegacyUpgradeMethod =
  | 'machine.update.system'
  | 'machine.update.klipper'
  | 'machine.update.moonraker'
  | 'machine.update.client'

function legacyUpgradeMethod(update: MachineUpdateItem): LegacyUpgradeMethod {
  if (update.configured_type === 'system') return 'machine.update.system'
  if (update.id === 'klipper') return 'machine.update.klipper'
  if (update.id === 'moonraker') return 'machine.update.moonraker'
  return 'machine.update.client'
}

/**
 * Updating Moonraker restarts Moonraker, which drops the socket — so anything
 * sequenced after it would never be reached. It goes last so one connected run
 * covers every other source first.
 */
export function orderUpgradeTargets(updates: readonly MachineUpdateItem[]): MachineUpdateItem[] {
  const available = updates.filter((update) => updateAvailability(update) === 'available')
  return [
    ...available.filter((update) => update.id !== 'moonraker'),
    ...available.filter((update) => update.id === 'moonraker'),
  ]
}

export function buildMcuModules(status: Record<string, unknown>): MachineMcuModule[] {
  return Object.entries(status)
    .filter(([id]) => id === 'mcu' || id.startsWith('mcu '))
    .map(([id, value]) => {
      const mcu = isRecord(value) ? value : {}
      const constants = isRecord(mcu.mcu_constants) ? mcu.mcu_constants : {}
      const stats = isRecord(mcu.last_stats) ? mcu.last_stats : {}
      const taskAverage = finiteNumber(stats.mcu_task_avg)
      const taskDeviation = finiteNumber(stats.mcu_task_stddev)
      return {
        id,
        name: id,
        isPrimary: id === 'mcu',
        chip: stringValue(constants.MCU),
        app: stringValue(mcu.app),
        version: truncateVersion(stringValue(mcu.mcu_version)),
        load:
          taskAverage === null || taskDeviation === null
            ? null
            : taskAverage + (3 * taskDeviation) / 0.0025,
        frequency: finiteNumber(stats.freq),
        isDisconnected:
          typeof mcu.non_critical_disconnected === 'boolean' ? mcu.non_critical_disconnected : null,
      }
    })
    .sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    })
}

export type MachineServiceState = 'active' | 'failed' | 'inactive'

export interface MachineServiceStatus {
  name: string
  state: MachineServiceState
  /** Set only for a service with a web UI of its own to open, such as Spoolman. */
  url: string | null
}

function serviceState(activeState: string | undefined): MachineServiceState {
  if (activeState === 'active') return 'active'
  if (activeState === 'failed') return 'failed'
  return 'inactive'
}

/**
 * `RESTART` and `FIRMWARE_RESTART` are Klippy re-executing its own process in
 * place; systemd never sees the unit stop, so its `active_state` stays `active`
 * throughout. Klippy's own lifecycle (the same signal the header connection
 * light uses) is what actually reports the restart, so the `klipper` row
 * follows that instead of the systemd service state.
 */
function klipperServiceState(klipperState: KlipperState): MachineServiceState {
  if (klipperState === 'ready') return 'active'
  if (klipperState === 'error' || klipperState === 'shutdown') return 'failed'
  return 'inactive'
}

/** A failed service needs attention now, so it sorts first; the rest follow alphabetically. */
export function sortServiceStatuses(services: MachineServiceStatus[]): MachineServiceStatus[] {
  return [...services].sort((left, right) => {
    if (left.state !== right.state) {
      if (left.state === 'failed') return -1
      if (right.state === 'failed') return 1
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  })
}

export function buildServiceStatuses(
  systemInfo: MoonrakerSystemInfo | null,
  klipperState: KlipperState,
): MachineServiceStatus[] {
  if (!systemInfo) return []
  return sortServiceStatuses(
    systemInfo.available_services.map((name) => ({
      name,
      state:
        name === 'klipper'
          ? klipperServiceState(klipperState)
          : serviceState(systemInfo.service_state[name]?.active_state),
      url: null,
    })),
  )
}

/**
 * Spoolman is not a systemd unit Moonraker supervises — it never appears in
 * `available_services` — so it cannot come out of `buildServiceStatuses`. It
 * is its own row, sourced entirely from the `spool` store: its connectivity
 * read (`server.spoolman.status`) and its resolved web UI address
 * (`server.config`).
 *
 * Gated on `spoolmanConnected` having actually answered rather than on the
 * optimistic `hasComponent('spoolman')` every other capability check uses:
 * that flag reads `true` for every printer until the handshake says
 * otherwise, which would flash a "Stopped" Spoolman row on every printer
 * that never configured it at all for the moment before `server.info`
 * settles. The systemd rows above have the same property for free — they
 * start empty and fill in once `machine.system_info` answers — and this
 * mirrors that rather than the nav-style "show until told no" pattern.
 */
export function buildSpoolmanServiceStatus(
  spoolmanConnected: boolean | null,
  spoolmanUrl: string | null,
): MachineServiceStatus | null {
  if (spoolmanConnected === null) return null
  return {
    name: 'spoolman',
    state: spoolmanConnected ? 'active' : 'failed',
    url: spoolmanUrl,
  }
}

export const useMachineSystemStore = defineStore('machineSystem', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()
  const spool = useSpoolStore()
  const systemInfo = ref<MoonrakerSystemInfo | null>(null)
  const procStats = ref<MoonrakerProcStats | null>(null)
  const updates = ref<MachineUpdateItem[]>([])
  const mcuModules = ref<MachineMcuModule[]>([])
  const serialDevices = ref<MoonrakerSerialDevice[]>([])
  const usbDevices = ref<MoonrakerUsbDevice[]>([])
  const canbusInterfaces = ref<MachineCanbusInterface[]>([])
  const isLoadingPeripherals = ref(false)
  const isLoading = ref(false)
  const error = ref(false)
  const clockNow = ref(Date.now())
  const uptimeBaselineAt = ref(Date.now())
  /** `null` while nothing is being checked, `''` while every source is. */
  const checkingUpdateId = ref<string | null>(null)
  const checkFailed = ref(false)
  /** The single source currently installing or recovering, `null` when none is. */
  const runningUpdateId = ref<string | null>(null)
  /** A multi-source run, which walks `runningUpdateId` through its targets. */
  const isUpdatingAll = ref(false)
  const updateFailed = ref(false)
  /**
   * Distinct from `updateFailed`: updating Moonraker restarts Moonraker, so the
   * socket carrying the request is expected to drop and the work continues on the
   * host. Reporting that as "could not be started" would be untrue.
   */
  const updateInterrupted = ref(false)
  const outputLines = ref<MachineUpdateOutputLine[]>([])
  let procStatsEventRevision = 0
  let mcuRefreshRevision = 0
  let serviceStateEventRevision = 0
  let stopPrinterChangeReset: (() => void) | null = null
  let nextOutputLineId = 1
  let stopProcStatsNotifications: (() => void) | null = null
  let stopMcuStatusNotifications: (() => void) | null = null
  let stopServiceStateNotifications: (() => void) | null = null
  let stopUpdateResponseNotifications: (() => void) | null = null
  let stopUpdateRefreshedNotifications: (() => void) | null = null
  let stopAvailabilityWatch: WatchStopHandle | null = null
  let clockTimer: ReturnType<typeof setInterval> | null = null
  let started = false

  const cpuUsage = computed(() => {
    const values = Object.values(procStats.value?.system_cpu_usage ?? {}).filter(Number.isFinite)
    if (values.length === 0) return 0
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
  })

  const memoryUsage = computed(() => {
    const memory = procStats.value?.system_memory
    if (!memory?.total) return 0
    return Math.round((memory.used / memory.total) * 100)
  })

  const systemUptime = computed(() => {
    const uptime = procStats.value?.system_uptime ?? 0
    return Math.max(0, uptime + Math.floor((clockNow.value - uptimeBaselineAt.value) / 1000))
  })

  const isCheckingUpdates = computed(() => checkingUpdateId.value !== null)
  const isUpdating = computed(() => runningUpdateId.value !== null || isUpdatingAll.value)
  /** One gate for every update control: the host runs one update process at a time. */
  const isUpdateManagerBusy = computed(() => isCheckingUpdates.value || isUpdating.value)
  /*
   * Only `available` counts. A source that needs attention has nothing installable
   * — Moonraker refuses to update a dirty or invalid repository — so letting it
   * raise Update all would offer an action that cannot succeed.
   */
  const hasAvailableUpdates = computed(() =>
    updates.value.some((update) => updateAvailability(update) === 'available'),
  )
  const services = computed(() => {
    const spoolmanRow = buildSpoolmanServiceStatus(spool.spoolmanConnected, spool.spoolmanUrl)
    const systemdRows = buildServiceStatuses(systemInfo.value, availability.klipperState)
    return spoolmanRow ? sortServiceStatuses([...systemdRows, spoolmanRow]) : systemdRows
  })

  function applyProcStats(update: Partial<MoonrakerProcStats>): void {
    const previous = procStats.value
    procStats.value = {
      cpu_temp: update.cpu_temp !== undefined ? update.cpu_temp : (previous?.cpu_temp ?? null),
      network: update.network ?? previous?.network ?? {},
      system_cpu_usage: update.system_cpu_usage ?? previous?.system_cpu_usage ?? {},
      system_uptime: update.system_uptime ?? previous?.system_uptime ?? 0,
      system_memory: update.system_memory ??
        previous?.system_memory ?? {
          total: 0,
          available: 0,
          used: 0,
        },
      throttled_state:
        update.throttled_state !== undefined
          ? update.throttled_state
          : (previous?.throttled_state ?? null),
    }
    if (update.system_uptime !== undefined) {
      const receivedAt = Date.now()
      uptimeBaselineAt.value = receivedAt
      clockNow.value = receivedAt
    }
  }

  function handleProcStatsNotification(notification: JsonRpcNotification): void {
    const payload = notification.params[0]
    if (!isRecord(payload)) return

    const update: Partial<MoonrakerProcStats> = {}
    if (
      payload.cpu_temp === null ||
      (typeof payload.cpu_temp === 'number' && Number.isFinite(payload.cpu_temp))
    ) {
      update.cpu_temp = payload.cpu_temp
    }
    if (isRecord(payload.network)) update.network = payload.network as MoonrakerProcStats['network']
    if (isRecord(payload.system_cpu_usage)) {
      update.system_cpu_usage = payload.system_cpu_usage as MoonrakerProcStats['system_cpu_usage']
    }
    if (typeof payload.system_uptime === 'number' && Number.isFinite(payload.system_uptime)) {
      update.system_uptime = payload.system_uptime
    }
    if (isRecord(payload.system_memory)) {
      update.system_memory = payload.system_memory as MoonrakerProcStats['system_memory']
    }

    if (Object.keys(update).length === 0) return
    procStatsEventRevision += 1
    applyProcStats(update)
  }

  function handleMcuStatusNotification(notification: JsonRpcNotification): void {
    const status = notification.params[0]
    if (!isRecord(status)) return

    const connectionSignals = new Map<string, boolean>()
    for (const [id, value] of Object.entries(status)) {
      if (
        (id === 'mcu' || id.startsWith('mcu ')) &&
        isRecord(value) &&
        typeof value.non_critical_disconnected === 'boolean'
      ) {
        connectionSignals.set(id, value.non_critical_disconnected)
      }
    }

    const hasMcuConnectionSignal = connectionSignals.size > 0
    if (hasMcuConnectionSignal) {
      mcuModules.value = mcuModules.value.map((module) =>
        connectionSignals.has(module.id)
          ? { ...module, isDisconnected: connectionSignals.get(module.id) ?? false }
          : module,
      )
    }
    if (hasMcuConnectionSignal) void refreshMcuModules()
  }

  /**
   * Moonraker pushes this the moment systemd reports a transition, so a restart
   * (klipper, or the whole host via a firmware restart) is reflected as it
   * happens rather than staying frozen at whatever `machine.system_info` last saw.
   */
  function handleServiceStateNotification(notification: JsonRpcNotification): void {
    const payload = notification.params[0]
    if (!isRecord(payload) || !systemInfo.value) return

    const previousServiceState = systemInfo.value.service_state
    const nextServiceState = { ...previousServiceState }
    let changed = false
    for (const [name, value] of Object.entries(payload)) {
      if (!isRecord(value)) continue
      const activeState =
        stringValue(value.active_state) ?? previousServiceState[name]?.active_state
      const subState = stringValue(value.sub_state) ?? previousServiceState[name]?.sub_state
      // Both fields are optional on Moonraker's payload, so an unreported one is
      // left absent rather than present-and-undefined.
      nextServiceState[name] = {
        ...(activeState === undefined ? {} : { active_state: activeState }),
        ...(subState === undefined ? {} : { sub_state: subState }),
      }
      changed = true
    }
    if (!changed) return
    serviceStateEventRevision += 1
    systemInfo.value = { ...systemInfo.value, service_state: nextServiceState }
  }

  /*
   * `version_info` is guarded rather than trusted: `load` assigns `error` after
   * reading each settled result, so a throw in here would escape the whole read
   * and leave the page with neither data nor an error.
   */
  function applyUpdateStatus(status: MoonrakerUpdateStatus): void {
    if (!isRecord(status.version_info)) return
    updates.value = Object.entries(status.version_info)
      .map(([id, entry]) => ({ ...entry, id, displayName: entry.name || id }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
  }

  /*
   * Moonraker's PackageKit path reports a step's status change and its progress
   * change as separate notifications that render to the same string, so an
   * upgrade transcript arrives with much of it doubled — `Running...0%`,
   * `Install...22%`, `Loading cache...100%`. Only an immediate repeat from the
   * same source is suppressed, which is narrow enough to leave genuine
   * repetition intact: `apt` really does re-fetch the same `InRelease` in a
   * later phase, and those lines are separated by that phase's own output.
   */
  function repeatsPreviousOutput(application: string, message: string): boolean {
    const previous = outputLines.value.at(-1)
    return previous?.application === application && previous.message === message
  }

  function appendOutput(application: string, message: string): void {
    if (message === '') return
    if (repeatsPreviousOutput(application, message)) return
    const line = { id: nextOutputLineId++, application, message }
    // Reassigned rather than pushed so the console's watcher sees one change per
    // notification and scrolls once.
    outputLines.value = [...outputLines.value, line].slice(-machineUpdateOutputLimit)
  }

  function handleUpdateResponseNotification(notification: JsonRpcNotification): void {
    const payload = notification.params[0]
    if (!isRecord(payload)) return
    const application = stringValue(payload.application) ?? ''
    if (typeof payload.message === 'string') appendOutput(application, payload.message.trimEnd())
    if (payload.complete !== true) return

    // Moonraker owns the lifecycle: an update started from another client ends
    // here too, and the finished versions only exist in a fresh status read.
    runningUpdateId.value = null
    void load()
  }

  function handleUpdateRefreshedNotification(notification: JsonRpcNotification): void {
    const payload = notification.params[0]
    if (!isRecord(payload) || !isRecord(payload.version_info)) return
    applyUpdateStatus(payload as unknown as MoonrakerUpdateStatus)
  }

  /**
   * Asks Moonraker to re-read the configured repositories. This is a read, not a
   * mutation: it reports what an upgrade would install and changes nothing.
   */
  async function checkForUpdates(name?: string): Promise<boolean> {
    if (!moonraker.isConnected || isUpdateManagerBusy.value) return false
    checkingUpdateId.value = name ?? ''
    checkFailed.value = false

    try {
      const status = await moonraker.rpcCall(
        'machine.update.refresh',
        name === undefined ? {} : { name },
        withoutLocalTimeout,
      )
      applyUpdateStatus(status)
      return true
    } catch {
      checkFailed.value = true
      return false
    } finally {
      checkingUpdateId.value = null
    }
  }

  function callLegacyUpgrade(target: MachineUpdateItem): Promise<unknown> {
    const method = legacyUpgradeMethod(target)
    if (method === 'machine.update.client') {
      return moonraker.rpcCall(method, { name: target.id }, withoutLocalTimeout)
    }
    return moonraker.rpcCall(method, undefined, withoutLocalTimeout)
  }

  /*
   * Both the completing `notify_update_response` and the request itself mark the
   * end of the work — Moonraker answers an update only once the host has finished —
   * so whichever lands first clears the running state. Waiting for the notification
   * alone would leave every update control disabled indefinitely if that one frame
   * never arrived, with a page reload as the only way out.
   */
  function finishUpdateRun(id: string): void {
    if (runningUpdateId.value === id) runningUpdateId.value = null
  }

  /**
   * Installs one source. Progress arrives as `notify_update_response` lines rather
   * than in this call's result.
   */
  async function upgradeOne(target: MachineUpdateItem): Promise<boolean> {
    runningUpdateId.value = target.id

    try {
      await moonraker.rpcCall('machine.update.upgrade', { name: target.id }, withoutLocalTimeout)
      finishUpdateRun(target.id)
      return true
    } catch (upgradeError) {
      const isUnknownMethod =
        upgradeError instanceof MoonrakerRpcError && upgradeError.code === methodNotFoundCode
      if (isUnknownMethod) {
        try {
          await callLegacyUpgrade(target)
          finishUpdateRun(target.id)
          return true
        } catch (legacyError) {
          return reportUpdateFailure(legacyError)
        }
      }

      return reportUpdateFailure(upgradeError)
    }
  }

  function beginUpdateRun(): void {
    updateFailed.value = false
    updateInterrupted.value = false
  }

  async function startUpdate(id: string): Promise<boolean> {
    if (!moonraker.isConnected || isUpdateManagerBusy.value) return false
    const target = updates.value.find((item) => item.id === id)
    // A source needing attention is recovered, never upgraded: Moonraker refuses
    // to update a dirty or invalid repository, so this would only produce noise.
    if (!target || updateAvailability(target) === 'attention') return false

    beginUpdateRun()
    return upgradeOne(target)
  }

  /**
   * Installs every source that has an update, one at a time because the host runs
   * one update process at a time. Sources needing attention are not included, so
   * Update all genuinely has no effect on them.
   */
  async function startAllUpdates(): Promise<boolean> {
    if (!moonraker.isConnected || isUpdateManagerBusy.value) return false
    const targets = orderUpgradeTargets(updates.value)
    if (targets.length === 0) return false

    beginUpdateRun()
    isUpdatingAll.value = true
    try {
      for (const target of targets) {
        // Stop at the first failure rather than walking into the rest: a refused
        // update usually means the host is busy or a print is running.
        if (!(await upgradeOne(target))) return false
      }
      return true
    } finally {
      isUpdatingAll.value = false
    }
  }

  /**
   * Resets a repository Moonraker has marked dirty, invalid, or corrupt. A corrupt
   * repository cannot be fixed by `git reset`, so it takes the re-clone instead —
   * the mode follows the reported state rather than asking the user to know which
   * git operation their repository needs.
   */
  async function recoverUpdate(id: string): Promise<boolean> {
    if (!moonraker.isConnected || isUpdateManagerBusy.value) return false
    const target = updates.value.find((item) => item.id === id)
    if (!target) return false

    beginUpdateRun()
    runningUpdateId.value = id

    try {
      await moonraker.rpcCall(
        'machine.update.recover',
        { name: id, hard: target.corrupt === true },
        withoutLocalTimeout,
      )
      finishUpdateRun(id)
      return true
    } catch (recoverError) {
      return reportUpdateFailure(recoverError)
    }
  }

  /*
   * ADR 0005 requires a mutation that loses its socket to fail explicitly and to
   * wait for an explicit retry — never a silent replay. Both paths do that; they
   * differ only in what the interface is allowed to claim happened.
   */
  function reportUpdateFailure(reason: unknown): false {
    if (reason instanceof MoonrakerDisconnectedError) updateInterrupted.value = true
    else updateFailed.value = true
    runningUpdateId.value = null
    return false
  }

  function clearUpdateOutput(): void {
    outputLines.value = []
    updateFailed.value = false
    updateInterrupted.value = false
  }

  async function refreshProcStats(): Promise<void> {
    if (!moonraker.isConnected) return
    const eventRevision = procStatsEventRevision
    try {
      const stats = await moonraker.rpcCall('machine.proc_stats')
      if (eventRevision === procStatsEventRevision) {
        applyProcStats(stats)
      } else {
        applyProcStats({
          system_uptime: stats.system_uptime,
          system_memory: stats.system_memory,
          throttled_state: stats.throttled_state,
        })
      }
    } catch {
      // Live notifications retain the most recent metrics until the next complete snapshot.
    }
  }

  async function refreshMcuModules(): Promise<void> {
    const refreshRevision = ++mcuRefreshRevision
    try {
      const { objects } = await moonraker.rpcCall('printer.objects.list')
      if (refreshRevision !== mcuRefreshRevision) return
      const mcuObjectNames = objects.filter((name) => name === 'mcu' || name.startsWith('mcu '))
      if (mcuObjectNames.length === 0) {
        await moonraker.removeObjectSubscription(machineMcuSubscriptionKey)
        if (refreshRevision !== mcuRefreshRevision) return
        mcuModules.value = []
        return
      }

      await moonraker
        .setObjectSubscription(
          machineMcuSubscriptionKey,
          Object.fromEntries(mcuObjectNames.map((name) => [name, null])),
        )
        .catch(() => undefined)
      if (refreshRevision !== mcuRefreshRevision) return

      const result = await moonraker.rpcCall('printer.objects.query', {
        objects: Object.fromEntries(mcuObjectNames.map((name) => [name, null])),
      })
      if (refreshRevision !== mcuRefreshRevision) return
      mcuModules.value = buildMcuModules(result.status)
    } catch {
      // Klipper may be unavailable while Moonraker remains connected; keep last-known modules visible.
    }
  }

  /**
   * Serial, USB, and CAN devices attached to the host — chiefly so a reader
   * can find the `/dev/serial/by-id/...` path a `[mcu]`/`[probe]` config's
   * `serial:` line wants, or a `canbus_uuid:` a canbus-connected toolhead's
   * config wants, without SSH-ing in. There is no notification for a device
   * being plugged or unplugged, so this is read once with the rest of
   * `load()` and again only on an explicit "Refresh" action — the same shape
   * `machine.update.status` already uses for its own explicit check, per
   * AGENTS.md's rule that a field with no notification behind it still needs
   * an explicit way to become current rather than staying frozen. Any one
   * call failing (an older Moonraker, or a provider that never implemented
   * it) simply leaves that list empty rather than erroring the whole page.
   *
   * The CAN scan needs an interface name upfront — unlike `serial`/`usb`,
   * which need no arguments — so it reads `systemInfo.value.canbus`'s keys
   * rather than guessing `can0`. That is also why this runs after `load()`
   * has already assigned `systemInfo.value`, instead of alongside it: the
   * interface names have to be known before they can be scanned.
   */
  async function refreshPeripherals(): Promise<void> {
    if (!moonraker.isConnected) return
    isLoadingPeripherals.value = true
    try {
      const canbusInterfaceNames = Object.keys(systemInfo.value?.canbus ?? {})
      const [serialResult, usbResult, ...canbusResults] = await Promise.allSettled([
        moonraker.rpcCall('machine.peripherals.serial'),
        moonraker.rpcCall('machine.peripherals.usb'),
        ...canbusInterfaceNames.map((name) =>
          moonraker.rpcCall('machine.peripherals.canbus', { interface: name }),
        ),
      ])
      if (serialResult.status === 'fulfilled')
        serialDevices.value = serialResult.value.serial_devices
      if (usbResult.status === 'fulfilled') usbDevices.value = usbResult.value.usb_devices
      canbusInterfaces.value = canbusInterfaceNames.reduce<MachineCanbusInterface[]>(
        (list, name, index) => {
          const result = canbusResults[index]
          if (result?.status !== 'fulfilled') return list
          const config = systemInfo.value?.canbus?.[name]
          list.push({
            interface: name,
            bitrate: config?.bitrate ?? null,
            driver: config?.driver ?? null,
            uuids: result.value.can_uuids,
          })
          return list
        },
        [],
      )
    } finally {
      isLoadingPeripherals.value = false
    }
  }

  /**
   * Reads the host's current state. `machine.update.status` is a cached read here
   * — asking it to refresh is deprecated, and the explicit check owns that work
   * so a page load never waits on a repository fetch.
   */
  async function load(): Promise<void> {
    if (!moonraker.isConnected) return
    isLoading.value = true
    error.value = false
    const eventRevision = procStatsEventRevision
    const serviceRevision = serviceStateEventRevision

    try {
      const [systemResult, statsResult, updateResult] = await Promise.allSettled([
        moonraker.rpcCall('machine.system_info'),
        moonraker.rpcCall('machine.proc_stats'),
        moonraker.rpcCall('machine.update.status', {}),
        refreshMcuModules(),
      ])
      if (systemResult.status === 'fulfilled') {
        const info = systemResult.value.system_info
        // A service restart triggered by this same update can be reported by
        // `notify_service_state_changed` before this request's own snapshot was
        // taken server-side, so a `service_state` this call returns can already be
        // stale relative to a live notification the store already applied. Keep
        // the live value in that case rather than regressing it back to "stopped".
        systemInfo.value =
          serviceRevision === serviceStateEventRevision
            ? info
            : { ...info, service_state: systemInfo.value?.service_state ?? info.service_state }
      }
      if (statsResult.status === 'fulfilled') {
        if (eventRevision === procStatsEventRevision) applyProcStats(statsResult.value)
        else {
          applyProcStats({
            system_uptime: statsResult.value.system_uptime,
            system_memory: statsResult.value.system_memory,
            throttled_state: statsResult.value.throttled_state,
          })
        }
      }
      if (updateResult.status === 'fulfilled') applyUpdateStatus(updateResult.value)
      // Waits on `systemResult` above, since the CAN scan needs the interface
      // names `system_info.canbus` just reported.
      await refreshPeripherals()
      error.value = [systemResult, statsResult, updateResult].some(
        (result) => result.status === 'rejected',
      )
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Host telemetry, the update list, and any update transcript describe the
   * machine we just left. The revision bumps orphan whatever reads are still
   * in flight against it, the same way `stop()` does.
   */
  function printerChanged(): void {
    procStatsEventRevision += 1
    mcuRefreshRevision += 1
    serviceStateEventRevision += 1
    systemInfo.value = null
    procStats.value = null
    updates.value = []
    mcuModules.value = []
    serialDevices.value = []
    usbDevices.value = []
    canbusInterfaces.value = []
    outputLines.value = []
    checkingUpdateId.value = null
    runningUpdateId.value = null
    isUpdatingAll.value = false
    updateInterrupted.value = false
    checkFailed.value = false
    updateFailed.value = false
    isLoading.value = false
    error.value = false
  }

  function start(): void {
    if (started) return
    started = true
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    clockNow.value = Date.now()
    clockTimer = setInterval(() => {
      clockNow.value = Date.now()
    }, 1_000)
    try {
      stopProcStatsNotifications = moonraker.onNotification(
        'notify_proc_stat_update',
        handleProcStatsNotification,
      )
      stopMcuStatusNotifications = moonraker.onNotification(
        'notify_status_update',
        handleMcuStatusNotification,
      )
      stopServiceStateNotifications = moonraker.onNotification(
        'notify_service_state_changed',
        handleServiceStateNotification,
      )
      stopUpdateResponseNotifications = moonraker.onNotification(
        'notify_update_response',
        handleUpdateResponseNotification,
      )
      stopUpdateRefreshedNotifications = moonraker.onNotification(
        'notify_update_refreshed',
        handleUpdateRefreshedNotification,
      )
    } catch {
      stopProcStatsNotifications?.()
      stopProcStatsNotifications = null
      stopMcuStatusNotifications?.()
      stopMcuStatusNotifications = null
      stopServiceStateNotifications?.()
      stopServiceStateNotifications = null
      stopUpdateResponseNotifications?.()
      stopUpdateResponseNotifications = null
      stopUpdateRefreshedNotifications?.()
      stopUpdateRefreshedNotifications = null
    }
    stopAvailabilityWatch = watch(
      () => availability.isKlipperReady,
      (isReady, wasReady) => {
        if (isReady && wasReady === false) void refreshMcuModules()
      },
    )
  }

  function stop(): void {
    if (!started) return
    started = false
    stopProcStatsNotifications?.()
    stopProcStatsNotifications = null
    stopMcuStatusNotifications?.()
    stopMcuStatusNotifications = null
    stopServiceStateNotifications?.()
    stopServiceStateNotifications = null
    stopUpdateResponseNotifications?.()
    stopUpdateResponseNotifications = null
    stopUpdateRefreshedNotifications?.()
    stopUpdateRefreshedNotifications = null
    stopAvailabilityWatch?.()
    stopAvailabilityWatch = null
    stopPrinterChangeReset?.()
    stopPrinterChangeReset = null
    if (clockTimer) clearInterval(clockTimer)
    clockTimer = null
    mcuRefreshRevision += 1
    void moonraker.removeObjectSubscription(machineMcuSubscriptionKey)
  }

  return {
    systemInfo,
    procStats,
    updates,
    mcuModules,
    serialDevices,
    usbDevices,
    canbusInterfaces,
    isLoadingPeripherals,
    services,
    isLoading,
    error,
    checkingUpdateId,
    checkFailed,
    runningUpdateId,
    isUpdatingAll,
    updateFailed,
    updateInterrupted,
    outputLines,
    cpuUsage,
    memoryUsage,
    systemUptime,
    isCheckingUpdates,
    isUpdating,
    isUpdateManagerBusy,
    hasAvailableUpdates,
    load,
    refreshPeripherals,
    checkForUpdates,
    startUpdate,
    startAllUpdates,
    recoverUpdate,
    clearUpdateOutput,
    refreshProcStats,
    start,
    stop,
  }
})
