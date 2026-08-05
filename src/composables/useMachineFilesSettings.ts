import { readonly, ref } from 'vue'

const showHiddenFilesStorageKey = 'alabaster.machine.showHiddenFiles'
const showBackupFilesStorageKey = 'alabaster.machine.showBackupFiles'
const showReadOnlyFilesStorageKey = 'alabaster.machine.showReadOnlyFiles'
const searchInFileContentsStorageKey = 'alabaster.machine.searchInFileContents'

const showHiddenFiles = ref(localStorage.getItem(showHiddenFilesStorageKey) === 'true')
const showBackupFiles = ref(localStorage.getItem(showBackupFilesStorageKey) === 'true')
// Read-only files are part of the configuration too, so they stay visible unless opted out.
const showReadOnlyFiles = ref(localStorage.getItem(showReadOnlyFilesStorageKey) !== 'false')
// Off by default: it costs a fetch per candidate file, where a name-only search costs nothing.
const searchInFileContents = ref(localStorage.getItem(searchInFileContentsStorageKey) === 'true')

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

export function useMachineFilesSettings() {
  return {
    showHiddenFiles: readonly(showHiddenFiles),
    showBackupFiles: readonly(showBackupFiles),
    showReadOnlyFiles: readonly(showReadOnlyFiles),
    searchInFileContents: readonly(searchInFileContents),
    setShowHiddenFiles,
    setShowBackupFiles,
    setShowReadOnlyFiles,
    setSearchInFileContents,
  }
}
