import { defineStore } from 'pinia'
import { ref } from 'vue'

import { isRecord } from '@/utils/records'

const storageKey = 'alabaster.commandPreferences.v1'

export type CommandDispatchMode = 'queue' | 'wait'

export interface StoredCommandPreferences {
  dispatch: CommandDispatchMode
  showQueue: boolean
}

export const defaultCommandPreferences: StoredCommandPreferences = {
  dispatch: 'queue',
  showQueue: false,
}

export function isCommandDispatchMode(value: unknown): value is CommandDispatchMode {
  return value === 'queue' || value === 'wait'
}

function read(): StoredCommandPreferences {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null')
    if (!isRecord(parsed)) return { ...defaultCommandPreferences }
    return {
      dispatch: isCommandDispatchMode(parsed.dispatch)
        ? parsed.dispatch
        : defaultCommandPreferences.dispatch,
      showQueue:
        typeof parsed.showQueue === 'boolean'
          ? parsed.showQueue
          : defaultCommandPreferences.showQueue,
    }
  } catch {
    return { ...defaultCommandPreferences }
  }
}

/**
 * What a control does while the printer is still working through an earlier
 * command, and whether the header lists what this browser is waiting on.
 * Carried by the settings bundle like every other preference, so it follows
 * the Moonraker user it is synced under — the shared `default` profile on a
 * printer without login.
 */
export const useCommandPreferencesStore = defineStore('commandPreferences', () => {
  const initial = read()
  const dispatch = ref<CommandDispatchMode>(initial.dispatch)
  const showQueue = ref(initial.showQueue)

  function persist(): void {
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ dispatch: dispatch.value, showQueue: showQueue.value }),
      )
    } catch {
      // A full or unavailable store costs persistence, never the live choice.
    }
  }

  function setDispatch(mode: CommandDispatchMode): void {
    dispatch.value = mode
    persist()
  }

  function setShowQueue(show: boolean): void {
    showQueue.value = show
    persist()
  }

  /** Repairs rather than rejects, like every other bundle field: an invalid half is left as it was. */
  function replace(input: unknown): void {
    if (!isRecord(input)) return
    if (isCommandDispatchMode(input.dispatch)) dispatch.value = input.dispatch
    if (typeof input.showQueue === 'boolean') showQueue.value = input.showQueue
    persist()
  }

  return { dispatch, showQueue, setDispatch, setShowQueue, replace }
})
