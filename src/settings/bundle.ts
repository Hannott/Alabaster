import {
  isConsoleFontChoice,
  useConsoleFont,
  type ConsoleFontChoice,
} from '@/composables/useConsoleFont'
import {
  isConsoleWeightMode,
  useConsoleWeight,
  type ConsoleWeightMode,
} from '@/composables/useConsoleWeight'
import { useEditorIndent } from '@/composables/useEditorIndent'
import { useFont } from '@/composables/useFont'
import { isTextWeightMode, useTextWeight, type TextWeightMode } from '@/composables/useTextWeight'
import { isThemeMode, useTheme, type ThemeMode } from '@/composables/useTheme'
import type { DashboardProfile } from '@/dashboard/layout'
import { defaultIndentWidth, isIndentWidth, type IndentWidth } from '@/features/machine/indent'
import { defaultFontId, isFontId, type FontId } from '@/fonts/registry'
import { i18n, setLocale, supportedLocales, type SupportedLocale } from '@/i18n'
import {
  defaultCustomDatePattern,
  isDateFormatMode,
  isTimeFormatMode,
  useDateTimeFormatMode,
  type DateFormatMode,
  type TimeFormatMode,
} from '@/i18n/formats'
import {
  confirmationKeys,
  useConfirmationsStore,
  type StoredConfirmations,
} from '@/stores/confirmations'
import { normalizeDashboardProfile, useDashboardLayoutStore } from '@/stores/dashboardLayout'
import { defaultThemePackId, isThemePackId, type ThemePackId } from '@/themes/registry'
import { isRecord } from '@/utils/records'

/**
 * Everything Backup/export, Backup/import, and Moonraker-DB sync
 * (`stores/settingsSync.ts`) read and write, in one shape. Deliberately
 * excludes device ergonomics that make no sense to carry to another screen
 * (wake lock, sidebar-collapsed state, the minimalistic-sidebar pick — see
 * `useMinimalisticSidebar` — the settings category-rail pick, the
 * page-header visibility pick — see `usePageHeaders`), the printer list
 * itself (`stores/printers.ts` explains why that stays browser-local) along
 * with the hidden-destination preference that describes it
 * (`composables/useHiddenDestinations.ts` — what a browser has saved is what
 * makes Farm worth offering, so "Farm hidden" would travel to a screen where
 * the reason for it does not hold), and anything in `stores/auth.ts`'s domain.
 *
 * `version` exists so a future incompatible change to this shape has
 * somewhere to branch from; there is only one version today.
 */
export interface SettingsBundle {
  version: 1
  updatedAt: string
  theme: { mode: ThemeMode; pack: ThemePackId }
  font: FontId
  textWeight: TextWeightMode
  consoleFont: ConsoleFontChoice
  consoleWeight: ConsoleWeightMode
  editorIndentWidth: IndentWidth
  locale: SupportedLocale
  dateFormat: DateFormatMode
  dateCustomPattern: string
  timeFormat: TimeFormatMode
  confirmations: StoredConfirmations
  dashboardProfile: DashboardProfile
}

export function collectSettingsBundle(): SettingsBundle {
  const theme = useTheme()
  const font = useFont()
  const textWeight = useTextWeight()
  const consoleFont = useConsoleFont()
  const consoleWeight = useConsoleWeight()
  const editorIndent = useEditorIndent()
  const { timeMode, dateMode, dateCustomPattern } = useDateTimeFormatMode()
  const confirmations = useConfirmationsStore()
  const layout = useDashboardLayoutStore()

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    theme: { mode: theme.mode.value, pack: theme.themePack.value },
    font: font.fontId.value,
    textWeight: textWeight.mode.value,
    consoleFont: consoleFont.consoleFont.value,
    consoleWeight: consoleWeight.mode.value,
    editorIndentWidth: editorIndent.indentWidth.value,
    locale: supportedLocales.includes(i18n.global.locale.value as SupportedLocale)
      ? (i18n.global.locale.value as SupportedLocale)
      : 'en',
    dateFormat: dateMode.value,
    dateCustomPattern: dateCustomPattern.value,
    timeFormat: timeMode.value,
    confirmations: {
      skipAll: confirmations.skipAll,
      skipByGroup: { ...confirmations.skipByGroup },
      skipByKey: { ...confirmations.skipByKey },
      maintenanceReminderEnabled: confirmations.maintenanceReminderEnabled,
      maintenanceReminderSuppressedUntil: confirmations.maintenanceReminderSuppressedUntil,
    },
    dashboardProfile: layout.profile,
  }
}

/**
 * A bundle can arrive from a hand-edited export file or another Alabaster
 * version's sync payload, so every field is re-validated against its own
 * composable's guard rather than trusted as `SettingsBundle` — an invalid
 * value is skipped, leaving whatever was already set, the same repair-not-
 * reject stance `normalizeDashboardProfile`/`confirmations.replaceAll`
 * already take for their own two fields.
 *
 * Applies live and returns once every setter (including the async
 * `setLocale`) has run — there is no reload anywhere in this path.
 */
export async function applySettingsBundle(input: unknown): Promise<void> {
  if (!isRecord(input)) return

  const theme = useTheme()
  const font = useFont()
  const textWeight = useTextWeight()
  const consoleFont = useConsoleFont()
  const consoleWeight = useConsoleWeight()
  const editorIndent = useEditorIndent()
  const { setTimeMode, setDateMode, setDateCustomPattern } = useDateTimeFormatMode()
  const confirmations = useConfirmationsStore()
  const layout = useDashboardLayoutStore()

  if (isRecord(input.theme)) {
    if (typeof input.theme.mode === 'string' && isThemeMode(input.theme.mode)) {
      theme.setMode(input.theme.mode)
    }
    if (typeof input.theme.pack === 'string' && isThemePackId(input.theme.pack)) {
      theme.setThemePack(input.theme.pack)
    } else {
      theme.setThemePack(defaultThemePackId)
    }
  }
  if (typeof input.font === 'string') {
    font.setFontId(isFontId(input.font) ? input.font : defaultFontId)
  }
  if (typeof input.textWeight === 'string' && isTextWeightMode(input.textWeight)) {
    textWeight.setTextWeightMode(input.textWeight)
  }
  if (typeof input.consoleFont === 'string' && isConsoleFontChoice(input.consoleFont)) {
    consoleFont.setConsoleFont(input.consoleFont)
  }
  if (typeof input.consoleWeight === 'string' && isConsoleWeightMode(input.consoleWeight)) {
    consoleWeight.setConsoleWeightMode(input.consoleWeight)
  }
  if (isIndentWidth(input.editorIndentWidth)) {
    editorIndent.setIndentWidth(input.editorIndentWidth)
  }
  if (typeof input.timeFormat === 'string' && isTimeFormatMode(input.timeFormat)) {
    setTimeMode(input.timeFormat)
  }
  if (typeof input.dateFormat === 'string' && isDateFormatMode(input.dateFormat)) {
    setDateMode(input.dateFormat)
  }
  if (typeof input.dateCustomPattern === 'string') {
    setDateCustomPattern(input.dateCustomPattern)
  }
  if (
    typeof input.locale === 'string' &&
    supportedLocales.includes(input.locale as SupportedLocale)
  ) {
    await setLocale(input.locale as SupportedLocale)
  }
  if (input.confirmations !== undefined) confirmations.replaceAll(input.confirmations)
  if (input.dashboardProfile !== undefined) layout.replaceProfile(input.dashboardProfile)
}

/** A bundle built from nothing but defaults — what "Reset" applies. */
export function defaultSettingsBundle(): SettingsBundle {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    theme: { mode: 'system', pack: defaultThemePackId },
    font: defaultFontId,
    textWeight: 'regular',
    consoleFont: 'match',
    consoleWeight: 'regular',
    editorIndentWidth: defaultIndentWidth,
    locale: 'en',
    dateFormat: 'auto',
    dateCustomPattern: defaultCustomDatePattern,
    timeFormat: 'auto',
    confirmations: {
      skipAll: false,
      skipByGroup: { printInterrupting: false },
      skipByKey: Object.fromEntries(
        confirmationKeys.map((key) => [key, false]),
      ) as StoredConfirmations['skipByKey'],
      maintenanceReminderEnabled: false,
      maintenanceReminderSuppressedUntil: null,
    },
    dashboardProfile: normalizeDashboardProfile(undefined),
  }
}
