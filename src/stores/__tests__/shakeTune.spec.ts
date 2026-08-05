import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { useShakeTuneStore } from '@/stores/shakeTune'

function directoryResult(files: Array<{ filename: string; modified: number }>) {
  return {
    dirs: [],
    files: files.map((file) => ({ ...file, size: 0, permissions: 'rw' })),
    disk_usage: { total: 0, used: 0, free: 0 },
  } as never
}

describe('shake&tune results store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setActivePinia(createPinia())
    const availability = useAvailabilityStore()
    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
  })

  it('reads only PNGs from every category folder under the config root, newest first', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation(async (method, params) => {
      const path = (params as { path: string }).path
      if (path === 'config/K-ShakeTune_results/belts') {
        return directoryResult([
          { filename: 'belts_20260801_120000_x.png', modified: 1 },
          { filename: 'belts_20260810_090000_x.png', modified: 10 },
          { filename: 'belts_raw.stdata', modified: 5 },
        ])
      }
      return directoryResult([])
    })

    const shakeTune = useShakeTuneStore()
    await shakeTune.refresh()

    expect(rpcCall).toHaveBeenCalledWith('server.files.get_directory', {
      path: 'config/K-ShakeTune_results/belts',
    })
    expect(shakeTune.resultsByCategory.belts.map((result) => result.name)).toEqual([
      'belts_20260810_090000_x.png',
      'belts_20260801_120000_x.png',
    ])
    expect(shakeTune.hasAnyResults).toBe(true)
  })

  it('treats a missing results folder as no results, in every category, not a failure', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockRejectedValue(new Error('directory does not exist'))

    const shakeTune = useShakeTuneStore()
    await shakeTune.refresh()

    expect(shakeTune.hasAnyResults).toBe(false)
    expect(shakeTune.resultsByCategory.belts).toEqual([])
    expect(shakeTune.resultsByCategory.inputShaper).toEqual([])
  })

  it('reads a customised result_folder from configfile.settings instead of the default', async () => {
    const printerConfig = usePrinterConfigStore()
    vi.spyOn(printerConfig, 'section').mockImplementation((name) =>
      name === 'shaketune' ? { result_folder: '~/printer_data/config/ShakeTune_results' } : null,
    )
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation(async (method, params) => {
      const path = (params as { path: string }).path
      if (path === 'config/ShakeTune_results/belts') {
        return directoryResult([{ filename: 'belts_20260810_090000_x.png', modified: 10 }])
      }
      return directoryResult([])
    })

    const shakeTune = useShakeTuneStore()
    await shakeTune.refresh()

    expect(rpcCall).toHaveBeenCalledWith('server.files.get_directory', {
      path: 'config/ShakeTune_results/belts',
    })
    expect(shakeTune.resultsByCategory.belts.map((result) => result.name)).toEqual([
      'belts_20260810_090000_x.png',
    ])
  })

  it('treats a result_folder configured outside the config root as no results', async () => {
    const printerConfig = usePrinterConfigStore()
    vi.spyOn(printerConfig, 'section').mockImplementation((name) =>
      name === 'shaketune' ? { result_folder: '~/printer_data/shaketune_results' } : null,
    )
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall')

    const shakeTune = useShakeTuneStore()
    await shakeTune.refresh()

    expect(rpcCall).not.toHaveBeenCalled()
    expect(shakeTune.hasAnyResults).toBe(false)
  })

  it('re-resolves the results root once configfile.settings loads after the initial refresh', async () => {
    const printerConfig = usePrinterConfigStore()
    const sectionSpy = vi.spyOn(printerConfig, 'section').mockReturnValue(null)
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockImplementation(async (method, params) => {
      const path = (params as { path: string }).path
      if (path === 'config/ShakeTune_results/belts') {
        return directoryResult([{ filename: 'belts_20260810_090000_x.png', modified: 10 }])
      }
      return directoryResult([])
    })

    // Moonraker connects before `configfile.settings` has loaded, same as on a
    // cold page load: the immediate refresh below resolves against no
    // `shaketune` section at all, falling back to the default folder, which
    // this printer's custom `result_folder` never wrote to.
    const shakeTune = useShakeTuneStore()
    shakeTune.start()
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(shakeTune.hasAnyResults).toBe(false)

    // `configfile.settings` finishes loading afterwards, with the printer's
    // actual `result_folder`.
    sectionSpy.mockImplementation((name) =>
      name === 'shaketune' ? { result_folder: '~/printer_data/config/ShakeTune_results' } : null,
    )
    printerConfig.hasSettings = true
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(shakeTune.hasAnyResults).toBe(true)
    shakeTune.stop()
  })
})
