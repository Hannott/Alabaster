import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { PRIMARY_CONFIG } from '@/features/machine/fileKind'
import {
  includedConfigFiles,
  indexConfig,
  optionKey,
  effectiveOption,
  removeOption,
  writeOption,
  type OptionWriteFailure,
} from '@/features/config/optionLocator'
import {
  buildOptionCatalogue,
  buildQuickConfigCards,
  unappliedChanges,
  visiblePins,
  type QuickConfigPin,
} from '@/features/config/quickConfigFields'
import {
  arrangeQuickConfigColumns,
  normalizeQuickConfigColumns,
  type QuickConfigColumns,
} from '@/features/config/quickConfigLayout'
import { useAvailabilityStore } from '@/stores/availability'
import { useMachineFilesStore } from '@/stores/machineFiles'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { readScoped, writeScoped } from '@/stores/printerScope'
import { usePrintersStore } from '@/stores/printers'
import { isRecord } from '@/utils/records'

export type ConfigurationViewMode = 'files' | 'quickConfig'

/**
 * What writing a running value to the config did. `buffered` means the file
 * already held someone's unsaved edits, so the value went into that buffer
 * rather than saving their edits along with it.
 */
export type PersistResult =
  | { status: 'saved' | 'buffered'; path: string; autosave?: true }
  | { status: 'unchanged' }
  | { status: 'refused'; reason: 'unavailable' | 'autosave' | 'pending' | OptionWriteFailure }

const pinsStorageKey = 'alabaster.quickConfig.pins'
const columnsStorageKey = 'alabaster.quickConfig.columns'

export function isQuickConfigPin(value: unknown): value is QuickConfigPin {
  return (
    isRecord(value) &&
    typeof value.section === 'string' &&
    value.section.trim() !== '' &&
    typeof value.option === 'string' &&
    value.option.trim() !== ''
  )
}

/**
 * A stored list, or null for "never changed", which is what lets the defaults
 * follow the printer's sections rather than being frozen on first open.
 */
export function normalizeQuickConfigPins(value: unknown): QuickConfigPin[] | null {
  if (!Array.isArray(value)) return null
  const seen = new Set<string>()
  const pins: QuickConfigPin[] = []
  for (const entry of value) {
    if (!isQuickConfigPin(entry)) continue
    const pin = {
      section: entry.section.trim().toLowerCase(),
      option: entry.option.trim().toLowerCase(),
    }
    const key = optionKey(pin.section, pin.option)
    if (seen.has(key)) continue
    seen.add(key)
    pins.push(pin)
  }
  return pins
}

function storedTable(key: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? '{}')
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Quick config: pinned config options edited as fields, written into the
 * same path-keyed buffers the configuration editor uses.
 *
 * The pinned list is per printer, because sections are per machine, and
 * rides in the settings bundle so it follows the user through sync and
 * backup. Reading the files starts at `printer.cfg` and follows every
 * include the way Klipper does, so each field edits the line Klipper uses.
 */
export const useQuickConfigStore = defineStore('quickConfig', () => {
  const availability = useAvailabilityStore()
  const machineFiles = useMachineFilesStore()
  const moonraker = useMoonrakerStore()
  const printer = usePrinterStore()
  const printerConfig = usePrinterConfigStore()
  const printers = usePrintersStore()

  /** Which view Configuration shows. Kept for the session, so leaving the route does not reset it. */
  const viewMode = ref<ConfigurationViewMode>('files')
  /** A field the editor asked Quick config to scroll to, cleared once it has. */
  const revealRequest = ref<QuickConfigPin | null>(null)
  const storedPins = ref<QuickConfigPin[] | null>(
    normalizeQuickConfigPins(readScoped(storedTable(pinsStorageKey), printers.activeScopeKeys)),
  )
  /** Which column each card sits in, per printer like the pins; null until a card is moved. */
  const storedColumns = ref<QuickConfigColumns | null>(
    normalizeQuickConfigColumns(
      readScoped(storedTable(columnsStorageKey), printers.activeScopeKeys),
    ),
  )
  const availablePaths = ref<string[]>([])
  const loadedPaths = ref<string[]>([])
  const hasLoaded = ref(false)
  const isLoading = ref(false)
  const loadFailed = ref(false)
  /** Files Quick config has written into, so Save and Discard touch only those. */
  const touchedPaths = ref(new Set<string>())
  const fieldErrors = ref(new Map<string, OptionWriteFailure>())
  let loadGeneration = 0
  /*
   * Counted rather than a flag: Quick config and the editor's context menu
   * both read the index, and the view that unmounts first must not stop the
   * reload the other is still showing results from.
   */
  let starts = 0
  let reloadTimer: ReturnType<typeof setTimeout> | null = null
  const disposers: Array<() => void> = []

  watch(
    () => printers.activeScopeKeys.join(','),
    () => {
      storedPins.value = normalizeQuickConfigPins(
        readScoped(storedTable(pinsStorageKey), printers.activeScopeKeys),
      )
      storedColumns.value = normalizeQuickConfigColumns(
        readScoped(storedTable(columnsStorageKey), printers.activeScopeKeys),
      )
    },
  )

  function persist(key: string, value: unknown): void {
    window.localStorage.setItem(
      key,
      JSON.stringify(writeScoped(storedTable(key), printers.activeScopeKeys, value)),
    )
  }

  function persistPins(): void {
    persist(pinsStorageKey, storedPins.value)
  }

  function filesFrom(side: 'content' | 'saved'): Map<string, string> {
    const files = new Map<string, string>()
    for (const path of loadedPaths.value) {
      const buffer = machineFiles.configBuffer(path)
      if (buffer) files.set(path, buffer[side])
    }
    return files
  }

  const currentFiles = computed(() => filesFrom('content'))
  const currentIndex = computed(() =>
    indexConfig(PRIMARY_CONFIG, currentFiles.value, availablePaths.value),
  )
  const savedIndex = computed(() =>
    indexConfig(PRIMARY_CONFIG, filesFrom('saved'), availablePaths.value),
  )

  const pins = computed(() =>
    visiblePins(
      storedPins.value,
      (pin) =>
        printerConfig.section(pin.section)?.[pin.option] !== undefined ||
        currentIndex.value.options.has(optionKey(pin.section, pin.option)),
    ),
  )

  const cards = computed(() =>
    buildQuickConfigCards({
      pins: pins.value,
      current: currentIndex.value,
      saved: savedIndex.value,
      settings: printerConfig.settings,
      loadedConfig: printerConfig.loadedConfig,
      savePending: printer.saveConfigPending,
      pendingItems: printer.saveConfigPendingItems,
    }),
  )

  const catalogue = computed(() => buildOptionCatalogue(currentIndex.value, printerConfig.settings))

  /** Everything saved but not yet loaded, only once the files have been read. */
  const unapplied = computed(() =>
    hasLoaded.value ? unappliedChanges(savedIndex.value, printerConfig.loadedConfig) : [],
  )

  function warningsFor(section: string) {
    const key = section.toLowerCase()
    return printer.configWarnings.filter((warning) => warning.section?.toLowerCase() === key)
  }

  const fields = computed(() => cards.value.flatMap((card) => card.fields))
  const unsavedCount = computed(() => fields.value.filter((field) => field.unsaved).length)
  const unsavedPaths = computed(() =>
    [...touchedPaths.value].filter((path) => machineFiles.isPathDirty(path)),
  )
  /*
   * `SAVE_CONFIG` rewrites the `#*#` block from what Klipper holds in memory,
   * not from disk, so an edit there saved without a restart is undone by the
   * next calibration someone accepts. Once Klipper restarts, memory matches
   * the file and the edit is safe.
   */
  const requiresRestart = computed(() =>
    fields.value.some((field) => field.unsaved && field.autosave),
  )

  async function load(): Promise<void> {
    if (!availability.isMoonrakerConnected) return
    const generation = ++loadGeneration
    isLoading.value = true
    try {
      const available = await machineFiles.listConfigFiles()
      if (generation !== loadGeneration) return
      const visited: string[] = []
      let queue = available.includes(PRIMARY_CONFIG) ? [PRIMARY_CONFIG] : []
      let complete = true
      while (queue.length > 0) {
        if (!(await machineFiles.loadConfigFiles(queue))) complete = false
        if (generation !== loadGeneration) return
        visited.push(...queue)
        const next: string[] = []
        for (const path of queue) {
          const text = machineFiles.configBuffer(path)?.content
          if (text === undefined) continue
          for (const included of includedConfigFiles(path, text, available)) {
            if (!visited.includes(included) && !next.includes(included)) next.push(included)
          }
        }
        queue = next
      }
      availablePaths.value = available
      loadedPaths.value = visited
      loadFailed.value = !complete
      hasLoaded.value = true
    } catch {
      if (generation === loadGeneration) loadFailed.value = true
    } finally {
      if (generation === loadGeneration) isLoading.value = false
    }
  }

  function scheduleReload(): void {
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      reloadTimer = null
      void load()
    }, 150)
  }

  function fieldKey(pin: QuickConfigPin): string {
    return optionKey(pin.section, pin.option)
  }

  function fieldError(pin: QuickConfigPin): OptionWriteFailure | null {
    return fieldErrors.value.get(fieldKey(pin)) ?? null
  }

  /** Writes a field's value into the buffer of the file that holds its effective line. */
  function setValue(pin: QuickConfigPin, value: string): void {
    const key = fieldKey(pin)
    const field = fields.value.find((candidate) => fieldKey(candidate) === key)
    if (field?.lock) return
    const result = writeOption(
      currentIndex.value,
      currentFiles.value,
      pin.section,
      pin.option,
      value,
    )
    const errors = new Map(fieldErrors.value)
    if (!result.ok) {
      errors.set(fieldKey(pin), result.reason)
      fieldErrors.value = errors
      return
    }
    errors.delete(fieldKey(pin))
    fieldErrors.value = errors
    if (result.content === currentFiles.value.get(result.path)) return
    machineFiles.setConfigBufferContent(result.path, result.content)
    touchedPaths.value = new Set([...touchedPaths.value, result.path])
  }

  /** The value on disk, null when the file does not set it, undefined until the files are read. */
  function savedValue(section: string, option: string): string | null | undefined {
    if (!hasLoaded.value) return undefined
    return effectiveOption(savedIndex.value, section, option)?.value ?? null
  }

  /*
   * For a runtime control that wants to keep what it set — the Extruder card's
   * pressure advance. The value is already running, so this only has to reach
   * disk; no restart. It refuses the two cases where the write would be
   * silently undone: a line in the `SAVE_CONFIG` block, which the next
   * `SAVE_CONFIG` regenerates from memory, and an option among the pending
   * calibration results.
   *
   * `intoAutosave` is for a caller that restarts Klipper straight after, with
   * a firmware restart rather than `SAVE_CONFIG`: the restart makes Klipper
   * read the edited block from disk before anything could regenerate it. It
   * still refuses while anything is staged, since that restart would discard
   * the staged change.
   */
  async function persistOption(
    section: string,
    option: string,
    value: string,
    options: { intoAutosave?: boolean } = {},
  ): Promise<PersistResult> {
    if (!availability.isMoonrakerConnected) return { status: 'refused', reason: 'unavailable' }
    if (!hasLoaded.value) await load()
    if (!hasLoaded.value) return { status: 'refused', reason: 'unavailable' }
    const existing = effectiveOption(currentIndex.value, section, option)
    if (existing?.autosave && (options.intoAutosave !== true || printer.saveConfigPending)) {
      return { status: 'refused', reason: 'autosave' }
    }
    const autosave = existing?.autosave === true ? ({ autosave: true } as const) : {}
    if (
      printer.saveConfigPendingItems[section.toLowerCase()]?.[option.toLowerCase()] !== undefined
    ) {
      return { status: 'refused', reason: 'pending' }
    }
    const result = writeOption(currentIndex.value, currentFiles.value, section, option, value)
    if (!result.ok) return { status: 'refused', reason: result.reason }
    if (result.content === currentFiles.value.get(result.path)) return { status: 'unchanged' }
    const hadOtherEdits = machineFiles.isPathDirty(result.path)
    machineFiles.setConfigBufferContent(result.path, result.content)
    touchedPaths.value = new Set([...touchedPaths.value, result.path])
    if (hadOtherEdits) return { status: 'buffered', path: result.path, ...autosave }
    if (!(await machineFiles.saveConfigFiles([result.path]))) {
      return { status: 'buffered', path: result.path, ...autosave }
    }
    return { status: 'saved', path: result.path, ...autosave }
  }

  /*
   * The other half of `persistOption`, for a write that makes an option
   * invalid rather than different: switching `[extruder]` to a nonlinear
   * pressure-advance model leaves `pressure_advance` unread, and Klipper
   * refuses to start on an option nothing reads. Refuses what `persistOption`
   * refuses, for the same reasons, and a value spread over several lines.
   */
  async function unpersistOption(section: string, option: string): Promise<PersistResult> {
    if (!availability.isMoonrakerConnected) return { status: 'refused', reason: 'unavailable' }
    if (!hasLoaded.value) await load()
    if (!hasLoaded.value) return { status: 'refused', reason: 'unavailable' }
    const existing = effectiveOption(currentIndex.value, section, option)
    if (!existing) return { status: 'unchanged' }
    if (existing.autosave) return { status: 'refused', reason: 'autosave' }
    if (
      printer.saveConfigPendingItems[section.toLowerCase()]?.[option.toLowerCase()] !== undefined
    ) {
      return { status: 'refused', reason: 'pending' }
    }
    const removed = removeOption(currentIndex.value, currentFiles.value, section, option)
    if (!removed) return { status: 'refused', reason: 'multiline' }
    const hadOtherEdits = machineFiles.isPathDirty(removed.path)
    machineFiles.setConfigBufferContent(removed.path, removed.content)
    touchedPaths.value = new Set([...touchedPaths.value, removed.path])
    if (hadOtherEdits) return { status: 'buffered', path: removed.path }
    if (!(await machineFiles.saveConfigFiles([removed.path]))) {
      return { status: 'buffered', path: removed.path }
    }
    return { status: 'saved', path: removed.path }
  }

  async function save(restart: boolean): Promise<boolean> {
    if (restart && printer.hasActivePrint) return false
    if (!restart && requiresRestart.value) return false
    const saved = await machineFiles.saveConfigFiles(unsavedPaths.value, restart)
    if (saved) touchedPaths.value = new Set()
    return saved
  }

  /*
   * Back to what is on disk. An option that was at its default had no line to
   * go back to, so the line Quick config added is taken out again rather than
   * left holding the default value.
   */
  function revert(pin: QuickConfigPin): void {
    const key = fieldKey(pin)
    const field = fields.value.find((candidate) => fieldKey(candidate) === key)
    if (!field?.unsaved) return
    if (field.savedValue !== null) {
      setValue(pin, field.savedValue)
      return
    }
    const removed = removeOption(currentIndex.value, currentFiles.value, pin.section, pin.option)
    if (removed) machineFiles.setConfigBufferContent(removed.path, removed.content)
  }

  function discard(): void {
    for (const path of touchedPaths.value) machineFiles.discardChangesAt(path)
    touchedPaths.value = new Set()
    fieldErrors.value = new Map()
  }

  function setStoredPins(next: QuickConfigPin[]): void {
    storedPins.value = normalizeQuickConfigPins(next)
    persistPins()
  }

  /** Replaces one card's options, in order; an empty list removes the card. */
  function setSectionPins(section: string, options: readonly string[]): void {
    const key = section.toLowerCase()
    setStoredPins([
      ...pins.value.filter((candidate) => candidate.section !== key),
      ...options.map((option) => ({ section: key, option })),
    ])
  }

  function isPinned(section: string, option: string): boolean {
    const key = optionKey(section, option)
    return pins.value.some((pin) => optionKey(pin.section, pin.option) === key)
  }

  /** Adds one option to the end of its section's card, the way the editor's context menu pins it. */
  function pinOption(section: string, option: string): void {
    if (isPinned(section, option)) return
    setStoredPins([...pins.value, { section: section.toLowerCase(), option: option.toLowerCase() }])
  }

  function unpinOption(section: string, option: string): void {
    const key = optionKey(section, option)
    setStoredPins(pins.value.filter((pin) => optionKey(pin.section, pin.option) !== key))
  }

  /** The cards laid out in however many columns the view has room for. */
  function columnsFor(count: number): QuickConfigColumns {
    return arrangeQuickConfigColumns(
      cards.value.map((card) => card.key),
      storedColumns.value,
      count,
    )
  }

  /**
   * Stores an arrangement — the view's, as displayed after a move, or the
   * settings bundle's, re-validated. A card unpinned later stays named here, so
   * pinning its section again brings it back to the same place.
   */
  function setColumns(value: unknown): void {
    storedColumns.value = normalizeQuickConfigColumns(value)
    persist(columnsStorageKey, storedColumns.value)
  }

  function unpinSection(section: string): void {
    const key = section.toLowerCase()
    setStoredPins(pins.value.filter((candidate) => candidate.section !== key))
  }

  /** For the settings bundle: the stored list, or null while the defaults stand. */
  function replacePins(value: unknown): void {
    storedPins.value = normalizeQuickConfigPins(value)
    persistPins()
  }

  function printerChanged(): void {
    loadGeneration += 1
    availablePaths.value = []
    loadedPaths.value = []
    hasLoaded.value = false
    isLoading.value = false
    loadFailed.value = false
    touchedPaths.value = new Set()
    fieldErrors.value = new Map()
  }

  function start(): void {
    starts += 1
    if (starts > 1) return
    disposers.push(
      moonraker.onPrinterChange(printerChanged),
      watch(
        () => availability.isMoonrakerConnected,
        (connected) => {
          if (connected) void load()
          else loadGeneration += 1
        },
        { immediate: true },
      ),
    )
    try {
      disposers.push(moonraker.onNotification('notify_filelist_changed', scheduleReload))
    } catch {
      // Without file notifications the values still load; they refresh on the next visit.
    }
  }

  function stop(): void {
    if (starts === 0) return
    starts -= 1
    if (starts > 0) return
    loadGeneration += 1
    isLoading.value = false
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = null
    while (disposers.length > 0) disposers.pop()?.()
  }

  return {
    viewMode,
    revealRequest,
    /** Every included file's sections and options, for the editor's context menu. */
    index: currentIndex,
    storedPins,
    pins,
    cards,
    catalogue,
    unapplied,
    warningsFor,
    hasLoaded,
    isLoading,
    loadFailed,
    unsavedCount,
    unsavedPaths,
    requiresRestart,
    fieldError,
    setValue,
    save,
    revert,
    discard,
    savedValue,
    persistOption,
    unpersistOption,
    setSectionPins,
    storedColumns,
    columnsFor,
    setColumns,
    isPinned,
    pinOption,
    unpinOption,
    unpinSection,
    replacePins,
    load,
    start,
    stop,
  }
})
