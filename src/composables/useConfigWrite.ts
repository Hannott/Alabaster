import { computed, ref } from 'vue'

import { onKlipperRestart } from '@/composables/onKlipperRestart'
import { useAvailability } from '@/composables/useAvailability'
import { useCalibrationStore, type PersistActionOutcome } from '@/stores/calibration'
import { usePrinterStore } from '@/stores/printer'

/**
 * Writes a guided panel's result to the config lines Klipper uses and
 * restarts so it runs, through the same action a procedure's result offers
 * (`calibration.runAction`): one locator, one restart rule — `SAVE_CONFIG`
 * where something is staged, a firmware restart where a line in the
 * `SAVE_CONFIG` block was edited — and one refusal when neither is safe.
 *
 * Refused during a print, because the restart would end it.
 */
export function useConfigWrite() {
  const calibration = useCalibrationStore()
  const printer = usePrinterStore()
  const { availability } = useAvailability('klipper')

  const writing = ref<string | null>(null)
  const last = ref<{ id: string; outcome: PersistActionOutcome } | null>(null)

  const disabled = computed(
    () => !availability.value.isAvailable || printer.hasActivePrint || writing.value !== null,
  )

  async function write(
    id: string,
    section: string,
    changes: readonly { option: string; value: string }[],
    removes: readonly string[] = [],
    /** False for every write but the last of several sections, so Klipper restarts once. */
    restart = true,
  ): Promise<PersistActionOutcome | null> {
    writing.value = id
    try {
      const outcome = await calibration.runAction({
        kind: 'persist',
        id,
        label: { literal: id },
        section,
        changes,
        removes,
        restart,
      })
      if (typeof outcome !== 'string') return null
      last.value = { id, outcome }
      return outcome
    } finally {
      writing.value = null
    }
  }

  /** The outcome of the last write with this id, for the note beside its button. */
  function outcomeFor(id: string): PersistActionOutcome | null {
    return last.value?.id === id ? last.value.outcome : null
  }

  function forget(): void {
    last.value = null
  }

  // "Klipper is restarting" and "restart to load it" are both over once it is back.
  onKlipperRestart(forget)

  return { writing, disabled, write, outcomeFor, forget }
}
