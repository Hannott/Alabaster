import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import { FarmConnection } from '@/farm/connection'
import { isPrintableGcodeFilename, type MoonrakerFileInfo } from '@/services/moonraker'
import { readQueue } from '@/farm/snapshot'
import { emptyFarmSnapshot, type FarmPrinterSnapshot } from '@/farm/types'
import { i18n } from '@/i18n'
import { useAvailabilityStore } from '@/stores/availability'
import { useJobQueueStore } from '@/stores/jobQueue'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import { printerDisplayLabel, printerHost, usePrintersStore } from '@/stores/printers'
import { useSpoolStore } from '@/stores/spool'
import { useTelemetryStore } from '@/stores/telemetry'
import { useToastsStore } from '@/stores/toasts'
import { useWebcamsStore } from '@/stores/webcams'

/**
 * The farm rail's data layer: one page-scoped connection per *visible* printer
 * the user is not currently driving, plus an adapter that presents the printer
 * they are driving in the same shape.
 *
 * Three rules hold this together, and each of them prevents a specific failure:
 *
 * - **No domain store may read this one.** Farm connections are read-mostly,
 *   page-scoped, and invisible to the rest of the application, which is what
 *   keeps ADR 0005's "one connection, retargeted" true everywhere else.
 *   `farmIsolation.spec.ts` fails the build if an import ever points the other
 *   way.
 * - **Never a second socket to the active printer.** It already has one, fully
 *   subscribed. A second would double its subscription and show numbers a tick
 *   behind the dashboard's — the same values from two sources, disagreeing.
 * - **Connections follow the viewport.** A column that is not on screen holds
 *   no socket, so the page costs what fits on the screen rather than what the
 *   printer list holds. Measured: 1.6 KB/s per connected printer while idle, of
 *   which 1.1 KB/s is host telemetry Moonraker pushes whether or not anybody
 *   subscribed to it.
 */

/**
 * How long a column keeps its connection after leaving the viewport.
 *
 * Without hysteresis, scrolling the rail would open and close a socket per
 * column crossed. With it, a scroll past costs nothing and a scroll back is
 * instant, because the connection was never dropped.
 */
export const farmVisibilityGraceMs = 30_000

export interface FarmPrinterView {
  id: string
  label: string
  host: string
  endpoint: string
  isActive: boolean
  snapshot: FarmPrinterSnapshot
}

export const useFarmStore = defineStore('farm', () => {
  const printers = usePrintersStore()
  const moonraker = useMoonrakerStore()
  const availability = useAvailabilityStore()
  const printer = usePrinterStore()
  const telemetry = useTelemetryStore()
  const webcams = useWebcamsStore()
  const jobQueue = useJobQueueStore()
  const spool = useSpoolStore()
  const toasts = useToastsStore()

  /** Snapshots by printer id, for the printers this page connects to itself. */
  const snapshots = ref<Record<string, FarmPrinterSnapshot>>({})
  /** Ids whose column is on screen, per the rail's own observer. */
  const visibleIds = ref<Set<string>>(new Set())
  /** Whether the page is mounted and the document visible. */
  const active = ref(false)
  const pendingCommands = ref<Set<string>>(new Set())

  const connections = new Map<string, FarmConnection>()
  const graceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let stopWatch: WatchStopHandle | null = null

  function snapshotFor(id: string): FarmPrinterSnapshot {
    return snapshots.value[id] ?? emptyFarmSnapshot()
  }

  /**
   * The active printer's column, assembled from the stores that already hold
   * its data. Everything here is a read of live state — no request of its own,
   * and no second socket.
   */
  const activeSnapshot = computed<FarmPrinterSnapshot>(() => {
    const connected = availability.isMoonrakerConnected
    const job = printer.printStats.filename
      ? {
          filename: printer.printStats.filename,
          progress: printer.progress,
          printDuration: printer.printStats.printDuration,
          totalDuration: printer.printStats.totalDuration,
          remainingSeconds: printer.remainingSeconds,
          currentLayer: printer.layer.current,
          totalLayer: printer.layer.total,
          thumbnailUrl: printer.thumbnailUrl,
        }
      : null

    return {
      connection: connected
        ? 'connected'
        : availability.hasReachedMoonraker
          ? 'reconnecting'
          : 'offline',
      hasConnected: availability.hasReachedMoonraker,
      klipper: availability.klipperState,
      klipperMessage: availability.klipperMessage,
      state: printer.printStats.state,
      homedAxes: printer.motion.homedAxes.toLowerCase(),
      job,
      extruder: { temperature: telemetry.hotend.temperature, target: telemetry.hotend.target },
      bed: { temperature: telemetry.bed.temperature, target: telemetry.bed.target },
      spool: spool.activeSpool
        ? {
            material: spool.activeSpool.filament.material ?? '',
            color: spool.activeSpool.filament.color_hex
              ? `#${spool.activeSpool.filament.color_hex.replace(/^#/, '')}`
              : '',
            remainingWeight: spool.activeSpool.remaining_weight ?? null,
          }
        : null,
      queue: readQueue({ queue_state: jobQueue.queueState, queued_jobs: jobQueue.jobs }),
      cameras: webcams.cameras,
      power: null,
      updatedAt: connected ? Date.now() : null,
    }
  })

  /** Every saved printer, in the order the user arranged them. */
  const columns = computed<FarmPrinterView[]>(() =>
    printers.entries.map((entry) => ({
      id: entry.id,
      label: printerDisplayLabel(entry),
      host: printerHost(entry.endpoint),
      endpoint: entry.endpoint,
      isActive: entry.id === printers.activeId,
      snapshot: entry.id === printers.activeId ? activeSnapshot.value : snapshotFor(entry.id),
    })),
  )

  function connectionFor(id: string): FarmConnection | null {
    return connections.get(id) ?? null
  }

  function openConnection(id: string): void {
    const entry = printers.entries.find((candidate) => candidate.id === id)
    if (!entry || entry.id === printers.activeId) return

    const existing = connections.get(id)
    if (existing) {
      existing.setEndpoint(entry.endpoint)
      existing.start()
      return
    }

    const connection = new FarmConnection({
      id,
      endpoint: entry.endpoint,
      version: __APP_VERSION__,
      origin: window.location.origin,
      onChange: (snapshot) => {
        snapshots.value = { ...snapshots.value, [id]: snapshot }
      },
      // The entry, not the snapshot: a name belongs to the saved printer, and
      // remembering it there is what lets an offline column keep it.
      onName: (name) => printers.rememberDiscoveredName(id, name),
    })
    connections.set(id, connection)
    connection.start()
  }

  function closeConnection(id: string, { dispose = false } = {}): void {
    const connection = connections.get(id)
    if (!connection) return
    if (dispose) {
      connection.dispose()
      connections.delete(id)
      return
    }
    connection.stop()
  }

  function clearGrace(id: string): void {
    const timer = graceTimers.get(id)
    if (timer === undefined) return
    clearTimeout(timer)
    graceTimers.delete(id)
  }

  /**
   * Reconciles what is connected against what should be: the page is active,
   * the column is on screen, and the printer is not the one already driven.
   * Called from every input that can change any of those, so there is one
   * decision rather than one per caller.
   */
  function syncConnections(): void {
    const wanted = new Set<string>()
    if (active.value) {
      for (const entry of printers.entries) {
        if (entry.id === printers.activeId) continue
        if (visibleIds.value.has(entry.id)) wanted.add(entry.id)
      }
    }

    for (const id of wanted) {
      clearGrace(id)
      openConnection(id)
    }

    for (const id of [...connections.keys()]) {
      if (wanted.has(id)) continue
      // The page going away closes everything at once; a single column
      // scrolling off waits out its grace, so a scroll past costs nothing.
      if (!active.value || !printers.entries.some((entry) => entry.id === id)) {
        clearGrace(id)
        closeConnection(id, { dispose: true })
        continue
      }
      if (graceTimers.has(id)) continue
      graceTimers.set(
        id,
        setTimeout(() => {
          graceTimers.delete(id)
          if (!visibleIds.value.has(id) || !active.value) closeConnection(id)
        }, farmVisibilityGraceMs),
      )
    }
  }

  function setVisible(id: string, visible: boolean): void {
    const next = new Set(visibleIds.value)
    if (visible) next.add(id)
    else next.delete(id)
    visibleIds.value = next
    syncConnections()
  }

  /**
   * The page is on screen. Started from the view's `onMounted` and from the
   * document becoming visible again; `deactivate` is the other half.
   */
  function activate(): void {
    if (active.value) return
    active.value = true
    // The active printer's column reads these, and nothing else on this route
    // would have started them.
    webcams.start()
    jobQueue.start()
    spool.start()
    stopWatch ??= watch(
      () => [
        printers.entries.map((entry) => `${entry.id}:${entry.endpoint}`).join('|'),
        printers.activeId,
      ],
      () => syncConnections(),
    )
    syncConnections()
  }

  function deactivate(): void {
    if (!active.value) return
    active.value = false
    for (const id of [...graceTimers.keys()]) clearGrace(id)
    for (const id of [...connections.keys()]) closeConnection(id, { dispose: true })
    stopWatch?.()
    stopWatch = null
    webcams.stop()
    jobQueue.stop()
    spool.stop()
  }

  function retry(id: string): void {
    const connection = connections.get(id)
    if (connection) {
      connection.retry()
      return
    }
    if (id === printers.activeId) moonraker.reconnect()
    else openConnection(id)
  }

  const isPending = (id: string, command: string): boolean =>
    pendingCommands.value.has(`${id}:${command}`)

  function markPending(key: string, pending: boolean): void {
    const next = new Set(pendingCommands.value)
    if (pending) next.add(key)
    else next.delete(key)
    pendingCommands.value = next
  }

  /**
   * Sends one command to one printer, whether it is the active one or a farm
   * connection. Failures are surfaced with the printer's name and never
   * retried: on a rail of near-identical columns, a toast that does not say
   * which machine refused is worse than none.
   */
  async function run(
    id: string,
    command: string,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<boolean> {
    const key = `${id}:${command}`
    if (pendingCommands.value.has(key)) return false
    markPending(key, true)
    try {
      if (id === printers.activeId) await moonraker.rpcCallRaw(method, params)
      else {
        const connection = connections.get(id)
        if (!connection) return false
        await connection.call(method, params)
      }
      return true
    } catch {
      const entry = printers.entries.find((candidate) => candidate.id === id)
      toasts.push(
        i18n.global.t('farm.commandFailed', {
          printer: entry ? printerDisplayLabel(entry) : id,
        }),
      )
      return false
    } finally {
      markPending(key, false)
    }
  }

  const pause = (id: string) => run(id, 'pause', 'printer.print.pause')
  const resume = (id: string) => run(id, 'resume', 'printer.print.resume')
  const cancel = (id: string) => run(id, 'cancel', 'printer.print.cancel')
  const emergencyStop = (id: string) => run(id, 'emergencyStop', 'printer.emergency_stop')
  const cooldown = (id: string) =>
    run(id, 'cooldown', 'printer.gcode.script', { script: 'TURN_OFF_HEATERS' })
  /**
   * `G28`, or `G28 X` for one axis — a native Klipper command on every machine,
   * which is what lets a homing control exist on a page that deliberately
   * discovers nothing about the printer's configuration.
   *
   * The column is responsible for refusing this while a job is loaded; the
   * reasoning is the Movement card's and is repeated there.
   */
  function home(id: string, axes = ''): Promise<boolean> {
    const requested = axes.trim().toUpperCase()
    const script = requested === '' ? 'G28' : `G28 ${requested.split('').join(' ')}`
    return run(id, 'home', 'printer.gcode.script', { script })
  }

  const holdQueue = (id: string) => run(id, 'queue', 'server.job_queue.pause')
  const startQueue = (id: string) => run(id, 'queue', 'server.job_queue.start')

  /** Deletes the head of the queue — the job the machine would start next. */
  function removeNextJob(id: string): Promise<boolean> {
    const next = snapshotFor(id).queue?.jobs[0] ?? activeSnapshot.value.queue?.jobs[0]
    const jobId =
      id === printers.activeId
        ? (activeSnapshot.value.queue?.jobs[0]?.jobId ?? null)
        : (next?.jobId ?? null)
    if (jobId === null) return Promise.resolve(false)
    return run(id, 'removeNext', 'server.job_queue.delete_job', { job_ids: [jobId] })
  }

  /**
   * One printer's printable files, newest first.
   *
   * Read on demand rather than subscribed: a file list is not something a farm
   * column shows, it is something a dialog asks for when somebody opens it, and
   * carrying every printer's directory listing in a snapshot would be a
   * per-column cost paid for a per-click need.
   *
   * Returns `null` when the printer cannot answer at all, which the dialog
   * shows as its own empty state — distinct from a printer with no files, the
   * way `dialog-system.md`'s Shape 4 requires.
   */
  async function listFiles(id: string): Promise<MoonrakerFileInfo[] | null> {
    try {
      const result =
        id === printers.activeId
          ? await moonraker.rpcCall('server.files.list', { root: 'gcodes' })
          : ((await connections.get(id)?.call<MoonrakerFileInfo[]>('server.files.list', {
              root: 'gcodes',
            })) ?? null)
      if (result === null) return null
      return [...result]
        .filter((file) => isPrintableGcodeFilename(file.path))
        .sort((left, right) => right.modified - left.modified)
    } catch {
      return null
    }
  }

  /** Puts a file at the back of that printer's queue. */
  function queueFile(id: string, path: string): Promise<boolean> {
    return run(id, 'queueFile', 'server.job_queue.post_job', { filenames: [path] })
  }

  /** Starts a file now. Only ever offered on a machine with nothing loaded. */
  function startPrint(id: string, path: string): Promise<boolean> {
    return run(id, 'startPrint', 'printer.print.start', { filename: path })
  }

  function togglePower(id: string): Promise<boolean> {
    const device = snapshotFor(id).power
    if (!device) return Promise.resolve(false)
    return run(id, 'power', 'machine.device_power.post_device', {
      device: device.device,
      action: device.on ? 'off' : 'on',
    })
  }

  return {
    columns,
    activeSnapshot,
    active,
    visibleIds,
    pendingCommands,
    isPending,
    snapshotFor,
    connectionFor,
    activate,
    deactivate,
    setVisible,
    retry,
    pause,
    resume,
    cancel,
    emergencyStop,
    cooldown,
    home,
    holdQueue,
    startQueue,
    removeNextJob,
    listFiles,
    queueFile,
    startPrint,
    togglePower,
  }
})
