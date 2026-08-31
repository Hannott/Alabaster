import { computed, ref } from 'vue'

import { hideableDestinations, type NavigationDestinationName } from '@/navigation/destinations'

/**
 * Which navigation destinations the user has chosen not to see.
 *
 * Only the destinations the registry marks `hideable` may be in here, and the
 * registry is where the argument for each one belongs — a rail the user can
 * empty is a rail that can strand them, so hiding is an exception granted per
 * destination rather than a general facility. Anything else in storage is
 * dropped on read, so removing a destination's `hideable` flag also un-hides it
 * rather than leaving it permanently invisible.
 *
 * Module-level state rather than a store, like the sidebar's collapse and
 * `useFarmExpansion`: a display preference with no domain behind it. It stays
 * out of the settings bundle (`settings/bundle.ts`) for the reason the printer
 * list itself does — what a browser has saved is what makes the Farm
 * destination worth offering, and carrying "Farm hidden" to a screen with a
 * different printer list would hide it for a reason that does not apply there.
 */

const storageKey = 'alabaster.navigation.hidden'

function readStorage(): NavigationDestinationName[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is NavigationDestinationName =>
      hideableDestinations.some((destination) => destination === value),
    )
  } catch {
    return []
  }
}

const hidden = ref<NavigationDestinationName[]>(readStorage())

function persist(): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(hidden.value))
  } catch {
    // A full or unavailable store costs the preference after the next reload
    // and nothing else. Never worth interrupting anyone for.
  }
}

export function useHiddenDestinations() {
  const isHidden = (name: NavigationDestinationName): boolean => hidden.value.includes(name)

  /** `visible` reads the way the checkbox does: checked means shown. */
  function setVisible(name: NavigationDestinationName, visible: boolean): void {
    if (!hideableDestinations.some((destination) => destination === name)) return
    const next = hidden.value.filter((entry) => entry !== name)
    if (!visible) next.push(name)
    hidden.value = next
    persist()
  }

  return {
    hidden: computed(() => hidden.value),
    isHidden,
    setVisible,
  }
}
