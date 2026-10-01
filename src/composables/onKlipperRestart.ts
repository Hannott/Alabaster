import { watch } from 'vue'

import { useAvailabilityStore } from '@/stores/availability'

/**
 * Runs `callback` each time Klipper comes back ready after a restart, a
 * firmware restart or a reconnect, for the component's lifetime.
 *
 * For what a surface holds about the printer that no status object reports:
 * a note that a tower is armed, that a value is applied until restart, that a
 * guided helper it opened is waiting. Everything read from the printer keeps
 * itself current through its own subscription; these are the surface's own
 * record of what it sent, and a restart ends what they describe without a
 * word. See `availability.klipperSession`.
 */
export function onKlipperRestart(callback: () => void): void {
  const availability = useAvailabilityStore()
  watch(
    () => availability.klipperSession,
    () => callback(),
  )
}
