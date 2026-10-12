import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NotificationHandler } from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useGcodeFilesStore } from '@/stores/gcodeFiles'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'

function directoryResult(
  dirs: Array<{ dirname: string; modified: number }>,
  files: Array<{ filename: string; modified: number; size: number } & Record<string, unknown>>,
) {
  return {
    dirs: dirs.map((folder) => ({ ...folder, size: 0, permissions: 'rw' })),
    files: files.map((file) => ({ ...file, permissions: 'rw' })),
    disk_usage: { total: 1000, used: 400, free: 600 },
    root_info: { name: 'gcodes', permissions: 'rw' },
  } as never
}

describe('gcode files store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setActivePinia(createPinia())
    const availability = useAvailabilityStore()
    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
  })

  it('reads a directory of the gcodes root and keeps only printable files', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(
      directoryResult(
        [{ dirname: 'calibration', modified: 5 }],
        [
          { filename: 'cube.gcode', modified: 10, size: 2048 },
          { filename: 'benchy.GCO', modified: 20, size: 4096 },
          // Extracted thumbnails and slicer leftovers live in this root too, and
          // offering one as printable would mean offering a print that fails.
          { filename: 'cube.png', modified: 11, size: 64 },
          { filename: 'notes.txt', modified: 12, size: 32 },
        ],
      ),
    )
    const gcodeFiles = useGcodeFilesStore()

    await gcodeFiles.refreshDirectory()

    expect(rpcCall).toHaveBeenCalledWith('server.files.get_directory', {
      path: 'gcodes',
      extended: true,
    })
    expect(gcodeFiles.files.map((file) => file.name)).toEqual(['cube.gcode', 'benchy.GCO'])
    expect(gcodeFiles.folders.map((folder) => folder.name)).toEqual(['calibration'])
    expect(gcodeFiles.diskUsage.free).toBe(600)
  })

  it('asks for the subdirectory and builds breadcrumbs when navigating into one', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi
      .spyOn(moonraker, 'rpcCall')
      .mockResolvedValue(directoryResult([], [{ filename: 'part.gcode', modified: 1, size: 10 }]))
    const gcodeFiles = useGcodeFilesStore()

    await gcodeFiles.navigateTo('calibration/first-layer')

    expect(rpcCall).toHaveBeenLastCalledWith('server.files.get_directory', {
      path: 'gcodes/calibration/first-layer',
      extended: true,
    })
    expect(gcodeFiles.breadcrumbs).toEqual([
      { name: 'calibration', path: 'calibration' },
      { name: 'first-layer', path: 'calibration/first-layer' },
    ])
    expect(gcodeFiles.parentPath).toBe('calibration')
    expect(gcodeFiles.files[0]?.path).toBe('calibration/first-layer/part.gcode')
  })

  it('has no parent at the root, so there is nothing to navigate up to', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(directoryResult([], []))
    const gcodeFiles = useGcodeFilesStore()

    expect(gcodeFiles.parentPath).toBeNull()
    await gcodeFiles.navigateUp()
    expect(gcodeFiles.currentPath).toBe('')
  })

  /**
   * Folder navigation clears the previous rows first, per the motion rules in
   * `interface-standards.md`: rows from the folder you left, sitting under
   * breadcrumbs naming the folder you entered, misreport where you are.
   */
  it('clears the previous folder rows before the destination arrives', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall')
      .mockResolvedValueOnce(
        directoryResult([], [{ filename: 'first.gcode', modified: 1, size: 10 }]),
      )
      .mockImplementationOnce(async () => {
        expect(gcodeFiles.files).toEqual([])
        return directoryResult([], [{ filename: 'second.gcode', modified: 2, size: 20 }])
      })
    const gcodeFiles = useGcodeFilesStore()

    await gcodeFiles.refreshDirectory()
    expect(gcodeFiles.files).toHaveLength(1)

    await gcodeFiles.navigateTo('sub')
    expect(gcodeFiles.files.map((file) => file.name)).toEqual(['second.gcode'])
  })

  it('reports a failed read instead of showing another folder’s rows', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall')
      .mockResolvedValueOnce(directoryResult([], [{ filename: 'a.gcode', modified: 1, size: 1 }]))
      .mockRejectedValueOnce(new Error('restarting'))
    const gcodeFiles = useGcodeFilesStore()

    await gcodeFiles.refreshDirectory()
    await gcodeFiles.refreshDirectory()

    expect(gcodeFiles.failed).toBe(true)
    expect(gcodeFiles.files).toEqual([])
    expect(gcodeFiles.isLoading).toBe(false)
  })

  it('sorts folders ahead of files, each on the chosen key', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(
      directoryResult(
        [
          { dirname: 'zeta', modified: 1 },
          { dirname: 'Alpha', modified: 9 },
        ],
        [
          { filename: 'big.gcode', modified: 1, size: 900 },
          { filename: 'small.gcode', modified: 9, size: 10 },
        ],
      ),
    )
    const gcodeFiles = useGcodeFilesStore()
    await gcodeFiles.refreshDirectory()

    // Newest first is the default, because that is what a print list is for.
    expect(gcodeFiles.sortKey).toBe('modified')
    expect(gcodeFiles.sortedFiles.map((file) => file.name)).toEqual(['small.gcode', 'big.gcode'])

    gcodeFiles.sortBy('name')
    expect(gcodeFiles.sortDirection).toBe('ascending')
    expect(gcodeFiles.sortedFolders.map((folder) => folder.name)).toEqual(['Alpha', 'zeta'])
    expect(gcodeFiles.sortedFiles.map((file) => file.name)).toEqual(['big.gcode', 'small.gcode'])

    gcodeFiles.sortBy('name')
    expect(gcodeFiles.sortDirection).toBe('descending')

    gcodeFiles.sortBy('size')
    expect(gcodeFiles.sortedFiles.map((file) => file.name)).toEqual(['big.gcode', 'small.gcode'])
  })

  it('reads what a row shows from the extended listing, without a request per file', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(
      directoryResult(
        [],
        [
          {
            filename: 'clip.gcode',
            modified: 10,
            size: 2048,
            estimated_time: 3641,
            filament_weight_total: 8.84,
            filament_type: 'PLA;PETG',
            filament_colors: ['#8D6B4B', '#FFFFFF'],
            thumbnails: [
              { width: 32, height: 32, size: 1, relative_path: '.thumbs/clip-32x32.png' },
              { width: 300, height: 300, size: 1, relative_path: '.thumbs/clip-300x300.png' },
            ],
            print_start_time: 1_700_000_000,
            job_id: '0001DC',
          },
          // A colour that is not one would reach a style attribute as written.
          { filename: 'bare.gcode', modified: 5, size: 10, filament_colors: ['red; x'] },
        ],
      ),
    )
    const gcodeFiles = useGcodeFilesStore()

    await gcodeFiles.refreshDirectory()

    expect(rpcCall).toHaveBeenCalledTimes(1)
    expect(gcodeFiles.files[0]?.details).toEqual({
      estimatedTime: 3641,
      filamentWeight: 8.84,
      filamentType: 'PLA',
      filamentColor: '#8D6B4B',
      // The 32 px one is blurry in a 40 px cell on a dense screen.
      thumbnail: '.thumbs/clip-300x300.png',
      lastPrintedAt: 1_700_000_000,
      lastJobId: '0001DC',
    })
    expect(gcodeFiles.files[1]?.details.filamentColor).toBeNull()
    expect(gcodeFiles.files[1]?.details.thumbnail).toBeNull()
  })

  it('hides the slicer thumbnail folder and other dot entries', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(
      directoryResult(
        [
          { dirname: '.thumbs', modified: 1 },
          { dirname: 'parts', modified: 2 },
        ],
        [
          { filename: '.hidden.gcode', modified: 1, size: 1 },
          { filename: 'cube.gcode', modified: 1, size: 1 },
        ],
      ),
    )
    const gcodeFiles = useGcodeFilesStore()

    await gcodeFiles.refreshDirectory()

    expect(gcodeFiles.folders.map((folder) => folder.name)).toEqual(['parts'])
    expect(gcodeFiles.files.map((file) => file.name)).toEqual(['cube.gcode'])
  })

  it('narrows the shown folder by name and forgets the search on navigation', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(
      directoryResult(
        [{ dirname: 'Brackets', modified: 2 }],
        [
          { filename: 'bracket_left.gcode', modified: 1, size: 1 },
          { filename: 'cube.gcode', modified: 1, size: 1 },
        ],
      ),
    )
    const gcodeFiles = useGcodeFilesStore()
    await gcodeFiles.refreshDirectory()

    gcodeFiles.query = '  BRACKET '

    expect(gcodeFiles.visibleFiles.map((file) => file.name)).toEqual(['bracket_left.gcode'])
    expect(gcodeFiles.visibleFolders.map((folder) => folder.name)).toEqual(['Brackets'])

    await gcodeFiles.navigateTo('Brackets')
    expect(gcodeFiles.query).toBe('')
  })

  it('closes the open file when it is chosen again', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(
      directoryResult([], [{ filename: 'cube.gcode', modified: 1, size: 10 }]),
    )
    vi.spyOn(usePrinterStore(), 'loadMetadata').mockResolvedValue(null)
    const gcodeFiles = useGcodeFilesStore()
    await gcodeFiles.refreshDirectory()

    await gcodeFiles.toggle('cube.gcode')
    expect(gcodeFiles.selectedPath).toBe('cube.gcode')

    await gcodeFiles.toggle('cube.gcode')
    expect(gcodeFiles.selectedPath).toBeNull()
  })

  it('asks history how the open file last printed, and only once it is opened', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation((async (method: string) => {
      if (method === 'server.history.get_job') {
        return { job: { job_id: '0001DC', status: 'klippy_shutdown', start_time: 1_700_000_500 } }
      }
      return directoryResult(
        [],
        [{ filename: 'clip.gcode', modified: 1, size: 10, job_id: '0001DC', print_start_time: 1 }],
      )
    }) as never)
    vi.spyOn(usePrinterStore(), 'loadMetadata').mockResolvedValue(null)
    const gcodeFiles = useGcodeFilesStore()
    await gcodeFiles.refreshDirectory()
    expect(rpcCall).not.toHaveBeenCalledWith('server.history.get_job', expect.anything())

    await gcodeFiles.select('clip.gcode')
    await vi.waitFor(() => expect(gcodeFiles.selectedLastPrint).not.toBeNull())

    expect(rpcCall).toHaveBeenCalledWith('server.history.get_job', { uid: '0001DC' })
    expect(gcodeFiles.selectedLastPrint).toEqual({
      startedAt: 1_700_000_500,
      outcome: 'interrupted',
    })
  })

  it('reads slicer metadata for the selected file through the printer store cache', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(
      directoryResult([], [{ filename: 'cube.gcode', modified: 1, size: 10 }]),
    )
    const printer = usePrinterStore()
    const loadMetadata = vi
      .spyOn(printer, 'loadMetadata')
      .mockResolvedValue({ filename: 'cube.gcode', estimated_time: 3600 })
    const gcodeFiles = useGcodeFilesStore()
    await gcodeFiles.refreshDirectory()

    await gcodeFiles.select('cube.gcode')

    expect(loadMetadata).toHaveBeenCalledWith('cube.gcode')
    expect(gcodeFiles.selectedFile?.name).toBe('cube.gcode')
    expect(gcodeFiles.selectedMetadata?.estimated_time).toBe(3600)
    expect(gcodeFiles.isMetadataLoading).toBe(false)
  })

  it('drops the selection when navigating, since it belongs to the folder left behind', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(
      directoryResult([], [{ filename: 'cube.gcode', modified: 1, size: 10 }]),
    )
    const printer = usePrinterStore()
    vi.spyOn(printer, 'loadMetadata').mockResolvedValue({ filename: 'cube.gcode' })
    const gcodeFiles = useGcodeFilesStore()
    await gcodeFiles.refreshDirectory()
    await gcodeFiles.select('cube.gcode')

    await gcodeFiles.navigateTo('sub')

    expect(gcodeFiles.selectedPath).toBeNull()
    expect(gcodeFiles.selectedMetadata).toBeNull()
  })

  it('keeps a file with no slicer metadata selected rather than treating it as an error', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(
      directoryResult([], [{ filename: 'handwritten.gcode', modified: 1, size: 10 }]),
    )
    const printer = usePrinterStore()
    vi.spyOn(printer, 'loadMetadata').mockResolvedValue(null)
    const gcodeFiles = useGcodeFilesStore()
    await gcodeFiles.refreshDirectory()

    await gcodeFiles.select('handwritten.gcode')

    expect(gcodeFiles.selectedFile?.name).toBe('handwritten.gcode')
    expect(gcodeFiles.selectedMetadata).toBeNull()
    expect(gcodeFiles.failed).toBe(false)
  })

  it('reselects the open file when the file list reports it was rewritten', async () => {
    const moonraker = useMoonrakerStore()
    let filelistHandler: NotificationHandler | undefined
    vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
      if (method === 'notify_filelist_changed') filelistHandler = handler
      return () => undefined
    })
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(
      directoryResult([], [{ filename: 'cube.gcode', modified: 1, size: 10 }]),
    )
    const printer = usePrinterStore()
    const invalidateMetadata = vi.spyOn(printer, 'invalidateMetadata')
    const loadMetadata = vi
      .spyOn(printer, 'loadMetadata')
      .mockResolvedValueOnce({ filename: 'cube.gcode', estimated_time: 1000 })
      .mockResolvedValueOnce({ filename: 'cube.gcode', estimated_time: 2000 })

    const gcodeFiles = useGcodeFilesStore()
    gcodeFiles.start()
    await gcodeFiles.select('cube.gcode')
    expect(gcodeFiles.selectedMetadata?.estimated_time).toBe(1000)

    filelistHandler?.({
      jsonrpc: '2.0',
      method: 'notify_filelist_changed',
      params: [{ action: 'modify_file', item: { root: 'gcodes', path: 'cube.gcode' } }],
    })

    await vi.waitFor(() => expect(loadMetadata).toHaveBeenCalledTimes(2))
    expect(invalidateMetadata).toHaveBeenCalledWith('cube.gcode')
    expect(gcodeFiles.selectedMetadata?.estimated_time).toBe(2000)
    gcodeFiles.stop()
  })

  it('leaves the open file alone when a different file changes', async () => {
    const moonraker = useMoonrakerStore()
    let filelistHandler: NotificationHandler | undefined
    vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
      if (method === 'notify_filelist_changed') filelistHandler = handler
      return () => undefined
    })
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(
      directoryResult([], [{ filename: 'cube.gcode', modified: 1, size: 10 }]),
    )
    const printer = usePrinterStore()
    const invalidateMetadata = vi.spyOn(printer, 'invalidateMetadata')
    const loadMetadata = vi
      .spyOn(printer, 'loadMetadata')
      .mockResolvedValue({ filename: 'cube.gcode', estimated_time: 1000 })

    const gcodeFiles = useGcodeFilesStore()
    gcodeFiles.start()
    await gcodeFiles.select('cube.gcode')

    filelistHandler?.({
      jsonrpc: '2.0',
      method: 'notify_filelist_changed',
      params: [{ action: 'modify_file', item: { root: 'gcodes', path: 'other.gcode' } }],
    })
    await Promise.resolve()

    expect(invalidateMetadata).not.toHaveBeenCalled()
    expect(loadMetadata).toHaveBeenCalledTimes(1)
    gcodeFiles.stop()
  })

  describe('analysis estimates', () => {
    it('checks whether the estimator is ready once Moonraker connects', async () => {
      const moonraker = useMoonrakerStore()
      const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({
        estimator_executable: 'klipper_estimator',
        estimator_ready: true,
        estimator_version: 'v3.7.3',
        estimator_config_exists: true,
        using_default_config: false,
      } as never)

      const gcodeFiles = useGcodeFilesStore()
      gcodeFiles.start()
      await Promise.resolve()
      await Promise.resolve()

      expect(rpcCall).toHaveBeenCalledWith('server.analysis.status')
      expect(gcodeFiles.isAnalysisReady).toBe(true)
      gcodeFiles.stop()
    })

    it('treats a refused status check as not ready rather than an error', async () => {
      const moonraker = useMoonrakerStore()
      vi.spyOn(moonraker, 'rpcCall').mockRejectedValue(new Error('method not found'))

      const gcodeFiles = useGcodeFilesStore()
      gcodeFiles.start()
      await Promise.resolve()
      await Promise.resolve()

      expect(gcodeFiles.isAnalysisReady).toBe(false)
      gcodeFiles.stop()
    })

    it('processes the file, drops its cached metadata, and re-reads the selected file', async () => {
      const moonraker = useMoonrakerStore()
      vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(
        directoryResult([], [{ filename: 'cube.gcode', modified: 1, size: 10 }]),
      )
      const printer = usePrinterStore()
      const invalidateMetadata = vi.spyOn(printer, 'invalidateMetadata')
      vi.spyOn(printer, 'loadMetadata').mockResolvedValue({
        filename: 'cube.gcode',
        estimated_time: 3600,
      })
      const processRpc = vi.spyOn(moonraker, 'rpcCall').mockResolvedValueOnce({
        prev_processed: false,
        version: 'v3.7.3',
        bypassed: false,
      } as never)

      const gcodeFiles = useGcodeFilesStore()
      await gcodeFiles.refreshDirectory()
      await gcodeFiles.select('cube.gcode')

      const succeeded = await gcodeFiles.processEstimate('cube.gcode')

      expect(succeeded).toBe(true)
      expect(processRpc).toHaveBeenCalledWith('server.analysis.process', {
        filename: 'cube.gcode',
      })
      expect(invalidateMetadata).toHaveBeenCalledWith('cube.gcode')
      // Re-selected, so the corrected metadata a fresh read would carry
      // actually reaches the detail pane rather than the pre-processed cache.
      expect(gcodeFiles.selectedMetadata?.filename).toBe('cube.gcode')
    })

    it('reports failure rather than throwing when Moonraker refuses to process', async () => {
      const moonraker = useMoonrakerStore()
      vi.spyOn(moonraker, 'rpcCall').mockRejectedValue(new Error('estimator not ready'))
      const gcodeFiles = useGcodeFilesStore()

      const succeeded = await gcodeFiles.processEstimate('cube.gcode')

      expect(succeeded).toBe(false)
      expect(gcodeFiles.processEstimateFailed).toBe(true)
      expect(gcodeFiles.isProcessingEstimate).toBe(false)
    })
  })
})
