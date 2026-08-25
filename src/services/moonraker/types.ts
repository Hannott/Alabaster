export type JsonRpcParams = Record<string, unknown> | readonly unknown[]

export interface JsonRpcErrorPayload {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params: readonly unknown[]
}

export interface SocketCloseEventLike {
  code: number
  reason: string
  wasClean: boolean
}

export interface WebSocketLike {
  readonly readyState: number
  onopen: WebSocket['onopen']
  onmessage: WebSocket['onmessage']
  onerror: WebSocket['onerror']
  onclose: WebSocket['onclose']
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void
  close(code?: number, reason?: string): void
}

export type WebSocketFactory = (url: string) => WebSocketLike

export interface MoonrakerIdentity {
  clientName: string
  version: string
  type: 'web' | 'mobile' | 'desktop' | 'display' | 'bot' | 'agent' | 'other'
  url: string
  accessToken?: string
  apiKey?: string
}

export type KlippyState = 'disconnected' | 'startup' | 'ready' | 'error' | 'shutdown'

export interface MoonrakerServerInfo {
  klippy_connected: boolean
  klippy_state: KlippyState
  /** Components Moonraker loaded successfully; failures are reported separately. */
  components?: string[]
  /** File roots this instance serves, such as `gcodes` and `config`. */
  registered_directories?: string[]
  [key: string]: unknown
}

/**
 * `moonraker.conf` reflected back section by section. Sections are whatever
 * the host has configured, so this stays a passthrough rather than a typed
 * shape — callers narrow the one section they need, the way `spool.ts` reads
 * `config.spoolman`.
 */
export interface MoonrakerServerConfig {
  config: Record<string, unknown>
}

export interface IdentifyConnectionResult {
  connection_id: number
}

export interface MoonrakerFileInfo {
  path: string
  modified: number
  size: number
  permissions?: string
}

/**
 * One embedded slicer preview. `relative_path` is relative to the directory
 * holding the G-code file, not to the gcodes root.
 */
export interface MoonrakerGcodeThumbnail {
  width: number
  height: number
  size: number
  relative_path: string
}

/**
 * `server.files.metadata` for a G-code file. Every field beyond the filename is
 * optional: what Moonraker can report depends on what the slicer wrote, and an
 * unsliced or hand-written file may carry almost none of it.
 */
export interface MoonrakerGcodeMetadata {
  filename: string
  size?: number
  modified?: number
  slicer?: string
  slicer_version?: string
  layer_height?: number
  first_layer_height?: number
  object_height?: number
  layer_count?: number
  filament_total?: number
  filament_weight_total?: number
  estimated_time?: number
  thumbnails?: MoonrakerGcodeThumbnail[]
  /**
   * Where the printable G-code starts and ends within the file. Everything
   * before the first and after the last is slicer preamble — comments, the
   * configuration block, and base64 thumbnails, which on a small file can be a
   * third of its bytes. Progress measured against the whole file would count
   * that preamble as printing.
   */
  gcode_start_byte?: number
  gcode_end_byte?: number
  nozzle_diameter?: number
  /** What the file's first layer asks Klipper to heat the hotend to. */
  first_layer_extr_temp?: number
  /** What the file's first layer asks Klipper to heat the bed to. */
  first_layer_bed_temp?: number
  /** Absent on the overwhelming majority of printers, which have no enclosure heater. */
  chamber_temp?: number
  /**
   * A single string for a one-filament file. A multi-material file reports
   * one comma-separated string per slicer, which is why the plural
   * `filament_colors` / `extruder_colors` / `filament_temps` /
   * `filament_weights` arrays below are the ones worth reading for a
   * per-tool breakdown — they line up index-for-index with each other and
   * with `referenced_tools`, not with this pair.
   */
  filament_name?: string
  filament_type?: string
  /** Hex colors, one per filament in a multi-material file, index-aligned with the fields below. */
  filament_colors?: string[]
  /** The physical extruder's own color, where the printer reports one per tool. */
  extruder_colors?: string[]
  /** One first-layer extruder temperature per filament, same index order as `filament_colors`. */
  filament_temps?: number[]
  /** One weight in grams per filament, same index order as `filament_colors`; sums to `filament_weight_total`. */
  filament_weights?: number[]
  /** Which tool numbers the file actually uses, for a printer with more extruders configured than this file needs. */
  referenced_tools?: number[]
  /** How many `T` tool-change commands the file contains. */
  filament_change_count?: number
  /** `1` when the slicer marked this a multi-material-unit print, otherwise absent. */
  mmu_print?: number
  printer_vendor?: string
  printer_model?: string
  printer_variant?: string
  profile_version?: string
}

/**
 * `[analysis]`'s own health, from `server.analysis.status`. `estimator_ready`
 * is what actually gates offering the action: the component can be configured
 * in `moonraker.conf` while Moonraker is still downloading the
 * `klipper_estimator` binary the first time it is asked for.
 */
export interface MoonrakerAnalysisStatus {
  estimator_executable: string
  estimator_ready: boolean
  estimator_version: string
  estimator_config_exists: boolean
  using_default_config: boolean
}

/** `server.analysis.process`'s report of what it actually did. */
export interface MoonrakerAnalysisProcessResult {
  prev_processed: boolean
  version: string
  bypassed: boolean
}

export type MoonrakerFileRoot = 'config' | 'gcodes' | 'logs' | 'timelapse'

export interface MoonrakerDirectoryEntry {
  modified: number
  size: number
  permissions: string
}

export interface MoonrakerDirectoryFile extends MoonrakerDirectoryEntry {
  filename: string
}

export interface MoonrakerDirectoryFolder extends MoonrakerDirectoryEntry {
  dirname: string
}

export interface MoonrakerDirectoryResult {
  dirs: MoonrakerDirectoryFolder[]
  files: MoonrakerDirectoryFile[]
  disk_usage: {
    total: number
    used: number
    free: number
  }
  root_info?: {
    name: string
    permissions: string
  }
}

/**
 * Whatever a frontend chose to keep beside a camera that Moonraker itself has
 * no field for. Moonraker stores `extra_data` verbatim and never reads it, so
 * this is a shared scratch space between every client on one printer — the
 * keys below are Mainsail's, and Alabaster reads them rather than inventing
 * parallel ones so a camera configured in either interface behaves the same in
 * both. Anything Alabaster adds of its own goes under an `alabaster` key, for
 * the same reason in reverse.
 */
export interface MoonrakerWebcamExtraData {
  /** `webrtc-go2rtc` only: request the audio track as well as the video one. */
  enableAudio?: boolean
  /** MJPEG services only: suppress the measured frame-rate readout. */
  hideFps?: boolean
  nozzleCrosshair?: boolean
  nozzleCrosshairColor?: string
  /** Fraction of the frame's smaller side, 0.01–1. */
  nozzleCrosshairSize?: number
  /**
   * Alabaster's own crosshair colour: one of `dashboardColorTokens`' keys
   * rather than a hex, so it follows the active theme pack. Namespaced because
   * it is not a field Mainsail knows — `nozzleCrosshairColor` above stays
   * written beside it for exactly that reason. See `features/camera/crosshair.ts`.
   */
  alabasterCrosshairColor?: string
  [key: string]: unknown
}

/**
 * One camera from Moonraker's own webcam database, which every Klipper
 * interface on the printer shares — adding a camera here makes it appear in
 * Mainsail and Fluidd too, and vice versa.
 *
 * Only `name`, `service`, `enabled`, `stream_url` and `snapshot_url` are
 * guaranteed by every Moonraker old enough to answer `server.webcams.list` at
 * all; the rest arrived with the database-backed rewrite, so they stay
 * optional and every reader supplies the API's own documented default rather
 * than assuming presence. `webcamDefaults` in `stores/webcams.ts` is the one
 * place those defaults are written down.
 */
export interface MoonrakerWebcam {
  /** Unique and stable across renames — prefer it over `name` as a key. */
  uid?: string
  name: string
  location?: string
  icon?: string
  service: string
  enabled: boolean
  stream_url: string
  snapshot_url: string
  target_fps?: number
  target_fps_idle?: number
  flip_horizontal?: boolean
  flip_vertical?: boolean
  rotation?: number
  aspect_ratio?: string
  extra_data?: MoonrakerWebcamExtraData
  /**
   * `'config'` for a camera declared in `moonraker.conf`, which the API
   * refuses to modify or delete — the editor renders it read-only rather than
   * offering controls whose save Moonraker would reject. `'database'` for one
   * any client created.
   */
  source?: 'config' | 'database'
}

/**
 * A `post_item` body. `uid` names an existing camera to update — omitted, the
 * request creates one — and on an update every other field defaults to the
 * camera's current value, so a partial patch is legal. `name` and
 * `stream_url` are required on create only, which is why they are optional
 * here rather than mirroring `MoonrakerWebcam`.
 */
export type MoonrakerWebcamPatch = Partial<Omit<MoonrakerWebcam, 'source'>>

export interface MoonrakerWebcamTestResult {
  name: string
  snapshot_reachable: boolean
  snapshot_url: string
  stream_url: string
}

/**
 * One switch `[power]` knows about — a smart plug, a GPIO relay, or a TPLink/
 * Tasmota/Shelly device, whatever `moonraker.conf` configured it as. `status`
 * is usually `on`/`off`, but a device mid-transition or in a fault state
 * reports its own string, which is why it stays untyped rather than a union
 * that would silently drop a state moonraker.conf's device plugins invent.
 */
export interface MoonrakerPowerDevice {
  device: string
  status: string
  locked_while_printing: boolean
  type: string
}

/**
 * One entry Moonraker's `[announcements]` manager pulled from a feed —
 * Moonraker's or Klipper's own release notices, or a configured component's.
 * Built into every Moonraker instance, unlike `power` or `spoolman`: there is
 * no config section that gates it, so Alabaster asks unconditionally and
 * treats a refusal (an ancient Moonraker predating the feature) the same as
 * an empty list rather than an error.
 */
export interface MoonrakerAnnouncementEntry {
  entry_id: string
  url: string
  title: string
  description: string
  priority: 'normal' | 'high'
  date: number
  dismissed: boolean
  date_dismissed: number | null
  dismiss_wake: number | null
  source: string
  feed: string
}

export interface MoonrakerSystemInfo {
  provider: string
  cpu_info?: {
    cpu_count: number
    bits: string
    processor: string
    cpu_desc: string
    hardware_desc: string
    model: string
    total_memory: number
    memory_units: string
  }
  distribution: {
    name: string
    version: string
    codename: string
  }
  available_services: string[]
  service_state: Record<string, { active_state?: string; sub_state?: string }>
  virtualization?: { virt_type: string; virt_identifier: string }
  network?: Record<
    string,
    { mac_address?: string; ip_addresses?: Array<{ family?: string; address?: string }> }
  >
  /**
   * CAN interfaces the host itself sees, keyed by interface name (`can0`,
   * `can1`, ...) — this is where an interface name comes from before
   * `machine.peripherals.canbus` can be asked to scan it; the endpoint takes
   * no interface list of its own.
   */
  canbus?: Record<string, { tx_queue_len: number; bitrate: number; driver: string }>
}

/**
 * One serial/tty device Moonraker's own sysfs scan found — `path_by_id` is
 * exactly what a `[mcu]`/`[probe]` config's `serial:` line names, when the
 * kernel exposes one. `device_type` distinguishes a genuine hardware UART
 * (a Pi's own GPIO serial) from a USB-CDC device, since only the latter
 * carries a `usb_location` to cross-reference against `MoonrakerUsbDevice`.
 */
export interface MoonrakerSerialDevice {
  device_type: 'unknown' | 'hardware_uart' | 'usb'
  device_path: string
  device_name: string
  driver_name: string
  path_by_hardware: string | null
  path_by_id: string | null
  usb_location: string | null
}

/**
 * One USB device node, identified before it necessarily has a serial/tty
 * device of its own — useful to confirm a board is enumerating on the bus at
 * all when it never gained a `/dev/serial/*` entry. `description` is
 * Moonraker's own `usb.ids` lookup already resolved server-side; Alabaster
 * never parses vendor/product IDs itself.
 */
export interface MoonrakerUsbDevice {
  device_num: number
  bus_num: number
  vendor_id: string
  product_id: string
  usb_location: string
  manufacturer: string | null
  product: string | null
  serial: string | null
  description: string | null
}

/**
 * One CAN node `machine.peripherals.canbus` found on an interface that
 * neither Klipper nor Katapult has claimed yet — the endpoint reports only
 * unassigned UUIDs, not every node a running `printer.cfg` already wired up,
 * so this list is "what could still be added", not "what's on the bus".
 */
export interface MoonrakerCanbusUuid {
  uuid: string
  application: 'Klipper' | 'Katapult'
}

export interface MoonrakerProcStats {
  cpu_temp: number | null
  network: Record<
    string,
    { rx_bytes: number; tx_bytes: number; bandwidth: number; rx_errs: number; tx_errs: number }
  >
  system_cpu_usage: Record<string, number>
  system_uptime: number
  system_memory: { total: number; available: number; used: number }
  throttled_state: { bits: number; flags: string[] } | null
}

/** One upstream commit a repository has not applied yet. */
export interface MoonrakerCommitBehind {
  sha: string
  author: string
  /** Unix seconds, as a string. */
  date: string
  subject: string
  message: string
  tag: string | null
}

export interface MoonrakerUpdateEntry {
  configured_type?: 'system' | 'git_repo' | 'web' | 'zip' | 'python'
  name?: string
  version?: string
  remote_version?: string
  package_count?: number
  /** The upgradeable package names for a `system` source — `apt`'s own changelog. */
  package_list?: string[]
  is_dirty?: boolean
  corrupt?: boolean
  is_valid?: boolean
  commits_behind_count?: number
  commits_behind?: MoonrakerCommitBehind[]
  /*
   * Moonraker distinguishes these three, and the distinction is what a recovery
   * decision rests on: `warnings` mark the repository invalid and disable updates,
   * `anomalies` are unexpected-but-tolerated conditions that still allow an update,
   * and `git_messages` is the output of a git command that actually failed.
   */
  anomalies?: string[]
  warnings?: string[]
  git_messages?: string[]
  branch?: string
  remote_alias?: string
  detached?: boolean
  pristine?: boolean
  full_version_string?: string
}

export interface MoonrakerUpdateStatus {
  busy: boolean
  github_rate_limit: number
  github_requests_remaining: number
  github_limit_reset_time: number
  version_info: Record<string, MoonrakerUpdateEntry>
}

/** One `notify_update_response` line from a running update process. */
export interface MoonrakerUpdateResponse {
  application: string
  proc_id: number
  message: string
  complete: boolean
}

/**
 * One value a Moonraker component recorded against a job — declared as a
 * `history_field_*` entry under that component's own config section, and
 * reported back on every job whether or not the section still declares it.
 * `value` is an array for a component that records more than one reading per
 * job, such as Spoolman's `spool_ids` on a multi-material print.
 */
export interface MoonrakerHistoryAuxiliaryData {
  description: string
  name: string
  provider: string
  units: string | null
  value: number | number[]
}

/** One completed (or abandoned) print, as `server.history.list` reports it. */
export interface MoonrakerHistoryJob {
  job_id: string
  filename: string
  status: string
  start_time: number
  end_time: number | null
  print_duration: number
  total_duration: number
  filament_used: number
  exists: boolean
  metadata?: MoonrakerGcodeMetadata
  auxiliary_data?: MoonrakerHistoryAuxiliaryData[]
}

/**
 * Lifetime counters Moonraker keeps itself. `total_time` counts everything the
 * job occupied the printer for; `print_time` counts only the moving part, which
 * is why the two differ by more than rounding on a job with a long heat-up.
 */
export interface MoonrakerHistoryTotals {
  total_jobs: number
  total_time: number
  total_print_time: number
  total_filament_used: number
  longest_job: number
  longest_print: number
}

/** One auxiliary field's lifetime aggregate, alongside `MoonrakerHistoryTotals`. */
export interface MoonrakerHistoryAuxiliaryTotal {
  field: string
  provider: string
  maximum: number
  total: number
}

export type JobQueueState = 'ready' | 'loading' | 'starting' | 'paused'

export interface MoonrakerQueuedJob {
  filename: string
  job_id: string
  time_added: number
  time_in_queue: number
}

export interface MoonrakerJobQueueStatus {
  queued_jobs: MoonrakerQueuedJob[]
  queue_state: JobQueueState
}

export interface SpoolmanVendor {
  id: number
  name: string
  comment?: string | null
}

/** One filament type Spoolman knows about; many spools can share one. */
export interface SpoolmanFilament {
  id: number
  name?: string | null
  vendor?: SpoolmanVendor | null
  material?: string | null
  density?: number
  diameter?: number
  /** Net filament weight when new, grams — what a fresh spool of this type holds. */
  weight?: number
  /** The empty spool's own weight, grams — Spoolman's other half of a gross reading. */
  spool_weight?: number
  color_hex?: string | null
  settings_extruder_temp?: number | null
  settings_bed_temp?: number | null
}

/**
 * One physical spool. `remaining_weight`/`remaining_length` are Spoolman's own
 * derived fields — absent whenever it lacks enough of `filament.weight`,
 * `filament.spool_weight`, or `filament.density` to derive them, which is why
 * they are optional rather than computed again here from `used_weight`.
 */
export interface SpoolmanSpool {
  id: number
  registered: string
  first_used?: string | null
  last_used?: string | null
  filament: SpoolmanFilament
  remaining_weight?: number | null
  used_weight: number
  remaining_length?: number | null
  used_length: number
  location?: string | null
  lot_nr?: string | null
  comment?: string | null
  archived: boolean
}

/**
 * One catalogue entry from Spoolman's own external filament database
 * (SpoolmanDB, synced and cached server-side), as `GET
 * /v1/external/filament/search` answers it. Typing only the fields Alabaster
 * reads, the same convention `SpoolmanFilament` already follows — the real
 * schema also carries density, weight, spool type, finish and pattern, none
 * of which a preset needs.
 */
export interface SpoolmanExternalFilament {
  id: string
  manufacturer: string
  name: string
  material: string
  color_hex?: string | null
  color_hexes?: string[] | null
  extruder_temp?: number | null
  bed_temp?: number | null
}

export interface MoonrakerSpoolmanStatus {
  spoolman_connected: boolean
  /** Consumption Moonraker has recorded but not yet flushed to the Spoolman server. */
  pending_reports: { spool_id: number; filament_used: number }[]
  spool_id: number | null
}

/**
 * `server.spoolman.proxy`'s v2 response envelope. Alabaster always requests
 * `use_v2_response: true`, which turns a Spoolman-side error (a deleted spool,
 * an invalid path) into data here instead of a thrown RPC error — the
 * distinction `MoonrakerRpcError` exists to preserve is "Moonraker refused
 * this," and a proxied 404 from Spoolman itself is not that.
 */
export interface SpoolmanProxyResponse<Result> {
  response: Result | null
  error: { status_code: number; message: string } | null
}

/**
 * `access.info`'s answer — whether this Moonraker instance enforces login at
 * all. `login_required` is only `true` when `force_logins` is configured
 * *and* at least one user exists, which is why most installs never see any of
 * this: the default is a trusted-LAN connection with zero users configured.
 */
export interface MoonrakerAuthInfo {
  default_source: string
  available_sources: string[]
  login_required: boolean
  trusted: boolean | null
}

/** One registered account, as `access.get_user`/`access.users.list` report it. */
export interface MoonrakerUserInfo {
  username: string
  source: string
  created_on: number
}

/**
 * `access.login`/`access.post_user`'s shared response shape. `token` is a
 * short-lived (1 hour) access token that authenticates the *current* websocket
 * connection immediately — Moonraker keeps a connection authenticated until it
 * closes or the user logs out, so nothing further needs to be sent on this
 * connection. `refresh_token` is the one worth persisting: exchanged for a
 * fresh access token on every future connection via `access.refresh_jwt`.
 */
export interface MoonrakerLoginResult {
  username: string
  token: string
  refresh_token: string
  action: string
  source: string
}

/** `access.logout`/`access.delete_user`'s shared response shape. */
export interface MoonrakerUserActionResult {
  username: string
  action: string
}

/** `access.refresh_jwt`'s response — a fresh access token, no new refresh token. */
export interface MoonrakerRefreshResult {
  username: string
  token: string
  source: string
  action: string
}

export type PrinterObjectSelection = Record<string, readonly string[] | null>

export interface PrinterObjectSnapshot {
  eventtime: number
  status: Record<string, unknown>
}

export interface MoonrakerRpcMethods {
  'server.connection.identify': {
    params: {
      client_name: string
      version: string
      type: MoonrakerIdentity['type']
      url: string
      access_token?: string
      api_key?: string
    }
    result: IdentifyConnectionResult
  }
  'server.info': {
    params: undefined
    result: MoonrakerServerInfo
  }
  'server.config': {
    params: undefined
    result: MoonrakerServerConfig
  }
  'printer.info': {
    params: undefined
    result: {
      state: KlippyState
      state_message: string
      hostname: string
      software_version: string
      cpu_info: string
      [key: string]: unknown
    }
  }
  'printer.objects.list': {
    params: undefined
    result: { objects: string[] }
  }
  /**
   * Moonraker's own recording of every sensor, one sample a second, bounded by
   * `[data_store] temperature_store_size` in `moonraker.conf` (1200 by default,
   * so twenty minutes). The arrays carry no timestamps: they are evenly spaced
   * and end at the present, which is what makes them reconstructable.
   */
  'server.temperature_store': {
    params: { include_monitors?: boolean }
    result: Record<
      string,
      { temperatures?: number[]; targets?: number[]; powers?: number[]; speeds?: number[] }
    >
  }
  'printer.objects.query': {
    params: { objects: PrinterObjectSelection }
    result: PrinterObjectSnapshot
  }
  'printer.objects.subscribe': {
    params: { objects: PrinterObjectSelection }
    result: PrinterObjectSnapshot
  }
  'printer.gcode.script': {
    params: { script: string }
    result: string
  }
  /*
   * Each configured endstop, reported as `TRIGGERED` or `open`. Klipper answers
   * by actually querying the MCUs, which is why it is asked for on demand rather
   * than subscribed to — there is no notification for it.
   */
  'printer.query_endstops.status': {
    params: undefined
    result: Record<string, string>
  }
  'printer.emergency_stop': {
    params: undefined
    result: string
  }
  'printer.restart': {
    params: undefined
    result: string
  }
  'printer.firmware_restart': {
    params: undefined
    result: string
  }
  'printer.print.start': {
    params: { filename: string }
    result: string
  }
  'printer.print.pause': {
    params: undefined
    result: string
  }
  'printer.print.resume': {
    params: undefined
    result: string
  }
  'printer.print.cancel': {
    params: undefined
    result: string
  }
  'server.files.list': {
    // Any root Moonraker registered, which is more than the two Alabaster
    // happened to ask for when this was written.
    params: { root: MoonrakerFileRoot }
    result: MoonrakerFileInfo[]
  }
  'server.files.metadata': {
    params: { filename: string }
    result: MoonrakerGcodeMetadata
  }
  'server.analysis.status': {
    params: undefined
    result: MoonrakerAnalysisStatus
  }
  /**
   * Rewrites the file in place: corrected time estimates and M73 progress
   * commands from `klipper_estimator`'s own accounting, not Alabaster's. A
   * file `[analysis] enable_auto_analysis` already processed on upload
   * reports `bypassed: true` and changes nothing, so calling this again is
   * never harmful — only ever a no-op or an improvement.
   */
  'server.analysis.process': {
    params: { filename: string; estimator_config?: string; force?: boolean }
    result: MoonrakerAnalysisProcessResult
  }
  'server.files.get_directory': {
    params: { path: string; extended?: boolean }
    result: MoonrakerDirectoryResult
  }
  'server.files.post_directory': {
    params: { path: string }
    result: { item: { path: string; root: string } }
  }
  'server.files.delete_file': {
    params: { path: string }
    result: { item: { path: string; root: string } }
  }
  'server.files.delete_directory': {
    params: { path: string; force?: boolean }
    result: { item: { path: string; root: string } }
  }
  'server.files.move': {
    params: { source: string; dest: string }
    result: { item: { path: string; root: string } }
  }
  /**
   * Moonraker's own retained console history, which is what lets the console show
   * what the printer said before this browser tab existed. `time` is epoch
   * seconds and `type` distinguishes what the user sent from what Klipper
   * answered, so a backfilled transcript reads the same as a live one.
   */
  'server.gcode_store': {
    params: { count?: number } | undefined
    result: {
      gcode_store: { message: string; time: number; type: 'command' | 'response' }[]
    }
  }
  'server.history.list': {
    params: {
      limit?: number
      start?: number
      since?: number
      before?: number
      order?: 'asc' | 'desc'
    }
    result: { count: number; jobs: MoonrakerHistoryJob[] }
  }
  'server.history.totals': {
    params: undefined
    result: {
      job_totals: MoonrakerHistoryTotals
      auxiliary_totals?: MoonrakerHistoryAuxiliaryTotal[]
    }
  }
  'server.history.reset_totals': {
    params: undefined
    result: { last_totals: MoonrakerHistoryTotals }
  }
  'server.history.delete_job': {
    params: { uid: string } | { all: true }
    result: string[]
  }
  'server.job_queue.status': {
    params: undefined
    result: MoonrakerJobQueueStatus
  }
  /**
   * The same filename may be repeated to queue several runs of one file —
   * Moonraker gives each its own `job_id`, so the queue never collapses
   * duplicates the way a `Set` of paths would.
   */
  'server.job_queue.post_job': {
    params: { filenames: string[]; reset?: boolean }
    result: MoonrakerJobQueueStatus
  }
  'server.job_queue.delete_job': {
    params: { job_ids?: string[]; all?: boolean }
    result: MoonrakerJobQueueStatus
  }
  'server.job_queue.pause': {
    params: undefined
    result: MoonrakerJobQueueStatus
  }
  'server.job_queue.start': {
    params: undefined
    result: MoonrakerJobQueueStatus
  }
  'server.webcams.list': {
    params: undefined
    result: { webcams: MoonrakerWebcam[] }
  }
  /**
   * Creates a camera when `uid` is absent and updates the named one when it is
   * present. Moonraker refuses outright for a camera whose `source` is
   * `'config'`, so the editor never offers a save for one.
   */
  'server.webcams.post_item': {
    params: MoonrakerWebcamPatch
    result: { webcam: MoonrakerWebcam }
  }
  'server.webcams.delete_item': {
    params: { uid: string } | { name: string }
    result: { webcam: MoonrakerWebcam }
  }
  /**
   * Asks Moonraker — not the browser — to fetch the camera's snapshot. That
   * distinction is the whole value: a stream that fails in the browser but
   * succeeds here is a URL the browser cannot reach (an internal hostname, a
   * mixed-content block), which is a different problem from a camera that is
   * off. `snapshot_reachable` is false whenever the snapshot URL is empty or
   * did not answer within a second.
   */
  'server.webcams.test': {
    params: { uid: string } | { name: string }
    result: MoonrakerWebcamTestResult
  }
  'server.announcements.list': {
    params: { include_dismissed?: boolean }
    result: { entries: MoonrakerAnnouncementEntry[]; feeds: string[] }
  }
  'server.announcements.dismiss': {
    params: { entry_id: string; wake_time?: number }
    result: { entry_id: string }
  }
  /**
   * The `[database]` component is core Moonraker, present on every printer —
   * unlike `authorization` or `spoolman`, no `hasComponent` gate is needed
   * before using it. `key` never carries the array form the API also accepts
   * (a path into a nested value): every caller in this codebase reads or
   * writes one whole item at a time.
   */
  'server.database.get_item': {
    params: { namespace: string; key?: string }
    result: { namespace: string; key?: string; value: unknown }
  }
  'server.database.post_item': {
    params: { namespace: string; key: string; value: unknown }
    result: { namespace: string; key: string; value: unknown }
  }
  'server.database.delete_item': {
    params: { namespace: string; key: string }
    result: { namespace: string; key: string; value: unknown }
  }
  'server.spoolman.status': {
    params: undefined
    result: MoonrakerSpoolmanStatus
  }
  'server.spoolman.get_spool_id': {
    params: undefined
    result: { spool_id: number | null }
  }
  /**
   * Moonraker reads this with `get_int("spool_id", None)`, which only falls
   * back to `None` — clearing the active spool — when the key is absent
   * entirely. Sending it present-but-`null` still reaches `int()` and Moonraker
   * refuses the call, so the key is optional here rather than nullable: a
   * caller clearing the active spool omits it instead of sending `null`.
   */
  'server.spoolman.post_spool_id': {
    params: { spool_id?: number }
    result: { spool_id: number | null }
  }
  /**
   * Forwards a request to Spoolman's own REST API; `path` is the full versioned
   * route (`/v1/spool/3`). The generic result type is `unknown` here rather than
   * threaded through this table, because what comes back depends on `path` in a
   * way this map cannot express — callers narrow it themselves, the same way
   * `rpcCallRaw` callers already do for endpoints outside this table entirely.
   */
  'server.spoolman.proxy': {
    params: {
      request_method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
      path: string
      query?: string
      body?: Record<string, unknown>
      use_v2_response?: boolean
    }
    result: SpoolmanProxyResponse<unknown>
  }
  'machine.system_info': {
    params: undefined
    result: { system_info: MoonrakerSystemInfo }
  }
  'machine.proc_stats': {
    params: undefined
    result: MoonrakerProcStats
  }
  'machine.peripherals.serial': {
    params: undefined
    result: { serial_devices: MoonrakerSerialDevice[] }
  }
  'machine.peripherals.usb': {
    params: undefined
    result: { usb_devices: MoonrakerUsbDevice[] }
  }
  'machine.peripherals.canbus': {
    params: { interface?: string }
    result: { can_uuids: MoonrakerCanbusUuid[] }
  }
  'machine.update.status': {
    params: { refresh?: boolean }
    result: MoonrakerUpdateStatus
  }
  'machine.update.refresh': {
    params: { name?: string }
    result: MoonrakerUpdateStatus
  }
  'machine.update.upgrade': {
    params: { name?: string }
    result: string
  }
  /**
   * `hard: false` runs `git reset`, which clears a dirty repository but cannot fix
   * a corrupt one; `hard: true` removes and re-clones it.
   */
  'machine.update.recover': {
    params: { name: string; hard?: boolean }
    result: string
  }
  /**
   * Reverts one source to the version it tracked before its most recent
   * install. Only a `git_repo`/`web` source can answer this — a `system`
   * source's PackageKit path has no prior version for Moonraker to hold onto.
   */
  'machine.update.rollback': {
    params: { name: string }
    result: string
  }
  /*
   * Superseded by `machine.update.upgrade`, which Moonraker gained later. They
   * remain declared because a Pi running an older Moonraker answers only these,
   * and the update manager falls back to them on a method-not-found response.
   */
  'machine.update.full': {
    params: undefined
    result: string
  }
  'machine.update.moonraker': {
    params: undefined
    result: string
  }
  'machine.update.klipper': {
    params: undefined
    result: string
  }
  'machine.update.client': {
    params: { name: string }
    result: string
  }
  'machine.update.system': {
    params: undefined
    result: string
  }
  'machine.services.restart': {
    params: { service: string }
    result: string
  }
  'machine.services.start': {
    params: { service: string }
    result: string
  }
  'machine.services.stop': {
    params: { service: string }
    result: string
  }
  'machine.reboot': {
    params: undefined
    result: string
  }
  'machine.shutdown': {
    params: undefined
    result: string
  }
  'machine.device_power.devices': {
    params: undefined
    result: { devices: MoonrakerPowerDevice[] }
  }
  /**
   * `action` is only ever sent as `'on' | 'off'`; Alabaster derives the target
   * state itself from the device's last-known status rather than sending
   * `'toggle'`, so a race against a concurrent notification can never leave
   * the UI unsure which way a toggle actually went.
   */
  'machine.device_power.post_device': {
    params: { device: string; action: 'on' | 'off' | 'toggle' }
    result: Record<string, string>
  }
  /**
   * Method names verified against Moonraker's own source
   * (`moonraker/components/authorization.py`) and published docs
   * (`docs/external_api/authorization.md`) rather than guessed from the HTTP
   * routes they mirror — several differ from the obvious guess:
   * `access.get_user`/`access.post_user`/`access.delete_user` are three
   * methods behind one HTTP endpoint, and the API key pair is split into
   * `access.get_api_key`/`access.post_api_key` rather than a single
   * `access.api_key`.
   */
  'access.info': {
    params: undefined
    result: MoonrakerAuthInfo
  }
  'access.login': {
    params: { username: string; password: string; source?: string }
    result: MoonrakerLoginResult
  }
  'access.logout': {
    params: undefined
    result: MoonrakerUserActionResult
  }
  'access.get_user': {
    params: undefined
    result: MoonrakerUserInfo | { username: null; source: null; created_on: null }
  }
  'access.post_user': {
    params: { username: string; password: string }
    result: MoonrakerLoginResult
  }
  'access.delete_user': {
    params: { username: string }
    result: MoonrakerUserActionResult
  }
  'access.users.list': {
    params: undefined
    result: { users: MoonrakerUserInfo[] }
  }
  'access.user.password': {
    params: { password: string; new_password: string }
    result: MoonrakerUserActionResult
  }
  /** Accessible without prior authentication; a 401 means the refresh token itself is no longer valid. */
  'access.refresh_jwt': {
    params: { refresh_token: string }
    result: MoonrakerRefreshResult
  }
  'access.get_api_key': {
    params: undefined
    result: string
  }
  'access.post_api_key': {
    params: undefined
    result: string
  }
}

export interface MoonrakerCallOptions {
  /**
   * Overrides the transport's default request timeout. `null` disables the local
   * timer entirely, which is required for the update manager: Moonraker answers
   * `machine.update.refresh` and `machine.update.upgrade` only after the work is
   * finished, and a fetch across every configured repository routinely outlasts
   * any timeout short enough to be useful elsewhere. Such a request is still
   * bounded — a closing socket rejects everything still pending.
   */
  timeoutMs?: number | null
}

export type MoonrakerRpcMethod = keyof MoonrakerRpcMethods
export type MoonrakerRpcParams<Method extends MoonrakerRpcMethod> =
  MoonrakerRpcMethods[Method]['params']
export type MoonrakerRpcResult<Method extends MoonrakerRpcMethod> =
  MoonrakerRpcMethods[Method]['result']

export type MoonrakerConnectionPhase =
  'idle' | 'connecting' | 'identifying' | 'connected' | 'reconnecting' | 'stopped'

export interface MoonrakerConnectionStatus {
  phase: MoonrakerConnectionPhase
  attempt: number
  retryDelayMs?: number
}

export interface TimerScheduler {
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>
  clearTimeout(timer: ReturnType<typeof setTimeout>): void
}

export type NotificationHandler = (notification: JsonRpcNotification) => void
export type ConnectionStatusHandler = (status: MoonrakerConnectionStatus) => void
export type ServerInfoHandler = (serverInfo: MoonrakerServerInfo) => void
/**
 * Klipper's own sentence about why it is not ready — a config error, an MCU
 * shutdown reason, or the reassuring one it reports while loading. `server.info`
 * carries the state but never the message, so this arrives from `printer.info`
 * on the lifecycle poll rather than with the state that prompted it.
 */
export type KlipperMessageHandler = (message: string) => void
export type ObjectSnapshotHandler = (snapshot: PrinterObjectSnapshot) => void
export type ErrorHandler = (error: Error) => void
