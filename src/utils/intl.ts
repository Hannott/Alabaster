/**
 * Memoized `Intl` formatter construction.
 *
 * Building an `Intl.DateTimeFormat` costs roughly fifty times what formatting
 * one value with an existing instance does — measured in this project's own
 * runtime at 33 ms per thousand construct-and-format pairs against 0.6 ms per
 * thousand formats, and `Intl.NumberFormat` at 11 ms against 0.4 ms. A
 * formatter built inside a function that runs once per row therefore turns a
 * list's render into locale-data loading repeated once per row: History's job
 * list spent 33 of its 49 ms re-render on exactly that, and the same cost sat
 * in every other dated list in the product, because the shared date formatter
 * in `src/i18n/formats.ts` constructed one per formatted value.
 *
 * So every formatter whose options are not already held in a `computed` comes
 * from here instead of from a bare constructor call. A formatter is immutable
 * and stateless, so handing the same instance to every caller is safe; there
 * is nothing to invalidate either, because a formatter for one (locale,
 * options) pair never stops being right for that pair, and a changed user
 * preference produces a different options object, which is a different key.
 *
 * The cache is bounded by construction rather than by eviction: keys come from
 * the locales the product ships, the format modes the user can pick, and
 * option objects written literally at each call site — never from the data
 * being formatted — so it converges on a handful of entries and stays there.
 * A caller that derived options from unbounded data would break that, which is
 * why no such caller exists.
 */

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>()
const numberFormatters = new Map<string, Intl.NumberFormat>()

/**
 * Options are serialized with their own keys as the replacer allow-list, so
 * two objects that differ only in the order they were written land on one
 * entry rather than two equivalent ones.
 */
function cacheKey(locale: string, options: object | undefined): string {
  if (options === undefined) return locale
  // `\u0000` written as the escape, never embedded: a raw NUL byte in a
  // source file makes git treat the whole file as binary, which costs every
  // future diff and merge on it and no test would ever notice.
  return `${locale}\u0000${JSON.stringify(options, Object.keys(options).sort())}`
}

export function dateTimeFormat(
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = cacheKey(locale, options)
  const cached = dateTimeFormatters.get(key)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat(locale, options)
  dateTimeFormatters.set(key, formatter)
  return formatter
}

export function numberFormat(
  locale: string,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = cacheKey(locale, options)
  const cached = numberFormatters.get(key)
  if (cached) return cached
  const formatter = new Intl.NumberFormat(locale, options)
  numberFormatters.set(key, formatter)
  return formatter
}
