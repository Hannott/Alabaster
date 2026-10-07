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
import { useGcodeViewerSettings } from '@/composables/useGcodeViewerSettings'
import type { GcodeQualityMode } from '@/features/gcode/quality'
import type { GcodeColorMode } from '@/features/gcode/types'
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
import { useAuthStore } from '@/stores/auth'
import {
  defaultCommandPreferences,
  useCommandPreferencesStore,
  type StoredCommandPreferences,
} from '@/stores/commandPreferences'
import type { QuickConfigPin } from '@/features/config/quickConfigFields'
import type { QuickConfigColumns } from '@/features/config/quickConfigLayout'
import { useQuickConfigStore } from '@/stores/quickConfig'
import { useDocumentationSiteStore } from '@/stores/documentationSite'
import type { DocsSite } from '@/features/machine/docsLinks'
import { useZMotionStore, type ZMotion } from '@/stores/zMotion'
import { useBeltGuideStore, type BeltGuideValues } from '@/stores/beltGuide'
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
/**
 * How someone likes to look at a toolpath. In the bundle because the answer
 * is the same on every screen they own — unlike the viewer's two device
 * facts, the detail ceiling this machine can hold and whether its last parse
 * died, which are answers about one browser on one piece of hardware and
 * would be the wrong answer anywhere else.
 */
export interface GcodeViewerBundle {
  colorMode: GcodeColorMode
  showTravels: boolean
  qualityMode: GcodeQualityMode
  followByDefault: boolean
}

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
  gcodeViewer: GcodeViewerBundle
  /**
   * The active printer's pinned Quick config options, like its dashboard
   * profile. Null while the defaults stand, so a restore onto a printer with
   * other sections keeps choosing defaults from that printer's own config.
   */
  quickConfigPins: QuickConfigPin[] | null
  /** Which column each of those cards sits in. Null until a card has been moved. */
  quickConfigColumns: QuickConfigColumns | null
  /**
   * The active printer's Z motion — which part moves and which way Z+ takes
   * it. Null while the printer has no stored answer.
   */
  zMotion: ZMotion | null
  /**
   * Which firmware's documentation the configuration editor links to on the
   * active printer. Null while it follows the firmware the update manager
   * reports.
   */
  documentationSite: DocsSite | null
  /**
   * The belt guide's masses and last reading on the active printer. Null
   * while nothing has been typed there.
   */
  beltGuide: BeltGuideValues | null
  /**
   * Queue-or-wait and the header queue list. Carried only while a Moonraker
   * user is logged in, and null otherwise: without login every browser shares
   * one synced slot, and these are one person's habits, not the printer's.
   * See `stores/commandPreferences.ts`.
   */
  commands: StoredCommandPreferences | null
}

function isGcodeColorMode(value: unknown): value is GcodeColorMode {
  return value === 'single' || value === 'feature' || value === 'feedrate'
}

function isGcodeQualityMode(value: unknown): value is GcodeQualityMode {
  return value === 'quality' || value === 'auto' || value === 'performance'
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
  const gcodeViewer = useGcodeViewerSettings()
  const quickConfig = useQuickConfigStore()
  const zMotion = useZMotionStore()
  const documentationSite = useDocumentationSiteStore()
  const beltGuide = useBeltGuideStore()
  const commandPreferences = useCommandPreferencesStore()
  const auth = useAuthStore()

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
    gcodeViewer: {
      colorMode: gcodeViewer.colorMode.value,
      showTravels: gcodeViewer.showTravels.value,
      qualityMode: gcodeViewer.qualityMode.value,
      followByDefault: gcodeViewer.followByDefault.value,
    },
    quickConfigPins: quickConfig.storedPins,
    quickConfigColumns: quickConfig.storedColumns,
    zMotion: zMotion.stored,
    documentationSite: documentationSite.stored,
    beltGuide: beltGuide.stored,
    commands: auth.currentUser
      ? { dispatch: commandPreferences.dispatch, showQueue: commandPreferences.showQueue }
      : null,
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
  const gcodeViewer = useGcodeViewerSettings()
  const quickConfig = useQuickConfigStore()
  const zMotion = useZMotionStore()
  const documentationSite = useDocumentationSiteStore()
  const beltGuide = useBeltGuideStore()

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
  if (input.quickConfigPins !== undefined) quickConfig.replacePins(input.quickConfigPins)
  if (input.quickConfigColumns !== undefined) quickConfig.setColumns(input.quickConfigColumns)
  if (input.zMotion !== undefined) zMotion.replace(input.zMotion)
  if (input.documentationSite !== undefined) documentationSite.replace(input.documentationSite)
  if (input.beltGuide !== undefined) beltGuide.replace(input.beltGuide)
  if (isRecord(input.commands)) useCommandPreferencesStore().replace(input.commands)
  if (isRecord(input.gcodeViewer)) {
    const viewer = input.gcodeViewer
    if (isGcodeColorMode(viewer.colorMode)) gcodeViewer.setColorMode(viewer.colorMode)
    if (typeof viewer.showTravels === 'boolean') gcodeViewer.setShowTravels(viewer.showTravels)
    if (isGcodeQualityMode(viewer.qualityMode)) gcodeViewer.setQualityMode(viewer.qualityMode)
    if (typeof viewer.followByDefault === 'boolean') {
      gcodeViewer.setFollowByDefault(viewer.followByDefault)
    }
  }
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
    gcodeViewer: {
      colorMode: 'single',
      showTravels: false,
      qualityMode: 'auto',
      followByDefault: true,
    },
    quickConfigPins: null,
    quickConfigColumns: null,
    zMotion: null,
    documentationSite: null,
    beltGuide: null,
    commands: { ...defaultCommandPreferences },
  }
}
