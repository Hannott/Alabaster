import { readonly, ref } from 'vue'

const showHiddenFilesStorageKey = 'alabaster.machine.showHiddenFiles'
const showBackupFilesStorageKey = 'alabaster.machine.showBackupFiles'
const showReadOnlyFilesStorageKey = 'alabaster.machine.showReadOnlyFiles'
const searchInFileContentsStorageKey = 'alabaster.machine.searchInFileContents'
const compactRowsStorageKey = 'alabaster.machine.compactRows'
const sortKeyStorageKey = 'alabaster.machine.sortKey'

/**
 * What the explorer orders each folder by. Folders always come first; within
 * each kind, names read A to Z while sizes and dates read largest and newest
 * first, the direction each is looked at for.
 */
export type MachineFileSortKey = 'name' | 'size' | 'modified'

function isSortKey(value: unknown): value is MachineFileSortKey {
  return value === 'name' || value === 'size' || value === 'modified'
}

const showHiddenFiles = ref(localStorage.getItem(showHiddenFilesStorageKey) === 'true')
const showBackupFiles = ref(localStorage.getItem(showBackupFilesStorageKey) === 'true')
// Read-only files are part of the configuration too, so they stay visible unless opted out.
const showReadOnlyFiles = ref(localStorage.getItem(showReadOnlyFilesStorageKey) !== 'false')
// Off by default: it costs a fetch per candidate file, where a name-only search costs nothing.
const searchInFileContents = ref(localStorage.getItem(searchInFileContentsStorageKey) === 'true')
// On by default: a dense, desktop-file-manager row is the shape most of this
// explorer's users expect, so the taller row is the opt-out rather than the opt-in.
const compactRows = ref(localStorage.getItem(compactRowsStorageKey) !== 'false')
const storedSortKey = localStorage.getItem(sortKeyStorageKey)
const sortKey = ref<MachineFileSortKey>(isSortKey(storedSortKey) ? storedSortKey : 'name')

function setShowHiddenFiles(enabled: boolean): void {
  showHiddenFiles.value = enabled
  localStorage.setItem(showHiddenFilesStorageKey, String(enabled))
}

function setShowBackupFiles(enabled: boolean): void {
  showBackupFiles.value = enabled
  localStorage.setItem(showBackupFilesStorageKey, String(enabled))
}

function setShowReadOnlyFiles(enabled: boolean): void {
  showReadOnlyFiles.value = enabled
  localStorage.setItem(showReadOnlyFilesStorageKey, String(enabled))
}

function setSearchInFileContents(enabled: boolean): void {
  searchInFileContents.value = enabled
  localStorage.setItem(searchInFileContentsStorageKey, String(enabled))
}

function setCompactRows(enabled: boolean): void {
  compactRows.value = enabled
  localStorage.setItem(compactRowsStorageKey, String(enabled))
}

function setSortKey(key: MachineFileSortKey): void {
  sortKey.value = key
  localStorage.setItem(sortKeyStorageKey, key)
}

export interface MachineFilesPreferences {
  showHiddenFiles: boolean
  showBackupFiles: boolean
  showReadOnlyFiles: boolean
  searchInFileContents: boolean
  compactRows: boolean
  sortKey: MachineFileSortKey
}

export const defaultMachineFilesPreferences: Readonly<MachineFilesPreferences> = {
  showHiddenFiles: false,
  showBackupFiles: false,
  showReadOnlyFiles: true,
  searchInFileContents: false,
  compactRows: true,
  sortKey: 'name',
}

function stored(): MachineFilesPreferences {
  return {
    showHiddenFiles: showHiddenFiles.value,
    showBackupFiles: showBackupFiles.value,
    showReadOnlyFiles: showReadOnlyFiles.value,
    searchInFileContents: searchInFileContents.value,
    compactRows: compactRows.value,
    sortKey: sortKey.value,
  }
}

/** A settings bundle's copy; a field of the wrong type leaves the current value. */
function replace(input: unknown): void {
  if (typeof input !== 'object' || input === null) return
  const record = input as Record<string, unknown>
  if (typeof record.showHiddenFiles === 'boolean') setShowHiddenFiles(record.showHiddenFiles)
  if (typeof record.showBackupFiles === 'boolean') setShowBackupFiles(record.showBackupFiles)
  if (typeof record.showReadOnlyFiles === 'boolean') setShowReadOnlyFiles(record.showReadOnlyFiles)
  if (typeof record.searchInFileContents === 'boolean') {
    setSearchInFileContents(record.searchInFileContents)
  }
  if (typeof record.compactRows === 'boolean') setCompactRows(record.compactRows)
  if (isSortKey(record.sortKey)) setSortKey(record.sortKey)
}

export function useMachineFilesSettings() {
  return {
    stored,
    replace,
    showHiddenFiles: readonly(showHiddenFiles),
    showBackupFiles: readonly(showBackupFiles),
    showReadOnlyFiles: readonly(showReadOnlyFiles),
    searchInFileContents: readonly(searchInFileContents),
    compactRows: readonly(compactRows),
    sortKey: readonly(sortKey),
    setShowHiddenFiles,
    setShowBackupFiles,
    setShowReadOnlyFiles,
    setSearchInFileContents,
    setCompactRows,
    setSortKey,
  }
}
