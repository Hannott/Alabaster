import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { readScoped, writeScoped } from '@/stores/printerScope'
import { usePrintersStore } from '@/stores/printers'
import { isRecord } from '@/utils/records'

/** What the belt guide was last given on a printer, as typed. */
export interface BeltGuideValues {
  /** Peaks on Shake&Tune's first belt curve, as the reader typed them. */
  firstPeaks: string
  secondPeaks: string
  unpaired: number
  /** The belt measured at target tension, by its index in the pair. */
  atTarget: 0 | 1 | null
  toolheadGrams: number | null
  gantryGrams: number | null
  xPeak: number | null
  yPeak: number | null
}

const storageKey = 'alabaster.beltGuide'

export const emptyBeltGuideValues: Readonly<BeltGuideValues> = Object.freeze({
  firstPeaks: '',
  secondPeaks: '',
  unpaired: 0,
  atTarget: null,
  toolheadGrams: null,
  gantryGrams: null,
  xPeak: null,
  yPeak: null,
})

function text(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 200) : ''
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Field by field rather than all or nothing: a value from another Alabaster
 * version or a hand-edited export keeps every field that still makes sense.
 * `null` when nothing but defaults would remain, so a printer with nothing
 * typed stores nothing and a bundle carries `null` for it.
 */
export function normalizeBeltGuideValues(value: unknown): BeltGuideValues | null {
  if (!isRecord(value)) return null
  const unpaired =
    typeof value.unpaired === 'number' && Number.isFinite(value.unpaired)
      ? Math.max(0, Math.round(value.unpaired))
      : 0
  const gantry =
    typeof value.gantryGrams === 'number' &&
    Number.isFinite(value.gantryGrams) &&
    value.gantryGrams >= 0
      ? value.gantryGrams
      : null
  const values: BeltGuideValues = {
    firstPeaks: text(value.firstPeaks),
    secondPeaks: text(value.secondPeaks),
    unpaired,
    atTarget: value.atTarget === 0 || value.atTarget === 1 ? value.atTarget : null,
    toolheadGrams: positive(value.toolheadGrams),
    gantryGrams: gantry,
    xPeak: positive(value.xPeak),
    yPeak: positive(value.yPeak),
  }
  const empty = (Object.keys(emptyBeltGuideValues) as (keyof BeltGuideValues)[]).every(
    (key) => values[key] === emptyBeltGuideValues[key],
  )
  return empty ? null : values
}

function storedTable(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}')
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * The belt guide's inputs, kept per printer. The masses are facts about the
 * machine that nothing in Klipper reports, and retyping them for every belt
 * run is the friction that would stop the cross-check being used; the peaks
 * are kept with them so a reader who tensions a belt and comes back finds the
 * reading they were working from.
 *
 * In the settings bundle, like Z motion, so a second device opening the same
 * printer gets the same masses.
 */
export const useBeltGuideStore = defineStore('beltGuide', () => {
  const printers = usePrintersStore()

  const stored = ref<BeltGuideValues | null>(
    normalizeBeltGuideValues(readScoped(storedTable(), printers.activeScopeKeys)),
  )

  watch(
    () => printers.activeScopeKeys.join(','),
    () => {
      stored.value = normalizeBeltGuideValues(readScoped(storedTable(), printers.activeScopeKeys))
    },
  )

  function persist(): void {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify(writeScoped(storedTable(), printers.activeScopeKeys, stored.value)),
    )
  }

  const values = computed<BeltGuideValues>(() => stored.value ?? { ...emptyBeltGuideValues })

  function update(patch: Partial<BeltGuideValues>): void {
    stored.value = normalizeBeltGuideValues({ ...values.value, ...patch })
    persist()
  }

  /** Applies a settings bundle's value; null clears the printer back to nothing typed. */
  function replace(value: unknown): void {
    stored.value = normalizeBeltGuideValues(value)
    persist()
  }

  return { stored, values, update, replace }
})
