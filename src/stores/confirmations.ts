import { defineStore } from 'pinia'
import { reactive, toRefs } from 'vue'
import { isRecord } from '@/utils/records'

const storageKey = 'alabaster.confirmations.v1'

/**
 * One entry per `ConfirmDialog` that has no better local home — a plain page
 * with no settings surface of its own (Configuration, History, Machine,
 * Timelapse, Calibration's own delete) or the header's power menu. A
 * dashboard module's own confirmations are deliberately absent: they live in
 * that module's own settings pane, backed by its own dashboard `config`, the
 * same way `skipMotorsOffWarning` always did — see
 * `docs/design/dialog-system.md`'s "Skippable confirmations" for the split
 * and why `skipAll` still reaches both halves.
 *
 * `PromptDialog` and the documented multi-choice outlier
 * (`UpdateRecoveryDialog`) are absent for a different reason: skipping a
 * value-entry dialog has no value to submit in its place, and skipping a
 * three-way repair decision has no single default action to take on a user's
 * behalf. Only a binary confirm/cancel always has one.
 *
 * Naming mirrors the confirming component's own handler, not the dialog's
 * title key, so a rename of the copy never obligates a rename here.
 *
 * The console's two keys are the documented exception to the split above: they
 * are reached from a dashboard module *and* from a page, and one action with one
 * consequence must not answer to two settings. See
 * `docs/design/dialog-system.md`'s "One action on two surfaces".
 */
export const confirmationKeys = [
  'emergencyStop',
  'rebootHost',
  'shutdownHost',
  'deleteMeshProfile',
  'clearConsole',
  'clearCommandHistory',
  'discardFileChanges',
  'saveAllFiles',
  'discardAllFiles',
  'saveAllAndRestart',
  'deleteFileEntry',
  'openUnsupportedFile',
  'createIncludeTarget',
  'deleteHistoryJob',
  'reprintJob',
  'installUpdate',
  'removePrinter',
  'removeCamera',
  'deleteTimelapseVideo',
  'restartKlipper',
  'firmwareRestart',
  'clearJobQueue',
  'excludeObject',
  'farmCancelPrint',
  'farmPowerOff',
  'farmStartPrint',
  'deleteUser',
  'regenerateApiKey',
  'openLargeGcodeFile',
  'importSettings',
  'resetSettings',
  'forgetSyncedData',
  'rollbackUpdate',
  'stopService',
  'restartService',
] as const

export type ConfirmationKey = (typeof confirmationKeys)[number]

/**
 * A third level between `skipAll` and a single key: the actions whose whole
 * consequence is that a print is running. Grouping them is not tidying — these
 * are the confirmations a user most plausibly wants to keep or drop *together*,
 * because the decision behind them is one decision ("do I want to be asked
 * before something interrupts a job?") rather than five.
 *
 * Membership is by consequence, not by surface. `emergencyStop`, `rebootHost`
 * and `shutdownHost` are deliberately absent even though they also end a print:
 * they end it as a side effect of stopping the machine, and someone who wants
 * to reach for a restart without a dialog has not thereby said they want to
 * halt the printer without one.
 */
export const printInterruptingKeys = [
  'restartKlipper',
  'firmwareRestart',
  'clearJobQueue',
  'excludeObject',
  'farmCancelPrint',
  'farmPowerOff',
] as const satisfies readonly ConfirmationKey[]

export type ConfirmationGroup = 'printInterrupting'

const groupMembers: Record<ConfirmationGroup, readonly ConfirmationKey[]> = {
  printInterrupting: printInterruptingKeys,
}

export function groupOf(key: ConfirmationKey): ConfirmationGroup | null {
  for (const group of Object.keys(groupMembers) as ConfirmationGroup[]) {
    if (groupMembers[group].includes(key)) return group
  }
  return null
}

export interface StoredConfirmations {
  skipAll: boolean
  /** One entry per group, checked after `skipAll` and before the key's own row. */
  skipByGroup: Record<ConfirmationGroup, boolean>
  skipByKey: Record<ConfirmationKey, boolean>
  /**
   * Opt-in, not skippable — the inverse of every key above. Off by default
   * because it interrupts starting a print, which needed an explicit yes
   * rather than shipping on for everyone; see the History contract's
   * Maintenance section.
   */
  maintenanceReminderEnabled: boolean
  /** Unix milliseconds; `null` means never suppressed. */
  maintenanceReminderSuppressedUntil: number | null
}

/**
 * Shared by `readStored` (parsing the raw localStorage string) and
 * `replaceAll` (applying an already-parsed bundle from import/sync) — an
 * unreadable or old-shaped value falls back to `false`/`null` field by field
 * rather than rejecting the whole object, the same repair-not-reset stance
 * `dashboardLayout.ts`'s normalization takes.
 */
function normalizeStored(parsed: unknown): StoredConfirmations {
  const skipByKey = Object.fromEntries(confirmationKeys.map((key) => [key, false])) as Record<
    ConfirmationKey,
    boolean
  >
  const skipByGroup = { printInterrupting: false }
  const empty: StoredConfirmations = {
    skipAll: false,
    skipByGroup,
    skipByKey,
    maintenanceReminderEnabled: false,
    maintenanceReminderSuppressedUntil: null,
  }
  if (!isRecord(parsed)) return empty
  if (isRecord(parsed.skipByKey)) {
    for (const key of confirmationKeys) {
      if (parsed.skipByKey[key] === true) skipByKey[key] = true
    }
  }
  if (isRecord(parsed.skipByGroup)) {
    for (const group of Object.keys(skipByGroup) as ConfirmationGroup[]) {
      if (parsed.skipByGroup[group] === true) skipByGroup[group] = true
    }
  }
  return {
    skipAll: parsed.skipAll === true,
    skipByGroup,
    skipByKey,
    maintenanceReminderEnabled: parsed.maintenanceReminderEnabled === true,
    maintenanceReminderSuppressedUntil:
      typeof parsed.maintenanceReminderSuppressedUntil === 'number'
        ? parsed.maintenanceReminderSuppressedUntil
        : null,
  }
}

function readStored(): StoredConfirmations {
  try {
    return normalizeStored(JSON.parse(window.localStorage.getItem(storageKey) ?? 'null'))
  } catch {
    return normalizeStored(null)
  }
}

/** Milliseconds a snooze from "Not now" holds — long enough to mean something distinct from the daily cap below. */
const notNowSnoozeMs = 7 * 24 * 60 * 60 * 1000

export const useConfirmationsStore = defineStore('confirmations', () => {
  const stored = readStored()
  const state = reactive({
    skipAll: stored.skipAll,
    skipByGroup: stored.skipByGroup,
    skipByKey: stored.skipByKey,
    maintenanceReminderEnabled: stored.maintenanceReminderEnabled,
    maintenanceReminderSuppressedUntil: stored.maintenanceReminderSuppressedUntil,
  })

  function persist(): void {
    window.localStorage.setItem(storageKey, JSON.stringify(state))
  }

  /**
   * Whether the dialog for `key` should still open. Three levels, checked
   * outermost first, so a broader switch always wins over a narrower one and
   * turning it back off restores whatever the narrower ones were set to.
   */
  function shouldConfirm(key: ConfirmationKey): boolean {
    if (state.skipAll) return false
    const group = groupOf(key)
    if (group !== null && state.skipByGroup[group]) return false
    return !state.skipByKey[key]
  }

  /** Whether a level above `key`'s own row is what is deciding it right now. */
  function isOverridden(key: ConfirmationKey): boolean {
    if (state.skipAll) return true
    const group = groupOf(key)
    return group !== null && state.skipByGroup[group]
  }

  function setSkipAll(value: boolean): void {
    state.skipAll = value
    persist()
  }

  function setSkip(key: ConfirmationKey, value: boolean): void {
    state.skipByKey[key] = value
    persist()
  }

  function setSkipGroup(group: ConfirmationGroup, value: boolean): void {
    state.skipByGroup[group] = value
    persist()
  }

  function setMaintenanceReminderEnabled(value: boolean): void {
    state.maintenanceReminderEnabled = value
    persist()
  }

  /**
   * An overdue interval stays overdue for weeks, and a prompt that fires on
   * every print for weeks is a prompt the user learns to dismiss without
   * reading. Answering it at all — either way — quiets it until the next
   * local midnight, so it asks again at most once a day.
   */
  function suppressMaintenanceReminderUntilTomorrow(): void {
    const midnight = new Date()
    midnight.setHours(24, 0, 0, 0)
    state.maintenanceReminderSuppressedUntil = midnight.getTime()
    persist()
  }

  /** "Not now": for the user who knows and has the part on order — meaningfully longer than the daily cap, or it is the same button twice. */
  function snoozeMaintenanceReminder(): void {
    state.maintenanceReminderSuppressedUntil = Date.now() + notNowSnoozeMs
    persist()
  }

  function shouldShowMaintenanceReminder(): boolean {
    if (!state.maintenanceReminderEnabled) return false
    const until = state.maintenanceReminderSuppressedUntil
    return until === null || Date.now() >= until
  }

  /**
   * Applies a whole `StoredConfirmations` bundle in one write — import and
   * Moonraker-DB restore (`src/settings/bundle.ts`) both replace every field
   * at once rather than toggling keys one at a time, so this takes the same
   * repair-not-reset input `readStored` does instead of assuming its shape.
   */
  function replaceAll(data: unknown): void {
    const normalized = normalizeStored(data)
    state.skipAll = normalized.skipAll
    state.skipByGroup = normalized.skipByGroup
    state.skipByKey = normalized.skipByKey
    state.maintenanceReminderEnabled = normalized.maintenanceReminderEnabled
    state.maintenanceReminderSuppressedUntil = normalized.maintenanceReminderSuppressedUntil
    persist()
  }

  return {
    ...toRefs(state),
    shouldConfirm,
    isOverridden,
    setSkipAll,
    setSkip,
    setSkipGroup,
    setMaintenanceReminderEnabled,
    suppressMaintenanceReminderUntilTomorrow,
    snoozeMaintenanceReminder,
    shouldShowMaintenanceReminder,
    replaceAll,
  }
})
