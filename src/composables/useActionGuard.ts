import { computed, type ComputedRef, type Ref, unref } from 'vue'

import { type ConfirmationKey, useConfirmationsStore } from '@/stores/confirmations'

/**
 * What a control costs if it runs. See `docs/design/button-system.md`'s
 * consequence ladder for the test that decides each one.
 *
 * - `reversible` — repeating or reversing the control restores the previous
 *   state, and nothing was consumed in between. No treatment at all.
 * - `disruptive` — it changes an active print's outcome, but the print survives
 *   and can be brought back. A caution hover, and no dialog — for a control
 *   reached for constantly while watching a print go wrong, where a dialog in
 *   front of it would be worse than none. Pause used to be this tier's
 *   reference case; it moved to `terminal` because nothing brings a paused
 *   print back on its own, so a misclick here is not actually free to reverse.
 *   No control currently ships at this tier, but the ladder keeps the rung for
 *   whatever next control fits its test: costs something, survives it, and is
 *   reached for too often to interrupt.
 * - `terminal` — it ends the print, or makes the machine forget something it
 *   cannot recompute. A dialog, and the danger livery.
 */
export type ActionTier = 'reversible' | 'disruptive' | 'terminal'

/**
 * Whether anything stands between the click and the consequence. This is a
 * separate axis from the tier, and keeping them separate is the whole point of
 * this composable: `danger` used to mean both "destructive" and "the dialog is
 * off", so a reader could not recover which one a red outline was asserting,
 * and the rule could only describe controls where the two coincided.
 *
 * `prompt` is not a lesser `confirm`. It marks a control that opens a
 * value-entry dialog, which carries the same typographic mark for the same
 * reason — the ellipsis has always meant "opens a dialog", not "asks yes or
 * no" — but no tier and no variant, because asking for a value is not itself a
 * consequence.
 */
export type ActionGuard = 'none' | 'confirm' | 'prompt'

/** A tier that may depend on printer state, so 3b can resolve to 1 when idle. */
type TierSource = ActionTier | (() => ActionTier)

/**
 * The variant a guarded control wears — its ordinary emphasis, chosen the way
 * every other control's is.
 */
export type ActionEmphasis = 'primary' | 'neutral' | 'quiet' | 'danger' | 'danger-quiet'

/**
 * One step up the emphasis scale, which is what removing a guard does.
 *
 * This is `button-system.md`'s original "a control whose confirmation has been
 * turned off moves up a variant", restored to being one rule rather than a
 * table of five hand-written cases. It reproduces every row of that table
 * (`neutral` and `primary` both land on `danger`, `danger-quiet` drops the
 * softening) and adds the step the table said did not exist: `danger` had
 * nowhere to go, so Cancel print looked identical whether or not anything was
 * going to catch a misclick. `critical` is that step.
 *
 * A committing action such as Start keeps its `primary` emphasis while guarded
 * precisely because this is one step, not a floor: its consequence is
 * commitment rather than destruction, so it has no business wearing danger
 * livery while the dialog is still there to ask.
 */
const escalation: Record<ActionEmphasis, 'button--danger' | 'button--critical'> = {
  neutral: 'button--danger',
  primary: 'button--danger',
  quiet: 'button--danger',
  'danger-quiet': 'button--danger',
  danger: 'button--critical',
}

const restingVariant: Record<ActionEmphasis, string | null> = {
  neutral: null,
  primary: 'button--primary',
  quiet: 'button--quiet',
  danger: 'button--danger',
  'danger-quiet': 'button--danger-quiet',
}

interface ActionGuardOptions {
  /**
   * Pass a getter, not a literal, whenever the tier depends on whether a job
   * is loaded. `() => printer.hasActivePrint ? 'terminal' : 'reversible'` is
   * the print-derived case: restarting Klipper against an idle machine is
   * something you do ten times while editing `printer.cfg`, and a dialog there
   * asks about a risk that is not present — which is exactly the interruption
   * that teaches people to switch confirmations off.
   */
  tier: TierSource
  /**
   * The variant this control wears while its guard is in place. Defaults to
   * `danger` for a terminal action, because a destructive control says so
   * whether or not it is about to ask. Pass `primary` or `neutral` for an action
   * whose consequence is commitment rather than destruction -- Start is the
   * case -- so it escalates from its own emphasis instead of starting at the
   * top of the scale.
   */
  emphasis?: ActionEmphasis
  /** A page-level confirmation, listed in `confirmationKeys`. */
  key?: ConfirmationKey
  /**
   * A module-local confirmation, backed by that module's own dashboard config.
   * Mutually exclusive with `key` in practice: an action answers to one setting,
   * never two, or the user sets a preference twice and finds it held half the
   * time.
   */
  moduleFlag?: Ref<boolean> | ComputedRef<boolean>
  /**
   * A `PromptDialog` trigger. Takes the mark and the ARIA relationship and
   * nothing else — no tier, no variant, no skip setting, because there is no
   * value to substitute for one the user did not type.
   */
  prompt?: boolean
}

/** What a call site binds. Never assembled by hand — see `variant` below. */
export interface ActionGuardBindings {
  'data-guard'?: ActionGuard
  'data-tier'?: 'disruptive'
  'aria-haspopup'?: 'dialog'
}

export interface ActionGuardResult {
  /** The resolved tier, recomputed as printer state changes. */
  tier: ComputedRef<ActionTier>
  /** Whether a dialog is going to open. False when the tier does not ask, or a skip setting is on. */
  guarded: ComputedRef<boolean>
  /**
   * The variant class this control must wear, derived and never passed in. A
   * call site able to supply its own variant could contradict its own guard,
   * which is the drift the button-system guard test fails the build over.
   *
   * `null` means the `neutral` default -- no variant class at all.
   */
  variant: ComputedRef<string | null>
  bind: ComputedRef<ActionGuardBindings>
  /**
   * Run the action, or open the dialog first. `open` is called when a
   * confirmation is due; `run` when it is not.
   *
   * This is the part that pays for itself. The pattern it replaces required the
   * skip path and the confirm path to execute identical bodies, extracted by
   * hand at each site; owning the branch here means there is one body by
   * construction rather than by discipline.
   */
  request: (run: () => void, open: () => void) => void
}

export function useActionGuard(options: ActionGuardOptions): ActionGuardResult {
  const confirmations = useConfirmationsStore()

  const tier = computed<ActionTier>(() =>
    typeof options.tier === 'function' ? options.tier() : options.tier,
  )

  const guarded = computed(() => {
    if (options.prompt === true) return true
    // A tier that does not ask has nothing for a skip setting to switch off.
    if (tier.value !== 'terminal') return false
    if (options.moduleFlag !== undefined) {
      return !confirmations.skipAll && !unref(options.moduleFlag)
    }
    if (options.key !== undefined) return confirmations.shouldConfirm(options.key)
    return false
  })

  const emphasis: ActionEmphasis = options.emphasis ?? 'danger'

  const variant = computed(() => {
    // Nothing to escalate: a prompt has no consequence of its own, and a tier
    // below terminal was never carrying a guard for the absence of one to say
    // anything about.
    if (options.prompt === true || tier.value !== 'terminal') return restingVariant[emphasis]
    return guarded.value ? restingVariant[emphasis] : escalation[emphasis]
  })

  const bind = computed<ActionGuardBindings>(() => {
    if (options.prompt === true) return { 'data-guard': 'prompt', 'aria-haspopup': 'dialog' }
    if (tier.value === 'disruptive') return { 'data-tier': 'disruptive' }
    if (guarded.value) return { 'data-guard': 'confirm', 'aria-haspopup': 'dialog' }
    return {}
  })

  function request(run: () => void, open: () => void): void {
    if (guarded.value) open()
    else run()
  }

  return { tier, guarded, variant, bind, request }
}
