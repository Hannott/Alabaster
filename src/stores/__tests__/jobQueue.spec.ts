import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { JsonRpcNotification, NotificationHandler } from '@/services/moonraker'
import { normalizeQueuedJobs, useJobQueueStore } from '@/stores/jobQueue'
import { useMoonrakerStore } from '@/stores/moonraker'

describe('queued job normalization', () => {
  it('keeps jobs that can be acted on and drops incomplete entries', () => {
    expect(
      normalizeQueuedJobs([
        { filename: 'cube.gcode', job_id: '000001', time_added: 5, time_in_queue: 2 },
        { filename: 'no-id.gcode' },
        { job_id: '000002' },
        'nonsense',
      ]),
    ).toEqual([{ filename: 'cube.gcode', job_id: '000001', time_added: 5, time_in_queue: 2 }])
  })
})

describe('job queue store', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('reads the queue and follows queue notifications', async () => {
    const moonraker = useMoonrakerStore()
    let queueHandler: NotificationHandler | undefined
    vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
      if (method === 'notify_job_queue_changed') queueHandler = handler
      return () => undefined
    })
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({
      queued_jobs: [{ filename: 'cube.gcode', job_id: '000001', time_added: 1, time_in_queue: 0 }],
      queue_state: 'paused',
    } as never)

    const jobQueue = useJobQueueStore()
    jobQueue.start()
    await jobQueue.refresh()

    expect(jobQueue.jobs).toHaveLength(1)
    expect(jobQueue.isPaused).toBe(true)

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method: 'notify_job_queue_changed',
      params: [{ action: 'jobs_added', updated_queue: [], queue_state: 'ready' }],
    }
    queueHandler?.(notification)

    expect(jobQueue.jobs).toEqual([])
    expect(jobQueue.isPaused).toBe(false)
  })

  it('applies the status a mutating command returns and reports failures', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'onNotification').mockImplementation(() => () => undefined)
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({
      queued_jobs: [],
      queue_state: 'ready',
    } as never)

    const jobQueue = useJobQueueStore()
    expect(await jobQueue.removeJob('000001')).toBe(true)
    expect(rpcCall).toHaveBeenCalledWith('server.job_queue.delete_job', { job_ids: ['000001'] })
    expect(jobQueue.queueState).toBe('ready')

    expect(await jobQueue.removeJob('  ')).toBe(false)

    rpcCall.mockRejectedValueOnce(new Error('moonraker refused'))
    expect(await jobQueue.clearQueue()).toBe(false)
    expect(jobQueue.lastCommandError).toBe('clear')

    jobQueue.clearCommandError()
    expect(jobQueue.lastCommandError).toBeNull()
  })

  it('enqueues the file Print files is looking at', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'onNotification').mockImplementation(() => () => undefined)
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({
      queued_jobs: [{ filename: 'cube.gcode', job_id: '000001', time_added: 1, time_in_queue: 0 }],
      queue_state: 'ready',
    } as never)

    const jobQueue = useJobQueueStore()
    expect(await jobQueue.addJob('cube.gcode')).toBe(true)
    expect(rpcCall).toHaveBeenCalledWith('server.job_queue.post_job', {
      filenames: ['cube.gcode'],
    })
    expect(jobQueue.jobs).toHaveLength(1)

    expect(await jobQueue.addJob('  ')).toBe(false)

    rpcCall.mockRejectedValueOnce(new Error('moonraker refused'))
    expect(await jobQueue.addJob('cube.gcode')).toBe(false)
    expect(jobQueue.lastCommandError).toBe('add')
  })
})
