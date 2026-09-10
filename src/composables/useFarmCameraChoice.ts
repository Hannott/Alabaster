import { ref } from 'vue'

/**
 * Which of a printer's cameras its farm card shows, remembered per printer.
 *
 * Module-level state rather than a store, for the reason the sidebar's collapse
 * and `useHiddenDestinations` are: this is a display preference with no domain
 * behind it, and nothing outside the farm page reads it. It is deliberately
 * **not** part of the farm store either — what a card chooses to draw must
 * never be able to influence what is connected, and keeping the two in separate
 * modules is what makes that true by construction rather than by discipline.
 * The farm's expansion state lived here for exactly the same reason before the
 * page had one card size.
 *
 * Keyed by printer id, so an entry whose address changes keeps its choice, and
 * remembered across reloads because the camera worth watching on a machine is
 * usually the one that was worth watching yesterday. The value is a camera
 * `uid`, and a uid that no longer exists resolves back to the first enabled
 * camera rather than to an empty tile.
 */

const storageKey = 'alabaster.farm.camera'

function readStorage(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}')
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    )
    return Object.fromEntries(entries)
  } catch {
    return {}
  }
}

const chosen = ref<Record<string, string>>(readStorage())

function persist(): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(chosen.value))
  } catch {
    // A full or unavailable store costs the choices after the next reload and
    // nothing else. Never worth interrupting anyone for.
  }
}

export function useFarmCameraChoice() {
  const chosenCamera = (printerId: string): string | null => chosen.value[printerId] ?? null

  function chooseCamera(printerId: string, uid: string): void {
    chosen.value = { ...chosen.value, [printerId]: uid }
    persist()
  }

  return { chosenCamera, chooseCamera }
}
