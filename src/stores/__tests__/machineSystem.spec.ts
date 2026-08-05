import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAvailabilityStore } from '@/stores/availability'
import {
  buildMcuModules,
  machineUpdateOutputLimit,
  updateAvailability,
  useMachineSystemStore,
} from '@/stores/machineSystem'
import { useMoonrakerStore } from '@/stores/moonraker'
import { useSpoolStore } from '@/stores/spool'
import { MoonrakerDisconnectedError, MoonrakerRpcError } from '@/services/moonraker'
import type { JsonRpcNotification, MoonrakerProcStats } from '@/services/moonraker'

/** Registers the store's notification handlers without a real socket. */
function captureNotifications(
  moonraker: ReturnType<typeof useMoonrakerStore>,
): Map<string, (notification: JsonRpcNotification) => void> {
  const handlers = new Map<string, (notification: JsonRpcNotification) => void>()
  vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
    handlers.set(method, handler)
    return () => handlers.delete(method)
  })
  return handlers
}

function updateStatus(versionInfo: Record<string, Record<string, unknown>>) {
  return {
    busy: false,
    github_rate_limit: 60,
    github_requests_remaining: 60,
    github_limit_reset_time: 0,
    version_info: versionInfo,
  }
}

describe('machine system store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('orders the primary MCU before named controller modules and preserves reported details', () => {
    expect(
      buildMcuModules({
        'mcu toolboard': {
          mcu_constants: { MCU: 'STM32G0B1xx' },
          mcu_version: 'v0.12.0-1-extra',
          last_stats: {
            mcu_task_avg: 0.00001,
            mcu_task_stddev: 0.000001,
            freq: 12_000_000,
          },
        },
        mcu: {
          app: 'Kalico',
          mcu_constants: { MCU: 'STM32F446xx' },
          mcu_version: 'v0.12.0-2-extra',
          last_stats: {
            mcu_task_avg: 0.00002,
            mcu_task_stddev: 0.000002,
            freq: 180_000_000,
          },
        },
        'mcu bed': { mcu_constants: { MCU: 'RP2040' } },
        toolhead: { position: [0, 0, 0] },
      }),
    ).toEqual([
      {
        id: 'mcu',
        name: 'mcu',
        isPrimary: true,
        chip: 'STM32F446xx',
        app: 'Kalico',
        version: 'v0.12.0-2-extra',
        load: 0.00002 + (3 * 0.000002) / 0.0025,
        frequency: 180_000_000,
        isDisconnected: null,
      },
      {
        id: 'mcu bed',
        name: 'mcu bed',
        isPrimary: false,
        chip: 'RP2040',
        app: null,
        version: null,
        load: null,
        frequency: null,
        isDisconnected: null,
      },
      {
        id: 'mcu toolboard',
        name: 'mcu toolboard',
        isPrimary: false,
        chip: 'STM32G0B1xx',
        app: null,
        version: 'v0.12.0-1-extra',
        load: 0.00001 + (3 * 0.000001) / 0.0025,
        frequency: 12_000_000,
        isDisconnected: null,
      },
    ])
  })

  it('rediscovers controller modules after Klipper restarts and Kalico reports a module disconnect', async () => {
    const availability = useAvailabilityStore()
    const moonraker = useMoonrakerStore()
    moonraker.connectionPhase = 'connected'
    const rpcCall = vi
      .spyOn(moonraker, 'rpcCall')
      .mockResolvedValueOnce({ objects: ['mcu', 'mcu canbus'] } as never)
      .mockResolvedValueOnce({
        eventtime: 1,
        status: {
          mcu: { mcu_constants: { MCU: 'STM32F446xx' } },
          'mcu canbus': { mcu_constants: { MCU: 'STM32G0B1xx' } },
        },
      } as never)
      .mockResolvedValueOnce({ objects: ['mcu', 'mcu canbus'] } as never)
      .mockResolvedValueOnce({
        eventtime: 2,
        status: {
          mcu: { mcu_constants: { MCU: 'STM32F446xx' } },
          'mcu canbus': {
            mcu_constants: { MCU: 'STM32G0B1xx' },
            non_critical_disconnected: true,
          },
        },
      } as never)

    const setObjectSubscription = vi
      .spyOn(moonraker, 'setObjectSubscription')
      .mockResolvedValue(undefined)
    vi.spyOn(moonraker, 'removeObjectSubscription').mockResolvedValue(undefined)

    let mcuStatusHandler: ((notification: JsonRpcNotification) => void) | undefined
    vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
      if (method === 'notify_status_update') mcuStatusHandler = handler
      return () => undefined
    })

    const machine = useMachineSystemStore()
    machine.start()
    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    availability.printerSnapshotSynchronized()
    await nextTick()
    await vi.waitFor(() => {
      expect(machine.mcuModules.map((module) => module.id)).toEqual(['mcu', 'mcu canbus'])
    })

    expect(rpcCall).toHaveBeenCalledWith('printer.objects.list')
    expect(setObjectSubscription).toHaveBeenCalledWith('alabaster.machine-mcus', {
      mcu: null,
      'mcu canbus': null,
    })
    mcuStatusHandler?.({
      jsonrpc: '2.0',
      method: 'notify_status_update',
      params: [{ 'mcu canbus': { non_critical_disconnected: true } }, 2],
    })
    expect(machine.mcuModules.find((module) => module.id === 'mcu canbus')?.isDisconnected).toBe(
      true,
    )
    await vi.waitFor(() => {
      expect(rpcCall).toHaveBeenCalledTimes(4)
      expect(machine.mcuModules.find((module) => module.id === 'mcu canbus')?.isDisconnected).toBe(
        true,
      )
    })
    machine.stop()
  })

  it('loads host metrics and sorts update sources by display name', async () => {
    useAvailabilityStore().moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const moonraker = useMoonrakerStore()
    moonraker.connectionPhase = 'connected'
    const rpcCall = vi
      .spyOn(moonraker, 'rpcCall')
      .mockResolvedValueOnce({
        system_info: {
          provider: 'systemd_cli',
          distribution: { name: 'Debian', version: '13', codename: 'trixie' },
          available_services: ['klipper', 'moonraker'],
          service_state: {},
        },
      } as never)
      .mockResolvedValueOnce({
        cpu_temp: 45,
        network: {},
        system_cpu_usage: { cpu0: 10, cpu1: 30 },
        system_uptime: 3600,
        system_memory: { total: 1000, available: 600, used: 400 },
        throttled_state: null,
      } as never)
      .mockResolvedValueOnce({
        busy: false,
        github_rate_limit: 60,
        github_requests_remaining: 50,
        github_limit_reset_time: 0,
        version_info: {
          moonraker: { configured_type: 'git_repo', version: 'v1' },
          klipper: { configured_type: 'git_repo', name: 'Klipper', version: 'v2' },
        },
      } as never)
      .mockResolvedValueOnce({ objects: ['toolhead', 'mcu toolboard', 'mcu'] } as never)
      .mockResolvedValueOnce({ serial_devices: [] } as never)
      .mockResolvedValueOnce({ usb_devices: [] } as never)
      .mockResolvedValueOnce({
        eventtime: 1,
        status: {
          'mcu toolboard': { mcu_constants: { MCU: 'STM32G0B1xx' } },
          mcu: { mcu_constants: { MCU: 'STM32F446xx' } },
        },
      } as never)

    const machine = useMachineSystemStore()
    await machine.load()

    // Asking `status` to refresh is deprecated and blocks the page load behind a
    // repository fetch; the explicit check owns that work instead.
    expect(rpcCall).toHaveBeenNthCalledWith(3, 'machine.update.status', {})
    expect(machine.cpuUsage).toBe(20)
    expect(machine.memoryUsage).toBe(40)
    expect(machine.updates.map((update) => update.displayName)).toEqual(['Klipper', 'moonraker'])
    expect(machine.mcuModules.map((module) => module.id)).toEqual(['mcu', 'mcu toolboard'])
    expect(machine.error).toBe(false)
  })

  it('updates a non-Klipper service status live from notify_service_state_changed, without a fresh load', async () => {
    useAvailabilityStore().moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const moonraker = useMoonrakerStore()
    moonraker.connectionPhase = 'connected'
    const handlers = captureNotifications(moonraker)
    vi.spyOn(moonraker, 'rpcCall')
      .mockResolvedValueOnce({
        system_info: {
          provider: 'systemd_cli',
          distribution: { name: 'Debian', version: '13', codename: 'trixie' },
          available_services: ['klipper', 'moonraker'],
          service_state: {
            klipper: { active_state: 'active', sub_state: 'running' },
            moonraker: { active_state: 'active', sub_state: 'running' },
          },
        },
      } as never)
      .mockResolvedValueOnce({
        cpu_temp: 45,
        network: {},
        system_cpu_usage: {},
        system_uptime: 3600,
        system_memory: { total: 1000, available: 600, used: 400 },
        throttled_state: null,
      } as never)
      .mockResolvedValueOnce(updateStatus({}) as never)
      .mockResolvedValueOnce({ objects: [] } as never)

    const machine = useMachineSystemStore()
    machine.start()
    await machine.load()

    expect(machine.services).toEqual([
      { name: 'klipper', state: 'active', url: null },
      { name: 'moonraker', state: 'active', url: null },
    ])

    // Moonraker itself is a genuine systemd unit restart, so its active_state
    // transitions and the notification reports it live.
    handlers.get('notify_service_state_changed')?.({
      jsonrpc: '2.0',
      method: 'notify_service_state_changed',
      params: [{ moonraker: { active_state: 'failed', sub_state: 'failed' } }],
    })
    expect(machine.services).toEqual([
      { name: 'moonraker', state: 'failed', url: null },
      { name: 'klipper', state: 'active', url: null },
    ])

    machine.stop()
  })

  it('keeps a live service-state notification that arrives while a reload is already in flight', async () => {
    // Reproduces a service (e.g. KlipperScreen) staying "Stopped" in the UI after
    // its own update finished restarting it: the update's completion triggers a
    // fresh `machine.system_info` read, but that request's answer can be a
    // snapshot the host took before the restart settled, arriving after the
    // live `notify_service_state_changed` notification already reported "active".
    useAvailabilityStore().moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const moonraker = useMoonrakerStore()
    moonraker.connectionPhase = 'connected'
    const handlers = captureNotifications(moonraker)
    const rpcCall = vi
      .spyOn(moonraker, 'rpcCall')
      .mockResolvedValueOnce({
        system_info: {
          provider: 'systemd_cli',
          distribution: { name: 'Debian', version: '13', codename: 'trixie' },
          available_services: ['klipper', 'klipperscreen'],
          service_state: {
            klipper: { active_state: 'active', sub_state: 'running' },
            klipperscreen: { active_state: 'active', sub_state: 'running' },
          },
        },
      } as never)
      .mockResolvedValueOnce({
        cpu_temp: 45,
        network: {},
        system_cpu_usage: {},
        system_uptime: 3600,
        system_memory: { total: 1000, available: 600, used: 400 },
        throttled_state: null,
      } as never)
      .mockResolvedValueOnce(updateStatus({}) as never)
      .mockResolvedValueOnce({ objects: [] } as never)

    const machine = useMachineSystemStore()
    machine.start()
    await machine.load()
    expect(machine.services).toEqual([
      { name: 'klipper', state: 'active', url: null },
      { name: 'klipperscreen', state: 'active', url: null },
    ])

    let resolveSystemInfo!: (value: unknown) => void
    const staleSystemInfo = new Promise((resolve) => {
      resolveSystemInfo = resolve
    })
    rpcCall
      .mockReturnValueOnce(staleSystemInfo as never)
      .mockResolvedValueOnce({
        cpu_temp: 45,
        network: {},
        system_cpu_usage: {},
        system_uptime: 3610,
        system_memory: { total: 1000, available: 600, used: 400 },
        throttled_state: null,
      } as never)
      .mockResolvedValueOnce(updateStatus({}) as never)
      .mockResolvedValueOnce({ objects: [] } as never)

    // The update's own `notify_update_response(complete: true)` triggers this reload.
    const reload = machine.load()

    // The real transition to "active" is reported live while that request is
    // still waiting on the host.
    handlers.get('notify_service_state_changed')?.({
      jsonrpc: '2.0',
      method: 'notify_service_state_changed',
      params: [{ klipperscreen: { active_state: 'active', sub_state: 'running' } }],
    })
    expect(machine.services).toEqual([
      { name: 'klipper', state: 'active', url: null },
      { name: 'klipperscreen', state: 'active', url: null },
    ])

    // The in-flight `machine.system_info` request finally answers, but with a
    // snapshot taken before the restart — the same kind of stale read a manual
    // browser refresh would eventually replace, except this one must not win.
    resolveSystemInfo({
      system_info: {
        provider: 'systemd_cli',
        distribution: { name: 'Debian', version: '13', codename: 'trixie' },
        available_services: ['klipper', 'klipperscreen'],
        service_state: {
          klipper: { active_state: 'active', sub_state: 'running' },
          klipperscreen: { active_state: 'inactive', sub_state: 'dead' },
        },
      },
    })
    await reload

    expect(machine.services).toEqual([
      { name: 'klipper', state: 'active', url: null },
      { name: 'klipperscreen', state: 'active', url: null },
    ])

    machine.stop()
  })

  it('follows Klippy lifecycle for the klipper row instead of the frozen systemd state', async () => {
    // `RESTART`/`FIRMWARE_RESTART` have Klippy re-exec its own process: systemd
    // never sees the unit stop, so `service_state.klipper.active_state` would
    // stay "active" the whole time if that were the only signal used. The row
    // must instead follow the same Klippy lifecycle notifications that drive the
    // header connection light.
    const availability = useAvailabilityStore()
    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const moonraker = useMoonrakerStore()
    moonraker.connectionPhase = 'connected'
    vi.spyOn(moonraker, 'rpcCall')
      .mockResolvedValueOnce({
        system_info: {
          provider: 'systemd_cli',
          distribution: { name: 'Debian', version: '13', codename: 'trixie' },
          available_services: ['klipper'],
          service_state: { klipper: { active_state: 'active', sub_state: 'running' } },
        },
      } as never)
      .mockResolvedValueOnce({
        cpu_temp: 45,
        network: {},
        system_cpu_usage: {},
        system_uptime: 3600,
        system_memory: { total: 1000, available: 600, used: 400 },
        throttled_state: null,
      } as never)
      .mockResolvedValueOnce(updateStatus({}) as never)
      .mockResolvedValueOnce({ objects: [] } as never)

    const machine = useMachineSystemStore()
    await machine.load()
    expect(machine.services).toEqual([{ name: 'klipper', state: 'active', url: null }])

    availability.handleKlipperNotification('notify_klippy_disconnected')
    expect(machine.services).toEqual([{ name: 'klipper', state: 'inactive', url: null }])

    availability.handleKlipperNotification('notify_klippy_shutdown')
    expect(machine.services).toEqual([{ name: 'klipper', state: 'failed', url: null }])

    availability.handleKlipperNotification('notify_klippy_ready')
    expect(machine.services).toEqual([{ name: 'klipper', state: 'active', url: null }])
  })

  it('adds a Spoolman row from the spool store once it has actually answered, independent of systemd', () => {
    useAvailabilityStore().moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const machine = useMachineSystemStore()
    const spool = useSpoolStore()

    // No answer yet — not even a Spoolman-less printer's own optimistic
    // capability flag — so the row stays absent rather than flashing "Stopped".
    expect(machine.services).toEqual([])

    spool.spoolmanUrl = 'http://printer.local:7912/'
    spool.spoolmanConnected = true
    expect(machine.services).toEqual([
      { name: 'spoolman', state: 'active', url: 'http://printer.local:7912/' },
    ])

    spool.spoolmanConnected = false
    expect(machine.services).toEqual([
      { name: 'spoolman', state: 'failed', url: 'http://printer.local:7912/' },
    ])
  })

  it('retains loaded data when a later refresh fails', async () => {
    const moonraker = useMoonrakerStore()
    moonraker.connectionPhase = 'connected'
    const machine = useMachineSystemStore()
    machine.updates = [{ id: 'klipper', displayName: 'klipper', version: 'v1' }]
    vi.spyOn(moonraker, 'rpcCall').mockRejectedValue(new Error('offline'))

    await machine.load()

    expect(machine.error).toBe(true)
    expect(machine.updates).toHaveLength(1)
  })

  it('reads serial and USB devices, keeping either list independent of the other failing', async () => {
    const moonraker = useMoonrakerStore()
    moonraker.connectionPhase = 'connected'
    const machine = useMachineSystemStore()
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'machine.peripherals.serial') {
        return Promise.resolve({
          serial_devices: [
            {
              device_type: 'usb',
              device_path: '/dev/ttyACM0',
              device_name: 'ttyACM0',
              driver_name: 'cdc_acm',
              path_by_hardware: null,
              path_by_id: '/dev/serial/by-id/usb-Klipper_stm32f446xx-if00',
              usb_location: '1:5',
            },
          ],
        }) as never
      }
      if (method === 'machine.peripherals.usb') {
        return Promise.reject(new Error('usb detection unavailable'))
      }
      return Promise.reject(new Error('unexpected call'))
    })

    await machine.refreshPeripherals()

    expect(machine.serialDevices).toHaveLength(1)
    expect(machine.serialDevices[0]?.path_by_id).toBe(
      '/dev/serial/by-id/usb-Klipper_stm32f446xx-if00',
    )
    // The failed USB read leaves that list exactly as it was rather than
    // erroring the whole call — an older Moonraker without this method must
    // not blank out the serial devices it just answered.
    expect(machine.usbDevices).toEqual([])
  })

  it('clears peripherals when the connection is retargeted', async () => {
    const realWebSocket = globalThis.WebSocket
    globalThis.WebSocket = class {
      static readonly CONNECTING = 0
      readyState = 0
      close(): void {}
      send(): void {}
    } as unknown as typeof WebSocket
    const moonraker = useMoonrakerStore()
    // A client has to exist for the retarget below to count as a printer
    // change — `connect` is the path `printerChanged` actually runs on.
    moonraker.connect('printer-a.local:7125')
    moonraker.connectionPhase = 'connected'
    const machine = useMachineSystemStore()
    machine.start()
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'machine.peripherals.serial') {
        return Promise.resolve({ serial_devices: [{ device_path: '/dev/ttyACM0' }] }) as never
      }
      if (method === 'machine.peripherals.usb') {
        return Promise.resolve({ usb_devices: [{ vendor_id: '1d50' }] }) as never
      }
      return Promise.reject(new Error('unexpected call'))
    })
    await machine.refreshPeripherals()
    expect(machine.serialDevices).toHaveLength(1)

    moonraker.connect('a-different-printer.local')
    globalThis.WebSocket = realWebSocket

    expect(machine.serialDevices).toEqual([])
    expect(machine.usbDevices).toEqual([])
    machine.stop()
  })

  it('applies live process-stat notifications and preserves them over a slower snapshot', async () => {
    const moonraker = useMoonrakerStore()
    moonraker.connectionPhase = 'connected'
    let notificationHandler: ((notification: JsonRpcNotification) => void) | undefined
    const dispose = vi.fn()
    const subscribedMethods: string[] = []
    vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
      subscribedMethods.push(method)
      if (method === 'notify_proc_stat_update') notificationHandler = handler
      return dispose
    })

    let resolveSnapshot: ((stats: MoonrakerProcStats) => void) | undefined
    vi.spyOn(moonraker, 'rpcCall').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSnapshot = resolve
        }) as never,
    )

    const machine = useMachineSystemStore()
    machine.start()
    const refresh = machine.refreshProcStats()

    notificationHandler?.({
      jsonrpc: '2.0',
      method: 'notify_proc_stat_update',
      params: [
        {
          cpu_temp: 55,
          network: { wlan0: { bandwidth: 4096 } },
          system_cpu_usage: { cpu: 72 },
        },
      ],
    })

    resolveSnapshot?.({
      cpu_temp: 40,
      network: {},
      system_cpu_usage: { cpu: 10 },
      system_uptime: 7200,
      system_memory: { total: 1000, available: 500, used: 500 },
      throttled_state: null,
    })
    await refresh

    expect(machine.procStats?.cpu_temp).toBe(55)
    expect(machine.cpuUsage).toBe(72)
    expect(machine.procStats?.network.wlan0?.bandwidth).toBe(4096)
    expect(machine.memoryUsage).toBe(50)
    expect(machine.systemUptime).toBeGreaterThanOrEqual(7200)

    expect(subscribedMethods).toEqual([
      'notify_proc_stat_update',
      'notify_status_update',
      'notify_service_state_changed',
      'notify_update_response',
      'notify_update_refreshed',
    ])

    machine.stop()
    expect(dispose).toHaveBeenCalledTimes(5)
  })

  it('reads a headline state for every source and only offers Update all when one is behind', () => {
    expect(updateAvailability({ is_dirty: true, remote_version: 'v1', version: 'v1' })).toBe(
      'attention',
    )
    expect(updateAvailability({ corrupt: true })).toBe('attention')
    expect(updateAvailability({ is_valid: false })).toBe('attention')
    expect(updateAvailability({ commits_behind_count: 2 })).toBe('available')
    expect(updateAvailability({ package_count: 7 })).toBe('available')
    expect(updateAvailability({ remote_version: 'v2', version: 'v1' })).toBe('available')
    expect(updateAvailability({ remote_version: 'v1', version: 'v1' })).toBe('current')

    const machine = useMachineSystemStore()
    machine.updates = [
      { id: 'klipper', displayName: 'Klipper', remote_version: 'v1', version: 'v1' },
    ]
    expect(machine.hasAvailableUpdates).toBe(false)

    machine.updates = [
      ...machine.updates,
      { id: 'system', displayName: 'system', package_count: 3 },
    ]
    expect(machine.hasAvailableUpdates).toBe(true)
  })

  it('checks for updates without a local deadline and keeps the last status when the check fails', async () => {
    const moonraker = useMoonrakerStore()
    moonraker.connectionPhase = 'connected'
    const machine = useMachineSystemStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValueOnce(
      updateStatus({
        klipper: { name: 'Klipper', version: 'v1', remote_version: 'v2' },
      }) as never,
    )

    expect(await machine.checkForUpdates()).toBe(true)

    // A repository fetch routinely outlasts any timeout short enough to be
    // useful elsewhere, so the refresh opts out of the local timer entirely.
    expect(rpcCall).toHaveBeenCalledWith('machine.update.refresh', {}, { timeoutMs: null })
    expect(machine.updates.map((update) => update.displayName)).toEqual(['Klipper'])
    expect(machine.hasAvailableUpdates).toBe(true)
    expect(machine.isCheckingUpdates).toBe(false)
    expect(machine.checkFailed).toBe(false)
    // The page-level banner stays reserved for a failed host read.
    expect(machine.error).toBe(false)

    rpcCall.mockRejectedValueOnce(new Error('offline'))
    expect(await machine.checkForUpdates('klipper')).toBe(false)

    expect(rpcCall).toHaveBeenLastCalledWith(
      'machine.update.refresh',
      { name: 'klipper' },
      { timeoutMs: null },
    )
    expect(machine.checkFailed).toBe(true)
    expect(machine.updates).toHaveLength(1)
    expect(machine.error).toBe(false)
  })

  it('streams update output and never leaves the running state stuck on a missing notification', async () => {
    const moonraker = useMoonrakerStore()
    moonraker.connectionPhase = 'connected'
    const handlers = captureNotifications(moonraker)
    const machine = useMachineSystemStore()
    machine.start()
    machine.updates = [{ id: 'klipper', displayName: 'Klipper', commits_behind_count: 1 }]

    // Moonraker answers an update only once the host has finished, so the request
    // resolving is itself an end-of-work signal. Waiting for the completing
    // notification alone would disable every update control indefinitely if that
    // one frame never arrived.
    let finishUpgrade: (() => void) | undefined
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation(
      () =>
        new Promise((resolve) => {
          finishUpgrade = () => resolve('ok')
        }) as never,
    )
    const upgrading = machine.startUpdate('klipper')
    await flushPromises()

    expect(rpcCall).toHaveBeenCalledWith(
      'machine.update.upgrade',
      { name: 'klipper' },
      { timeoutMs: null },
    )
    expect(machine.runningUpdateId).toBe('klipper')
    expect(machine.isUpdating).toBe(true)

    const respond = handlers.get('notify_update_response')
    respond?.({
      jsonrpc: '2.0',
      method: 'notify_update_response',
      params: [
        { application: 'klipper', proc_id: 1, message: 'Updating Klipper...', complete: false },
      ],
    })
    respond?.({
      jsonrpc: '2.0',
      method: 'notify_update_response',
      params: [{ application: 'klipper', proc_id: 1, message: '', complete: false }],
    })

    expect(machine.outputLines.map((line) => line.message)).toEqual(['Updating Klipper...'])
    expect(machine.isUpdating).toBe(true)

    // No completing notification here — only the request settling.
    finishUpgrade?.()
    expect(await upgrading).toBe(true)
    expect(machine.runningUpdateId).toBe(null)
    expect(machine.isUpdating).toBe(false)

    // The notification path still clears it when it is the one that arrives first.
    machine.runningUpdateId = 'klipper'
    respond?.({
      jsonrpc: '2.0',
      method: 'notify_update_response',
      params: [{ application: 'klipper', proc_id: 1, message: 'Update finished', complete: true }],
    })

    expect(machine.outputLines).toHaveLength(2)
    expect(machine.runningUpdateId).toBe(null)
    machine.stop()
  })

  it('collapses a progress line Moonraker reports twice without hiding a later repeat', () => {
    const moonraker = useMoonrakerStore()
    moonraker.connectionPhase = 'connected'
    const handlers = captureNotifications(moonraker)
    const machine = useMachineSystemStore()
    machine.start()

    const respond = handlers.get('notify_update_response')
    // PackageKit reports the step's status change and its progress change
    // separately, and both render to the same string.
    const stream = [
      { application: 'system', message: 'Install...22%' },
      { application: 'system', message: 'Install...22%\n' },
      { application: 'system', message: 'Preparing: udisks2' },
      // A different source repeating the same string is its own line.
      { application: 'klipper', message: 'Preparing: udisks2' },
      // apt really does re-fetch this in a later phase, once other output has
      // intervened, so it must survive.
      { application: 'system', message: 'Install...22%' },
    ]
    for (const params of stream) {
      respond?.({
        jsonrpc: '2.0',
        method: 'notify_update_response',
        params: [{ ...params, proc_id: 2, complete: false }],
      })
    }

    expect(machine.outputLines.map((line) => line.message)).toEqual([
      'Install...22%',
      'Preparing: udisks2',
      'Preparing: udisks2',
      'Install...22%',
    ])
    // Every surviving line still carries its own key.
    expect(new Set(machine.outputLines.map((line) => line.id)).size).toBe(4)
    machine.stop()
  })

  it('bounds the transcript and applies a status refreshed by another client', () => {
    const moonraker = useMoonrakerStore()
    moonraker.connectionPhase = 'connected'
    const handlers = captureNotifications(moonraker)
    const machine = useMachineSystemStore()
    machine.start()

    const respond = handlers.get('notify_update_response')
    for (let index = 0; index < machineUpdateOutputLimit + 25; index += 1) {
      respond?.({
        jsonrpc: '2.0',
        method: 'notify_update_response',
        params: [{ application: 'system', proc_id: 2, message: `line ${index}`, complete: false }],
      })
    }

    expect(machine.outputLines).toHaveLength(machineUpdateOutputLimit)
    expect(machine.outputLines[0]?.message).toBe('line 25')

    handlers.get('notify_update_refreshed')?.({
      jsonrpc: '2.0',
      method: 'notify_update_refreshed',
      params: [updateStatus({ moonraker: { version: 'v3' } })],
    })

    expect(machine.updates.map((update) => update.version)).toEqual(['v3'])

    machine.clearUpdateOutput()
    expect(machine.outputLines).toEqual([])
    machine.stop()
  })

  it('falls back to the superseded per-item method when Moonraker does not know upgrade', async () => {
    const moonraker = useMoonrakerStore()
    moonraker.connectionPhase = 'connected'
    const machine = useMachineSystemStore()
    machine.updates = [
      { id: 'system', displayName: 'system', configured_type: 'system', package_count: 4 },
      {
        id: 'webclient',
        displayName: 'webclient',
        configured_type: 'web',
        commits_behind_count: 1,
      },
    ]

    const unknownMethod = new MoonrakerRpcError({ code: -32601, message: 'Method not found' })
    const rpcCall = vi
      .spyOn(moonraker, 'rpcCall')
      .mockRejectedValueOnce(unknownMethod)
      .mockResolvedValueOnce('ok' as never)

    expect(await machine.startUpdate('system')).toBe(true)
    expect(rpcCall).toHaveBeenLastCalledWith('machine.update.system', undefined, {
      timeoutMs: null,
    })
    expect(machine.updateFailed).toBe(false)

    machine.runningUpdateId = null
    rpcCall.mockRejectedValueOnce(unknownMethod).mockResolvedValueOnce('ok' as never)
    expect(await machine.startUpdate('webclient')).toBe(true)
    expect(rpcCall).toHaveBeenLastCalledWith(
      'machine.update.client',
      { name: 'webclient' },
      { timeoutMs: null },
    )

    machine.runningUpdateId = null
    rpcCall.mockRejectedValueOnce(unknownMethod).mockResolvedValueOnce('ok' as never)
    expect(await machine.startUpdate('klipper')).toBe(false)
    // `machine.update.full` is gone with it: Update all now walks the available
    // sources by name, because `full` would also touch one needing attention.
    expect(rpcCall).not.toHaveBeenCalledWith('machine.update.full', undefined, {
      timeoutMs: null,
    })
  })

  it('reports a failed update start and refuses a second one while the host is busy', async () => {
    const moonraker = useMoonrakerStore()
    moonraker.connectionPhase = 'connected'
    const machine = useMachineSystemStore()
    machine.updates = [{ id: 'klipper', displayName: 'Klipper', commits_behind_count: 1 }]
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockRejectedValue(new Error('refused'))

    expect(await machine.startUpdate('klipper')).toBe(false)
    expect(machine.updateFailed).toBe(true)
    expect(machine.updateInterrupted).toBe(false)
    expect(machine.runningUpdateId).toBe(null)
    // A rejection that is not "method not found" must not retry a second method.
    expect(rpcCall).toHaveBeenCalledOnce()

    expect(await machine.startUpdate('absent')).toBe(false)
    expect(rpcCall).toHaveBeenCalledOnce()

    machine.runningUpdateId = 'klipper'
    expect(await machine.startAllUpdates()).toBe(false)
    expect(await machine.checkForUpdates()).toBe(false)
    expect(await machine.recoverUpdate('klipper')).toBe(false)
    expect(rpcCall).toHaveBeenCalledOnce()
  })

  it('separates a lost socket from a refused start, without replaying either', async () => {
    const moonraker = useMoonrakerStore()
    moonraker.connectionPhase = 'connected'
    const machine = useMachineSystemStore()
    machine.updates = [{ id: 'moonraker', displayName: 'moonraker', commits_behind_count: 2 }]
    const rpcCall = vi
      .spyOn(moonraker, 'rpcCall')
      .mockRejectedValue(new MoonrakerDisconnectedError())

    expect(await machine.startUpdate('moonraker')).toBe(false)

    // Updating Moonraker restarts Moonraker, so the socket carrying the request is
    // expected to drop. Calling that "could not be started" would be untrue — but
    // ADR 0005 still forbids replaying it, so the call is not retried.
    expect(machine.updateInterrupted).toBe(true)
    expect(machine.updateFailed).toBe(false)
    expect(machine.runningUpdateId).toBe(null)
    expect(rpcCall).toHaveBeenCalledOnce()

    machine.clearUpdateOutput()
    expect(machine.updateInterrupted).toBe(false)
  })

  it('leaves a source needing attention out of Update all and refuses to upgrade it', async () => {
    const moonraker = useMoonrakerStore()
    moonraker.connectionPhase = 'connected'
    const machine = useMachineSystemStore()
    machine.updates = [
      { id: 'KlipperScreen', displayName: 'KlipperScreen', is_dirty: true },
      { id: 'system', displayName: 'system', configured_type: 'system', package_count: 4 },
    ]
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)

    // A dirty repository has nothing installable, so it must not be what raises
    // Update all — that would offer an action Moonraker refuses.
    expect(machine.hasAvailableUpdates).toBe(true)
    machine.updates = [machine.updates[0]!]
    expect(machine.hasAvailableUpdates).toBe(false)

    expect(await machine.startUpdate('KlipperScreen')).toBe(false)
    expect(await machine.startAllUpdates()).toBe(false)
    expect(rpcCall).not.toHaveBeenCalled()
    expect(machine.updateFailed).toBe(false)
  })

  it('installs each available source by name, leaving Moonraker until last', async () => {
    const moonraker = useMoonrakerStore()
    moonraker.connectionPhase = 'connected'
    captureNotifications(moonraker)
    const machine = useMachineSystemStore()
    machine.start()
    machine.updates = [
      { id: 'moonraker', displayName: 'moonraker', commits_behind_count: 2 },
      { id: 'KlipperScreen', displayName: 'KlipperScreen', corrupt: true },
      { id: 'klipper', displayName: 'Klipper', commits_behind_count: 5 },
      { id: 'system', displayName: 'system', configured_type: 'system', package_count: 3 },
    ]
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)

    expect(await machine.startAllUpdates()).toBe(true)

    const upgraded = rpcCall.mock.calls
      .filter(([method]) => method === 'machine.update.upgrade')
      .map(([, params]) => (params as { name: string }).name)

    // Named per source rather than one global upgrade, so the corrupt repository is
    // untouched. Moonraker is last because updating it drops the socket carrying
    // the run, which would strand anything sequenced after it.
    expect(upgraded).toEqual(['klipper', 'system', 'moonraker'])
    expect(machine.isUpdatingAll).toBe(false)
    machine.stop()
  })

  it('stops a multi-source run at the first refusal instead of walking into the rest', async () => {
    const moonraker = useMoonrakerStore()
    moonraker.connectionPhase = 'connected'
    const machine = useMachineSystemStore()
    machine.updates = [
      { id: 'klipper', displayName: 'Klipper', commits_behind_count: 1 },
      { id: 'system', displayName: 'system', configured_type: 'system', package_count: 2 },
    ]
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockRejectedValue(new Error('printing'))

    expect(await machine.startAllUpdates()).toBe(false)

    expect(rpcCall).toHaveBeenCalledOnce()
    expect(machine.updateFailed).toBe(true)
    expect(machine.isUpdatingAll).toBe(false)
    expect(machine.runningUpdateId).toBe(null)
  })

  it('picks the recovery mode from the reported state rather than asking the user', async () => {
    const moonraker = useMoonrakerStore()
    moonraker.connectionPhase = 'connected'
    const machine = useMachineSystemStore()
    machine.updates = [
      { id: 'KlipperScreen', displayName: 'KlipperScreen', is_dirty: true },
      { id: 'webclient', displayName: 'webclient', corrupt: true },
    ]
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)

    // A dirty repository is fixed by `git reset`...
    expect(await machine.recoverUpdate('KlipperScreen')).toBe(true)
    expect(rpcCall).toHaveBeenLastCalledWith(
      'machine.update.recover',
      { name: 'KlipperScreen', hard: false },
      { timeoutMs: null },
    )

    // ...but a corrupt one is not, so it takes the re-clone instead.
    machine.runningUpdateId = null
    expect(await machine.recoverUpdate('webclient')).toBe(true)
    expect(rpcCall).toHaveBeenLastCalledWith(
      'machine.update.recover',
      { name: 'webclient', hard: true },
      { timeoutMs: null },
    )

    machine.runningUpdateId = null
    expect(await machine.recoverUpdate('absent')).toBe(false)
    expect(rpcCall).toHaveBeenCalledTimes(2)
  })
})
