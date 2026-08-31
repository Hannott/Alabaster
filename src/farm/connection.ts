import { normalizeCamera, type Camera } from '@/features/camera/camera'
import {
  farmObjectSelection,
  readHeater,
  readJob,
  readQueue,
  toKlipperState,
  toPrintState,
} from '@/farm/snapshot'
import { emptyFarmSnapshot, type FarmPrinterSnapshot } from '@/farm/types'
import {
  MoonrakerClient,
  moonrakerThumbnailUrl,
  probeMoonrakerReachable,
  type JsonRpcNotification,
  type JsonRpcParams,
  type MoonrakerGcodeMetadata,
  type MoonrakerServerInfo,
  type MoonrakerWebcam,
  type SpoolmanSpool,
  type TimerScheduler,
  type WebSocketFactory,
} from '@/services/moonraker'
import { isRecord } from '@/utils/records'

/**
 * One printer's page-scoped connection for the farm rail.
 *
 * Deliberately **not** a Pinia store and deliberately not shared with the rest
 * of the application. ADR 0005's "one connection, retargeted" still describes
 * how Alabaster drives a printer; this is the narrow exception the farm plan
 * argued for — a read-mostly connection that exists only while a column is on
 * screen, that no domain store may consume, and that carries a fixed
 * subscription rather than the whole dashboard's worth.
 *
 * Everything it learns lands in one `FarmPrinterSnapshot`, so the column
 * renders the same shape whether its printer is driven from here or from the
 * live stores.
 */

/** Injected in tests; production passes nothing and gets the real transport. */
export interface FarmConnectionOptions {
  id: string
  endpoint: string
  version: string
  origin: string
  onChange: (snapshot: FarmPrinterSnapshot) => void
  /**
   * What the printer answered when asked its own name.
   *
   * Separate from `onChange` because it is a fact about the saved entry rather
   * than about what the machine is doing: the column renders the entry's label,
   * not the snapshot, so a name carried inside the snapshot would have to be
   * copied back out on every change. Reported once per connection.
   */
  onName?: (name: string) => void
  socketFactory?: WebSocketFactory
  scheduler?: TimerScheduler
  random?: () => number
  probeReachable?: (endpoint: string) => Promise<boolean>
  now?: () => number
}

/**
 * How long a farm printer waits before retrying.
 *
 * The main connection climbs from 500 ms because the user is looking at that
 * printer and wants it back. A rail may hold several machines that are simply
 * switched off, and each of them retrying on the main ladder would spend the
 * page's life opening sockets — measured at 1.6 KB/s per *connected* printer,
 * a dead one costs handshakes instead. Thirty seconds is slow enough to be
 * free and fast enough that a printer coming back is on screen within half a
 * minute, which is well inside the time it takes to walk to it.
 */
const farmReconnectDelayMs = 30_000
const farmMaximumReconnectDelayMs = 60_000

export class FarmConnection {
  readonly id: string
  private readonly client: MoonrakerClient
  private readonly onChange: (snapshot: FarmPrinterSnapshot) => void
  private readonly onName: ((name: string) => void) | null
  private readonly probeReachable: (endpoint: string) => Promise<boolean>
  private readonly now: () => number
  private readonly disposers: Array<() => void> = []
  private snapshot: FarmPrinterSnapshot = emptyFarmSnapshot()
  private endpoint: string
  private running = false
  /** Raw `print_stats` etc., kept so a partial `notify_status_update` can merge. */
  private objects: Record<string, Record<string, unknown>> = {}
  private metadata: MoonrakerGcodeMetadata | null = null
  private metadataFilename = ''
  private components: string[] = []
  private probing = false
  /** Bumped on every connection so a late answer from a previous one is dropped. */
  private generation = 0

  constructor(options: FarmConnectionOptions) {
    this.id = options.id
    this.endpoint = options.endpoint
    this.onChange = options.onChange
    this.onName = options.onName ?? null
    this.probeReachable = options.probeReachable ?? probeMoonrakerReachable
    this.now = options.now ?? (() => Date.now())

    this.client = new MoonrakerClient({
      endpoint: options.endpoint,
      identity: {
        clientName: 'Alabaster',
        version: options.version,
        type: 'web',
        url: options.origin,
      },
      ...(options.socketFactory ? { socketFactory: options.socketFactory } : {}),
      ...(options.scheduler ? { scheduler: options.scheduler } : {}),
      ...(options.random ? { random: options.random } : {}),
      initialReconnectDelayMs: farmReconnectDelayMs,
      maximumReconnectDelayMs: farmMaximumReconnectDelayMs,
    })

    this.disposers.push(
      this.client.onConnectionStatus((status) => {
        if (status.phase === 'connected') {
          this.patch({ connection: 'connected', hasConnected: true })
          void this.loadOnce()
          return
        }
        if (status.phase === 'connecting') {
          this.patch({ connection: 'connecting' })
          return
        }
        if (status.phase === 'reconnecting') {
          this.patch({ connection: 'reconnecting' })
          // An attempt that failed against a printer this browser has never
          // reached is the one case worth diagnosing — see `diagnose` below.
          this.diagnose()
          return
        }
        if (status.phase === 'identifying') return
        if (status.phase === 'idle') {
          this.patch({ connection: 'idle' })
          return
        }
        // `stopped` while running means the socket dropped between attempts.
        this.patch({ connection: this.snapshot.hasConnected ? 'reconnecting' : 'offline' })
      }),
      this.client.onServerInfo((info) => this.applyServerInfo(info)),
      this.client.onKlipperMessage((message) => this.patch({ klipperMessage: message })),
      this.client.onObjectSnapshot((snapshot) => this.applyObjects(snapshot.status)),
      /*
       * The subscription's *result* arrives through `onObjectSnapshot`; every
       * change after it arrives as this notification and nothing else. Without
       * this handler a column showed the values from the moment it connected
       * and then froze — the exact failure `AGENTS.md`'s subscribe-don't-
       * snapshot rule exists to prevent, and invisible until you watch a
       * temperature that never moves.
       */
      this.client.onNotification('notify_status_update', (notification) => {
        const payload = notification.params[0]
        if (isRecord(payload)) this.applyObjects(payload)
      }),
      this.client.onNotification('notify_job_queue_changed', (notification) =>
        this.applyQueueNotification(notification),
      ),
      this.client.onNotification('notify_power_changed', (notification) =>
        this.applyPowerNotification(notification),
      ),
    )
  }

  get currentSnapshot(): FarmPrinterSnapshot {
    return this.snapshot
  }

  start(): void {
    if (this.running) return
    this.running = true
    void this.client.setObjectSubscription('alabaster.farm', farmObjectSelection)
    this.client.start()
  }

  /**
   * Closes the socket but keeps the snapshot. A column scrolled out of the rail
   * comes back showing what it last knew, dimmed, rather than re-loading from
   * nothing — the same continuity rule the dashboard follows through a restart
   * (ADR 0002).
   */
  stop(): void {
    if (!this.running) return
    this.running = false
    this.client.stop()
    this.patch({ connection: this.snapshot.hasConnected ? 'offline' : 'idle' })
  }

  dispose(): void {
    this.stop()
    for (const dispose of this.disposers.splice(0)) dispose()
  }

  /** A printer's address can be edited while its column is on screen. */
  setEndpoint(endpoint: string): void {
    if (endpoint === this.endpoint) return
    this.endpoint = endpoint
    this.objects = {}
    this.metadata = null
    this.metadataFilename = ''
    this.snapshot = emptyFarmSnapshot()
    this.emit()
    this.client.setEndpoint(endpoint)
  }

  retry(): void {
    if (!this.running) {
      this.start()
      return
    }
    this.client.resumeNow({ abandonAttempt: true })
  }

  /**
   * Every mutating control on a column goes through here. No retry and no
   * queueing: a command that fails on a farm connection is surfaced and waits
   * for the user, per ADR 0002's rule against replaying a mutating command
   * after a reconnect.
   */
  call<Result>(method: string, params?: JsonRpcParams): Promise<Result> {
    return this.client.callRaw<Result>(method, params)
  }

  private patch(patch: Partial<FarmPrinterSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    this.emit()
  }

  private emit(): void {
    this.onChange(this.snapshot)
  }

  private applyServerInfo(info: MoonrakerServerInfo): void {
    this.components = info.components ?? []
    this.patch({
      klipper: info.klippy_connected ? toKlipperState(info.klippy_state) : 'disconnected',
      ...(info.klippy_state === 'ready' ? { klipperMessage: '' } : {}),
      updatedAt: this.now(),
    })
  }

  /**
   * Merges a subscription snapshot or delta.
   *
   * Moonraker sends only what changed, so every object is merged field by field
   * over what was there — replacing wholesale would blank the target
   * temperature every time the actual one ticked.
   */
  private applyObjects(status: Record<string, unknown>): void {
    for (const [name, value] of Object.entries(status)) {
      if (!isRecord(value)) continue
      this.objects[name] = { ...(this.objects[name] ?? {}), ...value }
    }
    this.recomputeFromObjects()
  }

  private recomputeFromObjects(): void {
    const printStats = this.objects.print_stats ?? null
    const webhooks = this.objects.webhooks ?? null
    const filename =
      printStats && typeof printStats.filename === 'string' ? printStats.filename : ''

    if (filename !== this.metadataFilename) {
      this.metadataFilename = filename
      this.metadata = null
      if (filename !== '') void this.loadMetadata(filename)
    }

    const toolhead = this.objects.toolhead ?? null

    this.patch({
      state: toPrintState(printStats?.state),
      homedAxes:
        toolhead && typeof toolhead.homed_axes === 'string'
          ? toolhead.homed_axes.toLowerCase()
          : this.snapshot.homedAxes,
      ...(webhooks
        ? {
            klipper: toKlipperState(webhooks.state),
            klipperMessage:
              typeof webhooks.state_message === 'string' && webhooks.state !== 'ready'
                ? webhooks.state_message
                : '',
          }
        : {}),
      extruder: readHeater(this.objects.extruder, this.snapshot.extruder),
      bed: readHeater(this.objects.heater_bed, this.snapshot.bed),
      job: readJob({
        printStats,
        displayStatus: this.objects.display_status ?? null,
        virtualSdcard: this.objects.virtual_sdcard ?? null,
        slicerEstimateSeconds: this.metadata?.estimated_time ?? null,
        metadataLayerCount: this.metadata?.layer_count ?? null,
        thumbnailUrl: this.thumbnailUrl(filename),
      }),
      updatedAt: this.now(),
    })
  }

  private thumbnailUrl(filename: string): string | null {
    const thumbnails = this.metadata?.thumbnails
    if (!thumbnails?.length || filename === '') return null
    const largest = thumbnails.reduce((best, candidate) =>
      candidate.width > best.width ? candidate : best,
    )
    try {
      // Resolved against *this* printer's endpoint. Reusing the active
      // printer's would point every column at whichever machine happens to be
      // connected, under a different name each time, with nothing looking wrong.
      return moonrakerThumbnailUrl(filename, largest.relative_path, this.endpoint)
    } catch {
      return null
    }
  }

  private async loadMetadata(filename: string): Promise<void> {
    const generation = this.generation
    try {
      const metadata = await this.call<MoonrakerGcodeMetadata>('server.files.metadata', {
        filename,
      })
      if (generation !== this.generation || this.metadataFilename !== filename) return
      this.metadata = metadata
      this.recomputeFromObjects()
    } catch {
      // A file removed between the notification and the fetch, or a Moonraker
      // that never extracted metadata. The job row simply has no preview.
    }
  }

  /**
   * The three questions asked once per connection, plus the spool poll.
   *
   * They are one-shots rather than subscriptions because Moonraker either
   * pushes their changes (`notify_job_queue_changed`, `notify_power_changed`)
   * or does not report them at all. Capability answers are cached with the
   * connection: an optional component answers `Method not found` rather than
   * an empty result, and re-asking on every reconnect would spend a round trip
   * per column forever to learn the same "no".
   */
  private async loadOnce(): Promise<void> {
    const generation = ++this.generation
    await Promise.all([
      this.loadName(generation),
      this.loadCameras(generation),
      this.loadQueue(generation),
      this.loadPower(generation),
      this.loadSpool(generation),
    ])
  }

  /**
   * What the printer calls itself, so a column the user has not named shows a
   * name rather than an address.
   *
   * `printer.info` rather than `machine.system_info`: Moonraker answers it from
   * its own host information, so it survives a Klipper that is down — the
   * column that most needs telling apart from its neighbours — and its result
   * is a handful of fields rather than the several kilobytes of CPU,
   * distribution and network detail the system call returns for every printer
   * on the wall.
   */
  private async loadName(generation: number): Promise<void> {
    if (!this.onName) return
    try {
      const info = await this.call<{ hostname?: string }>('printer.info')
      if (generation !== this.generation) return
      if (typeof info.hostname === 'string' && info.hostname !== '') this.onName(info.hostname)
    } catch {
      // A printer that will not say what it is called keeps whatever name the
      // entry already had, which is its address on a first connection.
    }
  }

  private async loadCameras(generation: number): Promise<void> {
    try {
      const result = await this.call<{ webcams: MoonrakerWebcam[] }>('server.webcams.list')
      if (generation !== this.generation) return
      // Reported as the printer reports them, disabled ones included: the
      // column decides what to render, so both producers hand it the same list.
      const cameras: Camera[] = (result.webcams ?? []).map((webcam) =>
        normalizeCamera(webcam, this.endpoint),
      )
      this.patch({ cameras })
    } catch {
      this.patch({ cameras: [] })
    }
  }

  private async loadQueue(generation: number): Promise<void> {
    try {
      const result = await this.call<unknown>('server.job_queue.status')
      if (generation !== this.generation) return
      this.patch({ queue: readQueue(result) })
    } catch {
      this.patch({ queue: null })
    }
  }

  private async loadPower(generation: number): Promise<void> {
    if (!this.components.includes('power')) {
      this.patch({ power: null })
      return
    }
    try {
      const result = await this.call<{ devices?: unknown }>('machine.device_power.devices')
      if (generation !== this.generation) return
      this.patch({ power: readFirstPowerDevice(result.devices) })
    } catch {
      // `Method not found` from a printer without `[power]` is an answer, not a
      // failure: the column simply has no power control.
      this.patch({ power: null })
    }
  }

  private async loadSpool(generation: number): Promise<void> {
    if (!this.components.includes('spoolman')) {
      this.patch({ spool: null })
      return
    }
    try {
      const status = await this.call<{ spool_id: number | null; spoolman_connected: boolean }>(
        'server.spoolman.status',
      )
      if (generation !== this.generation) return
      if (!status.spoolman_connected || status.spool_id === null) {
        this.patch({ spool: null })
        return
      }
      const proxied = await this.call<{ response?: SpoolmanSpool | null; error?: unknown }>(
        'server.spoolman.proxy',
        {
          request_method: 'GET',
          path: `/v1/spool/${status.spool_id}`,
          use_v2_response: true,
        },
      )
      if (generation !== this.generation) return
      const spool = proxied.error ? null : (proxied.response ?? null)
      this.patch({
        spool: spool
          ? {
              material: spool.filament.material ?? '',
              color: spool.filament.color_hex
                ? `#${spool.filament.color_hex.replace(/^#/, '')}`
                : '',
              remainingWeight: spool.remaining_weight ?? null,
            }
          : null,
      })
    } catch {
      this.patch({ spool: null })
    }
  }

  private applyQueueNotification(notification: JsonRpcNotification): void {
    const payload = notification.params[0]
    const queue = readQueue(payload)
    if (queue) this.patch({ queue, updatedAt: this.now() })
  }

  private applyPowerNotification(notification: JsonRpcNotification): void {
    const payload = notification.params[0]
    const device = readFirstPowerDevice(payload)
    if (device && device.device === this.snapshot.power?.device) {
      this.patch({ power: device, updatedAt: this.now() })
    }
  }

  /**
   * A refused origin and a printer that is switched off fail the handshake
   * identically — browsers hide a failed WebSocket handshake's HTTP status from
   * JavaScript — so the failure alone cannot tell them apart. The probe can:
   * it resolves whenever *anything* answers HTTP at that host.
   *
   * Only for a printer this browser has never reached. One that has connected
   * before cannot newly be rejected by `cors_domains`, so probing every
   * reconnect blip would spend a request to learn nothing. On a farm this is
   * the single most common setup mistake, and without it the column reads
   * "offline" for a machine that is running perfectly.
   *
   * Driven by the connection *status* rather than by `onError`, which the main
   * store uses. The client's error path is skipped whenever a failed
   * handshake's `error` and `close` events land on the same tick — its own
   * `isCurrentConnection` guard goes stale in between — and a rail of printers
   * that are switched off is exactly where that would be noticed as a column
   * that never explains itself.
   */
  private diagnose(): void {
    if (this.snapshot.hasConnected || this.probing) return
    this.probing = true
    const endpoint = this.endpoint
    void this.probeReachable(endpoint).then((reachable) => {
      this.probing = false
      if (endpoint !== this.endpoint || this.snapshot.hasConnected) return
      if (reachable) this.patch({ connection: 'originRefused' })
    })
  }
}

/**
 * The printer's own switch, where it has one.
 *
 * A column shows a single power control, so a Moonraker driving several relays
 * answers with the first — picking one is the honest simplification, and the
 * printer's own Machine page lists them all.
 */
function readFirstPowerDevice(value: unknown): { device: string; on: boolean } | null {
  const list = Array.isArray(value) ? value : isRecord(value) ? [value] : []
  for (const candidate of list) {
    if (!isRecord(candidate)) continue
    const device = typeof candidate.device === 'string' ? candidate.device : ''
    if (device === '') continue
    return { device, on: candidate.status === 'on' }
  }
  return null
}
