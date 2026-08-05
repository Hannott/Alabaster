import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAvailabilityStore } from '@/stores/availability'
import { endstopPollIntervalMs, useEndstopsStore } from '@/stores/endstops'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'

function makeKlipperReady() {
  const availability = useAvailabilityStore()
  availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
  availability.printerSnapshotSynchronized()
}

describe('endstops store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useFakeTimers()
    setActivePinia(createPinia())
    makeKlipperReady()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads each endstop and sorts them by name', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({
      z: 'open',
      x: 'TRIGGERED',
      y: 'open',
    } as never)
    const endstops = useEndstopsStore()

    await endstops.refresh()

    expect(endstops.readings).toEqual([
      { name: 'x', state: 'triggered' },
      { name: 'y', state: 'open' },
      { name: 'z', state: 'open' },
    ])
  })

  it('reports an unrecognised answer as unknown rather than guessing', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({ x: 'weird', y: 42 } as never)
    const endstops = useEndstopsStore()

    await endstops.refresh()

    expect(endstops.readings).toEqual([
      { name: 'x', state: 'unknown' },
      { name: 'y', state: 'unknown' },
    ])
  })

  /**
   * A refused query says nothing about where the endstops actually are, so the
   * last reading stays on screen instead of the panel blanking.
   */
  it('keeps the last reading when a query fails', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({ x: 'open' } as never)
    const endstops = useEndstopsStore()
    await endstops.refresh()

    rpcCall.mockRejectedValueOnce(new Error('busy'))
    await expect(endstops.refresh()).resolves.toBe(false)

    expect(endstops.failed).toBe(true)
    expect(endstops.readings).toEqual([{ name: 'x', state: 'open' }])
  })

  it('polls while the printer is idle, since nothing notifies these', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({ x: 'open' } as never)
    const endstops = useEndstopsStore()

    endstops.start()
    expect(rpcCall).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(endstopPollIntervalMs * 2)
    expect(rpcCall.mock.calls.length).toBeGreaterThanOrEqual(3)

    endstops.stop()
  })

  /**
   * Klipper answers this query by asking the MCUs, which competes with the motion
   * queue. A reading nobody is watching is not worth that, so the poll stops and
   * what is on screen is marked stale instead.
   */
  it('stops polling while a print runs and marks the reading stale', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({ x: 'open' } as never)
    const printer = usePrinterStore()
    const endstops = useEndstopsStore()

    endstops.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(endstops.isStale).toBe(false)

    // Driven through the real state rather than a stubbed getter: a spy replaces
    // the computed with a plain function, so the watcher never sees it change and
    // the test would pass against a store that had stopped watching entirely.
    printer.printStats.state = 'printing'
    await vi.advanceTimersByTimeAsync(0)
    const callsWhenPrintStarted = rpcCall.mock.calls.length

    await vi.advanceTimersByTimeAsync(endstopPollIntervalMs * 3)

    expect(rpcCall.mock.calls.length).toBe(callsWhenPrintStarted)
    expect(endstops.isStale).toBe(true)
    expect(endstops.readings).toEqual([{ name: 'x', state: 'open' }])

    endstops.stop()
  })

  /**
   * The defect this guards, which is what turned a real MCU shutdown into a
   * flood of near-identical errors: `query_endstops.status` can hang for a long
   * time when the MCU is unresponsive, and without this guard the poll interval
   * kept firing every two seconds regardless, queuing another request on top of
   * the one still waiting. The backlog then drained in a burst the moment the
   * connection freed up.
   */
  it('never starts a second query while one is still outstanding', async () => {
    const moonraker = useMoonrakerStore()
    let resolveFirst: ((value: Record<string, string>) => void) | undefined
    const rpcCall = vi
      .spyOn(moonraker, 'rpcCall')
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)) as never)
    const endstops = useEndstopsStore()

    // start() fires the first query immediately and leaves it hanging.
    endstops.start()
    expect(endstops.isLoading).toBe(true)

    // Every tick of the poll interval while that first request is still
    // outstanding — the exact shape of a printer fault that leaves the query
    // unanswered for a long time.
    await vi.advanceTimersByTimeAsync(endstopPollIntervalMs * 3)
    expect(rpcCall).toHaveBeenCalledTimes(1)

    resolveFirst?.({ x: 'open' })
    await vi.advanceTimersByTimeAsync(0)
    expect(endstops.isLoading).toBe(false)

    // Once the hang clears, the next tick is free to ask again.
    await vi.advanceTimersByTimeAsync(endstopPollIntervalMs)
    expect(rpcCall).toHaveBeenCalledTimes(2)

    endstops.stop()
  })

  it('asks nothing at all while Klipper is not ready', async () => {
    setActivePinia(createPinia())
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall')
    const endstops = useEndstopsStore()

    endstops.start()
    await expect(endstops.refresh()).resolves.toBe(false)

    expect(rpcCall).not.toHaveBeenCalled()
    endstops.stop()
  })

  it('stops polling when the page that started it goes away', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({ x: 'open' } as never)
    const endstops = useEndstopsStore()

    endstops.start()
    endstops.stop()
    const callsAtStop = rpcCall.mock.calls.length

    await vi.advanceTimersByTimeAsync(endstopPollIntervalMs * 3)

    expect(rpcCall.mock.calls.length).toBe(callsAtStop)
  })
})
