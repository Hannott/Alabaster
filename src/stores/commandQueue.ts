import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { i18n } from '@/i18n'
import { useToastsStore } from '@/stores/toasts'

export interface QueuedCommand {
  id: number
  script: string
  /** i18n key of the surface that sent it — a card title or a page name. */
  originKey: string
  sentAt: number
  /** Whether any line is `G28`; see `isHomingScript`. */
  homing: boolean
}

/**
 * Any line of the script, not just the first, so a home combined with other
 * G-code on one console send still counts as homing.
 */
export function isHomingScript(script: string): boolean {
  return script.split('\n').some((line) => /^g28(\s|$)/i.test(line.trim()))
}

/**
 * One line for the list. `SAVE_GCODE_STATE`/`RESTORE_GCODE_STATE` are dropped:
 * a jog wraps its move in that pair, nobody typed it, and left in it pushes the
 * move itself past the end of the row.
 */
export function summarizeScript(script: string): string {
  const lines = script
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !/^(SAVE|RESTORE)_GCODE_STATE\b/i.test(line))
  return lines.length > 0 ? lines.join('; ') : script.trim()
}

/**
 * Every G-code script this browser has sent that the printer has not answered
 * yet, oldest first.
 *
 * Klipper runs scripts one at a time behind a single mutex, and Moonraker
 * answers `printer.gcode.script` only once Klipper has run it — so a request
 * may wait behind a heat soak for as long as the soak lasts, and is never
 * dropped for waiting. Send order is the order Klipper takes them in: one
 * WebSocket delivers them in order and the mutex serves them first come,
 * first served. The oldest entry is therefore the one running, unless another
 * client's script holds the mutex — which this list cannot see, since Klipper
 * exposes no queue of its own.
 *
 * The printer store adds and settles entries in `sendGcode` and `sendMacro`;
 * nothing else writes here.
 */
export const useCommandQueueStore = defineStore('commandQueue', () => {
  const toasts = useToastsStore()
  const entries = ref<QueuedCommand[]>([])
  let nextId = 1
  let lostCount = 0
  let lostFlush: ReturnType<typeof setTimeout> | null = null

  const isHoming = computed(() => entries.value.some((entry) => entry.homing))

  function add(script: string, originKey: string): number {
    const id = nextId++
    entries.value = [
      ...entries.value,
      { id, script, originKey, sentAt: Date.now(), homing: isHomingScript(script) },
    ]
    return id
  }

  function settle(id: number): void {
    entries.value = entries.value.filter((entry) => entry.id !== id)
  }

  /**
   * One toast for every send the dropped socket took with it, not one each:
   * the socket rejects all of them in the same tick, and ten queued jogs
   * becoming ten identical toasts says nothing the first did not. Their outcome
   * is unknown — Klipper may well run them — so the wording never claims they
   * failed.
   */
  function noteLost(): void {
    lostCount += 1
    lostFlush ??= setTimeout(() => {
      toasts.push(i18n.global.t('commandQueue.lostOnDisconnect', { count: lostCount }))
      lostCount = 0
      lostFlush = null
    }, 0)
  }

  /** For printer switches: an answer from the printer we just left can never arrive here. */
  function clear(): void {
    entries.value = []
  }

  return { entries, isHoming, add, settle, noteLost, clear }
})
