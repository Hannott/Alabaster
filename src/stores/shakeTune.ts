import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import { moonrakerFileUrl } from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterConfigStore } from '@/stores/printerConfig'

/**
 * Shake&Tune (`Frix-x/klippain-shaketune`) writes its diagnostic graphs under
 * `<result_folder>/<category>/*.png` — one subfolder per test kind, exactly as
 * its own `shaketune_config.py` declares them. `result_folder` defaults to
 * `~/printer_data/config/K-ShakeTune_results` but is a plain `[shaketune]`
 * config option, so a printer carried over from the project's pre-rename
 * `Shake-Tune_results` days, or one that just customized the path, writes
 * somewhere else entirely — hard-coding the default left every one of those
 * printers with a gallery that never finds its own images. The base folder is
 * therefore read from `configfile.settings` the same way every other machine
 * capability is, via `usePrinterConfigStore`; only the subfolder names below
 * stay fixed, because those come from `RESULTS_SUBFOLDERS` in shaketune's own
 * code, not from anything a user configures.
 *
 * There is still no Moonraker component or capability flag for a third-party
 * Klipper extras module like this one, so the gallery gates itself on the
 * folder actually existing: a printer that has never run a tuning macro
 * reports every category empty and the whole section disappears, the same
 * posture Extruder's macro picker takes for a macro nobody configured.
 */
export type ShakeTuneCategory =
  'axesMap' | 'belts' | 'inputShaper' | 'vibrations' | 'staticFrequency'

export const shakeTuneCategories: readonly ShakeTuneCategory[] = [
  'inputShaper',
  'belts',
  'vibrations',
  'axesMap',
  'staticFrequency',
]

const defaultResultsRoot = 'K-ShakeTune_results'

/**
 * `result_folder` is read (and `.expanduser()`-ed) from a Klipper config
 * option, so it always arrives as a path anchored under the printer's own
 * `printer_data/config/`, whatever the user's home directory is. Everything
 * after that anchor is the path Alabaster's `config` file root already
 * browses; a `result_folder` that resolves outside `config/` entirely has
 * nowhere Alabaster can read it from, so every category reports empty exactly
 * as it would for a printer that never ran a tuning macro.
 */
const configRootAnchor = 'printer_data/config/'

function resolveResultsRoot(
  printerConfig: ReturnType<typeof usePrinterConfigStore>,
): string | null {
  const configured = printerConfig.section('shaketune')?.result_folder
  if (typeof configured !== 'string' || configured.length === 0) return defaultResultsRoot
  const anchorIndex = configured.indexOf(configRootAnchor)
  if (anchorIndex < 0) return null
  return configured.slice(anchorIndex + configRootAnchor.length).replace(/\/+$/, '')
}

/** The exact subfolder names `shaketune_config.py`'s `RESULTS_SUBFOLDERS` declares. */
const categoryFolders: Record<ShakeTuneCategory, string> = {
  axesMap: 'axes_map',
  belts: 'belts',
  inputShaper: 'input_shaper',
  vibrations: 'vibrations',
  staticFrequency: 'static_freq',
}

/**
 * The macro that starts each category's test, exactly as `dummy_macros.cfg`
 * names them in klippain-shaketune's own repo — real `[gcode_macro]` sections
 * the extras module injects at Klipper startup (wrapping the internal
 * `_NAME`-prefixed command that does the work), which is what makes
 * `macros.hasMacro(...)` the right gate: every one of these shows up as a
 * `gcode_macro <NAME>` object once Shake&Tune is installed, whether or not it
 * has ever been run.
 *
 * Every parameter on every one of these is optional with a built-in default,
 * so the bare macro name is a complete, valid invocation — the same shape as
 * `BED_MESH_CALIBRATE` with no `PROFILE`.
 *
 * `staticFrequency` has no entry. `EXCITATE_AXIS_AT_FREQ` is an investigative
 * tool for holding one excitation frequency while something is inspected by
 * hand — repeated at whatever frequency the user is chasing — not a
 * run-once-and-get-a-graph test like the other four, and it defaults to
 * `CREATE_GRAPH=0`: triggered bare, it produces no result to show up in the
 * gallery at all. A button that appeared to do the same thing as the other
 * four while quietly doing something different is worse than no button.
 */
export const shakeTuneTriggerMacros: Partial<Record<ShakeTuneCategory, string>> = {
  inputShaper: 'AXES_SHAPER_CALIBRATION',
  belts: 'COMPARE_BELTS_RESPONSES',
  vibrations: 'CREATE_VIBRATIONS_PROFILE',
  axesMap: 'AXES_MAP_CALIBRATION',
}

export interface ShakeTuneResult {
  name: string
  /** Relative to the `config` root, so `moonrakerFileUrl` can resolve it directly. */
  path: string
  modified: number
  url: string
}

function emptyResults(): Record<ShakeTuneCategory, ShakeTuneResult[]> {
  return {
    axesMap: [],
    belts: [],
    inputShaper: [],
    vibrations: [],
    staticFrequency: [],
  }
}

export const useShakeTuneStore = defineStore('shakeTune', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()
  const printerConfig = usePrinterConfigStore()

  const resultsByCategory = ref(emptyResults())
  const isLoading = ref(false)

  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let generation = 0
  let started = false
  let stopAvailabilityWatch: WatchStopHandle | null = null
  let stopPrinterConfigWatch: WatchStopHandle | null = null
  let stopFileNotifications: (() => void) | null = null
  let stopPrinterChangeReset: (() => void) | null = null

  const hasAnyResults = computed(() =>
    shakeTuneCategories.some((category) => resultsByCategory.value[category].length > 0),
  )

  async function loadCategory(
    resultsRoot: string,
    category: ShakeTuneCategory,
  ): Promise<ShakeTuneResult[]> {
    try {
      const result = await moonraker.rpcCall('server.files.get_directory', {
        path: `config/${resultsRoot}/${categoryFolders[category]}`,
      })
      return result.files
        .filter((file) => /\.png$/i.test(file.filename))
        .map((file) => {
          const path = `${resultsRoot}/${categoryFolders[category]}/${file.filename}`
          return {
            name: file.filename,
            path,
            modified: file.modified,
            url: moonrakerFileUrl('config', path, moonraker.endpoint),
          }
        })
        .sort((left, right) => right.modified - left.modified)
    } catch {
      // No results yet, no results folder at all, or this category was never
      // run — every one of those is "nothing to show", never a failure banner
      // over a gallery that may legitimately be empty.
      return []
    }
  }

  async function refresh(): Promise<void> {
    if (isLoading.value) return
    const current = ++generation
    isLoading.value = true
    try {
      const resultsRoot = resolveResultsRoot(printerConfig)
      const loaded =
        resultsRoot === null
          ? shakeTuneCategories.map((): ShakeTuneResult[] => [])
          : await Promise.all(
              shakeTuneCategories.map((category) => loadCategory(resultsRoot, category)),
            )
      if (current !== generation) return
      resultsByCategory.value = Object.fromEntries(
        shakeTuneCategories.map((category, index) => [category, loaded[index]]),
      ) as Record<ShakeTuneCategory, ShakeTuneResult[]>
    } finally {
      if (current === generation) isLoading.value = false
    }
  }

  function scheduleRefresh(): void {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void refresh()
    }, 120)
  }

  /** Another machine's own tuning history, on another filesystem entirely. */
  function printerChanged(): void {
    generation += 1
    resultsByCategory.value = emptyResults()
    isLoading.value = false
  }

  function start(): void {
    if (started) return
    started = true
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    stopAvailabilityWatch = watch(
      () => availability.isMoonrakerConnected,
      (connected) => {
        if (connected) void refresh()
      },
      { immediate: true },
    )
    // On a fresh page load this store's own moonraker-connected refresh and
    // `usePrinterConfigStore`'s `configfile.settings` load race independently.
    // If the connected refresh above wins, it resolves `result_folder` against
    // whatever `printerConfig` has right now — nothing, on a cold load — falls
    // back to the default folder, and finds nothing there. Re-running once the
    // real settings land corrects that instead of leaving the gallery looking
    // empty until someone notices and clicks refresh.
    stopPrinterConfigWatch = watch(
      () => printerConfig.hasSettings,
      (loaded) => {
        if (loaded) void refresh()
      },
    )
    // A tuning macro just run from the console changes this listing, same as
    // any other file change — Moonraker does not distinguish which root.
    try {
      stopFileNotifications = moonraker.onNotification('notify_filelist_changed', scheduleRefresh)
    } catch {
      stopFileNotifications = null
    }
  }

  function stop(): void {
    if (!started) return
    started = false
    generation += 1
    stopAvailabilityWatch?.()
    stopAvailabilityWatch = null
    stopPrinterConfigWatch?.()
    stopPrinterConfigWatch = null
    stopFileNotifications?.()
    stopFileNotifications = null
    stopPrinterChangeReset?.()
    stopPrinterChangeReset = null
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = null
  }

  return {
    resultsByCategory,
    isLoading,
    hasAnyResults,
    refresh,
    start,
    stop,
  }
})
