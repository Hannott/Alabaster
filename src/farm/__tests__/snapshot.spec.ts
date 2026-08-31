import { describe, expect, it } from 'vitest'

import {
  farmObjectSelection,
  readHeater,
  readJob,
  readProgress,
  readQueue,
  readRemainingSeconds,
  toPrintState,
} from '@/farm/snapshot'

describe('the farm subscription', () => {
  /*
   * The measured reason this is a field list and not `{object: null}`: whole
   * objects cost 32 399 bytes of status updates against 7 947 over the same
   * idle 20 seconds, almost all of it a Kalico extruder's `control_stats`
   * block re-sent on every temperature tick. A future edit that "simplifies"
   * this to null selections would quadruple the rail's traffic silently.
   */
  it('names fields rather than subscribing to whole objects', () => {
    for (const [object, fields] of Object.entries(farmObjectSelection)) {
      expect(fields, object).not.toBeNull()
      expect(Array.isArray(fields), object).toBe(true)
    }
  })

  /*
   * `toolhead` is one field — `homed_axes` — and it is there for the homing
   * row. A control that homes a machine without knowing whether it is homed is
   * a control that lies, and `G28 Z` is not one to offer blind.
   */
  it('asks for nothing the column does not render', () => {
    expect(Object.keys(farmObjectSelection).sort()).toEqual([
      'display_status',
      'extruder',
      'heater_bed',
      'print_stats',
      'toolhead',
      'virtual_sdcard',
      'webhooks',
    ])
  })
})

describe('reading a farm snapshot', () => {
  it('merges a heater delta over what was already known', () => {
    const previous = { temperature: 200, target: 220 }
    // Moonraker sends only what changed; replacing wholesale would blank the
    // target every time the actual temperature ticked.
    expect(readHeater({ temperature: 201 }, previous)).toEqual({ temperature: 201, target: 220 })
  })

  it('keeps an unknown print state out of the state machine', () => {
    expect(toPrintState('printing')).toBe('printing')
    expect(toPrintState('something-new')).toBe('unknown')
    expect(toPrintState(undefined)).toBe('unknown')
  })

  it('prefers the slicer progress and falls back to the file position', () => {
    expect(readProgress({ progress: 0.5 }, { progress: 0.9 })).toBe(0.5)
    expect(readProgress({ progress: 0 }, { progress: 0.9 })).toBe(0.9)
    expect(readProgress(null, null)).toBeNull()
  })

  it('clamps a progress value a printer reports out of range', () => {
    expect(readProgress({ progress: 1.4 }, null)).toBe(1)
  })

  it('uses the slicer estimate before extrapolating from elapsed time', () => {
    expect(readRemainingSeconds(600, 0.5, 1800)).toBe(1200)
    expect(readRemainingSeconds(600, 0.5, null)).toBe(600)
    expect(readRemainingSeconds(600, 0, null)).toBeNull()
  })

  it('keeps the last job after a print ends rather than blanking the column', () => {
    const job = readJob({
      printStats: { filename: 'bracket.gcode', state: 'complete', print_duration: 2506 },
      displayStatus: { progress: 1 },
      virtualSdcard: { progress: 1 },
      slicerEstimateSeconds: null,
      metadataLayerCount: 201,
      thumbnailUrl: null,
    })
    expect(job?.filename).toBe('bracket.gcode')
    expect(job?.totalLayer).toBe(201)
  })

  it('has no job at all for a printer that has never loaded a file', () => {
    expect(
      readJob({
        printStats: { filename: '', state: 'standby' },
        displayStatus: null,
        virtualSdcard: null,
        slicerEstimateSeconds: null,
        metadataLayerCount: null,
        thumbnailUrl: null,
      }),
    ).toBeNull()
  })

  it('reads the queue in the order the machine will run it', () => {
    const queue = readQueue({
      queue_state: 'ready',
      queued_jobs: [
        { filename: 'first.gcode', job_id: '0001' },
        { filename: 'second.gcode', job_id: '0002' },
        { filename: '', job_id: '0003' },
      ],
    })
    expect(queue?.jobs.map((job) => job.filename)).toEqual(['first.gcode', 'second.gcode'])
    expect(queue?.jobs[0]?.jobId).toBe('0001')
  })

  /*
   * Measured against the workshop printer: an idle machine answers
   * `{queue_state: "paused", queued_jobs: []}` with nothing wrong. A column
   * that renders that as "held" invents an alarm on every idle printer in the
   * rail.
   */
  it('reports a paused, empty queue as paused with nothing in it', () => {
    const queue = readQueue({ queue_state: 'paused', queued_jobs: [] })
    expect(queue).toEqual({ state: 'paused', jobs: [] })
  })

  /*
   * The status result and the change notification spell the same list
   * differently. Reading only `queued_jobs` meant every queue change emptied
   * the card: the notification parsed cleanly and reported nothing queued to a
   * machine that had just gained a job.
   */
  it('reads the change notification list as well as the status result list', () => {
    const queue = readQueue({
      action: 'jobs_added',
      queue_state: 'ready',
      updated_queue: [{ filename: 'benchy.gcode', job_id: '000A' }],
    })
    expect(queue?.jobs.map((job) => job.filename)).toEqual(['benchy.gcode'])
  })

  it('answers null for a printer whose Moonraker has no queue', () => {
    expect(readQueue(undefined)).toBeNull()
  })
})
