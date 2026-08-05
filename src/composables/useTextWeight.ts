import { readonly, ref } from 'vue'

/**
 * Lets a reader pick their own base text weight — Light through Bold, the
 * named OpenType scale's middle five steps — rather than Alabaster fixing
 * one for everyone. `src/fonts/weights.css` turns the pick into
 * `--font-weight` plus two derived siblings two steps above and below it;
 * see there for why the picker itself stops at Light and Bold.
 */
export type TextWeightMode = 'light' | 'regular' | 'medium' | 'semibold' | 'bold'

const validTextWeightModes: readonly TextWeightMode[] = [
  'light',
  'regular',
  'medium',
  'semibold',
  'bold',
]

const defaultTextWeightMode: TextWeightMode = 'regular'

export function isTextWeightMode(value: string): value is TextWeightMode {
  return validTextWeightModes.includes(value as TextWeightMode)
}

const textWeightStorageKey = 'alabaster.textWeight'

function getInitialTextWeightMode(): TextWeightMode {
  const saved = localStorage.getItem(textWeightStorageKey)
  return saved && isTextWeightMode(saved) ? saved : defaultTextWeightMode
}

const mode = ref<TextWeightMode>(getInitialTextWeightMode())

function applyTextWeight(next: TextWeightMode): void {
  document.documentElement.dataset.textWeight = next
}

function setTextWeightMode(next: TextWeightMode): void {
  mode.value = next
  localStorage.setItem(textWeightStorageKey, next)
  applyTextWeight(next)
}

applyTextWeight(mode.value)

export function useTextWeight() {
  return {
    mode: readonly(mode),
    setTextWeightMode,
  }
}
