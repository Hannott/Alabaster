import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import { useAvailabilityStore } from '@/stores/availability'
import { createGuardedLoad } from '@/stores/guardedLoad'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import { useToastsStore } from '@/stores/toasts'
import { titleCaseIdentifier } from '@/utils/identifierCase'

const macroObjectPrefix = 'gcode_macro '

// Klipper marks helper macros with a leading underscore. These named macros are
// excluded as well: the print controls already own pause, resume, and cancel,
// and the remaining ones only do useful work with client-supplied parameters.
export const excludedMacroNames: ReadonlySet<string> = new Set([
  'PAUSE',
  'RESUME',
  'CANCEL_PRINT',
  'SET_PAUSE_NEXT_LAYER',
  'SET_PAUSE_AT_LAYER',
  'SET_PRINT_STATS_INFO',
])

export function formatMacroLabel(name: string): string {
  return titleCaseIdentifier(name)
}

/**
 * One macro invocation as Klipper's own parser reads it: the macro name, then
 * `KEY=value` pairs. An empty value omits its parameter entirely, so the
 * macro's own `|default(...)` applies — the interface never invents a value
 * for a field the user left blank. A value with spaces is quoted, which is
 * the one escaping Klipper's parameter splitting understands.
 */
export function buildMacroScript(name: string, params?: Readonly<Record<string, string>>): string {
  const parts = [name.trim().toUpperCase()]
  for (const [key, raw] of Object.entries(params ?? {})) {
    const value = raw.trim()
    if (value === '') continue
    parts.push(`${key}=${value.includes(' ') ? `"${value}"` : value}`)
  }
  return parts.join(' ')
}

export function isSelectableMacroObject(objectName: string): boolean {
  if (!objectName.startsWith(macroObjectPrefix)) return false
  const name = objectName.slice(macroObjectPrefix.length).trim().toUpperCase()
  if (name === '' || name.startsWith('_') || excludedMacroNames.has(name)) return false
  // A macro named like a G-code command overrides that command; it is not an
  // operator action and generally needs the parameters the firmware sends.
  return !/^[GM]\d+(\.\d+)?$/.test(name)
}

export function macroNamesFrom(objects: readonly string[]): string[] {
  const names = objects
    .filter(isSelectableMacroObject)
    .map((objectName) => objectName.slice(macroObjectPrefix.length).trim().toUpperCase())
  return [...new Set(names)].sort((left, right) => left.localeCompare(right))
}

/**
 * Every `gcode_macro` Klipper reports, with none of `macroNamesFrom`'s
 * filtering: that filter exists to keep helper macros, `PAUSE`/`RESUME`, and
 * exactly the two layer-pause macros out of the generic picker, which makes
 * it the wrong list for answering "does this specific macro exist" — the
 * bug this function fixes shipped as `hasMacro` reading `macroNamesFrom`'s
 * output, so it could never confirm one of the names that list always
 * excludes on purpose.
 */
export function allMacroNamesFrom(objects: readonly string[]): ReadonlySet<string> {
  const names = objects
    .filter((objectName) => objectName.startsWith(macroObjectPrefix))
    .map((objectName) => objectName.slice(macroObjectPrefix.length).trim().toUpperCase())
  return new Set(names)
}

/**
 * The store owns what the printer offers and what is currently running. Which
 * macros a card shows is placement configuration and belongs to the dashboard
 * profile, so several macro cards can present different sets.
 */
export const useMacrosStore = defineStore('macros', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()
  const printer = usePrinterStore()
  const toasts = useToastsStore()
  const discovered = ref<string[]>([])
  const allMacroNames = ref<ReadonlySet<string>>(new Set())
  const hasDiscovered = ref(false)
  const isLoading = ref(false)
  const failed = ref(false)
  const runningMacros = ref<ReadonlySet<string>>(new Set())
  const lastError = ref<string | null>(null)
  let stopAvailabilityWatch: WatchStopHandle | null = null
  let stopPrinterChangeReset: (() => void) | null = null
  let started = false
  const load = createGuardedLoad({ isLoading, failed })

  const discoveredNames = computed(() => new Set(discovered.value))

  function isRunning(name: string): boolean {
    return runningMacros.value.has(name.trim().toUpperCase())
  }

  function isMissing(name: string): boolean {
    return hasDiscovered.value && !discoveredNames.value.has(name.trim().toUpperCase())
  }

  /**
   * The opposite question from `isMissing`, and not just its negation: a
   * caller offering a control gated on a specific macro's presence — Print's
   * pause-at-layer row, for one — needs "confirmed present," not "not
   * confirmed absent." Before discovery finishes, `isMissing` reads `false`
   * for everything, which would flash every gated control on for a moment;
   * this reads `false` until discovery actually says otherwise. Reads
   * `allMacroNames`, not `discoveredNames`: the latter is `macroNamesFrom`'s
   * output, built for the generic macro picker, and it deliberately excludes
   * `SET_PAUSE_AT_LAYER`/`SET_PAUSE_NEXT_LAYER` by name — checking it here
   * would make this function unable to confirm the two macros it exists to
   * confirm, on every printer that actually has them.
   */
  function hasMacro(name: string): boolean {
    return hasDiscovered.value && allMacroNames.value.has(name.trim().toUpperCase())
  }

  async function refresh(): Promise<void> {
    await load.run(
      () => moonraker.rpcCall('printer.objects.list'),
      (result) => {
        discovered.value = macroNamesFrom(result.objects)
        allMacroNames.value = allMacroNamesFrom(result.objects)
        hasDiscovered.value = true
      },
    )
  }

  /**
   * Dispatch goes through the printer store's `sendMacro` — the path that
   * echoes into the console before dispatch and carries no local deadline, so
   * a heat soak stays pending for as long as it actually runs instead of
   * being reported dead at the transport's sixty-second default. Only a genuine
   * refusal from Klipper sets `lastError`, and it is never retried
   * automatically.
   */
  async function run(name: string, params?: Readonly<Record<string, string>>): Promise<boolean> {
    const macro = name.trim().toUpperCase()
    if (macro === '' || runningMacros.value.has(macro)) return false
    runningMacros.value = new Set(runningMacros.value).add(macro)
    lastError.value = null
    try {
      await printer.sendMacro(buildMacroScript(macro, params))
      return true
    } catch (error) {
      lastError.value = macro
      toasts.pushError(error)
      return false
    } finally {
      const remaining = new Set(runningMacros.value)
      remaining.delete(macro)
      runningMacros.value = remaining
    }
  }

  function clearError(): void {
    lastError.value = null
  }

  /**
   * Another machine's macro list is not a stale copy of this one's — it is a
   * different printer's vocabulary, and `isMissing` judging the new printer's
   * cards against it flags macros that exist and blesses ones that do not.
   * Wiped on the switch; `hasDiscovered` returning to false is what keeps
   * `isMissing` from accusing anything until the new list has actually loaded.
   */
  function printerChanged(): void {
    load.invalidate()
    discovered.value = []
    allMacroNames.value = new Set()
    hasDiscovered.value = false
    runningMacros.value = new Set()
    lastError.value = null
    failed.value = false
  }

  function start(): void {
    if (started) return
    started = true
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    stopAvailabilityWatch = watch(
      () => availability.isKlipperReady,
      (isReady) => {
        if (isReady) void refresh()
      },
      { immediate: true },
    )
  }

  function stop(): void {
    if (!started) return
    started = false
    load.invalidate()
    stopAvailabilityWatch?.()
    stopAvailabilityWatch = null
    stopPrinterChangeReset?.()
    stopPrinterChangeReset = null
  }

  return {
    discovered,
    allMacroNames,
    hasDiscovered,
    isLoading,
    failed,
    lastError,
    runningMacros,
    isRunning,
    isMissing,
    hasMacro,
    refresh,
    run,
    clearError,
    start,
    stop,
  }
})
