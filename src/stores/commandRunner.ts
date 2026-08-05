import { reactive, ref, type Ref } from 'vue'

import { useToastsStore } from '@/stores/toasts'

/**
 * The one implementation of AGENTS.md's mutating-command rule: a command that
 * fails is surfaced and waits for an explicit user retry — it is never queued,
 * never replayed after a reconnect, and never allowed to pile onto itself
 * while an earlier send is still in flight. This used to be copied into three
 * stores, and a drifted copy is the product rule silently broken in one
 * module only; keep changes to the rule here.
 *
 * `lastCommandError` names *which* action failed, for the one caller
 * (`App.vue`'s notification bell) that still needs to know a command recently
 * failed; `lastCommandErrorMessage` keeps Klipper's or Moonraker's own
 * refusal text beside it. Neither is rendered inline any more — the toast
 * pushed below is the single place a failure reaches the user — but both stay
 * single slots, since a press is one action at a time.
 */
export interface CommandRunner<K extends string> {
  /** Which commands are in flight, keyed for direct template reads. */
  pendingCommands: Record<K, boolean>
  lastCommandError: Ref<K | null>
  lastCommandErrorMessage: Ref<string | null>
  /** Runs `command` under the no-replay rule; false when refused or failed. */
  run(key: K, command: () => Promise<unknown>): Promise<boolean>
  clearCommandError(): void
  /**
   * Forgets every pending flag and the last failure. For printer switches: a
   * command sent to the printer we just left can never report back here.
   */
  reset(): void
}

function refusalText(error: unknown): string | null {
  if (!(error instanceof Error)) return null
  const message = error.message.trim()
  return message === '' ? null : message
}

export function createCommandRunner<K extends string>(keys: readonly K[]): CommandRunner<K> {
  const pendingCommands = reactive(Object.fromEntries(keys.map((key) => [key, false]))) as Record<
    K,
    boolean
  >
  // Cast because `ref<K | null>` unwraps the generic to `string` — the ref
  // never holds a nested ref, so the unwrap TypeScript guards against here
  // cannot happen.
  const lastCommandError = ref(null) as Ref<K | null>
  const lastCommandErrorMessage = ref<string | null>(null)
  const toasts = useToastsStore()

  async function run(key: K, command: () => Promise<unknown>): Promise<boolean> {
    if (pendingCommands[key]) return false
    pendingCommands[key] = true
    lastCommandError.value = null
    lastCommandErrorMessage.value = null
    try {
      await command()
      return true
    } catch (error) {
      lastCommandError.value = key
      lastCommandErrorMessage.value = refusalText(error)
      toasts.pushError(error)
      return false
    } finally {
      pendingCommands[key] = false
    }
  }

  function clearCommandError(): void {
    lastCommandError.value = null
    lastCommandErrorMessage.value = null
  }

  function reset(): void {
    for (const key of keys) pendingCommands[key] = false
    clearCommandError()
  }

  return {
    pendingCommands,
    lastCommandError,
    lastCommandErrorMessage,
    run,
    clearCommandError,
    reset,
  }
}
