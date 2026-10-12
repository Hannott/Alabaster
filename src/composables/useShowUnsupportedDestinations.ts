import { computed, ref } from 'vue'

/**
 * Whether the rail shows every destination even where this printer lacks the
 * root, component, or config section that gates it.
 *
 * For looking at a page on a machine that cannot fill it — Timelapse without
 * the timelapse component is the case that asked for it. The page renders
 * whatever its own unavailable or empty state is; nothing is invented to fill
 * it. Module-level and kept out of the settings bundle like
 * `useHiddenDestinations`: a reason to see a page on this screen says nothing
 * about another browser.
 */

const storageKey = 'alabaster.navigation.showUnsupported'

function readStorage(): boolean {
  try {
    return window.localStorage.getItem(storageKey) === 'true'
  } catch {
    return false
  }
}

const enabled = ref(readStorage())

export function useShowUnsupportedDestinations() {
  function setEnabled(value: boolean): void {
    enabled.value = value
    try {
      window.localStorage.setItem(storageKey, String(value))
    } catch {
      // Costs the preference after the next reload and nothing else.
    }
  }

  return { enabled: computed(() => enabled.value), setEnabled }
}
