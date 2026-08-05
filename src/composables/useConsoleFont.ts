import { readonly, ref } from 'vue'

import { ensureFontLoaded, fonts, isFontId, type FontId } from '@/fonts/registry'

/**
 * The console's own typeface, independent of the interface typeface in
 * `useFont.ts`. `'match'` (the default) means "whatever `--font-mono` already
 * resolves to" — see `fonts.css`'s `--console-font-family: var(--font-mono)`
 * — so a reader who has never touched this setting sees the console change
 * along with everything else, exactly as before this existed. Naming one of
 * the five fonts here detaches it: the console keeps that choice even if the
 * interface typeface changes afterward.
 */
export type ConsoleFontChoice = 'match' | FontId

const consoleFontStorageKey = 'alabaster.consoleFont'

export function isConsoleFontChoice(value: string): value is ConsoleFontChoice {
  return value === 'match' || isFontId(value)
}

function getInitialConsoleFont(): ConsoleFontChoice {
  const saved = localStorage.getItem(consoleFontStorageKey)
  return saved && isConsoleFontChoice(saved) ? saved : 'match'
}

const consoleFont = ref<ConsoleFontChoice>(getInitialConsoleFont())

function applyConsoleFont(next: ConsoleFontChoice): void {
  if (next === 'match') {
    delete document.documentElement.dataset.consoleFont
    return
  }
  document.documentElement.dataset.consoleFont = next
  ensureFontLoaded(next)
}

function setConsoleFont(next: ConsoleFontChoice): void {
  consoleFont.value = next
  localStorage.setItem(consoleFontStorageKey, next)
  applyConsoleFont(next)
}

applyConsoleFont(consoleFont.value)

export function useConsoleFont() {
  return {
    consoleFont: readonly(consoleFont),
    fonts,
    setConsoleFont,
  }
}
