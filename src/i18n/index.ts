import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import en from '@/locales/en.json'

export const supportedLocales = ['en', 'nb'] as const

export type SupportedLocale = (typeof supportedLocales)[number]
type MessageSchema = typeof en

const localeLoaders: Record<SupportedLocale, () => Promise<{ default: MessageSchema }>> = {
  en: async () => ({ default: en }),
  nb: () => import('@/locales/nb.json'),
}

const localeStorageKey = 'alabaster.locale'

const i18nOptions = {
  legacy: false,
  locale: 'en' as SupportedLocale,
  fallbackLocale: 'en' as SupportedLocale,
  // Secondary catalogs are loaded on demand; the assertion describes the
  // complete catalog shape without making them part of the initial bundle.
  messages: { en } as Record<SupportedLocale, MessageSchema>,
} as const

export const i18n = createI18n<false, typeof i18nOptions>(i18nOptions)

function normalizeLocale(locale: string | null | undefined): SupportedLocale | undefined {
  const language = locale?.trim().toLowerCase().split(/[-_]/)[0]

  return supportedLocales.find((supported) => supported === language)
}

export function resolvePreferredLocale(): SupportedLocale {
  const candidates = [
    localStorage.getItem(localeStorageKey),
    ...(navigator.languages ?? [navigator.language]),
  ]

  for (const candidate of candidates) {
    const locale = normalizeLocale(candidate)

    if (locale) return locale
  }

  return 'en'
}

export async function setLocale(locale: SupportedLocale): Promise<void> {
  if (!i18n.global.availableLocales.includes(locale)) {
    const messages = await localeLoaders[locale]()
    i18n.global.setLocaleMessage(locale, messages.default)
  }

  i18n.global.locale.value = locale
  document.documentElement.lang = locale
  localStorage.setItem(localeStorageKey, locale)
  await nextTick()
}

export async function initializeLocale(): Promise<void> {
  await setLocale(resolvePreferredLocale())
}
