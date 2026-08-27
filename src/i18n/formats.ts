import { readonly, ref } from 'vue'

import { dateTimeFormat } from '@/utils/intl'

/** `auto` follows the active locale's own convention; the other two force a cycle regardless of locale. */
export type TimeFormatMode = 'auto' | 'h23' | 'h12'

/**
 * `auto` follows the active locale the user picked inside Alabaster; `browser`
 * instead follows the visitor's own browser/OS locale, regardless of which
 * language Alabaster is displaying. Every fixed mode is a component order and
 * delimiter independent of any locale — the same catalogue of variations
 * Mainsail's date-format picker offers, so a user coming from there finds the
 * option they already expect. `custom` renders whatever pattern the user
 * types, via the token legend in `customDateTokens` below.
 *
 * A literal dot in a mode name would read as a nested-key separator once the
 * mode is interpolated into an i18n lookup path, so the dotted variants are
 * named with a `-dot` suffix instead — the rendered delimiter comes from
 * `DATE_PATTERNS` below, not from the mode name itself.
 */
export type DateFormatMode =
  | 'auto'
  | 'browser'
  | 'iso'
  | 'mm-dd-yyyy'
  | 'mm-dd-yy'
  | 'm-d-yyyy'
  | 'm-d-yy'
  | 'dd-mm-yyyy'
  | 'dd-mm-yy'
  | 'dd-mm-yyyy-dot'
  | 'dd-mm-yy-dot'
  | 'd-m-yyyy-dot'
  | 'd-m-yy-dot'
  | 'yyyy-mm-dd-dot'
  | 'yy-mm-dd-dot'
  | 'custom'

/** Canonical order for rendering the date-format picker; keep new modes appended here. */
export const dateFormatModes: readonly DateFormatMode[] = [
  'auto',
  'browser',
  'iso',
  'mm-dd-yyyy',
  'mm-dd-yy',
  'm-d-yyyy',
  'm-d-yy',
  'dd-mm-yyyy',
  'dd-mm-yy',
  'dd-mm-yyyy-dot',
  'dd-mm-yy-dot',
  'd-m-yyyy-dot',
  'd-m-yy-dot',
  'yyyy-mm-dd-dot',
  'yy-mm-dd-dot',
  'custom',
]

type FixedDateFormatMode = Exclude<DateFormatMode, 'auto' | 'browser' | 'custom'>
type DateComponentToken = 'yyyy' | 'yy' | 'mm' | 'm' | 'dd' | 'd'

interface DatePatternSpec {
  delimiter: string
  order: readonly DateComponentToken[]
}

const DATE_PATTERNS: Record<FixedDateFormatMode, DatePatternSpec> = {
  iso: { delimiter: '-', order: ['yyyy', 'mm', 'dd'] },
  'mm-dd-yyyy': { delimiter: '-', order: ['mm', 'dd', 'yyyy'] },
  'mm-dd-yy': { delimiter: '-', order: ['mm', 'dd', 'yy'] },
  'm-d-yyyy': { delimiter: '-', order: ['m', 'd', 'yyyy'] },
  'm-d-yy': { delimiter: '-', order: ['m', 'd', 'yy'] },
  'dd-mm-yyyy': { delimiter: '-', order: ['dd', 'mm', 'yyyy'] },
  'dd-mm-yy': { delimiter: '-', order: ['dd', 'mm', 'yy'] },
  'dd-mm-yyyy-dot': { delimiter: '.', order: ['dd', 'mm', 'yyyy'] },
  'dd-mm-yy-dot': { delimiter: '.', order: ['dd', 'mm', 'yy'] },
  'd-m-yyyy-dot': { delimiter: '.', order: ['d', 'm', 'yyyy'] },
  'd-m-yy-dot': { delimiter: '.', order: ['d', 'm', 'yy'] },
  'yyyy-mm-dd-dot': { delimiter: '.', order: ['yyyy', 'mm', 'dd'] },
  'yy-mm-dd-dot': { delimiter: '.', order: ['yy', 'mm', 'dd'] },
}

function dateComponent(date: Date, token: DateComponentToken): string {
  switch (token) {
    case 'yyyy':
      return `${date.getFullYear()}`
    case 'yy':
      return `${date.getFullYear()}`.slice(-2)
    case 'mm':
      return `${date.getMonth() + 1}`.padStart(2, '0')
    case 'm':
      return `${date.getMonth() + 1}`
    case 'dd':
      return `${date.getDate()}`.padStart(2, '0')
    case 'd':
      return `${date.getDate()}`
  }
}

/**
 * Fixed patterns can't be expressed through `Intl.DateTimeFormatOptions` —
 * there is no option for a custom component order or delimiter — so they are
 * built from date-component getters instead, matching Mainsail's own approach.
 */
function formatFixedPattern(date: Date, mode: FixedDateFormatMode, short: boolean): string {
  const spec = DATE_PATTERNS[mode]
  const order = short
    ? spec.order.filter((token) => token !== 'yyyy' && token !== 'yy')
    : spec.order
  return order.map((token) => dateComponent(date, token)).join(spec.delimiter)
}

/**
 * Every token the free-text "Custom" pattern understands, case-insensitively
 * — `YYYY` and `yyyy` mean the same thing, so a typo in casing never silently
 * falls back to literal text. Anything in a typed pattern that isn't one of
 * these runs through untouched, which is what lets delimiters, spaces, and
 * arbitrary words sit alongside them.
 *
 * Ordered longest-first within each letter family (`yyyy` before `yy`, `mmmm`
 * before `mm` before `m`) so the matching regex below — a plain left-to-right
 * alternation — commits to the longer token wherever both could match.
 */
export const customDateTokens: readonly { token: string; labelKey: string }[] = [
  { token: 'yyyy', labelKey: 'formats.date.customLegend.yyyy' },
  { token: 'yy', labelKey: 'formats.date.customLegend.yy' },
  { token: 'mmmm', labelKey: 'formats.date.customLegend.mmmm' },
  { token: 'mmm', labelKey: 'formats.date.customLegend.mmm' },
  { token: 'mm', labelKey: 'formats.date.customLegend.mm' },
  { token: 'm', labelKey: 'formats.date.customLegend.m' },
  { token: 'dddd', labelKey: 'formats.date.customLegend.dddd' },
  { token: 'ddd', labelKey: 'formats.date.customLegend.ddd' },
  { token: 'dd', labelKey: 'formats.date.customLegend.dd' },
  { token: 'd', labelKey: 'formats.date.customLegend.d' },
]

const CUSTOM_TOKEN_PATTERN = new RegExp(
  customDateTokens.map((entry) => entry.token).join('|'),
  'gi',
)

/** The example column of the custom-token legend, and the engine behind `formatCustomPattern`. */
export function formatCustomToken(token: string, date: Date, locale: string): string {
  switch (token.toLowerCase()) {
    case 'yyyy':
      return `${date.getFullYear()}`
    case 'yy':
      return `${date.getFullYear()}`.slice(-2)
    case 'mm':
      return `${date.getMonth() + 1}`.padStart(2, '0')
    case 'm':
      return `${date.getMonth() + 1}`
    case 'mmm':
      return dateTimeFormat(locale, { month: 'short' }).format(date)
    case 'mmmm':
      return dateTimeFormat(locale, { month: 'long' }).format(date)
    case 'dd':
      return `${date.getDate()}`.padStart(2, '0')
    case 'd':
      return `${date.getDate()}`
    case 'ddd':
      return dateTimeFormat(locale, { weekday: 'short' }).format(date)
    case 'dddd':
      return dateTimeFormat(locale, { weekday: 'long' }).format(date)
    default:
      return token
  }
}

function formatCustomPattern(pattern: string, date: Date, locale: string): string {
  if (pattern.trim() === '') return ''
  return pattern.replace(CUSTOM_TOKEN_PATTERN, (match) => formatCustomToken(match, date, locale))
}

function browserLocale(): string {
  if (typeof navigator === 'undefined') return 'en-US'
  return navigator.languages?.[0] ?? navigator.language ?? 'en-US'
}

const timeStorageKey = 'alabaster.format.time'
const dateStorageKey = 'alabaster.format.date'
const customPatternStorageKey = 'alabaster.format.dateCustomPattern'

/** What a freshly opened "Custom" field starts from — recognizable, and a valid pattern on its own. */
export const defaultCustomDatePattern = 'yyyy-mm-dd'

export function isTimeFormatMode(value: string): value is TimeFormatMode {
  return value === 'auto' || value === 'h23' || value === 'h12'
}

export function isDateFormatMode(value: string): value is DateFormatMode {
  return (dateFormatModes as readonly string[]).includes(value)
}

function getInitialTimeMode(): TimeFormatMode {
  const saved = localStorage.getItem(timeStorageKey)
  return saved !== null && isTimeFormatMode(saved) ? saved : 'auto'
}

function getInitialDateMode(): DateFormatMode {
  const saved = localStorage.getItem(dateStorageKey)
  return saved !== null && isDateFormatMode(saved) ? saved : 'auto'
}

function getInitialCustomPattern(): string {
  return localStorage.getItem(customPatternStorageKey) ?? defaultCustomDatePattern
}

const timeMode = ref<TimeFormatMode>(getInitialTimeMode())
const dateMode = ref<DateFormatMode>(getInitialDateMode())
const dateCustomPattern = ref<string>(getInitialCustomPattern())

function setTimeMode(mode: TimeFormatMode): void {
  timeMode.value = mode
  localStorage.setItem(timeStorageKey, mode)
}

function setDateMode(mode: DateFormatMode): void {
  dateMode.value = mode
  localStorage.setItem(dateStorageKey, mode)
}

function setDateCustomPattern(pattern: string): void {
  dateCustomPattern.value = pattern
  localStorage.setItem(customPatternStorageKey, pattern)
}

interface TimeOptions {
  /** Adds `second: '2-digit'` — the console transcript is the one caller that needs it. */
  seconds?: boolean
}

/**
 * `dateStyle`/`timeStyle` presets cannot be mixed with an explicit `hourCycle`
 * override in the same `Intl.DateTimeFormatOptions` object — it throws. Every
 * formatter here is built from explicit components instead, so a forced hour
 * cycle always applies no matter which style tier is requested.
 */
function timeIntlOptions(mode: TimeFormatMode, opts: TimeOptions): Intl.DateTimeFormatOptions {
  const options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }
  if (opts.seconds) options.second = '2-digit'
  if (mode !== 'auto') options.hourCycle = mode
  return options
}

interface DateOptions {
  /** `short` omits the year, for contexts where the date is assumed recent (a file's last-modified stamp). `medium` (default) is a full calendar date. */
  style?: 'short' | 'medium'
}

function dateIntlOptions(opts: DateOptions): Intl.DateTimeFormatOptions {
  const style = opts.style ?? 'medium'
  return style === 'short'
    ? { month: 'short', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' }
}

/**
 * The one place that turns a `DateFormatMode` into text — `createDateFormatter`
 * and `createDateTimeFormatter` close over the live mode/pattern refs, while
 * `previewDateFormat` calls this directly so the picker can show every option
 * its own example without touching global state to do it.
 */
function formatDate(
  mode: DateFormatMode,
  appLocale: string,
  value: Date | number,
  opts: DateOptions,
  customPattern: string,
): string {
  const date = new Date(value)
  if (mode === 'auto') return dateTimeFormat(appLocale, dateIntlOptions(opts)).format(date)
  if (mode === 'browser') {
    return dateTimeFormat(browserLocale(), dateIntlOptions(opts)).format(date)
  }
  if (mode === 'custom') return formatCustomPattern(customPattern, date, appLocale)
  return formatFixedPattern(date, mode, opts.style === 'short')
}

/**
 * Narrower than `Intl.DateTimeFormat` so a fixed-pattern or custom mode can
 * return a plain formatter too. Accepts the same `Date | number` union
 * `Intl.DateTimeFormat#format` does — callers pass epoch milliseconds
 * straight from Moonraker payloads.
 */
export interface DateFormatterLike {
  format(date: Date | number): string
}

/**
 * The returned formatter is shared rather than freshly built — see
 * `src/utils/intl.ts` for why, and note that this is safe only because an
 * `Intl` formatter is immutable. The name stays `create` because what a caller
 * gets back is unchanged: a formatter for the mode in force when it asked.
 */
export function createTimeFormatter(locale: string, opts: TimeOptions = {}): Intl.DateTimeFormat {
  return dateTimeFormat(locale, timeIntlOptions(timeMode.value, opts))
}

export function createDateFormatter(locale: string, opts: DateOptions = {}): DateFormatterLike {
  return {
    format: (value) => formatDate(dateMode.value, locale, value, opts, dateCustomPattern.value),
  }
}

export function createDateTimeFormatter(locale: string, opts: DateOptions = {}): DateFormatterLike {
  const timeFormatter = createTimeFormatter(locale)
  return {
    format: (value) =>
      `${formatDate(dateMode.value, locale, value, opts, dateCustomPattern.value)} ${timeFormatter.format(value)}`,
  }
}

/** Renders what `mode` would look like right now, without touching the applied mode — the picker's own example column. */
export function previewTimeFormat(mode: TimeFormatMode, locale: string, date: Date): string {
  return dateTimeFormat(locale, timeIntlOptions(mode, {})).format(date)
}

/** Same as `previewTimeFormat`, for the date picker; `pattern` only matters when `mode` is `'custom'`. */
export function previewDateFormat(
  mode: DateFormatMode,
  locale: string,
  date: Date,
  pattern: string,
): string {
  return formatDate(mode, locale, date, {}, pattern)
}

export function useDateTimeFormatMode() {
  return {
    timeMode: readonly(timeMode),
    dateMode: readonly(dateMode),
    dateCustomPattern: readonly(dateCustomPattern),
    setTimeMode,
    setDateMode,
    setDateCustomPattern,
  }
}
