import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import type {
  JsonRpcNotification,
  SpoolmanExternalFilament,
  SpoolmanProxyResponse,
  SpoolmanSpool,
} from '@/services/moonraker'
import { configBoolean } from '@/dashboard/context'
import { useAvailabilityStore } from '@/stores/availability'
import { createCommandRunner } from '@/stores/commandRunner'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import { useServerCapabilitiesStore } from '@/stores/serverCapabilities'
import { isRecord } from '@/utils/records'

/**
 * `[spoolman] server` in `moonraker.conf` is usually a loopback address —
 * Moonraker reaches it locally on the same host — but a browser tab reached
 * over the network needs the host it actually used to reach Moonraker, the
 * same substitution `resolveWebcamUrl` (`webcams.ts`) makes for stream paths.
 * Returns `null` for a value that is not a usable URL at all rather than
 * throwing, since a malformed `server` entry must not break the status read
 * it rides along with.
 */
export function resolveSpoolmanUrl(
  configuredServer: string,
  websocketEndpoint: string,
): string | null {
  try {
    const hasScheme = /^https?:\/\//i.test(configuredServer)
    const server = new URL(hasScheme ? configuredServer : `http://${configuredServer}`)
    if (['localhost', '127.0.0.1', '::1'].includes(server.hostname)) {
      server.hostname = new URL(websocketEndpoint).hostname
    }
    return server.toString()
  } catch {
    return null
  }
}

export const spoolCommandKeys = ['setActiveSpool'] as const

export type SpoolCommandKey = (typeof spoolCommandKeys)[number]

/**
 * How often the active spool's own remaining weight is re-read.
 *
 * `notify_active_spool_set` reports which spool is active, but nothing reports
 * a change in how much that spool has left — Moonraker updates Spoolman's own
 * consumption record as it tracks extrusion, and nothing pushes the result
 * back. This is the explicit polling `AGENTS.md`'s hard rule calls for where no
 * notification exists.
 *
 * Unlike `endstops.ts`, this never pauses for a running print: it is a plain
 * HTTP proxy call that touches no MCU, and the weight it reads matters most
 * exactly while a print is consuming it.
 */
export const spoolPollIntervalMs = 5000

export const useSpoolStore = defineStore('spool', () => {
  const availability = useAvailabilityStore()
  const serverCapabilities = useServerCapabilitiesStore()
  const moonraker = useMoonrakerStore()
  const printer = usePrinterStore()
  const dashboardLayout = useDashboardLayoutStore()

  /** `null` until `server.spoolman.status` or its notification has answered. */
  const spoolmanConnected = ref<boolean | null>(null)
  /** The Spoolman web UI's own address, resolved from `server.config`; `null` until read or unconfigured. */
  const spoolmanUrl = ref<string | null>(null)
  const activeSpoolId = ref<number | null>(null)
  const activeSpool = ref<SpoolmanSpool | null>(null)
  const availableSpools = ref<SpoolmanSpool[]>([])
  const isLoadingActiveSpool = ref(false)
  const isLoadingAvailableSpools = ref(false)
  /** A refused read, kept apart from "no active spool" — the two look different. */
  const failed = ref(false)
  const commands = createCommandRunner<SpoolCommandKey>(spoolCommandKeys)
  const { pendingCommands, lastCommandError, lastCommandErrorMessage } = commands

  const disposers: Array<() => void> = []
  let stopCapabilityWatch: WatchStopHandle | null = null
  let stopPrinterChangeReset: (() => void) | null = null
  let stopAutoPauseWatch: WatchStopHandle | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let started = false
  let activeSpoolGeneration = 0

  const hasActiveSpool = computed(() => activeSpool.value !== null)

  /**
   * Read directly off the dashboard profile rather than through
   * `useDashboardModule` — this effect has to run regardless of which page is
   * open, the same reasoning `printer.ts`'s own `maybeResetJobAdjustments`
   * already follows for Print's reset-on-finish settings, and reads the
   * profile the exact same way. Spool never supports multiple instances, so
   * there is always exactly one to find by `moduleId`.
   */
  const autoPauseOnEmpty = computed(() => {
    const instance = dashboardLayout.profile.instances.find(
      (candidate) => candidate.moduleId === 'spool',
    )
    return configBoolean(instance?.config ?? {}, 'autoPauseOnEmpty', false)
  })

  /**
   * Re-reads the active spool's own record. A no-op with nothing active, which
   * is normal rather than a failure — most idle moments have no spool loaded.
   */
  async function refreshActiveSpool(): Promise<void> {
    const id = activeSpoolId.value
    if (id === null) {
      activeSpool.value = null
      return
    }
    const generation = ++activeSpoolGeneration
    isLoadingActiveSpool.value = true
    try {
      const result = await moonraker.rpcCall('server.spoolman.proxy', {
        request_method: 'GET',
        path: `/v1/spool/${id}`,
        use_v2_response: true,
      })
      if (generation !== activeSpoolGeneration) return
      const proxied = result as SpoolmanProxyResponse<SpoolmanSpool>
      activeSpool.value = proxied.error ? null : (proxied.response ?? null)
      failed.value = proxied.error !== null
    } catch {
      if (generation === activeSpoolGeneration) failed.value = true
    } finally {
      if (generation === activeSpoolGeneration) isLoadingActiveSpool.value = false
    }
  }

  async function refreshStatus(): Promise<void> {
    try {
      const status = await moonraker.rpcCall('server.spoolman.status')
      spoolmanConnected.value = status.spoolman_connected
      activeSpoolId.value = status.spool_id
      // A Spoolman known to be down cannot answer a fresh read, and every
      // fit/temperature check downstream must treat "unavailable" the same as
      // "no data" rather than keep judging a print against last-known-good
      // numbers that are no longer trustworthy.
      if (status.spoolman_connected) {
        await refreshActiveSpool()
      } else {
        activeSpool.value = null
      }
    } catch {
      // Either Moonraker has no `spoolman` component — the capability watch
      // below already accounts for that — or a genuine request failure, which
      // leaves the last-known state on screen rather than blanking it.
    }
  }

  /**
   * `moonraker.conf` does not change without a restart, so this is read once per
   * connection rather than polled — the same cadence `webcams.ts` reads
   * `server.webcams.list` on. Kept apart from `refreshStatus`'s own try/catch so
   * a config read failure cannot blank out `spoolmanConnected` or the active spool.
   */
  async function refreshSpoolmanUrl(): Promise<void> {
    try {
      const { config } = await moonraker.rpcCall('server.config')
      const configuredServer = isRecord(config.spoolman) ? config.spoolman.server : undefined
      spoolmanUrl.value =
        typeof configuredServer === 'string'
          ? resolveSpoolmanUrl(configuredServer, moonraker.endpoint)
          : null
    } catch {
      spoolmanUrl.value = null
    }
  }

  /** Loads the switcher's own list. Called on demand, not kept polling. */
  async function loadAvailableSpools(): Promise<void> {
    isLoadingAvailableSpools.value = true
    try {
      const result = await moonraker.rpcCall('server.spoolman.proxy', {
        request_method: 'GET',
        path: '/v1/spool',
        query: 'archived=false',
        use_v2_response: true,
      })
      const proxied = result as SpoolmanProxyResponse<SpoolmanSpool[]>
      availableSpools.value = proxied.error ? [] : (proxied.response ?? [])
    } catch {
      availableSpools.value = []
    } finally {
      isLoadingAvailableSpools.value = false
    }
  }

  /**
   * Searches Spoolman's own cached copy of SpoolmanDB server-side
   * (`spoolman/api/v1/externaldb.py`'s `/external/filament/search`, matched
   * word-by-word against manufacturer/name/material) rather than downloading
   * its ~7,000-entry catalogue to filter client-side. Not a tracked command —
   * like `printer.loadMetadata`, an empty result or a proxy failure is a
   * normal outcome for the caller to render, not a failed action.
   */
  async function searchExternalFilaments(
    query: string,
  ): Promise<{ filaments: SpoolmanExternalFilament[]; failed: boolean }> {
    try {
      const result = await moonraker.rpcCall('server.spoolman.proxy', {
        request_method: 'GET',
        path: '/v1/external/filament/search',
        query: `query=${encodeURIComponent(query)}&limit=20`,
        use_v2_response: true,
      })
      const proxied = result as SpoolmanProxyResponse<SpoolmanExternalFilament[]>
      return { filaments: proxied.response ?? [], failed: proxied.error !== null }
    } catch {
      return { filaments: [], failed: true }
    }
  }

  /**
   * `null` disables Moonraker's consumption tracking rather than picking a
   * spool. The key is omitted from the request entirely to clear it — see the
   * note on `server.spoolman.post_spool_id` in `types.ts` for why sending it
   * present-but-`null` makes Moonraker refuse the call outright.
   */
  function setActiveSpool(spoolId: number | null): Promise<boolean> {
    return commands.run('setActiveSpool', async () => {
      const result = await moonraker.rpcCall(
        'server.spoolman.post_spool_id',
        spoolId === null ? {} : { spool_id: spoolId },
      )
      activeSpoolId.value = result.spool_id
      await refreshActiveSpool()
    })
  }

  const clearCommandError = commands.clearCommandError

  function handleActiveSpoolSet(notification: JsonRpcNotification): void {
    const payload = notification.params[0]
    if (!isRecord(payload)) return
    activeSpoolId.value = typeof payload.spool_id === 'number' ? payload.spool_id : null
    void refreshActiveSpool()
  }

  function handleStatusChanged(notification: JsonRpcNotification): void {
    const payload = notification.params[0]
    if (!isRecord(payload)) return
    if (typeof payload.spoolman_connected === 'boolean') {
      spoolmanConnected.value = payload.spoolman_connected
      // Polling has already stopped by the time this fires (see `start`'s
      // capability watch), so nothing would otherwise refresh this away —
      // it would sit stale, read as current, for as long as Spoolman stays down.
      if (!payload.spoolman_connected) activeSpool.value = null
    }
  }

  /**
   * Which spool is active and how much it holds both describe whatever is on
   * the other end of the socket, so they go when the connection is retargeted
   * — the same rule `bedMesh.ts`'s `printerChanged` follows.
   */
  function printerChanged(): void {
    spoolmanConnected.value = null
    spoolmanUrl.value = null
    activeSpoolId.value = null
    activeSpool.value = null
    availableSpools.value = []
    commands.reset()
    failed.value = false
  }

  function startPolling(): void {
    if (pollTimer !== null) return
    pollTimer = setInterval(() => void refreshActiveSpool(), spoolPollIntervalMs)
  }

  function stopPolling(): void {
    if (pollTimer === null) return
    clearInterval(pollTimer)
    pollTimer = null
  }

  function start(): void {
    if (started) return
    started = true
    disposers.push(
      moonraker.onNotification('notify_active_spool_set', handleActiveSpoolSet),
      moonraker.onNotification('notify_spoolman_status_changed', handleStatusChanged),
    )
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    /*
     * Gated on `hasComponent` answering optimistically until Moonraker's own
     * handshake has said otherwise, and on Spoolman itself not having already
     * told us it is disconnected — a printer without the component never polls
     * at all, and one whose Spoolman server has dropped stops rather than
     * spending a request every tick on a call that cannot succeed.
     */
    stopCapabilityWatch = watch(
      () =>
        availability.isMoonrakerConnected &&
        serverCapabilities.hasComponent('spoolman') &&
        spoolmanConnected.value !== false,
      (shouldRun) => {
        if (shouldRun) {
          void refreshStatus()
          void refreshSpoolmanUrl()
          startPolling()
        } else {
          stopPolling()
        }
      },
      { immediate: true },
    )
    /*
     * "Empty" is a fact about the spool, not about any one file's total, so
     * this reads only the remaining weight — the same reading the disconnect
     * fix above already keeps honest, so a Spoolman known to be down can never
     * trigger this either. Guarded on `isPrinting` rather than `hasActivePrint`:
     * once the pause actually lands, `isPrinting` itself goes false, which is
     * what stops this from firing again on every further tick toward negative.
     */
    stopAutoPauseWatch = watch(
      () => activeSpool.value?.remaining_weight,
      (remaining) => {
        if (typeof remaining !== 'number' || remaining > 0) return
        if (!autoPauseOnEmpty.value || !printer.isPrinting) return
        void printer.pausePrint()
      },
    )
  }

  function stop(): void {
    if (!started) return
    started = false
    activeSpoolGeneration += 1
    stopPolling()
    stopCapabilityWatch?.()
    stopCapabilityWatch = null
    stopPrinterChangeReset?.()
    stopPrinterChangeReset = null
    stopAutoPauseWatch?.()
    stopAutoPauseWatch = null
    while (disposers.length > 0) disposers.pop()?.()
  }

  return {
    spoolmanConnected,
    spoolmanUrl,
    activeSpoolId,
    activeSpool,
    availableSpools,
    hasActiveSpool,
    isLoadingActiveSpool,
    isLoadingAvailableSpools,
    failed,
    lastCommandError,
    lastCommandErrorMessage,
    pendingCommands,
    refreshActiveSpool,
    loadAvailableSpools,
    searchExternalFilaments,
    setActiveSpool,
    clearCommandError,
    start,
    stop,
  }
})
