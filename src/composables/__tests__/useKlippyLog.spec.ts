import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'

import {
  KLIPPY_LOG_CHUNK,
  KLIPPY_LOG_POLL_MS,
  useKlippyLog,
  useKlippyLogRuns,
} from '@/composables/useKlippyLog'
import { useMoonrakerStore } from '@/stores/moonraker'

const encoder = new TextEncoder()

/** A Moonraker that serves `file` and honours `bytes=N-` and `bytes=N-M`. */
function serve(file: { bytes: Uint8Array<ArrayBuffer> }) {
  const ranges: string[] = []
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
    const range = new Headers(init?.headers).get('Range') ?? ''
    ranges.push(range)
    const match = /^bytes=(\d+)-(\d*)$/.exec(range)
    if (!match) return new Response(file.bytes, { status: 200 })
    const start = Number(match[1])
    const end = match[2] ? Number(match[2]) + 1 : file.bytes.length
    if (start >= file.bytes.length) return new Response(null, { status: 416 })
    return new Response(file.bytes.slice(start, end), { status: 206 })
  })
  vi.stubGlobal('fetch', fetcher)
  return ranges
}

/** A log of `runs` starts, padded with Stats lines to past `minimumBytes`. */
function log(runs: number, minimumBytes = 0): string {
  const lines: string[] = []
  for (let run = 0; run < runs; run += 1) {
    lines.push(`Start printer at Sun Nov  1 10:0${run}:00 2026 (${1000 + run * 100} ${50 + run})`)
    lines.push(`run ${run} ready`)
  }
  const head = lines.slice(0, -2)
  const tail = lines.slice(-2)
  const filler: string[] = []
  let size = lines.join('\n').length
  let tick = 0
  while (size < minimumBytes) {
    const stats = `Stats ${tick}.0: gcodein=0 mcu: mcu_awake=0.000 mcu_task_avg=0.000000`
    filler.push(stats)
    size += stats.length + 1
    tick += 1
  }
  return [...head, ...filler, ...tail].join('\n') + '\n'
}

beforeEach(() => {
  vi.restoreAllMocks()
  setActivePinia(createPinia())
  useMoonrakerStore().endpoint = 'ws://printer.test:7125/websocket'
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useKlippyLog', () => {
  it('reads the end first, then walks back to the start of the file', async () => {
    const file = { bytes: encoder.encode(log(3, KLIPPY_LOG_CHUNK * 2.5)) }
    const ranges = serve(file)
    const scope = effectScope()
    const reader = scope.run(() =>
      useKlippyLogRuns(() => ({ root: 'logs', path: 'klippy.log', size: file.bytes.length })),
    )!
    await flushPromises()

    expect(ranges[0]).toBe(`bytes=${file.bytes.length - KLIPPY_LOG_CHUNK}-`)
    expect(ranges.every((range) => /^bytes=\d+-\d*$/.test(range))).toBe(true)
    expect(reader.fromFileStart.value).toBe(true)
    expect(reader.runs.value).toHaveLength(3)
    expect(reader.selectedRun.value?.outcome).toEqual({ type: 'running' })
    scope.stop()
  })

  /** Moonraker sends no notification for a growing log, so its end is read again on a timer. */
  it('follows the log as Klipper writes to it', async () => {
    vi.useFakeTimers()
    const file = { bytes: encoder.encode(log(1)) }
    serve(file)
    const scope = effectScope()
    const reader = scope.run(() =>
      useKlippyLog(() => ({ root: 'logs', path: 'klippy.log', size: file.bytes.length })),
    )!
    await flushPromises()
    expect(reader.window.value?.lines.at(-1)).toBe('run 0 ready')

    file.bytes = encoder.encode(log(1) + 'Heater extruder within range of 220.000\n')
    await vi.advanceTimersByTimeAsync(KLIPPY_LOG_POLL_MS)

    expect(reader.window.value?.lines.at(-1)).toBe('Heater extruder within range of 220.000')
    scope.stop()
  })

  it('reads the replacement file after a rollover', async () => {
    vi.useFakeTimers()
    const file = { bytes: encoder.encode(log(2)) }
    serve(file)
    const scope = effectScope()
    const reader = scope.run(() =>
      useKlippyLog(() => ({ root: 'logs', path: 'klippy.log', size: file.bytes.length })),
    )!
    await flushPromises()

    file.bytes = encoder.encode('new\n')
    await vi.advanceTimersByTimeAsync(KLIPPY_LOG_POLL_MS * 6)
    await flushPromises()

    expect(reader.window.value?.lines).toEqual(['new'])
    scope.stop()
  })

  it('keeps the rows it has while the printer cannot be reached', async () => {
    const file = { bytes: encoder.encode(log(1)) }
    serve(file)
    const reachable = ref(true)
    const scope = effectScope()
    const reader = scope.run(() =>
      useKlippyLog(() =>
        reachable.value ? { root: 'logs', path: 'klippy.log', size: file.bytes.length } : null,
      ),
    )!
    await flushPromises()

    reachable.value = false
    await flushPromises()

    expect(reader.window.value?.lines).toContain('run 0 ready')
    scope.stop()
  })
})
