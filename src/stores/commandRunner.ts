import { reactive, ref, type Ref } from 'vue'

import { useToastsStore } from '@/stores/toasts'

/**
 * The one implementation of AGENTS.md's mutating-command rule: a command that
 * fails is surfaced and waits for an explicit user retry — it is never queued
 * locally, never replayed after a reconnect, and an exclusive key never piles
 * onto itself while an earlier send is still in flight. This used to be copied
 * into three stores, and a drifted copy is the product rule silently broken in
 * one module only; keep changes to the rule here.
 *
 * "Exclusive" is the default. A caller passes `concurrent: true` only for a
 * command whose second press means "do it again" — a jog, a set-value — and
 * only where the reader chose to queue presses (`stores/commandPreferences.ts`).
 * Moonraker hands each such send to Klipper, whose single G-code mutex runs
 * them in arrival order; that is Klipper's queue, not a local one, and nothing
 * here ever re-sends a command.
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
  run(key: K, command: () => Promise<unknown>, options?: CommandRunOptions): Promise<boolean>
  clearCommandError(): void
  /**
   * Forgets every pending flag and the last failure. For printer switches: a
   * command sent to the printer we just left can never report back here.
   */
  reset(): void
}

export interface CommandRunOptions {
  /** Send even while the same key is in flight. See the interface comment for when that is right. */
  concurrent?: boolean
  /**
   * Claims a failure before it becomes a toast; return true when the caller
   * has reported it some other way (one summary for many lost sends, or
   * nothing at all when the header already says why). The failure still
   * counts — `run` returns false and `lastCommandError` is set.
   */
  claimError?: (error: unknown) => boolean
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
  // A count rather than the flag alone, because concurrent sends of one key
  // settle in any order and only the last one out may clear the flag.
  const inFlight = new Map<K, number>()
  // Bumped by `reset`, so a send from before a printer switch that settles
  // afterwards cannot decrement the new printer's counts.
  let generation = 0
  // Cast because `ref<K | null>` unwraps the generic to `string` — the ref
  // never holds a nested ref, so the unwrap TypeScript guards against here
  // cannot happen.
  const lastCommandError = ref(null) as Ref<K | null>
  const lastCommandErrorMessage = ref<string | null>(null)
  const toasts = useToastsStore()

  async function run(
    key: K,
    command: () => Promise<unknown>,
    options: CommandRunOptions = {},
  ): Promise<boolean> {
    if (pendingCommands[key] && !options.concurrent) return false
    const runGeneration = generation
    inFlight.set(key, (inFlight.get(key) ?? 0) + 1)
    pendingCommands[key] = true
    lastCommandError.value = null
    lastCommandErrorMessage.value = null
    try {
      await command()
      return true
    } catch (error) {
      if (runGeneration === generation) {
        lastCommandError.value = key
        lastCommandErrorMessage.value = refusalText(error)
      }
      if (!options.claimError?.(error)) toasts.pushError(error)
      return false
    } finally {
      if (runGeneration === generation) {
        const remaining = (inFlight.get(key) ?? 1) - 1
        if (remaining > 0) {
          inFlight.set(key, remaining)
        } else {
          inFlight.delete(key)
          pendingCommands[key] = false
        }
      }
    }
  }

  function clearCommandError(): void {
    lastCommandError.value = null
    lastCommandErrorMessage.value = null
  }

  function reset(): void {
    generation += 1
    inFlight.clear()
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
