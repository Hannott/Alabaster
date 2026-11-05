import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAvailabilityStore } from '@/stores/availability'
import { useMachineFilesStore, type ConfigExportProgress } from '@/stores/machineFiles'
import { useMoonrakerStore } from '@/stores/moonraker'

const listed = [
  { path: 'printer.cfg', modified: 1, size: 10, permissions: 'rw' },
  { path: 'macros/homing.cfg', modified: 2, size: 10, permissions: 'rw' },
  { path: 'moonraker.conf', modified: 3, size: 10, permissions: 'rw' },
]

const listedWithExtras = [
  ...listed,
  { path: 'adxl_results/plot.html', modified: 4, size: 900000, permissions: 'rw' },
  { path: '.moonraker.conf.bkp', modified: 5, size: 10, permissions: 'rw' },
  { path: 'printer-20260101_120000.cfg', modified: 6, size: 10, permissions: 'rw' },
]

function connect(files = listed) {
  useAvailabilityStore().moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
  const moonraker = useMoonrakerStore()
  vi.spyOn(moonraker, 'rpcCall').mockImplementation(((method: string) =>
    Promise.resolve(method === 'server.files.list' ? files : [])) as never)
}

describe('configuration export progress', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  /**
   * The dialog can only show a count the store actually produces, so the
   * sequence is asserted from the store's side: one `reading` step per file,
   * in listing order, before a single `packing` and a `handoff` that is still
   * current when the archive is handed over.
   */
  it('reports each file as it is read, then packing, then the hand-off', async () => {
    connect()
    const machineFiles = useMachineFilesStore()
    const seen: ConfigExportProgress[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(() => {
        if (machineFiles.exportProgress) seen.push({ ...machineFiles.exportProgress })
        return Promise.resolve(new Response('[x]\n'))
      }),
    )
    const deliver = vi.fn<(archive: Blob) => void>(() => {
      if (machineFiles.exportProgress) seen.push({ ...machineFiles.exportProgress })
    })

    const started = machineFiles.exportConfigArchive(deliver, 'all')
    expect(machineFiles.exportProgress).toEqual({ scope: 'all', phase: 'listing' })
    await expect(started).resolves.toBe(true)

    expect(seen).toEqual([
      { scope: 'all', phase: 'reading', read: 0, total: 3, path: 'printer.cfg' },
      { scope: 'all', phase: 'reading', read: 1, total: 3, path: 'macros/homing.cfg' },
      { scope: 'all', phase: 'reading', read: 2, total: 3, path: 'moonraker.conf' },
      { scope: 'all', phase: 'handoff', total: 3 },
    ])
    expect(deliver).toHaveBeenCalledTimes(1)
    expect(deliver.mock.calls[0]?.[0]?.type).toBe('application/zip')
    expect(machineFiles.exportProgress).toBeNull()
    expect(machineFiles.isMutating).toBe(false)
    expect(machineFiles.lastError).toBeNull()
  })

  /**
   * The `config` scope is decided by extension alone: a plot or a backup
   * beside the configuration is left out, and the total the dialog counts
   * against is the filtered one, so the bar fills to the end.
   */
  it('reads only .cfg and .conf files in the config scope, with a matching total', async () => {
    connect(listedWithExtras)
    const machineFiles = useMachineFilesStore()
    const requested: string[] = []
    const totals = new Set<number>()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation((input) => {
        requested.push(String(input))
        const progress = machineFiles.exportProgress
        if (progress?.phase === 'reading') totals.add(progress.total)
        return Promise.resolve(new Response('[x]\n'))
      }),
    )

    await expect(machineFiles.exportConfigArchive(() => undefined, 'config')).resolves.toBe(true)

    expect(requested.map((url) => url.split('/config/')[1]?.split('?')[0])).toEqual([
      'printer.cfg',
      'macros/homing.cfg',
      'moonraker.conf',
      'printer-20260101_120000.cfg',
    ])
    expect([...totals]).toEqual([4])
  })

  /** All or nothing: a backup missing a file it appears to contain is worse than none. */
  it('delivers nothing and reports the export error when one read fails', async () => {
    connect()
    const machineFiles = useMachineFilesStore()
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response('[x]\n'))
        .mockResolvedValueOnce(new Response(null, { status: 500 })),
    )
    const deliver = vi.fn()

    await expect(machineFiles.exportConfigArchive(deliver)).resolves.toBe(false)

    expect(deliver).not.toHaveBeenCalled()
    expect(machineFiles.lastError).toBe('export')
    expect(machineFiles.exportProgress).toBeNull()
    expect(machineFiles.isMutating).toBe(false)
  })

  /**
   * Cancel stops the export rather than hiding the dialog over one that keeps
   * running: the read in flight is aborted, no further file is requested, and
   * — as with a cancelled upload — nothing is reported as a failure.
   */
  it('abandons the read in flight on cancel and reports no error', async () => {
    connect()
    const machineFiles = useMachineFilesStore()
    let abortSignal: AbortSignal | undefined
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      abortSignal = init?.signal ?? undefined
      return new Promise((resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        )
        if (fetchMock.mock.calls.length === 1) return
        resolve(new Response('[x]\n'))
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const deliver = vi.fn()

    const started = machineFiles.exportConfigArchive(deliver)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(machineFiles.exportProgress).toEqual({
      scope: 'all',
      phase: 'reading',
      read: 0,
      total: 3,
      path: 'printer.cfg',
    })

    machineFiles.cancelExport()
    await expect(started).resolves.toBe(false)

    expect(abortSignal?.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(deliver).not.toHaveBeenCalled()
    expect(machineFiles.lastError).toBeNull()
    expect(machineFiles.exportProgress).toBeNull()
    expect(machineFiles.isMutating).toBe(false)
  })

  it('does not start while another mutation is running', async () => {
    connect()
    const machineFiles = useMachineFilesStore()
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => undefined))
    vi.stubGlobal('fetch', fetchMock)

    void machineFiles.exportConfigArchive(() => undefined)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await expect(machineFiles.exportConfigArchive(() => undefined)).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    machineFiles.cancelExport()
  })
})
