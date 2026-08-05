import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import {
  MoonrakerClient,
  MoonrakerConnectionError,
  MoonrakerEndpointError,
  MoonrakerRpcError,
  normalizeMoonrakerWebSocketUrl,
  probeMoonrakerReachable,
  type JsonRpcParams,
  type MoonrakerCallOptions,
  type MoonrakerConnectionPhase,
  type MoonrakerRpcMethod,
  type MoonrakerRpcParams,
  type MoonrakerRpcResult,
  type NotificationHandler,
  type ObjectSnapshotHandler,
  type PrinterObjectSelection,
} from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { usePrintersStore } from '@/stores/printers'
import { useServerCapabilitiesStore } from '@/stores/serverCapabilities'
import { isRecord } from '@/utils/records'

const availabilitySubscriptionKey = 'alabaster.availability'

export type ConnectionErrorKind =
  | 'none'
  | 'invalidEndpoint'
  | 'unauthorized'
  | 'connectionFailed'
  | 'originRefused'
  | 'requestFailed'

function currentLocationUrl(): string {
  return window.location.href
}

function classifyError(error: Error): ConnectionErrorKind {
  if (error instanceof MoonrakerEndpointError) return 'invalidEndpoint'
  if (error instanceof MoonrakerConnectionError) return 'connectionFailed'
  if (error instanceof MoonrakerRpcError && /unauthorized/i.test(error.message))
    return 'unauthorized'
  return 'requestFailed'
}

export const useMoonrakerStore = defineStore('moonraker', () => {
  const availability = useAvailabilityStore()
  const serverCapabilities = useServerCapabilitiesStore()
  const printers = usePrintersStore()
  /**
   * The endpoint being connected to, which is not the same thing as the printer
   * the user has selected: the selection lives in the printers store, and this
   * follows it. Per-printer state keys on the printer's id; per-connection state
   * keys on this.
   */
  const endpoint = ref(printers.activeEndpoint)
  const connectionPhase = ref<MoonrakerConnectionPhase>('idle')
  const reconnectAttempt = ref(0)
  const lastError = ref<ConnectionErrorKind>('none')
  const client = shallowRef<MoonrakerClient | null>(null)
  const disposers: Array<() => void> = []
  /**
   * At most one reachability probe runs at a time. The architecture makes this
   * exact rather than approximate: there is only ever one connection attempt in
   * flight, because a new `connect()` retargets the same client instead of
   * starting a second one.
   */
  let probingReachability = false

  const isConnected = computed(() => connectionPhase.value === 'connected')
  const isPending = computed(() =>
    ['connecting', 'identifying', 'reconnecting'].includes(connectionPhase.value),
  )

  /**
   * The resets that wipe previous-printer state out of the domain stores, run
   * from `connect()` the moment a switch is detected. One registry rather than
   * each store watching `endpoint` itself, because the watch was individually
   * forgettable and got forgotten: four stores carried it and ten did not, and
   * the ten held the old machine's data — its config sections gating
   * capabilities, its macros, its file listings — as the new machine's until
   * the new printer's first sync arrived, or indefinitely if it was offline.
   * A store that shows anything read from a printer registers here in its
   * `start()`; `printerSwitch.spec.ts` is what notices when one does not.
   *
   * Deliberately synchronous: the reset has to land before the client is
   * retargeted, for the same reason `availability.printerChanged()` does.
   */
  const printerChangeResets = new Set<() => void>()

  function onPrinterChange(reset: () => void): () => void {
    printerChangeResets.add(reset)
    return () => printerChangeResets.delete(reset)
  }

  /**
   * A refused origin and an offline printer both fail the WebSocket handshake
   * identically — browsers hide a failed handshake's HTTP response from
   * JavaScript entirely, the same restriction that keeps a cross-origin
   * `fetch` from working as a port scanner — so `classifyError` alone cannot
   * tell them apart. `probeMoonrakerReachable` can, narrowly: it resolves
   * whenever *anything* answers HTTP at that host, refused origin included.
   *
   * Gated on never having reached this printer: a printer that has already
   * connected once from this browser cannot newly be rejected by
   * `cors_domains`, so probing a routine reconnect blip after a restart would
   * only add noise to a state that is expected to clear on its own.
   */
  function diagnoseConnectionFailure(): void {
    if (availability.hasReachedMoonraker || probingReachability) return
    probingReachability = true
    const failedEndpoint = endpoint.value

    void probeMoonrakerReachable(failedEndpoint).then((reachable) => {
      probingReachability = false
      // Stale by the time it resolves: a different printer since, or this one
      // already past the failure it was diagnosing.
      if (endpoint.value !== failedEndpoint || lastError.value !== 'connectionFailed') return
      if (reachable) lastError.value = 'originRefused'
    })
  }

  function createClient(normalizedEndpoint: string): MoonrakerClient {
    const moonraker = new MoonrakerClient({
      endpoint: normalizedEndpoint,
      identity: {
        clientName: 'Alabaster',
        version: __APP_VERSION__,
        type: 'web',
        url: window.location.origin,
      },
      /*
       * Zero cost for the vast majority of printers, which have never logged
       * in: the stored token is read synchronously and, absent one, this
       * resolves without ever reaching the network. Only a printer whose
       * Moonraker enforces login and where the user has actually logged in
       * pays the one extra `access.refresh_jwt` round trip, once per
       * connection — the auth domain itself (`stores/auth.ts`) owns the
       * interactive `access.login` fallback for when this comes back empty.
       */
      refreshIdentity: async (call) => {
        const refreshToken = printers.activeEntry?.refreshToken
        if (!refreshToken) return {}
        try {
          const result = await call<{ token: string }>('access.refresh_jwt', {
            refresh_token: refreshToken,
          })
          return { accessToken: result.token }
        } catch {
          // The refresh token is no longer valid — a logout elsewhere, an
          // expired 90-day window, or a deleted account. Keeping it around
          // would only repeat this failed round trip on every future
          // reconnect, so it comes out now rather than waiting on the user to
          // notice and log out explicitly.
          if (printers.activeEntry) printers.setRefreshToken(printers.activeEntry.id, null)
          return {}
        }
      },
    })

    disposers.push(
      moonraker.onConnectionStatus((status) => {
        connectionPhase.value = status.phase
        reconnectAttempt.value = status.attempt

        if (status.phase === 'connecting' || status.phase === 'identifying') {
          availability.beginConnection()
        } else if (status.phase === 'reconnecting') {
          if (availability.hasReachedMoonraker) availability.moonrakerConnectionLost()
          else availability.moonrakerConnectionFailed()
        } else if (status.phase === 'stopped') {
          availability.moonrakerDisconnected()
        }
      }),
      moonraker.onServerInfo((serverInfo) => {
        lastError.value = 'none'
        availability.moonrakerConnected(serverInfo)
        serverCapabilities.applyServerInfo(serverInfo)
      }),
      moonraker.onObjectSnapshot(() => {
        availability.printerSnapshotSynchronized()
      }),
      moonraker.onKlipperMessage((message) => {
        availability.reportKlipperMessage(message)
      }),
      /*
       * The other half of the same fact, and the faster half: while Klipper is
       * running, `webhooks` pushes its state message the moment it changes, so a
       * shutdown mid-print explains itself without waiting for a round trip.
       * This is what the `webhooks` subscription below is for — the poll in the
       * transport covers the case this one cannot, a Klipper that never started
       * and therefore has no subscription to push anything.
       */
      moonraker.onNotification('notify_status_update', (notification) => {
        const status = notification.params[0]
        if (!isRecord(status)) return
        const webhooks = status.webhooks
        if (!isRecord(webhooks)) return
        if (typeof webhooks.state_message === 'string') {
          availability.reportKlipperMessage(webhooks.state_message)
        }
      }),
      moonraker.onNotification('notify_klippy_ready', () => {
        availability.handleKlipperNotification('notify_klippy_ready')
      }),
      moonraker.onNotification('notify_klippy_disconnected', () => {
        availability.handleKlipperNotification('notify_klippy_disconnected')
      }),
      moonraker.onNotification('notify_klippy_shutdown', () => {
        availability.handleKlipperNotification('notify_klippy_shutdown')
      }),
      moonraker.onNotification('notify_klippy_started', () => {
        availability.handleKlipperNotification('notify_klippy_started')
      }),
      moonraker.onError((error) => {
        const kind = classifyError(error)
        lastError.value = kind
        if (kind === 'connectionFailed') diagnoseConnectionFailure()
      }),
    )

    void moonraker.setObjectSubscription(availabilitySubscriptionKey, {
      webhooks: ['state', 'state_message'],
    })

    return moonraker
  }

  function start(): void {
    connect(printers.activeEndpoint)
  }

  function connect(nextEndpoint: string): boolean {
    let normalizedEndpoint: string
    try {
      normalizedEndpoint = normalizeMoonrakerWebSocketUrl(nextEndpoint, currentLocationUrl())
    } catch (error) {
      lastError.value = classifyError(error instanceof Error ? error : new MoonrakerEndpointError())
      return false
    }

    /*
     * Only an existing client can be holding another printer's state, so a
     * first connection is never a change. The reset has to happen before the
     * client is retargeted below: `setEndpoint` stops and restarts it
     * synchronously, and the status handlers that run in between read
     * `hasReachedMoonraker` to decide between connecting and reconnecting.
     */
    const isPrinterChange = client.value !== null && normalizedEndpoint !== endpoint.value
    if (isPrinterChange) {
      availability.printerChanged()
      serverCapabilities.reset()
      for (const reset of printerChangeResets) reset()
    }

    /*
     * Adds it, or selects it when it is already on the list. Recorded here
     * rather than only in a switcher so the two can never disagree: whatever we
     * are connected to is, by definition, the printer in front of the user.
     */
    printers.addPrinter(normalizedEndpoint)
    endpoint.value = normalizedEndpoint
    lastError.value = 'none'

    if (!client.value) client.value = createClient(normalizedEndpoint)
    else client.value.setEndpoint(normalizedEndpoint)

    client.value.start()
    return true
  }

  /**
   * Put a different saved printer in front.
   *
   * Selecting without connecting is the mistake this exists to prevent: the list
   * would say one printer while the socket, the readings, and the transcript all
   * still belonged to another, and everything scoped to the new printer would
   * load beside the old printer's live data. Switching is a connection change.
   */
  function selectPrinter(id: string): boolean {
    if (id === printers.activeId) return false
    if (!printers.selectPrinter(id)) return false
    return connect(printers.activeEndpoint)
  }

  /**
   * Drops a saved printer from the list. Storage scoped to its id is left alone
   * — `printers.removePrinter` already says why — so this only ever changes
   * which printers exist, never what any of them remember.
   *
   * Removing the printer in front is a connection change like any other switch:
   * `printers.removePrinter` has already chosen the next active entry, or the
   * same-origin default with none left, so this reconnects to it. Removing any
   * other printer touches nothing live.
   */
  function removePrinter(id: string): boolean {
    const wasActive = id === printers.activeId
    if (!printers.removePrinter(id)) return false
    if (wasActive) connect(printers.activeEndpoint)
    return true
  }

  function disconnect(): void {
    client.value?.stop()
  }

  /**
   * A clean restart of the same connection — `connect()` itself no-ops when
   * the endpoint hasn't changed, so this is the explicit path for "start
   * fresh now," namely right after an interactive login: the identify hook
   * above will pick up the just-stored refresh token and every domain store's
   * initial subscribe/load, previously refused as unauthorized, gets a clean
   * retry instead of a hand-rolled per-store resend.
   */
  function reconnect(): void {
    client.value?.stop()
    client.value?.start()
  }

  function rpcCall<Method extends MoonrakerRpcMethod>(
    method: Method,
    ...args: MoonrakerRpcParams<Method> extends undefined
      ? [params?: MoonrakerRpcParams<Method>, options?: MoonrakerCallOptions]
      : [params: MoonrakerRpcParams<Method>, options?: MoonrakerCallOptions]
  ): Promise<MoonrakerRpcResult<Method>> {
    if (!client.value) return Promise.reject(new MoonrakerConnectionError())
    return client.value.call(method, ...(args as never))
  }

  function rpcCallRaw<Result>(
    method: string,
    params?: JsonRpcParams,
    options?: MoonrakerCallOptions,
  ): Promise<Result> {
    if (!client.value) return Promise.reject(new MoonrakerConnectionError())
    return client.value.callRaw<Result>(method, params, options)
  }

  function setObjectSubscription(key: string, objects: PrinterObjectSelection): Promise<void> {
    if (!client.value) return Promise.reject(new MoonrakerConnectionError())
    return client.value.setObjectSubscription(key, objects)
  }

  function removeObjectSubscription(key: string): Promise<void> {
    if (!client.value) return Promise.resolve()
    return client.value.removeObjectSubscription(key)
  }

  function onNotification(method: string, handler: NotificationHandler): () => void {
    if (!client.value) throw new MoonrakerConnectionError()
    return client.value.onNotification(method, handler)
  }

  function onObjectSnapshot(handler: ObjectSnapshotHandler): () => void {
    if (!client.value) throw new MoonrakerConnectionError()
    return client.value.onObjectSnapshot(handler)
  }

  function dispose(): void {
    disconnect()
    while (disposers.length > 0) disposers.pop()?.()
    client.value = null
  }

  return {
    endpoint,
    connectionPhase,
    reconnectAttempt,
    lastError,
    isConnected,
    isPending,
    onPrinterChange,
    start,
    connect,
    selectPrinter,
    removePrinter,
    disconnect,
    reconnect,
    rpcCall,
    rpcCallRaw,
    setObjectSubscription,
    removeObjectSubscription,
    onNotification,
    onObjectSnapshot,
    dispose,
  }
})
