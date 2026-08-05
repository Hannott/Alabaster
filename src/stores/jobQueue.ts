import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import type {
  JobQueueState,
  JsonRpcNotification,
  MoonrakerJobQueueStatus,
  MoonrakerQueuedJob,
} from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { createCommandRunner } from '@/stores/commandRunner'
import { createGuardedLoad } from '@/stores/guardedLoad'
import { useMoonrakerStore } from '@/stores/moonraker'
import { isRecord } from '@/utils/records'

export const jobQueueCommandKeys = ['pause', 'start', 'remove', 'clear', 'add'] as const

export type JobQueueCommandKey = (typeof jobQueueCommandKeys)[number]

function isJobQueueState(value: unknown): value is JobQueueState {
  return value === 'ready' || value === 'loading' || value === 'starting' || value === 'paused'
}

export function normalizeQueuedJobs(value: unknown): MoonrakerQueuedJob[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return []
    const filename = typeof candidate.filename === 'string' ? candidate.filename : ''
    const jobId = typeof candidate.job_id === 'string' ? candidate.job_id : ''
    if (filename === '' || jobId === '') return []
    return [
      {
        filename,
        job_id: jobId,
        time_added: typeof candidate.time_added === 'number' ? candidate.time_added : 0,
        time_in_queue: typeof candidate.time_in_queue === 'number' ? candidate.time_in_queue : 0,
      },
    ]
  })
}

export const useJobQueueStore = defineStore('jobQueue', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()
  const jobs = ref<MoonrakerQueuedJob[]>([])
  const queueState = ref<JobQueueState>('ready')
  const isLoading = ref(false)
  const failed = ref(false)
  const commands = createCommandRunner<JobQueueCommandKey>(jobQueueCommandKeys)
  const { pendingCommands, lastCommandError, lastCommandErrorMessage } = commands
  const disposers: Array<() => void> = []
  let stopAvailabilityWatch: WatchStopHandle | null = null
  let started = false
  const load = createGuardedLoad({ isLoading, failed })

  const isPaused = computed(() => queueState.value === 'paused')

  function applyStatus(status: MoonrakerJobQueueStatus | Record<string, unknown>): void {
    jobs.value = normalizeQueuedJobs((status as Record<string, unknown>).queued_jobs)
    const state = (status as Record<string, unknown>).queue_state
    if (isJobQueueState(state)) queueState.value = state
  }

  function handleQueueChanged(notification: JsonRpcNotification): void {
    const payload = notification.params[0]
    if (!isRecord(payload)) return
    jobs.value = normalizeQueuedJobs(payload.updated_queue ?? payload.queued_jobs)
    if (isJobQueueState(payload.queue_state)) queueState.value = payload.queue_state
  }

  function runCommand(
    key: JobQueueCommandKey,
    command: () => Promise<MoonrakerJobQueueStatus>,
  ): Promise<boolean> {
    return commands.run(key, async () => applyStatus(await command()))
  }

  async function refresh(): Promise<void> {
    await load.run(
      () => moonraker.rpcCall('server.job_queue.status'),
      (status) => applyStatus(status),
    )
  }

  function pauseQueue(): Promise<boolean> {
    return runCommand('pause', () => moonraker.rpcCall('server.job_queue.pause'))
  }

  function startQueue(): Promise<boolean> {
    return runCommand('start', () => moonraker.rpcCall('server.job_queue.start'))
  }

  function removeJob(jobId: string): Promise<boolean> {
    if (jobId.trim() === '') return Promise.resolve(false)
    return runCommand('remove', () =>
      moonraker.rpcCall('server.job_queue.delete_job', { job_ids: [jobId] }),
    )
  }

  function clearQueue(): Promise<boolean> {
    return runCommand('clear', () =>
      moonraker.rpcCall('server.job_queue.delete_job', { all: true }),
    )
  }

  /**
   * Enqueuing is something done while looking at the file being enqueued
   * (`docs/design/navigation-plan.md`), so the caller is Print files, not this
   * card — the card stays the glance and management surface: pause, start,
   * reorder by removing and re-adding, clear.
   */
  function addJob(path: string): Promise<boolean> {
    const filename = path.trim()
    if (filename === '') return Promise.resolve(false)
    return runCommand('add', () =>
      moonraker.rpcCall('server.job_queue.post_job', { filenames: [filename] }),
    )
  }

  const clearCommandError = commands.clearCommandError

  /**
   * The queue lives on the machine at the other end of the socket, so its
   * jobs, its paused/ready state, and any command still pending against it
   * all go when the connection is retargeted.
   */
  function printerChanged(): void {
    load.invalidate()
    jobs.value = []
    queueState.value = 'ready'
    commands.reset()
    failed.value = false
  }

  function start(): void {
    if (started) return
    started = true
    disposers.push(
      moonraker.onPrinterChange(printerChanged),
      moonraker.onNotification('notify_job_queue_changed', handleQueueChanged),
    )
    stopAvailabilityWatch = watch(
      () => availability.isMoonrakerConnected,
      (isConnected) => {
        if (isConnected) void refresh()
      },
      { immediate: true },
    )
  }

  function stop(): void {
    if (!started) return
    started = false
    load.invalidate()
    stopAvailabilityWatch?.()
    stopAvailabilityWatch = null
    while (disposers.length > 0) disposers.pop()?.()
  }

  return {
    jobs,
    queueState,
    isPaused,
    isLoading,
    failed,
    lastCommandError,
    lastCommandErrorMessage,
    pendingCommands,
    refresh,
    pauseQueue,
    startQueue,
    removeJob,
    clearQueue,
    addJob,
    clearCommandError,
    start,
    stop,
  }
})
