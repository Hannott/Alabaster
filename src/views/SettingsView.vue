<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppSelect from '@/components/AppSelect.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import DisclosureReveal from '@/components/DisclosureReveal.vue'
import PageHeading from '@/components/PageHeading.vue'
import PromptDialog from '@/components/PromptDialog.vue'
import CamerasCard from '@/components/settings/CamerasCard.vue'
import { useConsoleFont, type ConsoleFontChoice } from '@/composables/useConsoleFont'
import { useConsoleWeight, type ConsoleWeightMode } from '@/composables/useConsoleWeight'
import { useEditorIndent } from '@/composables/useEditorIndent'
import { useFont } from '@/composables/useFont'
import { useHiddenDestinations } from '@/composables/useHiddenDestinations'
import { useMinimalisticSidebar } from '@/composables/useMinimalisticSidebar'
import { usePageHeaders, type PageHeaderVisibility } from '@/composables/usePageHeaders'
import { useSettingsCategory, type SettingsCategory } from '@/composables/useSettingsCategory'
import { useSidebar } from '@/composables/useSidebar'
import { useTextWeight, type TextWeightMode } from '@/composables/useTextWeight'
import { useTheme, type ThemeMode } from '@/composables/useTheme'
import { useWakeLock } from '@/composables/useWakeLock'
import { indentWidths, type IndentWidth } from '@/features/machine/indent'
import { navigationDestinations } from '@/navigation/destinations'
import { ensureAllFontsLoaded, type FontId } from '@/fonts/registry'
import { setLocale, supportedLocales, type SupportedLocale } from '@/i18n'
import {
  createDateTimeFormatter,
  customDateTokens,
  dateFormatModes,
  formatCustomToken,
  previewDateFormat,
  previewTimeFormat,
  useDateTimeFormatMode,
  type DateFormatMode,
  type TimeFormatMode,
} from '@/i18n/formats'
import type { MoonrakerUserInfo } from '@/services/moonraker'
import {
  applySettingsBundle,
  collectSettingsBundle,
  defaultSettingsBundle,
} from '@/settings/bundle'
import { useActionGuard } from '@/composables/useActionGuard'
import { configBoolean } from '@/dashboard/context'
import type { DashboardModuleId } from '@/dashboard/layout'
import { useAuthStore } from '@/stores/auth'
import {
  type ConfirmationGroup as ConfirmationGroupId,
  type ConfirmationKey,
  useConfirmationsStore,
} from '@/stores/confirmations'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'
import { useMoonrakerStore, type ConnectionErrorKind } from '@/stores/moonraker'
import {
  printerDisplayLabel,
  printerHost,
  usePrintersStore,
  type PrinterEntry,
} from '@/stores/printers'
import { useServerCapabilitiesStore } from '@/stores/serverCapabilities'
import { useSettingsSyncStore } from '@/stores/settingsSync'
import { useToastsStore } from '@/stores/toasts'
import type { ThemePackId } from '@/themes/registry'
import { copyToClipboard } from '@/utils/clipboard'

const { locale, t } = useI18n({ useScope: 'global' })
const { mode: themeMode, setMode, setThemePack, themePack, themePacks } = useTheme()
const { fontId, fonts, setFontId } = useFont()
const { mode: textWeightMode, setTextWeightMode } = useTextWeight()
const { consoleFont, fonts: consoleFonts, setConsoleFont } = useConsoleFont()
const { mode: consoleWeightMode, setConsoleWeightMode } = useConsoleWeight()
const { mode: pageHeaderVisibility, setPageHeaderVisibility } = usePageHeaders()
const { isMinimalisticSidebar, setMinimalisticSidebar } = useMinimalisticSidebar()
const { setSidebarCollapsed } = useSidebar()
const { timeMode, dateMode, dateCustomPattern, setTimeMode, setDateMode, setDateCustomPattern } =
  useDateTimeFormatMode()
const wakeLock = useWakeLock()
const { indentWidth, setIndentWidth } = useEditorIndent()
const moonraker = useMoonrakerStore()
const printers = usePrintersStore()
const layout = useDashboardLayoutStore()
const confirmations = useConfirmationsStore()
const auth = useAuthStore()
const serverCapabilities = useServerCapabilitiesStore()
const settingsSync = useSettingsSyncStore()
const toasts = useToastsStore()
const endpointInput = ref(moonraker.endpoint)
const themeModes: readonly ThemeMode[] = ['system', 'light', 'dark']
const textWeightModes: readonly TextWeightMode[] = [
  'light',
  'regular',
  'medium',
  'semibold',
  'bold',
]
const consoleWeightModes: readonly ConsoleWeightMode[] = ['regular', 'bold']
const pageHeaderVisibilities: readonly PageHeaderVisibility[] = ['show', 'hide']

/** Turning minimalistic mode on also collapses the sidebar immediately, rather than only changing its future default. */
function toggleMinimalisticSidebar(): void {
  const next = !isMinimalisticSidebar.value
  setMinimalisticSidebar(next)
  if (next) setSidebarCollapsed(true)
}
const timeFormatModes: readonly TimeFormatMode[] = ['auto', 'h23', 'h12']

// Fixed rather than live: every option's parenthesized example reads off the
// same instant, so they stay comparable to each other and to the legend below.
const formatExampleDate = new Date()

function timeExample(mode: TimeFormatMode): string {
  return previewTimeFormat(mode, locale.value, formatExampleDate)
}

function dateExample(mode: DateFormatMode): string {
  return previewDateFormat(mode, locale.value, formatExampleDate, dateCustomPattern.value)
}

function customTokenExample(token: string): string {
  return formatCustomToken(token, formatExampleDate, locale.value)
}

const dateCustomPatternInput = ref(dateCustomPattern.value)
watch(dateCustomPatternInput, (pattern) => setDateCustomPattern(pattern))

function changeLocale(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  void setLocale(target.value as SupportedLocale)
}

/*
 * --- Category rail ---
 *
 * A page long enough to need scrolling to find one setting is exactly what
 * this replaces: picking a category shows only its card, and "Show all
 * settings" is the one entry that restores the rest. The rail itself never
 * scrolls away — it is sticky against the page's own scrolling, pinned flush
 * with the scrollport's visible top; see interface-standards.md's Settings
 * contract and `.settings-rail` in main.css — so it stays reachable
 * regardless of how far the chosen card's content runs. The
 * pick itself is persisted (`useSettingsCategory`) so leaving the page and
 * coming back does not reset it to "Show all".
 */
const categories: readonly { id: SettingsCategory; labelKey: string }[] = [
  { id: 'all', labelKey: 'settings.categories.all' },
  { id: 'connection', labelKey: 'connection.eyebrow' },
  { id: 'printers', labelKey: 'printers.eyebrow' },
  { id: 'cameras', labelKey: 'cameras.eyebrow' },
  { id: 'users', labelKey: 'users.eyebrow' },
  { id: 'language', labelKey: 'language.eyebrow' },
  { id: 'theme', labelKey: 'theme.eyebrow' },
  { id: 'display', labelKey: 'display.eyebrow' },
  { id: 'editor', labelKey: 'editor.eyebrow' },
  { id: 'confirmations', labelKey: 'confirmations.eyebrow' },
  { id: 'backup', labelKey: 'backup.eyebrow' },
]

const { activeCategory, setActiveCategory } = useSettingsCategory()

/*
 * A narrow viewport swaps the rail's buttons for this select — see the
 * "Settings contract" section of interface-standards.md for why a dropdown
 * replaced the earlier wrapped-button-strip attempt.
 */
function changeCategory(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  setActiveCategory(target.value as SettingsCategory)
}

function showCategory(id: Exclude<SettingsCategory, 'all'>): boolean {
  return activeCategory.value === 'all' || activeCategory.value === id
}

const connectionErrorKey = computed(() => {
  const keyByError: Record<Exclude<ConnectionErrorKind, 'none'>, string> = {
    invalidEndpoint: 'connection.errors.invalidEndpoint',
    unauthorized: 'connection.errors.unauthorized',
    connectionFailed: 'connection.errors.connectionFailed',
    originRefused: 'connection.errors.originRefused',
    requestFailed: 'connection.errors.requestFailed',
  }

  return moonraker.lastError === 'none' ? null : keyByError[moonraker.lastError]
})

function changeThemePack(event: Event): void {
  const target = event.target

  if (!(target instanceof HTMLSelectElement)) return

  setThemePack(target.value as ThemePackId)
}

function changeFont(event: Event): void {
  const target = event.target

  if (!(target instanceof HTMLSelectElement)) return

  setFontId(target.value as FontId)
}

function changeConsoleFont(event: Event): void {
  const target = event.target

  if (!(target instanceof HTMLSelectElement)) return

  setConsoleFont(target.value as ConsoleFontChoice)
}

function saveConnection(): void {
  if (moonraker.connect(endpointInput.value)) endpointInput.value = moonraker.endpoint
}

/*
 * --- Authorization ---
 *
 * `auth.info` and `auth.currentUser` are already current by the time this
 * view mounts: `auth.ts`'s own `start()` loads them the moment a connection
 * exists, since the header's account shortcut needs both before anyone has
 * opened Settings at all. Only the user list and the API key stay gated
 * behind the Users category itself actually being open — both are heavier,
 * per-account data nothing outside that card ever needs.
 */
watch(
  () =>
    moonraker.isConnected &&
    showCategory('users') &&
    serverCapabilities.hasComponent('authorization'),
  (shouldLoad) => {
    if (shouldLoad) {
      void auth.loadUsers()
      void auth.loadApiKey()
    }
  },
  { immediate: true },
)

const loginUsername = ref('')
const loginPassword = ref('')
const loginSource = ref('')

async function submitLogin(): Promise<void> {
  const availableSources = auth.info?.available_sources ?? []
  const source = availableSources.length > 1 && loginSource.value ? loginSource.value : undefined
  const success = await auth.login(loginUsername.value, loginPassword.value, source)
  if (!success) return
  loginUsername.value = ''
  loginPassword.value = ''
  // `access.login` authenticates the current connection immediately, but
  // every subscribe/load already refused as unauthorized needs a clean retry
  // — a reconnect is the one existing path that redoes all of them.
  moonraker.reconnect()
}

async function submitLogout(): Promise<void> {
  await auth.logout()
}

const currentPasswordInput = ref('')
const newPasswordInput = ref('')

async function submitChangePassword(): Promise<void> {
  const success = await auth.changePassword(currentPasswordInput.value, newPasswordInput.value)
  if (!success) return
  currentPasswordInput.value = ''
  newPasswordInput.value = ''
}

const addUserNameInput = ref('')
const addUserPasswordInput = ref('')

async function submitCreateUser(): Promise<void> {
  const success = await auth.createUser(addUserNameInput.value, addUserPasswordInput.value)
  if (!success) return
  addUserNameInput.value = ''
  addUserPasswordInput.value = ''
  // `access.post_user` just logged this connection into the account it
  // created, exactly like an interactive login would — the same clean retry
  // is needed for the same reason.
  moonraker.reconnect()
}

const otherUsers = computed(() =>
  auth.users.filter((user) => user.username !== auth.currentUser?.username),
)

const pendingUserDeletion = ref<MoonrakerUserInfo | null>(null)

/*
 * These two had no skip setting, which the dialog-system contract does not
 * allow: every binary confirm in the application can be turned off, because a
 * guard the user cannot remove becomes a guard the user learns to click
 * through. Both are terminal on their own terms -- a deleted Moonraker user and
 * a rotated API key are gone whatever the printer is doing -- so neither tier
 * depends on print state.
 */
const deleteUserGuard = useActionGuard({
  tier: 'terminal',
  emphasis: 'danger-quiet',
  key: 'deleteUser',
})

const regenerateApiKeyGuard = useActionGuard({
  tier: 'terminal',
  emphasis: 'neutral',
  key: 'regenerateApiKey',
})

function requestUserDeletion(user: MoonrakerUserInfo): void {
  deleteUserGuard.request(
    () => void auth.deleteUser(user.username),
    () => (pendingUserDeletion.value = user),
  )
}

function requestApiKeyRegeneration(): void {
  regenerateApiKeyGuard.request(
    () => void auth.regenerateApiKey(),
    () => (pendingApiKeyRegeneration.value = true),
  )
}

const apiKeyCopied = ref(false)
let apiKeyCopiedTimeout: ReturnType<typeof setTimeout> | undefined

async function copyApiKey(): Promise<void> {
  if (!auth.apiKey) return
  const succeeded = await copyToClipboard(auth.apiKey)
  if (!succeeded) {
    toasts.push(t('users.apiKey.copyFailed'))
    return
  }
  apiKeyCopied.value = true
  clearTimeout(apiKeyCopiedTimeout)
  apiKeyCopiedTimeout = setTimeout(() => (apiKeyCopied.value = false), 1500)
}

async function confirmUserDeletion(): Promise<void> {
  if (pendingUserDeletion.value) await auth.deleteUser(pendingUserDeletion.value.username)
  pendingUserDeletion.value = null
}

const pendingApiKeyRegeneration = ref(false)

async function confirmApiKeyRegeneration(): Promise<void> {
  await auth.regenerateApiKey()
  pendingApiKeyRegeneration.value = false
}

/*
 * --- Printers ---
 *
 * Switching, renaming, and removing act on a whole entry rather than on the
 * live connection directly, so each one goes through the store that can make
 * the two agree — `moonraker.selectPrinter`/`removePrinter` reconnect exactly
 * when the printer in front actually changes.
 */

const addEndpointInput = ref('')
const addLabelInput = ref('')
const addError = ref(false)
type DashboardSeed = 'blank' | 'copy'
const dashboardSeed = ref<DashboardSeed>('blank')
const copyFromId = ref(printers.activeId || (printers.entries[0]?.id ?? ''))

const copyFromOptions = computed(() =>
  printers.entries.map((entry) => ({ value: entry.id, label: printerDisplayLabel(entry) })),
)

function submitAddPrinter(): void {
  const countBeforeAdd = printers.entries.length
  const entry = printers.addPrinter(addEndpointInput.value, addLabelInput.value)
  if (!entry) {
    addError.value = true
    return
  }
  addError.value = false

  /*
   * A typed address that already belongs to another saved printer switches to
   * it rather than creating a second entry — `addPrinter` already handles
   * that. The dashboard copy must not run in that case: `entry` would then be
   * someone else's printer, and copying onto it would overwrite a dashboard
   * that already exists rather than seed a blank one.
   */
  const isNewEntry = printers.entries.length > countBeforeAdd
  if (isNewEntry && dashboardSeed.value === 'copy' && copyFromId.value) {
    layout.copyProfileFrom(printers.scopeKeysFor(copyFromId.value), entry.id)
  }
  moonraker.connect(entry.endpoint)

  addEndpointInput.value = ''
  addLabelInput.value = ''
  dashboardSeed.value = 'blank'
}

const hiddenDestinations = useHiddenDestinations()

/*
 * Read off the registry rather than restated: the count that earns the
 * destination is declared there, and a second copy here would be the one that
 * drifts. No Farm entry at all means no switch, rather than a switch guessing
 * at a threshold.
 */
const farmMinimumPrinters =
  navigationDestinations.find((destination) => destination.name === 'farm')
    ?.requiresSavedPrinters ?? Number.POSITIVE_INFINITY

/**
 * The Farm row is offered only where the destination is otherwise earned.
 *
 * A switch that does nothing is worse than no switch: on a single-printer
 * install the rail has no Farm entry to show or hide, and a control explaining
 * that in a hint would be explaining the product's own gating to somebody who
 * has not met the page yet.
 */
const canOfferFarm = computed(() => printers.entries.length >= farmMinimumPrinters)

const showsFarmDestination = computed(() => !hiddenDestinations.isHidden('farm'))

const pendingRename = ref<PrinterEntry | null>(null)

/**
 * What clearing the name falls back to — which is no longer always the address.
 * A printer that has told us what it calls itself is shown by that name, so a
 * hint promising the address would be describing a different product.
 */
const renameHint = computed(() => {
  const entry = pendingRename.value
  if (!entry) return ''
  if (entry.discoveredName)
    return t('printers.renameHintDiscovered', { name: entry.discoveredName })
  return t('printers.renameHint', { host: printerHost(entry.endpoint) })
})

function confirmRename(value: string): void {
  if (pendingRename.value) printers.setLabel(pendingRename.value.id, value)
  pendingRename.value = null
}

const pendingRemoval = ref<PrinterEntry | null>(null)
const pendingRemovalName = computed(() =>
  pendingRemoval.value ? printerDisplayLabel(pendingRemoval.value) : '',
)

function confirmRemoval(): void {
  if (pendingRemoval.value) moonraker.removePrinter(pendingRemoval.value.id)
  pendingRemoval.value = null
}

function requestRemoval(entry: PrinterEntry): void {
  if (confirmations.shouldConfirm('removePrinter')) pendingRemoval.value = entry
  else moonraker.removePrinter(entry.id)
}

/*
 * --- Confirmations ---
 *
 * One row per `ConfirmDialog` that has no dashboard module of its own to live
 * in, grouped by the surface it confirms on — see
 * `docs/design/dialog-system.md`. `confirmationKeys` is the source of truth
 * for which keys belong here, so one present in it but missing a row below (or
 * the reverse) is a mistake this page has no way to catch silently forever —
 * the registry test below does.
 */
interface ConfirmationGroup {
  titleKey: string
  keys: readonly ConfirmationKey[]
  /**
   * A group-level switch, when this group's members answer to one. Only
   * `printInterrupting` has one: the decision behind those rows is a single
   * decision -- do I want to be asked before something interrupts a job --
   * rather than five, so a reader who has made it once should not have to make
   * it five times. Every other group here is a grouping for reading, not a
   * level of the setting.
   */
  group?: ConfirmationGroupId
  descriptionKey?: string
}

const confirmationGroups: readonly ConfirmationGroup[] = [
  { titleKey: 'confirmations.groups.power', keys: ['emergencyStop', 'rebootHost', 'shutdownHost'] },
  {
    titleKey: 'confirmations.groups.printInterrupting',
    group: 'printInterrupting',
    descriptionKey: 'confirmations.printInterruptingDescription',
    keys: ['restartKlipper', 'firmwareRestart', 'clearJobQueue', 'excludeObject'],
  },
  {
    titleKey: 'confirmations.groups.farm',
    keys: ['farmCancelPrint', 'farmPowerOff', 'farmStartPrint'],
  },
  { titleKey: 'confirmations.groups.bedMesh', keys: ['deleteMeshProfile'] },
  // One group for both console surfaces: the card's header action and the page's
  // toolbar clear the same transcript and write the same cutoff, so they share
  // the setting rather than each carrying one.
  { titleKey: 'confirmations.groups.console', keys: ['clearConsole', 'clearCommandHistory'] },
  {
    titleKey: 'confirmations.groups.configuration',
    keys: [
      'discardFileChanges',
      'saveAllFiles',
      'discardAllFiles',
      'saveAllAndRestart',
      'deleteFileEntry',
      'openUnsupportedFile',
      'createIncludeTarget',
    ],
  },
  { titleKey: 'confirmations.groups.history', keys: ['deleteHistoryJob', 'reprintJob'] },
  {
    titleKey: 'confirmations.groups.machine',
    keys: ['installUpdate', 'rollbackUpdate', 'stopService', 'restartService'],
  },
  { titleKey: 'confirmations.groups.printers', keys: ['removePrinter'] },
  { titleKey: 'confirmations.groups.cameras', keys: ['removeCamera'] },
  {
    titleKey: 'confirmations.groups.accounts',
    keys: ['deleteUser', 'regenerateApiKey'],
  },
  { titleKey: 'confirmations.groups.gcodeViewer', keys: ['openLargeGcodeFile'] },
  { titleKey: 'confirmations.groups.timelapse', keys: ['deleteTimelapseVideo'] },
  {
    titleKey: 'confirmations.groups.backup',
    keys: ['importSettings', 'resetSettings', 'forgetSyncedData'],
  },
]

/*
 * A row renders checked when *anything* above it is skipping the dialog, and
 * disabled when that something is not the row itself -- checked because every
 * dialog genuinely is being skipped, disabled because the row is not what is
 * deciding it, and titled because a checked-but-unclickable control with no
 * explanation reads as a bug. Turning the outer switch back off restores
 * whatever each row was set to on its own; it never resets them.
 */
function isConfirmationSkipped(key: ConfirmationKey): boolean {
  return !confirmations.shouldConfirm(key)
}

function isConfirmationOverridden(key: ConfirmationKey): boolean {
  return confirmations.isOverridden(key)
}

function overrideTitle(key: ConfirmationKey): string | undefined {
  if (confirmations.skipAll) return t('confirmations.globalOverride')
  if (confirmations.isOverridden(key)) return t('confirmations.groupOverride')
  return undefined
}

function toggleConfirmation(key: ConfirmationKey): void {
  confirmations.setSkip(key, !confirmations.skipByKey[key])
}

function isGroupSkipped(group: ConfirmationGroupId): boolean {
  return confirmations.skipAll || confirmations.skipByGroup[group]
}

function toggleGroup(group: ConfirmationGroupId): void {
  confirmations.setSkipGroup(group, !confirmations.skipByGroup[group])
}

/*
 * --- Module guards, mirrored ---
 *
 * A dashboard module's own confirmations (Print, Movement, Temperatures,
 * BedMesh) are backed by that module's own dashboard `config`, not by
 * `confirmations.ts` — see `docs/design/dialog-system.md`'s "Module guards,
 * mirrored on Settings". They still live in each module's own settings pane;
 * this section renders a second checkbox for the same value so someone can
 * see and change every guard in the app from one page, rather than opening a
 * module's settings to find one. It reads and writes the same
 * `dashboardLayout` instance `config` that module's own pane does — there is
 * one value, shown twice, never a separate copy to drift from it.
 *
 * None of Print, Movement, Temperatures, or BedMesh supports more than one
 * dashboard instance (`registry.ts` has no `supportsMultiple` on any of
 * them), and `normalizeInstances` guarantees every registered module keeps
 * exactly one instance even while absent from the dashboard itself — so
 * "the" instance for a module id is never ambiguous here.
 */
interface ModuleGuardRow {
  key: string
  labelKey: string
}

interface ModuleGuardGroup {
  moduleId: DashboardModuleId
  titleKey: string
  rows: readonly ModuleGuardRow[]
}

const moduleGuardGroups: readonly ModuleGuardGroup[] = [
  {
    moduleId: 'print',
    titleKey: 'dashboard.modules.print',
    rows: [
      { key: 'skipStartWarning', labelKey: 'dashboard.print.skipStartWarning' },
      { key: 'skipPauseWarning', labelKey: 'dashboard.print.skipPauseWarning' },
      { key: 'skipCancelWarning', labelKey: 'dashboard.print.skipCancelWarning' },
    ],
  },
  {
    moduleId: 'movement',
    titleKey: 'dashboard.modules.movement',
    rows: [
      { key: 'skipMotorsOffWarning', labelKey: 'dashboard.movement.skipMotorsOffWarning' },
      { key: 'skipLevelingWarning', labelKey: 'dashboard.movement.skipLevelingWarning' },
    ],
  },
  {
    moduleId: 'temperatures',
    titleKey: 'dashboard.modules.temperatures',
    rows: [
      { key: 'skipCalibrationWarning', labelKey: 'dashboard.temperature.skipCalibrationWarning' },
    ],
  },
  {
    moduleId: 'bedMesh',
    titleKey: 'dashboard.modules.bedMesh',
    rows: [
      { key: 'skipDeleteProfileWarning', labelKey: 'dashboard.bedMesh.skipDeleteProfileWarning' },
    ],
  },
]

function moduleInstance(moduleId: DashboardModuleId) {
  return layout.profile.instances.find((instance) => instance.moduleId === moduleId)
}

function isModuleGuardSkipped(moduleId: DashboardModuleId, key: string): boolean {
  return confirmations.skipAll || configBoolean(moduleInstance(moduleId)?.config ?? {}, key, false)
}

function toggleModuleGuard(moduleId: DashboardModuleId, key: string): void {
  const instance = moduleInstance(moduleId)
  if (!instance) return
  layout.updateConfig(instance.instanceId, { [key]: !configBoolean(instance.config, key, false) })
}

function moduleGuardTitle(): string | undefined {
  return confirmations.skipAll ? t('confirmations.globalOverride') : undefined
}

/*
 * --- Backup ---
 *
 * Export/import/reset and Moonraker-DB sync all move the same
 * `SettingsBundle` (`src/settings/bundle.ts`) — export downloads it, import
 * parses a file back into it, reset applies a freshly-built default one, and
 * sync pushes/pulls it through `stores/settingsSync.ts`. None of the four
 * reloads anything; every apply happens live.
 */
function exportSettings(): void {
  const blob = new Blob([JSON.stringify(collectSettingsBundle(), null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'alabaster-settings.json'
  link.click()
  URL.revokeObjectURL(url)
}

const importInput = ref<HTMLInputElement | null>(null)
const importParseError = ref(false)
const pendingImport = ref<unknown>(null)

function openImportPicker(): void {
  importInput.value?.click()
}

async function onImportChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const parsed = JSON.parse(await file.text())
    importParseError.value = false
    if (confirmations.shouldConfirm('importSettings')) pendingImport.value = parsed
    else await applySettingsBundle(parsed)
  } catch {
    importParseError.value = true
  }
}

async function confirmImport(): Promise<void> {
  const parsed = pendingImport.value
  pendingImport.value = null
  if (parsed !== null) await applySettingsBundle(parsed)
}

const pendingReset = ref(false)

function requestReset(): void {
  if (confirmations.shouldConfirm('resetSettings')) pendingReset.value = true
  else void applySettingsBundle(defaultSettingsBundle())
}

async function confirmReset(): Promise<void> {
  pendingReset.value = false
  await applySettingsBundle(defaultSettingsBundle())
}

function toggleSync(): void {
  const entry = printers.activeEntry
  if (!entry) return
  void settingsSync.setEnabled(entry.id, !settingsSync.isEnabled)
}

const pendingForget = ref(false)

function requestForget(): void {
  if (confirmations.shouldConfirm('forgetSyncedData')) pendingForget.value = true
  else void settingsSync.forget()
}

async function confirmForget(): Promise<void> {
  pendingForget.value = false
  await settingsSync.forget()
}

const lastSyncedDisplay = computed(() => {
  const value = settingsSync.lastSyncedAt
  return value ? createDateTimeFormatter(locale.value).format(new Date(value)) : null
})
</script>

<template>
  <section class="standard-page">
    <PageHeading :title="t('settings.title')" />

    <div class="settings-page">
      <div class="settings-body">
        <nav class="settings-rail" :aria-label="t('settings.categoriesLabel')">
          <AppButton
            v-for="category in categories"
            :key="category.id"
            variant="quiet"
            size="sm"
            start
            block
            :label="t(category.labelKey)"
            class="settings-rail-button"
            :aria-current="activeCategory === category.id ? 'true' : undefined"
            @click="setActiveCategory(category.id)"
          />

          <select
            :value="activeCategory"
            class="field field--block settings-rail-select"
            :aria-label="t('settings.categoriesLabel')"
            @change="changeCategory"
          >
            <option v-for="category in categories" :key="category.id" :value="category.id">
              {{ t(category.labelKey) }}
            </option>
          </select>
        </nav>

        <div class="settings-content">
          <section
            v-if="showCategory('connection')"
            class="connection-panel page-card"
            :data-pending="moonraker.isPending || undefined"
          >
            <div>
              <p class="text-eyebrow text-data-blue">
                {{ t('connection.eyebrow') }}
              </p>
              <h2 class="mt-2 text-section-title">
                {{ t('connection.title') }}
              </h2>
              <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
                {{ t('connection.description') }}
              </p>
            </div>

            <form class="mt-7" @submit.prevent="saveConnection">
              <label for="moonraker-endpoint" class="text-group-title">
                {{ t('connection.endpointLabel') }}
              </label>
              <p id="moonraker-endpoint-hint" class="mt-2 text-sm leading-6 text-muted">
                {{ t('connection.endpointHint') }}
              </p>
              <input
                id="moonraker-endpoint"
                v-model="endpointInput"
                type="text"
                inputmode="url"
                autocomplete="off"
                autocapitalize="none"
                spellcheck="false"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore
                aria-describedby="moonraker-endpoint-hint connection-error"
                :placeholder="t('connection.endpointPlaceholder')"
                class="field field--block mt-5 font-mono"
              />

              <Transition name="status-change">
                <p
                  v-if="connectionErrorKey"
                  id="connection-error"
                  class="mt-3 rounded-2xl border border-danger bg-danger-soft px-4 py-3 text-sm font-weight-base text-danger-text"
                  role="alert"
                >
                  {{ t(connectionErrorKey) }}
                </p>
              </Transition>

              <div class="mt-5 flex flex-wrap gap-3">
                <AppButton
                  variant="primary"
                  :label="t('connection.saveAndConnect')"
                  type="submit"
                />
                <AppButton
                  v-if="
                    moonraker.connectionPhase !== 'idle' && moonraker.connectionPhase !== 'stopped'
                  "
                  size="sm"
                  :label="t('connection.disconnect')"
                  @click="moonraker.disconnect"
                />
              </div>
            </form>
          </section>

          <section v-if="showCategory('printers')" class="page-card">
            <p class="text-eyebrow text-data-blue">
              {{ t('printers.eyebrow') }}
            </p>
            <h2 class="mt-2 text-section-title">
              {{ t('printers.title') }}
            </h2>
            <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
              {{ t('printers.description') }}
            </p>

            <label v-if="canOfferFarm" class="check-row mt-7">
              <input
                type="checkbox"
                :checked="showsFarmDestination"
                @change="hiddenDestinations.setVisible('farm', !showsFarmDestination)"
              />
              <span>{{ t('printers.showFarm') }}</span>
            </label>

            <p v-if="printers.entries.length === 0" class="mt-7 text-sm leading-6 text-muted">
              {{ t('printers.empty') }}
            </p>
            <ul v-else class="mt-7 divide-y divide-subtle">
              <li
                v-for="entry in printers.entries"
                :key="entry.id"
                class="flex items-center gap-3 py-3"
              >
                <span class="min-w-0 flex-1">
                  <strong class="block truncate text-row-name">{{
                    printerDisplayLabel(entry)
                  }}</strong>
                  <!--
                    Whenever the name above is not itself the address. That used
                    to mean "the user named it"; a printer that reports its own
                    name is now shown by that too, and its address would
                    otherwise appear nowhere on this card.
                  -->
                  <span
                    v-if="printerDisplayLabel(entry) !== printerHost(entry.endpoint)"
                    class="block truncate text-xs text-muted"
                    >{{ printerHost(entry.endpoint) }}</span
                  >
                </span>
                <span
                  v-if="entry.id === printers.activeId"
                  class="text-xs font-black uppercase tracking-[0.1em] text-muted"
                >
                  {{ t('printers.active') }}
                </span>
                <AppButton
                  v-else
                  size="sm"
                  :label="t('printers.switch')"
                  @click="moonraker.selectPrinter(entry.id)"
                />
                <AppButton
                  variant="quiet"
                  size="sm"
                  icon-only
                  icon="rename"
                  :aria-label="t('printers.rename', { name: printerDisplayLabel(entry) })"
                  @click="pendingRename = entry"
                />
                <AppButton
                  variant="danger-quiet"
                  size="sm"
                  icon-only
                  icon="trash"
                  :aria-label="t('printers.remove', { name: printerDisplayLabel(entry) })"
                  @click="requestRemoval(entry)"
                />
              </li>
            </ul>

            <form
              class="printers-add-form mt-7 border-t border-subtle pt-7"
              @submit.prevent="submitAddPrinter"
            >
              <p class="text-group-title">{{ t('printers.addTitle') }}</p>

              <label for="add-printer-endpoint" class="mt-5 block text-field-label text-muted">
                {{ t('printers.addEndpointLabel') }}
              </label>
              <input
                id="add-printer-endpoint"
                v-model="addEndpointInput"
                type="text"
                inputmode="url"
                autocomplete="off"
                autocapitalize="none"
                spellcheck="false"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore
                :placeholder="t('printers.addEndpointPlaceholder')"
                aria-describedby="add-printer-error"
                class="field field--sm field--block mt-2"
              />

              <label for="add-printer-name" class="mt-4 block text-field-label text-muted">
                {{ t('printers.addNameLabel') }}
              </label>
              <input
                id="add-printer-name"
                v-model="addLabelInput"
                type="text"
                autocomplete="off"
                maxlength="64"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore
                :placeholder="t('printers.addNamePlaceholder')"
                class="field field--sm field--block mt-2"
              />

              <Transition name="status-change">
                <p
                  v-if="addError"
                  id="add-printer-error"
                  class="mt-3 rounded-2xl border border-danger bg-danger-soft px-4 py-3 text-sm font-weight-base text-danger-text"
                  role="alert"
                >
                  {{ t('connection.errors.invalidEndpoint') }}
                </p>
              </Transition>

              <div v-if="printers.entries.length > 0" class="mt-5">
                <p class="text-field-label text-muted">{{ t('printers.copyTitle') }}</p>
                <div class="check-set mt-2">
                  <label class="check-row">
                    <input
                      type="radio"
                      name="printer-dashboard-seed"
                      :checked="dashboardSeed === 'blank'"
                      @change="dashboardSeed = 'blank'"
                    />
                    <span>{{ t('printers.copyBlank') }}</span>
                  </label>
                  <label class="check-row">
                    <input
                      type="radio"
                      name="printer-dashboard-seed"
                      :checked="dashboardSeed === 'copy'"
                      @change="dashboardSeed = 'copy'"
                    />
                    <span class="flex min-w-0 flex-1 items-center gap-2">
                      {{ t('printers.copyFrom') }}
                      <AppSelect
                        :model-value="copyFromId"
                        :options="copyFromOptions"
                        :label="t('printers.copyFrom')"
                        :disabled="dashboardSeed !== 'copy'"
                        @update:model-value="(id) => (copyFromId = id)"
                      />
                    </span>
                  </label>
                </div>
              </div>

              <AppButton
                variant="primary"
                :label="t('printers.addSubmit')"
                class="mt-5"
                type="submit"
              />
            </form>
          </section>

          <CamerasCard v-if="showCategory('cameras')" />

          <PromptDialog
            :open="pendingRename !== null"
            :title="t('printers.renameTitle')"
            :description="renameHint"
            :label="t('printers.renameLabel')"
            :initial-value="pendingRename?.label"
            :confirm-label="t('printers.renameConfirm')"
            @confirm="confirmRename"
            @cancel="pendingRename = null"
          />

          <ConfirmDialog
            :open="pendingRemoval !== null"
            :title="t('printers.removeTitle', { name: pendingRemovalName })"
            :description="t('printers.removeDescription', { name: pendingRemovalName })"
            :confirm-label="t('printers.removeConfirm')"
            tone="danger"
            @confirm="confirmRemoval"
            @cancel="pendingRemoval = null"
          />

          <!--
            Hidden entirely rather than shown empty: this printer's Moonraker
            has no `[authorization]` component at all, so there is nothing
            here to manage — the same optimistic-until-proven-otherwise gate
            `spool.ts` already uses for `spoolman`.
          -->
          <section
            v-if="showCategory('users') && serverCapabilities.hasComponent('authorization')"
            class="page-card"
          >
            <p class="text-eyebrow text-data-blue">
              {{ t('users.eyebrow') }}
            </p>
            <h2 class="mt-2 text-section-title">
              {{ t('users.title') }}
            </h2>

            <div class="mt-7 flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p v-if="auth.currentUser" class="text-row-name">
                  {{ t('users.session.loggedInAs', { name: auth.currentUser.username }) }}
                </p>
                <p v-else-if="auth.info?.trusted" class="text-row-name">
                  {{ t('users.session.trusted') }}
                </p>
                <p v-else class="text-row-name">
                  {{ t('users.session.notLoggedIn') }}
                </p>
              </div>
              <AppButton
                v-if="auth.currentUser"
                size="sm"
                :label="t('users.session.logout')"
                :disabled="auth.pendingCommands.logout"
                @click="submitLogout"
              />
            </div>

            <!--
              Not tied to `lastError === 'unauthorized'`: that gate only ever
              caught the case where something else had already failed, and
              left no way to deliberately log in. Gated on `!auth.currentUser`
              instead, the same condition the Logout button above uses in
              reverse — visible while trusted or logged out (including right
              after `createUser`'s own side effect of logging this connection
              into the account it just made, until `submitLogout` clears it),
              hidden once a real named account is the one logged in.
            -->
            <form
              v-if="!auth.currentUser"
              class="login-form mt-7 border-t border-subtle pt-7"
              @submit.prevent="submitLogin"
            >
              <p class="text-group-title">{{ t('users.login.title') }}</p>
              <p class="mt-2 text-sm leading-6 text-muted">
                {{ t('users.login.description') }}
              </p>

              <label for="login-username" class="mt-4 block text-field-label text-muted">
                {{ t('users.login.usernameLabel') }}
              </label>
              <input
                id="login-username"
                v-model="loginUsername"
                type="text"
                autocomplete="username"
                class="field field--sm field--block mt-2"
              />

              <label for="login-password" class="mt-4 block text-field-label text-muted">
                {{ t('users.login.passwordLabel') }}
              </label>
              <input
                id="login-password"
                v-model="loginPassword"
                type="password"
                autocomplete="current-password"
                class="field field--sm field--block mt-2"
              />

              <template v-if="(auth.info?.available_sources.length ?? 0) > 1">
                <label for="login-source" class="mt-4 block text-field-label text-muted">
                  {{ t('users.login.sourceLabel') }}
                </label>
                <select
                  id="login-source"
                  v-model="loginSource"
                  class="field field--sm field--block mt-2"
                >
                  <option
                    v-for="source in auth.info?.available_sources ?? []"
                    :key="source"
                    :value="source"
                  >
                    {{ source }}
                  </option>
                </select>
              </template>

              <p
                v-if="auth.lastCommandError === 'login'"
                class="mt-3 rounded-2xl border border-danger bg-danger-soft px-4 py-3 text-sm font-weight-base text-danger-text"
                role="alert"
              >
                {{ auth.lastCommandErrorMessage || t('users.login.failed') }}
              </p>

              <AppButton
                variant="primary"
                :label="t('users.login.submit')"
                class="mt-5"
                type="submit"
                :disabled="auth.pendingCommands.login"
              />
            </form>

            <form
              v-if="auth.currentUser && auth.currentUser.source === 'moonraker'"
              class="mt-7 border-t border-subtle pt-7"
              @submit.prevent="submitChangePassword"
            >
              <p class="text-group-title">{{ t('users.changePassword.title') }}</p>

              <label for="change-password-current" class="mt-4 block text-field-label text-muted">
                {{ t('users.changePassword.currentLabel') }}
              </label>
              <input
                id="change-password-current"
                v-model="currentPasswordInput"
                type="password"
                autocomplete="current-password"
                class="field field--sm field--block mt-2"
              />

              <label for="change-password-new" class="mt-4 block text-field-label text-muted">
                {{ t('users.changePassword.newLabel') }}
              </label>
              <input
                id="change-password-new"
                v-model="newPasswordInput"
                type="password"
                autocomplete="new-password"
                class="field field--sm field--block mt-2"
              />

              <p
                v-if="auth.lastCommandError === 'changePassword'"
                class="mt-3 rounded-2xl border border-danger bg-danger-soft px-4 py-3 text-sm font-weight-base text-danger-text"
                role="alert"
              >
                {{ auth.lastCommandErrorMessage || t('users.changePassword.failed') }}
              </p>

              <AppButton
                size="sm"
                :label="t('users.changePassword.submit')"
                class="mt-5"
                type="submit"
                :disabled="auth.pendingCommands.changePassword"
              />
            </form>

            <div class="mt-7 border-t border-subtle pt-7">
              <p class="text-group-title">{{ t('users.list.title') }}</p>

              <p v-if="otherUsers.length === 0" class="mt-3 text-sm leading-6 text-muted">
                {{ t('users.list.empty') }}
              </p>
              <ul v-else class="mt-3 divide-y divide-subtle">
                <li
                  v-for="user in otherUsers"
                  :key="user.username"
                  class="flex items-center gap-3 py-3"
                >
                  <span class="min-w-0 flex-1">
                    <strong class="block truncate text-row-name">{{ user.username }}</strong>
                    <span class="block truncate text-xs text-muted">{{ user.source }}</span>
                  </span>
                  <AppButton
                    variant="danger-quiet"
                    size="sm"
                    icon-only
                    icon="trash"
                    :aria-label="t('users.list.remove', { name: user.username })"
                    @click="requestUserDeletion(user)"
                  />
                </li>
              </ul>

              <form class="mt-5 border-t border-subtle pt-5" @submit.prevent="submitCreateUser">
                <p class="text-group-title">{{ t('users.add.title') }}</p>
                <p class="mt-2 text-sm leading-6 text-muted">
                  {{ t('users.add.description') }}
                </p>

                <label for="add-user-name" class="mt-4 block text-field-label text-muted">
                  {{ t('users.add.usernameLabel') }}
                </label>
                <input
                  id="add-user-name"
                  v-model="addUserNameInput"
                  type="text"
                  autocomplete="off"
                  class="field field--sm field--block mt-2"
                />

                <label for="add-user-password" class="mt-4 block text-field-label text-muted">
                  {{ t('users.add.passwordLabel') }}
                </label>
                <input
                  id="add-user-password"
                  v-model="addUserPasswordInput"
                  type="password"
                  autocomplete="new-password"
                  class="field field--sm field--block mt-2"
                />

                <p
                  v-if="auth.lastCommandError === 'createUser'"
                  class="mt-3 rounded-2xl border border-danger bg-danger-soft px-4 py-3 text-sm font-weight-base text-danger-text"
                  role="alert"
                >
                  {{ auth.lastCommandErrorMessage || t('users.add.failed') }}
                </p>

                <AppButton
                  size="sm"
                  :label="t('users.add.submit')"
                  class="mt-5"
                  type="submit"
                  :disabled="auth.pendingCommands.createUser"
                />
              </form>
            </div>

            <div class="mt-7 border-t border-subtle pt-7">
              <p class="text-group-title">{{ t('users.apiKey.title') }}</p>
              <p class="mt-2 text-sm leading-6 text-muted">
                {{ t('users.apiKey.description') }}
              </p>
              <div class="mt-3 flex items-center gap-2">
                <code class="min-w-0 flex-1 truncate font-mono text-xs text-primary">
                  {{ auth.apiKey ?? t('users.apiKey.loading') }}
                </code>
                <AppButton
                  variant="quiet"
                  size="xs"
                  icon-only
                  :icon="apiKeyCopied ? 'check' : 'duplicate'"
                  class="shrink-0"
                  :disabled="!auth.apiKey"
                  :aria-label="apiKeyCopied ? t('users.apiKey.copied') : t('users.apiKey.copy')"
                  :title="apiKeyCopied ? t('users.apiKey.copied') : t('users.apiKey.copy')"
                  @click="copyApiKey()"
                />
              </div>
              <AppButton
                size="sm"
                :guard="regenerateApiKeyGuard"
                :label="t('users.apiKey.regenerate')"
                class="mt-3"
                :disabled="auth.pendingCommands.regenerateApiKey"
                @click="requestApiKeyRegeneration()"
              />
            </div>
          </section>

          <ConfirmDialog
            :open="pendingUserDeletion !== null"
            :title="t('users.list.removeTitle', { name: pendingUserDeletion?.username ?? '' })"
            :description="
              t('users.list.removeDescription', { name: pendingUserDeletion?.username ?? '' })
            "
            :confirm-label="t('users.list.removeConfirm')"
            tone="danger"
            @confirm="confirmUserDeletion"
            @cancel="pendingUserDeletion = null"
          />

          <ConfirmDialog
            :open="pendingApiKeyRegeneration"
            :title="t('users.apiKey.regenerateTitle')"
            :description="t('users.apiKey.regenerateDescription')"
            :confirm-label="t('users.apiKey.regenerateConfirm')"
            tone="danger"
            @confirm="confirmApiKeyRegeneration"
            @cancel="pendingApiKeyRegeneration = false"
          />

          <section v-if="showCategory('language')" class="page-card">
            <p class="text-eyebrow text-data-blue">
              {{ t('language.eyebrow') }}
            </p>
            <h2 class="mt-2 text-section-title">{{ t('language.title') }}</h2>

            <label for="language-select" class="mt-7 block text-group-title">
              {{ t('language.selectLabel') }}
            </label>
            <select
              id="language-select"
              :value="locale"
              class="field field--block mt-5 sm:max-w-sm"
              @change="changeLocale"
            >
              <option v-for="code in supportedLocales" :key="code" :value="code">
                {{ t(`locale.${code}`) }}
              </option>
            </select>

            <div class="mt-7 border-t border-subtle pt-7">
              <p class="text-group-title">{{ t('formats.timeLabel') }}</p>
              <div class="check-set mt-2">
                <label v-for="mode in timeFormatModes" :key="mode" class="check-row">
                  <input
                    type="radio"
                    name="time-format"
                    :checked="timeMode === mode"
                    @change="setTimeMode(mode)"
                  />
                  <span>
                    {{
                      t('formats.optionExample', {
                        label: t(`formats.time.${mode}`),
                        example: timeExample(mode),
                      })
                    }}
                  </span>
                </label>
              </div>

              <label for="date-format-select" class="mt-7 block text-group-title">
                {{ t('formats.dateLabel') }}
              </label>
              <select
                id="date-format-select"
                :value="dateMode"
                class="field field--block mt-5 sm:max-w-sm"
                @change="setDateMode(($event.target as HTMLSelectElement).value as DateFormatMode)"
              >
                <option v-for="mode in dateFormatModes" :key="mode" :value="mode">
                  {{
                    mode === 'custom'
                      ? t('formats.date.custom')
                      : t('formats.optionExample', {
                          label: t(`formats.date.${mode}`),
                          example: dateExample(mode),
                        })
                  }}
                </option>
              </select>

              <DisclosureReveal :open="dateMode === 'custom'">
                <div class="mt-5">
                  <label for="date-format-custom-input" class="block text-field-label text-muted">
                    {{ t('formats.date.customInputLabel') }}
                  </label>
                  <input
                    id="date-format-custom-input"
                    v-model="dateCustomPatternInput"
                    type="text"
                    autocomplete="off"
                    maxlength="64"
                    data-1p-ignore
                    data-lpignore="true"
                    data-bwignore
                    class="field field--sm field--block mt-2 sm:max-w-sm"
                  />
                  <p class="mt-2 text-sm leading-6 text-muted">
                    {{ t('formats.date.customPreview', { example: dateExample('custom') }) }}
                  </p>

                  <p class="mt-5 text-field-label text-muted">
                    {{ t('formats.date.customLegendTitle') }}
                  </p>
                  <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm leading-6">
                    <template v-for="entry in customDateTokens" :key="entry.token">
                      <dt class="font-mono text-primary">{{ entry.token }}</dt>
                      <dd class="text-muted">
                        {{ t(entry.labelKey) }} — {{ customTokenExample(entry.token) }}
                      </dd>
                    </template>
                  </dl>
                </div>
              </DisclosureReveal>
            </div>
          </section>

          <section v-if="showCategory('theme')" class="page-card">
            <p class="text-eyebrow text-data-blue">
              {{ t('theme.eyebrow') }}
            </p>
            <h2 class="mt-2 text-section-title">{{ t('theme.title') }}</h2>

            <p class="mt-7 text-group-title">{{ t('theme.modeLabel') }}</p>
            <div class="check-set mt-2">
              <label v-for="mode in themeModes" :key="mode" class="check-row">
                <input
                  type="radio"
                  name="theme-mode"
                  :checked="themeMode === mode"
                  @change="setMode(mode)"
                />
                <span>{{ t(`theme.mode.${mode}`) }}</span>
              </label>
            </div>

            <label for="theme-pack-select" class="mt-7 block text-group-title">
              {{ t('theme.packLabel') }}
            </label>
            <select
              id="theme-pack-select"
              :value="themePack"
              class="field field--block mt-5 sm:max-w-sm"
              @change="changeThemePack"
            >
              <option v-for="pack in themePacks" :key="pack.id" :value="pack.id">
                {{ t(pack.labelKey) }}
              </option>
            </select>

            <label for="font-select" class="mt-7 block text-group-title">
              {{ t('theme.fontLabel') }}
            </label>
            <select
              id="font-select"
              :value="fontId"
              class="field field--block mt-5 sm:max-w-sm"
              @focus="ensureAllFontsLoaded"
              @change="changeFont"
            >
              <option
                v-for="font in fonts"
                :key="font.id"
                :value="font.id"
                :style="{ fontFamily: 'var(--font-' + font.id + ')' }"
              >
                {{ t(font.labelKey) }}
              </option>
            </select>

            <p class="mt-7 text-group-title">{{ t('theme.textWeightLabel') }}</p>
            <div class="check-set mt-2">
              <label v-for="mode in textWeightModes" :key="mode" class="check-row">
                <input
                  type="radio"
                  name="text-weight"
                  :checked="textWeightMode === mode"
                  @change="setTextWeightMode(mode)"
                />
                <span>{{ t(`theme.textWeight.${mode}`) }}</span>
              </label>
            </div>

            <label for="console-font-select" class="mt-7 block text-group-title">
              {{ t('theme.consoleFontLabel') }}
            </label>
            <select
              id="console-font-select"
              :value="consoleFont"
              aria-describedby="console-font-hint"
              class="field field--block mt-5 sm:max-w-sm"
              @focus="ensureAllFontsLoaded"
              @change="changeConsoleFont"
            >
              <option value="match">{{ t('theme.consoleFontMatch') }}</option>
              <option
                v-for="font in consoleFonts"
                :key="font.id"
                :value="font.id"
                :style="{ fontFamily: 'var(--font-' + font.id + ')' }"
              >
                {{ t(font.labelKey) }}
              </option>
            </select>

            <p class="mt-7 text-group-title">{{ t('theme.consoleWeightLabel') }}</p>
            <div class="check-set mt-2">
              <label v-for="mode in consoleWeightModes" :key="mode" class="check-row">
                <input
                  type="radio"
                  name="console-weight"
                  :checked="consoleWeightMode === mode"
                  @change="setConsoleWeightMode(mode)"
                />
                <span>{{ t(`theme.consoleWeight.${mode}`) }}</span>
              </label>
            </div>

            <p class="mt-7 text-group-title">{{ t('theme.pageHeadersLabel') }}</p>
            <div class="check-set mt-2">
              <label v-for="mode in pageHeaderVisibilities" :key="mode" class="check-row">
                <input
                  type="radio"
                  name="page-headers"
                  :checked="pageHeaderVisibility === mode"
                  @change="setPageHeaderVisibility(mode)"
                />
                <span>{{ t(`theme.pageHeaders.${mode}`) }}</span>
              </label>
            </div>

            <label class="check-row mt-7">
              <input
                type="checkbox"
                :checked="isMinimalisticSidebar"
                @change="toggleMinimalisticSidebar"
              />
              <span>{{ t('theme.minimalisticSidebar') }}</span>
            </label>
          </section>

          <section v-if="showCategory('display')" class="page-card">
            <p class="text-eyebrow text-data-blue">
              {{ t('display.eyebrow') }}
            </p>
            <h2 class="mt-2 text-section-title">{{ t('display.title') }}</h2>
            <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
              {{ t('display.description') }}
            </p>

            <label class="check-row mt-7">
              <input
                type="checkbox"
                :checked="wakeLock.enabled.value"
                :disabled="!wakeLock.isSupported || !wakeLock.isSecureContext"
                @change="wakeLock.setEnabled(!wakeLock.enabled.value)"
              />
              <span>{{ t('display.toggle') }}</span>
            </label>

            <p v-if="!wakeLock.isSupported" class="mt-2 text-xs text-muted">
              {{ t('display.unsupportedBrowser') }}
            </p>
            <p v-else-if="!wakeLock.isSecureContext" class="mt-2 text-xs text-muted">
              {{ t('display.requiresSecureContext') }}
            </p>
            <p v-else-if="wakeLock.enabled.value" class="mt-2 text-xs text-muted">
              {{ wakeLock.isActive.value ? t('display.active') : t('display.inactiveWhileHidden') }}
            </p>
          </section>

          <section v-if="showCategory('editor')" class="page-card">
            <p class="text-eyebrow text-data-blue">
              {{ t('editor.eyebrow') }}
            </p>
            <h2 class="mt-2 text-section-title">{{ t('editor.title') }}</h2>
            <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
              {{ t('editor.description') }}
            </p>

            <p class="mt-7 text-group-title">{{ t('editor.indentLabel') }}</p>
            <div class="check-set mt-2">
              <label v-for="width in indentWidths" :key="width" class="check-row">
                <input
                  type="radio"
                  name="indent-width"
                  :checked="indentWidth === width"
                  @change="setIndentWidth(width as IndentWidth)"
                />
                <span>{{ t('editor.indentOption', { count: width }) }}</span>
              </label>
            </div>
            <p class="mt-2 text-sm leading-6 text-muted">{{ t('editor.indentHint') }}</p>
          </section>

          <section v-if="showCategory('confirmations')" class="page-card">
            <p class="text-eyebrow text-data-blue">
              {{ t('confirmations.eyebrow') }}
            </p>
            <h2 class="mt-2 text-section-title">
              {{ t('confirmations.title') }}
            </h2>
            <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
              {{ t('confirmations.description') }}
            </p>

            <label class="check-row mt-7">
              <input
                type="checkbox"
                :checked="confirmations.skipAll"
                @change="confirmations.setSkipAll(!confirmations.skipAll)"
              />
              <span class="font-bold">{{ t('confirmations.skipAll') }}</span>
            </label>

            <div
              v-for="group in confirmationGroups"
              :key="group.titleKey"
              class="mt-5 border-t border-subtle pt-5"
            >
              <p class="text-field-label text-muted">{{ t(group.titleKey) }}</p>
              <p v-if="group.descriptionKey" class="mt-1 text-xs text-muted">
                {{ t(group.descriptionKey) }}
              </p>
              <label
                v-if="group.group"
                class="check-row confirmation-group"
                :title="confirmations.skipAll ? t('confirmations.globalOverride') : undefined"
              >
                <input
                  type="checkbox"
                  :checked="isGroupSkipped(group.group)"
                  :disabled="confirmations.skipAll"
                  @change="toggleGroup(group.group)"
                />
                <span class="font-bold">{{ t('confirmations.printInterruptingSkipAll') }}</span>
              </label>
              <label
                v-for="key in group.keys"
                :key="key"
                class="check-row confirmation-item"
                :title="overrideTitle(key)"
              >
                <input
                  type="checkbox"
                  :checked="isConfirmationSkipped(key)"
                  :disabled="isConfirmationOverridden(key)"
                  @change="toggleConfirmation(key)"
                />
                <span>{{ t(`confirmations.items.${key}`) }}</span>
              </label>
            </div>

            <!--
              A second rendering of a value each module's own settings pane
              already owns — see the "Module guards, mirrored" comment above
              the script's `moduleGuardGroups`. Each module still gets its own
              bordered block, matching the groups above, so the card's rhythm
              does not change just because the source of these rows did.
            -->
            <div class="mt-5 border-t border-subtle pt-5">
              <p class="text-field-label text-muted">
                {{ t('confirmations.groups.moduleGuards') }}
              </p>
              <p class="mt-1 text-xs text-muted">
                {{ t('confirmations.moduleGuardsDescription') }}
              </p>
            </div>
            <div
              v-for="group in moduleGuardGroups"
              :key="group.moduleId"
              class="mt-5 border-t border-subtle pt-5"
            >
              <p class="text-field-label text-muted">{{ t(group.titleKey) }}</p>
              <label
                v-for="row in group.rows"
                :key="row.key"
                class="check-row module-guard-item"
                :title="moduleGuardTitle()"
              >
                <input
                  type="checkbox"
                  :checked="isModuleGuardSkipped(group.moduleId, row.key)"
                  :disabled="confirmations.skipAll"
                  @change="toggleModuleGuard(group.moduleId, row.key)"
                />
                <span>{{ t(row.labelKey) }}</span>
              </label>
            </div>

            <!--
              Opt-in, not skippable — the inverse of every row above, so it
              gets its own section rather than a place in confirmationGroups.
              Off by default: it interrupts starting a print, which needed an
              explicit yes rather than shipping on for everyone.
            -->
            <div class="mt-5 border-t border-subtle pt-5">
              <p class="text-field-label text-muted">
                {{ t('confirmations.groups.maintenance') }}
              </p>
              <label class="check-row">
                <input
                  type="checkbox"
                  :checked="confirmations.maintenanceReminderEnabled"
                  @change="
                    confirmations.setMaintenanceReminderEnabled(
                      !confirmations.maintenanceReminderEnabled,
                    )
                  "
                />
                <span>{{ t('confirmations.items.maintenanceReminder') }}</span>
              </label>
            </div>
          </section>

          <section v-if="showCategory('backup')" class="page-card">
            <p class="text-eyebrow text-data-blue">
              {{ t('backup.eyebrow') }}
            </p>
            <h2 class="mt-2 text-section-title">
              {{ t('backup.title') }}
            </h2>
            <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
              {{ t('backup.description') }}
            </p>

            <div class="mt-7 flex flex-wrap gap-3">
              <AppButton
                size="sm"
                icon="download"
                :label="t('backup.export')"
                @click="exportSettings"
              />
              <AppButton
                size="sm"
                icon="fileUpload"
                :label="t('backup.import')"
                @click="openImportPicker"
              />
              <input
                ref="importInput"
                type="file"
                class="sr-only"
                accept="application/json"
                :aria-label="t('backup.import')"
                @change="onImportChosen"
              />
              <AppButton
                variant="danger-quiet"
                size="sm"
                :label="t('backup.reset')"
                @click="requestReset"
              />
            </div>

            <Transition name="status-change">
              <p
                v-if="importParseError"
                class="mt-3 rounded-2xl border border-danger bg-danger-soft px-4 py-3 text-sm font-weight-base text-danger-text"
                role="alert"
              >
                {{ t('backup.importError') }}
              </p>
            </Transition>

            <div v-if="printers.activeEntry" class="mt-7 border-t border-subtle pt-7">
              <p class="text-group-title">{{ t('backup.sync.title') }}</p>
              <p class="mt-2 text-sm leading-6 text-muted">
                {{ t('backup.sync.description') }}
              </p>

              <label class="check-row mt-5">
                <input
                  type="checkbox"
                  :checked="settingsSync.isEnabled"
                  :disabled="!moonraker.isConnected"
                  @change="toggleSync"
                />
                <span>{{ t('backup.sync.toggle') }}</span>
              </label>

              <p class="mt-2 text-xs text-muted">
                <template v-if="settingsSync.lastCommandErrorMessage">
                  {{ settingsSync.lastCommandErrorMessage }}
                </template>
                <template v-else-if="lastSyncedDisplay">
                  {{ t('backup.sync.lastSynced', { value: lastSyncedDisplay }) }}
                </template>
                <template v-else>
                  {{ t('backup.sync.neverSynced') }}
                </template>
              </p>

              <div v-if="settingsSync.isEnabled" class="mt-3 flex flex-wrap gap-3">
                <AppButton
                  size="sm"
                  :label="t('backup.sync.now')"
                  :disabled="!moonraker.isConnected || settingsSync.pendingCommands.push"
                  @click="settingsSync.push"
                />
                <AppButton
                  variant="danger-quiet"
                  size="sm"
                  :label="t('backup.sync.forget')"
                  :disabled="!moonraker.isConnected"
                  @click="requestForget"
                />
              </div>
            </div>
          </section>

          <ConfirmDialog
            :open="pendingImport !== null"
            :title="t('backup.importConfirmTitle')"
            :description="t('backup.importConfirmDescription')"
            :confirm-label="t('backup.import')"
            @confirm="confirmImport"
            @cancel="pendingImport = null"
          />

          <ConfirmDialog
            :open="pendingReset"
            :title="t('backup.resetConfirmTitle')"
            :description="t('backup.resetConfirmDescription')"
            :confirm-label="t('backup.reset')"
            tone="danger"
            @confirm="confirmReset"
            @cancel="pendingReset = false"
          />

          <ConfirmDialog
            :open="pendingForget"
            :title="t('backup.sync.forgetConfirmTitle')"
            :description="t('backup.sync.forgetConfirmDescription')"
            :confirm-label="t('backup.sync.forget')"
            tone="danger"
            @confirm="confirmForget"
            @cancel="pendingForget = false"
          />
        </div>
      </div>
    </div>
  </section>
</template>
