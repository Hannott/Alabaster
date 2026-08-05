import { readonly, ref } from 'vue'

import { defaultFontId, ensureFontLoaded, fonts, isFontId, type FontId } from '@/fonts/registry'

const fontStorageKey = 'alabaster.font'

function getInitialFontId(): FontId {
  const saved = localStorage.getItem(fontStorageKey)
  return saved && isFontId(saved) ? saved : defaultFontId
}

const fontId = ref<FontId>(getInitialFontId())

function applyFont(next: FontId): void {
  document.documentElement.dataset.font = next
  ensureFontLoaded(next)
}

function setFontId(next: FontId): void {
  fontId.value = next
  localStorage.setItem(fontStorageKey, next)
  applyFont(next)
}

applyFont(fontId.value)

export function useFont() {
  return {
    fontId: readonly(fontId),
    fonts,
    setFontId,
  }
}
