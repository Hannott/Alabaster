import { readonly, ref } from 'vue'

export interface FileHistoryEntry {
  path: string
  name: string
}

const MAX_FILE_HISTORY = 10

/**
 * Module-level so the back/forward trail survives leaving the Configuration
 * route and returning: the open file itself (`machineFiles.currentFile`) is
 * store state and stays put across that navigation, but a component-local
 * ref does not — it used to reset to empty on every remount, silently
 * discarding a trail the user had just built.
 */
const fileHistory = ref<FileHistoryEntry[]>([])
const fileHistoryIndex = ref(-1)

/** Appends `path`, dropping any forward history past the current step — the
 *  same "new navigation prunes the redo stack" rule a browser follows. */
function pushFileHistory(path: string, name: string): void {
  const truncated = fileHistory.value.slice(0, fileHistoryIndex.value + 1)
  truncated.push({ path, name })
  const overflow = truncated.length - MAX_FILE_HISTORY
  fileHistory.value = overflow > 0 ? truncated.slice(overflow) : truncated
  fileHistoryIndex.value = fileHistory.value.length - 1
}

function setFileHistoryIndex(index: number): void {
  fileHistoryIndex.value = index
}

/** Test-only: module-level state outlives `createPinia()`, so a suite that
 *  opens files across multiple tests must clear this itself between them. */
function resetFileHistory(): void {
  fileHistory.value = []
  fileHistoryIndex.value = -1
}

export function useConfigFileHistory() {
  return {
    fileHistory: readonly(fileHistory),
    fileHistoryIndex: readonly(fileHistoryIndex),
    pushFileHistory,
    setFileHistoryIndex,
    resetFileHistory,
  }
}
