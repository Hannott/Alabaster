import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { useDashboardLayoutStore } from '@/stores/dashboardLayout'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { readScoped, writeScoped } from '@/stores/printerScope'
import { usePrintersStore } from '@/stores/printers'
import { isRecord } from '@/utils/records'

export type ZMovingPart = 'nozzle' | 'bed'
export type ZPlusDirection = 'up' | 'down'

export interface ZMotion {
  movingPart: ZMovingPart
  zPlus: ZPlusDirection
}

export const zMovingParts: readonly ZMovingPart[] = ['nozzle', 'bed']
export const zPlusDirections: readonly ZPlusDirection[] = ['up', 'down']

const storageKey = 'alabaster.zMotion'

/**
 * The direction Z+ moves each part on most machines: away from the other one,
 * with Z 0 where the nozzle meets the bed. Choosing a part resets the
 * direction to this, because the answer given for the other part says nothing
 * about this one.
 */
export function usualZPlus(part: ZMovingPart): ZPlusDirection {
  return part === 'nozzle' ? 'up' : 'down'
}

export function normalizeZMotion(value: unknown): ZMotion | null {
  if (!isRecord(value)) return null
  const { movingPart, zPlus } = value
  if (movingPart !== 'nozzle' && movingPart !== 'bed') return null
  if (zPlus !== 'up' && zPlus !== 'down') return null
  return { movingPart, zPlus }
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
 * Which part moves when Z changes, and which way Z+ moves it — a fact about
 * the machine that Klipper has no way to report, and that every Z control on
 * the Movement card is drawn from: controls are laid out as the part that
 * moves, down on the left or at the bottom, up on the right or at the top.
 * No command changes; only where a control sits and what it says.
 *
 * Per printer, like Quick config's pins, and in the settings bundle so a
 * second device opening the same printer gets the same answer.
 *
 * Before this was a setting it was a per-card `swapZDirection` checkbox that
 * flipped only the Z slider. A printer with no stored answer reads one from
 * that: any Movement card with it on means a bed that Z+ moves down, which is
 * what the flipped slider drew.
 */
export const useZMotionStore = defineStore('zMotion', () => {
  const layout = useDashboardLayoutStore()
  const printerConfig = usePrinterConfigStore()
  const printers = usePrintersStore()

  const stored = ref<ZMotion | null>(
    normalizeZMotion(readScoped(storedTable(), printers.activeScopeKeys)),
  )

  watch(
    () => printers.activeScopeKeys.join(','),
    () => {
      stored.value = normalizeZMotion(readScoped(storedTable(), printers.activeScopeKeys))
    },
  )

  function persist(): void {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify(writeScoped(storedTable(), printers.activeScopeKeys, stored.value)),
    )
  }

  const legacy = computed<ZMotion | null>(() =>
    layout.profile.instances.some(
      (instance) => instance.moduleId === 'movement' && instance.config.swapZDirection === true,
    )
      ? { movingPart: 'bed', zPlus: 'down' }
      : null,
  )

  const motion = computed<ZMotion>(() => {
    if (printerConfig.isDelta) return { movingPart: 'nozzle', zPlus: 'up' }
    return stored.value ?? legacy.value ?? { movingPart: 'nozzle', zPlus: 'up' }
  })

  const movingPart = computed(() => motion.value.movingPart)
  const zPlusIsUp = computed(() => motion.value.zPlus === 'up')

  function setMovingPart(part: ZMovingPart): void {
    stored.value = { movingPart: part, zPlus: usualZPlus(part) }
    persist()
  }

  function setZPlus(direction: ZPlusDirection): void {
    stored.value = { movingPart: motion.value.movingPart, zPlus: direction }
    persist()
  }

  /** Applies a settings bundle's value; null clears the printer back to its default. */
  function replace(value: unknown): void {
    stored.value = normalizeZMotion(value)
    persist()
  }

  return { stored, motion, movingPart, zPlusIsUp, setMovingPart, setZPlus, replace }
})
