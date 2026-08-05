import type { Ref } from 'vue'

/**
 * The generation-guarded load that every refresh-on-reconnect store shares.
 *
 * The guard is a correctness mechanism, not scaffolding, and the failures it
 * prevents are all races: a response landing after the store was stopped or
 * the printer was switched must not overwrite fresh state, resurrect
 * `isLoading`, or report a failure that belongs to a connection we already
 * left. Before this existed the same try/catch/finally was hand-copied into
 * eleven stores, and a copy that gets one `finally` comparison wrong fails
 * only under a reconnect race — which is why the copies must not drift.
 *
 * `failed` clears just before a fresh result is applied, never at the start
 * of an attempt: a failure notice holds steady through a retry instead of
 * flashing off and back on. `apply` may set `failed` itself when the payload
 * turns out to be malformed — the clear has already happened by then.
 *
 * Honest departures, kept hand-rolled because their shape genuinely differs
 * (add to this list rather than bending the helper): `endstops.ts` skips a
 * tick while one is in flight and never clears the last reading;
 * `gcodeFiles.ts` and `machineFiles.ts` report through typed error slots
 * rather than a boolean; `timelapse.ts` empties its listing on failure;
 * `spool.ts` runs per-resource loading flags around one shared failure.
 */
export interface GuardedLoadState {
  isLoading: Ref<boolean>
  failed: Ref<boolean>
}

export interface GuardedLoad {
  /**
   * Runs one guarded load. Resolves true when `apply` ran against a result
   * that is still current; false on failure or when a newer run, a stop, or
   * a printer switch superseded this one first.
   */
  run<T>(fetch: () => Promise<T>, apply: (result: T) => void): Promise<boolean>
  /** Orphans any in-flight load: its result, failure, and loading flag land nowhere. */
  invalidate(): void
}

export function createGuardedLoad(state: GuardedLoadState): GuardedLoad {
  let generation = 0

  async function run<T>(fetch: () => Promise<T>, apply: (result: T) => void): Promise<boolean> {
    const current = ++generation
    state.isLoading.value = true
    try {
      const result = await fetch()
      if (current !== generation) return false
      state.failed.value = false
      apply(result)
      return true
    } catch {
      if (current === generation) state.failed.value = true
      return false
    } finally {
      if (current === generation) state.isLoading.value = false
    }
  }

  function invalidate(): void {
    generation += 1
    state.isLoading.value = false
  }

  return { run, invalidate }
}
