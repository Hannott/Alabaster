import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { PRIMARY_CONFIG } from '@/features/machine/fileKind'
import {
  includedConfigFiles,
  indexConfig,
  optionKey,
  removeOption,
  writeOption,
  type OptionWriteFailure,
} from '@/features/config/optionLocator'
import {
  buildQuickConfigCards,
  visiblePins,
  type QuickConfigPin,
} from '@/features/config/quickConfigFields'
import { useAvailabilityStore } from '@/stores/availability'
import { useMachineFilesStore } from '@/stores/machineFiles'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { readScoped, writeScoped } from '@/stores/printerScope'
import { usePrintersStore } from '@/stores/printers'
import { isRecord } from '@/utils/records'

export type ConfigurationViewMode = 'files' | 'quickConfig'

const pinsStorageKey = 'alabaster.quickConfig.pins'

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

function pinsTable(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(pinsStorageKey) ?? '{}')
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
  const storedPins = ref<QuickConfigPin[] | null>(
    normalizeQuickConfigPins(readScoped(pinsTable(), printers.activeScopeKeys)),
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
  let started = false
  let reloadTimer: ReturnType<typeof setTimeout> | null = null
  const disposers: Array<() => void> = []

  watch(
    () => printers.activeScopeKeys.join(','),
    () => {
      storedPins.value = normalizeQuickConfigPins(readScoped(pinsTable(), printers.activeScopeKeys))
    },
  )

  function persistPins(): void {
    window.localStorage.setItem(
      pinsStorageKey,
      JSON.stringify(writeScoped(pinsTable(), printers.activeScopeKeys, storedPins.value)),
    )
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

  function unpin(pin: QuickConfigPin): void {
    const key = fieldKey(pin)
    setStoredPins(pins.value.filter((candidate) => fieldKey(candidate) !== key))
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
    if (started) return
    started = true
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
    if (!started) return
    started = false
    loadGeneration += 1
    isLoading.value = false
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = null
    while (disposers.length > 0) disposers.pop()?.()
  }

  return {
    viewMode,
    storedPins,
    pins,
    cards,
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
    unpin,
    unpinSection,
    replacePins,
    load,
    start,
    stop,
  }
})
