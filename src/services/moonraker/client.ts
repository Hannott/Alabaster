import { MoonrakerDisconnectedError } from '@/services/moonraker/errors'
import { JsonRpcTransport } from '@/services/moonraker/transport'
import type {
  ConnectionStatusHandler,
  ErrorHandler,
  IdentifyConnectionResult,
  JsonRpcParams,
  KlipperMessageHandler,
  MoonrakerCallOptions,
  MoonrakerConnectionPhase,
  MoonrakerConnectionStatus,
  MoonrakerIdentity,
  MoonrakerRpcMethod,
  MoonrakerRpcParams,
  MoonrakerRpcResult,
  MoonrakerServerInfo,
  NotificationHandler,
  ObjectSnapshotHandler,
  PrinterObjectSelection,
  PrinterObjectSnapshot,
  ServerInfoHandler,
  TimerScheduler,
  WebSocketFactory,
} from '@/services/moonraker/types'

const defaultScheduler: TimerScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
}

/**
 * Called once per connection attempt, right after the socket opens and before
 * `server.connection.identify` — the one point where a fresh `access_token`
 * can still reach that call. `call` is bound to the transport already being
 * established, so the hook can issue `access.refresh_jwt` itself without a
 * circular dependency on the client it is configuring. Expected to never
 * reject: a refresh failure is the auth domain's to handle (clear the now-dead
 * token, resolve with no patch), not a reason to fail the whole connection.
 */
export type MoonrakerIdentityRefresher = (
  call: <Result>(method: string, params?: JsonRpcParams) => Promise<Result>,
) => Promise<Partial<Pick<MoonrakerIdentity, 'accessToken' | 'apiKey'>>>

export interface MoonrakerClientOptions {
  endpoint: string
  identity: MoonrakerIdentity
  refreshIdentity?: MoonrakerIdentityRefresher
  socketFactory?: WebSocketFactory
  scheduler?: TimerScheduler
  random?: () => number
  requestTimeoutMs?: number
  initialReconnectDelayMs?: number
  maximumReconnectDelayMs?: number
  lifecyclePollMs?: number
}

export class MoonrakerClient {
  private readonly identity: MoonrakerIdentity
  private readonly refreshIdentity: MoonrakerIdentityRefresher | undefined
  private readonly scheduler: TimerScheduler
  private readonly random: () => number
  private readonly initialReconnectDelayMs: number
  private readonly maximumReconnectDelayMs: number
  private readonly lifecyclePollMs: number
  private readonly transport: JsonRpcTransport
  private readonly connectionHandlers = new Set<ConnectionStatusHandler>()
  private readonly serverInfoHandlers = new Set<ServerInfoHandler>()
  private readonly klipperMessageHandlers = new Set<KlipperMessageHandler>()
  private readonly snapshotHandlers = new Set<ObjectSnapshotHandler>()
  private readonly errorHandlers = new Set<ErrorHandler>()
  private readonly objectSubscriptions = new Map<string, PrinterObjectSelection>()
  private endpoint: string
  private phase: MoonrakerConnectionPhase = 'idle'
  private shouldRun = false
  private hasConnected = false
  private klippyReady = false
  private reconnectAttempt = 0
  private connectionGeneration = 0
  private klippyGeneration = 0
  private subscriptionRevision = 0
  private subscriptionSyncPending = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private lifecycleTimer: ReturnType<typeof setTimeout> | null = null
  private subscriptionSync: Promise<void> | null = null

  constructor(options: MoonrakerClientOptions) {
    this.endpoint = options.endpoint
    this.identity = options.identity
    this.refreshIdentity = options.refreshIdentity
    this.scheduler = options.scheduler ?? defaultScheduler
    this.random = options.random ?? Math.random
    this.initialReconnectDelayMs = options.initialReconnectDelayMs ?? 500
    this.maximumReconnectDelayMs = options.maximumReconnectDelayMs ?? 10_000
    this.lifecyclePollMs = options.lifecyclePollMs ?? 2_000
    this.transport = new JsonRpcTransport({
      ...(options.socketFactory ? { socketFactory: options.socketFactory } : {}),
      ...(options.requestTimeoutMs ? { requestTimeoutMs: options.requestTimeoutMs } : {}),
      scheduler: this.scheduler,
    })

    this.transport.onClose(() => this.handleConnectionLost())
    this.transport.onProtocolError((error) => this.emit(this.errorHandlers, error))
    this.transport.onNotification('notify_klippy_ready', () => this.handleKlippyReady())
    this.transport.onNotification('notify_klippy_disconnected', () =>
      this.handleKlippyUnavailable(),
    )
    this.transport.onNotification('notify_klippy_shutdown', () => {
      this.handleKlippyUnavailable()
      // A shutdown is where the reason matters most and where Klippy is still
      // there to be asked, so the reason is requested with the event instead of
      // waiting out the poll interval that follows it.
      void this.requestKlipperMessage()
    })
    this.transport.onNotification('notify_klippy_started', () => this.handleKlippyUnavailable())
  }

  get connectionPhase(): MoonrakerConnectionPhase {
    return this.phase
  }

  get isConnected(): boolean {
    return this.phase === 'connected' && this.transport.isOpen
  }

  start(): void {
    if (this.shouldRun) return
    this.shouldRun = true
    this.reconnectAttempt = 0
    void this.connect()
  }

  stop(): void {
    this.shouldRun = false
    this.clearTimers()
    this.connectionGeneration += 1
    this.klippyGeneration += 1
    this.klippyReady = false
    this.transport.disconnect()
    this.setConnectionStatus('stopped', 0)
  }

  /**
   * The page is in front of the user again, so a reconnect that is only
   * waiting out its backoff happens now rather than at the end of a timer set
   * while nobody was looking. A browser freezes a backgrounded tab and drops
   * its socket; the delay that was ticking when it froze can be the full
   * `maximumReconnectDelayMs`, and the whole of it is spent on a page the user
   * is already reading.
   *
   * Deliberately not `stop()` then `start()`, and never `setEndpoint`. Both
   * clear `hasConnected`, which is what separates a printer that dropped from
   * one that has never answered — so a resume routed through either would
   * report `connecting` instead of `reconnecting` and drop every module from
   * the dimmed, data-retaining `recovering` treatment to `unavailable`. The
   * point of this is to shorten that dimming, not to deepen it.
   *
   * `abandonAttempt` is for the one case where an attempt that looks in
   * flight is known to be dead: a page restored from the back/forward cache
   * had its handshake killed by the browser, and the failure that would have
   * scheduled a retry may not have been delivered to us yet. Restarting is
   * safe whenever it is true — `transport.connect` detaches the old socket's
   * handlers before opening the new one, so the superseded attempt cannot
   * report anything afterwards. Left false, an attempt genuinely in progress
   * is allowed to finish, so a reader flipping between tabs cannot keep
   * restarting a slow first handshake.
   */
  resumeNow({ abandonAttempt = false }: { abandonAttempt?: boolean } = {}): void {
    if (!this.shouldRun || this.transport.isOpen) return
    // No timer and no permission to abandon means a connect is under way.
    if (this.reconnectTimer === null && !abandonAttempt) return

    this.clearTimers()
    // The backoff had escalated because the tab was frozen, not because the
    // printer refused anything. A resume that failed schedules again from the
    // bottom, so a machine that really is gone still backs off as before.
    this.reconnectAttempt = 0
    void this.connect()
  }

  setEndpoint(endpoint: string): void {
    if (endpoint === this.endpoint) return
    const wasRunning = this.shouldRun
    this.stop()
    this.endpoint = endpoint
    /*
     * Reaching one server says nothing about the next one. Left set, the first
     * attempt against a different printer reports `reconnecting` rather than
     * `connecting`, so a machine that has never answered is presented as one
     * that dropped — and every consumer that distinguishes the two, including
     * the availability store's staleness, inherits the mistake.
     */
    this.hasConnected = false
    if (wasRunning) this.start()
  }

  call<Method extends MoonrakerRpcMethod>(
    method: Method,
    ...args: MoonrakerRpcParams<Method> extends undefined
      ? [params?: MoonrakerRpcParams<Method>, options?: MoonrakerCallOptions]
      : [params: MoonrakerRpcParams<Method>, options?: MoonrakerCallOptions]
  ): Promise<MoonrakerRpcResult<Method>> {
    return this.transport.call<MoonrakerRpcResult<Method>>(
      method,
      args[0] as JsonRpcParams | undefined,
      args[1] as MoonrakerCallOptions | undefined,
    )
  }

  callRaw<Result>(
    method: string,
    params?: JsonRpcParams,
    options?: MoonrakerCallOptions,
  ): Promise<Result> {
    return this.transport.call<Result>(method, params, options)
  }

  setObjectSubscription(key: string, objects: PrinterObjectSelection): Promise<void> {
    this.objectSubscriptions.set(key, this.cloneSelection(objects))
    this.subscriptionRevision += 1
    return this.requestSubscriptionSync()
  }

  removeObjectSubscription(key: string): Promise<void> {
    if (!this.objectSubscriptions.delete(key)) return Promise.resolve()
    this.subscriptionRevision += 1
    return this.requestSubscriptionSync()
  }

  onConnectionStatus(handler: ConnectionStatusHandler): () => void {
    this.connectionHandlers.add(handler)
    handler({ phase: this.phase, attempt: this.reconnectAttempt })
    return () => this.connectionHandlers.delete(handler)
  }

  onServerInfo(handler: ServerInfoHandler): () => void {
    this.serverInfoHandlers.add(handler)
    return () => this.serverInfoHandlers.delete(handler)
  }

  /**
   * Why Klipper is not ready, in Klipper's own words. Emitted on every
   * lifecycle poll that finds it connected but not ready, so a message that
   * changes — loading, then the config error that ended the load — is reported
   * again rather than frozen at the first thing said.
   */
  onKlipperMessage(handler: KlipperMessageHandler): () => void {
    this.klipperMessageHandlers.add(handler)
    return () => this.klipperMessageHandlers.delete(handler)
  }

  onObjectSnapshot(handler: ObjectSnapshotHandler): () => void {
    this.snapshotHandlers.add(handler)
    return () => this.snapshotHandlers.delete(handler)
  }

  onNotification(method: string, handler: NotificationHandler): () => void {
    return this.transport.onNotification(method, handler)
  }

  onAnyNotification(handler: NotificationHandler): () => void {
    return this.transport.onAnyNotification(handler)
  }

  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.add(handler)
    return () => this.errorHandlers.delete(handler)
  }

  private async connect(): Promise<void> {
    if (!this.shouldRun) return
    const generation = ++this.connectionGeneration
    this.setConnectionStatus(
      this.hasConnected ? 'reconnecting' : 'connecting',
      this.reconnectAttempt,
    )

    try {
      await this.transport.connect(this.endpoint)
      if (!this.isCurrentConnection(generation)) return

      if (this.refreshIdentity) {
        const patch = await this.refreshIdentity((method, params) =>
          this.transport.call(method, params),
        )
        if (!this.isCurrentConnection(generation)) return
        Object.assign(this.identity, patch)
      }

      this.setConnectionStatus('identifying', this.reconnectAttempt)
      await this.transport.call<IdentifyConnectionResult>(
        'server.connection.identify',
        this.identityParams(),
      )
      if (!this.isCurrentConnection(generation)) return

      const serverInfo = await this.transport.call<MoonrakerServerInfo>('server.info')
      if (!this.isCurrentConnection(generation)) return

      this.hasConnected = true
      this.reconnectAttempt = 0
      this.applyServerInfo(serverInfo)
      this.setConnectionStatus('connected', 0)
    } catch (error) {
      if (!this.isCurrentConnection(generation)) return
      this.emitError(error)
      this.transport.disconnect()
      this.scheduleReconnect()
    }
  }

  private handleConnectionLost(): void {
    if (!this.shouldRun) return
    this.connectionGeneration += 1
    this.klippyGeneration += 1
    this.klippyReady = false
    this.clearLifecycleTimer()
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (!this.shouldRun || this.reconnectTimer !== null) return

    this.reconnectAttempt += 1
    const exponentialDelay = Math.min(
      this.maximumReconnectDelayMs,
      this.initialReconnectDelayMs * 2 ** (this.reconnectAttempt - 1),
    )
    const jitter = 0.8 + this.random() * 0.4
    const retryDelayMs = Math.round(exponentialDelay * jitter)
    this.setConnectionStatus('reconnecting', this.reconnectAttempt, retryDelayMs)
    this.reconnectTimer = this.scheduler.setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, retryDelayMs)
  }

  private applyServerInfo(serverInfo: MoonrakerServerInfo): void {
    this.emit(this.serverInfoHandlers, serverInfo)
    const isReady = serverInfo.klippy_connected && serverInfo.klippy_state === 'ready'

    if (isReady && !this.klippyReady) {
      this.klippyReady = true
      this.klippyGeneration += 1
      this.clearLifecycleTimer()
      void this.requestSubscriptionSync()
    } else if (!isReady) {
      this.handleKlippyUnavailable()
      /*
       * `server.info` reports the state and never the reason, so the reason is
       * a second call. Asked here rather than left to the next poll because
       * this is also the connect path: a browser opened onto a printer whose
       * Klipper failed to boot would otherwise show the failure for a whole
       * poll interval before it could say anything about it.
       *
       * Only while Klippy is actually connected — `printer.info` is a proxied
       * call, and with the host process gone Moonraker refuses it. That case
       * has no message to report anyway: nothing is running to have one.
       */
      if (serverInfo.klippy_connected) void this.requestKlipperMessage()
    }
  }

  private async requestKlipperMessage(): Promise<void> {
    const generation = this.connectionGeneration

    try {
      const info = await this.transport.call<{ state_message?: string }>('printer.info')
      if (!this.isCurrentConnection(generation) || this.klippyReady) return
      if (typeof info.state_message === 'string') {
        this.emit(this.klipperMessageHandlers, info.state_message)
      }
    } catch {
      /*
       * Swallowed rather than reported: this runs on a two-second poll, and a
       * refused read of the reason is not a second failure to tell the user
       * about — the state it accompanies is already saying something is wrong,
       * and the next poll asks again.
       */
    }
  }

  private handleKlippyReady(): void {
    if (!this.isConnected) return
    if (!this.klippyReady) this.klippyGeneration += 1
    this.klippyReady = true
    this.clearLifecycleTimer()
    void this.requestSubscriptionSync()
  }

  private handleKlippyUnavailable(): void {
    this.klippyReady = false
    this.klippyGeneration += 1
    this.subscriptionRevision += 1
    this.scheduleLifecyclePoll()
  }

  private scheduleLifecyclePoll(): void {
    if (!this.shouldRun || !this.transport.isOpen || this.lifecycleTimer !== null) return
    this.lifecycleTimer = this.scheduler.setTimeout(() => {
      this.lifecycleTimer = null
      void this.pollServerInfo()
    }, this.lifecyclePollMs)
  }

  private async pollServerInfo(): Promise<void> {
    if (!this.shouldRun || !this.transport.isOpen || this.klippyReady) return
    const klippyGeneration = this.klippyGeneration

    try {
      const serverInfo = await this.transport.call<MoonrakerServerInfo>('server.info')
      if (!this.shouldRun || !this.transport.isOpen || this.klippyGeneration !== klippyGeneration) {
        return
      }
      this.applyServerInfo(serverInfo)
    } catch (error) {
      if (!(error instanceof MoonrakerDisconnectedError)) this.emitError(error)
    }

    if (!this.klippyReady) this.scheduleLifecyclePoll()
  }

  private requestSubscriptionSync(): Promise<void> {
    this.subscriptionSyncPending = true
    if (!this.shouldRun || !this.transport.isOpen || !this.klippyReady) {
      return Promise.resolve()
    }
    if (this.subscriptionSync) return this.subscriptionSync

    this.subscriptionSync = this.synchronizeSubscriptions().finally(() => {
      this.subscriptionSync = null
      if (
        this.subscriptionSyncPending &&
        this.shouldRun &&
        this.transport.isOpen &&
        this.klippyReady
      ) {
        void this.requestSubscriptionSync()
      }
    })
    return this.subscriptionSync
  }

  private async synchronizeSubscriptions(): Promise<void> {
    while (
      this.shouldRun &&
      this.transport.isOpen &&
      this.klippyReady &&
      this.subscriptionSyncPending
    ) {
      this.subscriptionSyncPending = false
      const synchronizedRevision = this.subscriptionRevision
      const connectionGeneration = this.connectionGeneration
      const klippyGeneration = this.klippyGeneration

      try {
        const snapshot = await this.transport.call<PrinterObjectSnapshot>(
          'printer.objects.subscribe',
          { objects: this.mergeObjectSubscriptions() },
        )

        if (
          !this.isCurrentConnection(connectionGeneration) ||
          !this.klippyReady ||
          this.klippyGeneration !== klippyGeneration
        ) {
          continue
        }

        if (synchronizedRevision !== this.subscriptionRevision) continue

        this.emit(this.snapshotHandlers, snapshot)
      } catch (error) {
        if (!(error instanceof MoonrakerDisconnectedError)) this.emitError(error)
        return
      }
    }
  }

  private mergeObjectSubscriptions(): PrinterObjectSelection {
    const merged: Record<string, string[] | null> = {}

    for (const selection of this.objectSubscriptions.values()) {
      for (const [objectName, fields] of Object.entries(selection)) {
        const current = merged[objectName]
        if (current === null || fields === null) {
          merged[objectName] = null
          continue
        }

        merged[objectName] = [...new Set([...(current ?? []), ...fields])]
      }
    }

    return merged
  }

  private cloneSelection(selection: PrinterObjectSelection): PrinterObjectSelection {
    return Object.fromEntries(
      Object.entries(selection).map(([objectName, fields]) => [
        objectName,
        fields === null ? null : [...fields],
      ]),
    )
  }

  private identityParams(): {
    client_name: string
    version: string
    type: MoonrakerIdentity['type']
    url: string
    access_token?: string
    api_key?: string
  } {
    const params: {
      client_name: string
      version: string
      type: MoonrakerIdentity['type']
      url: string
      access_token?: string
      api_key?: string
    } = {
      client_name: this.identity.clientName,
      version: this.identity.version,
      type: this.identity.type,
      url: this.identity.url,
    }

    if (this.identity.accessToken) params.access_token = this.identity.accessToken
    if (this.identity.apiKey) params.api_key = this.identity.apiKey
    return params
  }

  private isCurrentConnection(generation: number): boolean {
    return this.shouldRun && this.connectionGeneration === generation
  }

  private setConnectionStatus(
    phase: MoonrakerConnectionPhase,
    attempt: number,
    retryDelayMs?: number,
  ): void {
    this.phase = phase
    const status: MoonrakerConnectionStatus = { phase, attempt }
    if (retryDelayMs !== undefined) status.retryDelayMs = retryDelayMs
    this.emit(this.connectionHandlers, status)
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) {
      this.scheduler.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.clearLifecycleTimer()
  }

  private clearLifecycleTimer(): void {
    if (this.lifecycleTimer === null) return
    this.scheduler.clearTimeout(this.lifecycleTimer)
    this.lifecycleTimer = null
  }

  private emitError(error: unknown): void {
    this.emit(this.errorHandlers, error instanceof Error ? error : new Error(String(error)))
  }

  private emit<Value>(handlers: Set<(value: Value) => void>, value: Value): void {
    for (const handler of handlers) {
      try {
        handler(value)
      } catch (error) {
        if (handlers !== this.errorHandlers) this.emitError(error)
      }
    }
  }
}
