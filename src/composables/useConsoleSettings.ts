import { computed, ref } from 'vue'

import type { ConsoleSettings } from '@/components/console/ConsoleSettingsFields.vue'

/**
 * The console page's own preferences, persisted the way the G-code viewer's and
 * File Explorer's are — module-level state shared by every mount, so the page
 * keeps its settings across route changes without a store of its own.
 *
 * Deliberately separate from the dashboard card's configuration. The card reads
 * its settings from the dashboard profile because ADR 0006 gives a module no
 * storage key of its own, and because a card and a full page want genuinely
 * different answers: the card is a glance at the last few lines, the page is
 * where a print's whole history is read. Filters are the one pair where sharing
 * would arguably be kinder, and they are still separate, because a per-card
 * filter is what the module contract can express.
 */
const storageKey = 'alabaster.console.settings'

const defaults: ConsoleSettings = {
  // The one filter that defaults on: `M105` and every heat-up wait emit a
  // temperature report per second, and they are never what someone opened the
  // console to read.
  hideTemperatureReports: true,
  hideTimelapseCommands: true,
  showTimestamps: true,
  compact: false,
  rawOutput: false,
  followNewest: true,
  // The page's transcript fills its pane, so this is carried only to satisfy the
  // shared settings shape and is never rendered here.
  visibleLines: 12,
  // A terminal puts its prompt at the bottom, which is what most people reach for
  // this expecting; newest-first is offered for anyone who prefers reading down.
  inputPosition: 'bottom',
}

/** A hand-edited or older payload degrades key by key rather than all at once. */
function load(): ConsoleSettings {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}')
    if (typeof stored !== 'object' || stored === null) return { ...defaults }
    const record = stored as Record<string, unknown>
    const restored = {
      ...defaults,
      ...Object.fromEntries(
        Object.entries(defaults)
          .filter(([key]) => typeof record[key] === typeof defaults[key as keyof ConsoleSettings])
          .map(([key]) => [key, record[key]]),
      ),
    } as ConsoleSettings
    // A type check is not enough for a union: any string would survive it, and an
    // unrecognized position would leave the prompt nowhere.
    if (restored.inputPosition !== 'top' && restored.inputPosition !== 'bottom') {
      restored.inputPosition = defaults.inputPosition
    }
    return restored
  } catch {
    return { ...defaults }
  }
}

const settings = ref<ConsoleSettings>(load())

function update(patch: Partial<ConsoleSettings>): void {
  settings.value = { ...settings.value, ...patch }
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(settings.value))
  } catch {
    // A full or unavailable store costs the preference, not the console.
  }
}

export function useConsoleSettings() {
  return { settings: computed(() => settings.value), update }
}
