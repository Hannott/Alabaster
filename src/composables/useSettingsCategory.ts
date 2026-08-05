import { readonly, ref } from 'vue'

export type SettingsCategory =
  | 'all'
  | 'connection'
  | 'printers'
  | 'users'
  | 'language'
  | 'theme'
  | 'display'
  | 'editor'
  | 'confirmations'
  | 'backup'

const validCategories: readonly SettingsCategory[] = [
  'all',
  'connection',
  'printers',
  'users',
  'language',
  'theme',
  'display',
  'editor',
  'confirmations',
  'backup',
]

function isSettingsCategory(value: string): value is SettingsCategory {
  return validCategories.includes(value as SettingsCategory)
}

const settingsCategoryStorageKey = 'alabaster.settings.activeCategory'

function getInitialCategory(): SettingsCategory {
  const saved = localStorage.getItem(settingsCategoryStorageKey)
  return saved && isSettingsCategory(saved) ? saved : 'all'
}

const activeCategory = ref<SettingsCategory>(getInitialCategory())

function setActiveCategory(next: SettingsCategory): void {
  activeCategory.value = next
  localStorage.setItem(settingsCategoryStorageKey, next)
}

export function useSettingsCategory() {
  return {
    activeCategory: readonly(activeCategory),
    setActiveCategory,
  }
}
