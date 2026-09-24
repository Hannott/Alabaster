import { readonly, ref } from 'vue'

import type { MachineFileRoot, OpenMachineFile } from '@/stores/machineFiles'

/**
 * A file kept at the top of the Configuration explorer regardless of which
 * folder is currently browsed. Shaped exactly like `OpenMachineFile` (plus
 * the root it belongs to) so it can be handed straight to the view's
 * `openRecentFile`, the same open path a recent file already uses.
 */
export interface PinnedMachineFile extends OpenMachineFile {
  root: MachineFileRoot
}

const pinnedFilesStorageKey = 'alabaster.machine.pinnedFiles'

function isMachineFileRoot(value: unknown): value is MachineFileRoot {
  return value === 'config' || value === 'logs'
}

function isPinnedMachineFile(value: unknown): value is PinnedMachineFile {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    entry.kind === 'file' &&
    isMachineFileRoot(entry.root) &&
    typeof entry.path === 'string' &&
    entry.path.length > 0 &&
    typeof entry.name === 'string' &&
    typeof entry.size === 'number' &&
    typeof entry.modified === 'number' &&
    typeof entry.permissions === 'string'
  )
}

function loadPinnedFiles(): PinnedMachineFile[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(pinnedFilesStorageKey) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isPinnedMachineFile) : []
  } catch {
    return []
  }
}

const pinnedFiles = ref<PinnedMachineFile[]>(loadPinnedFiles())

function persist(): void {
  localStorage.setItem(pinnedFilesStorageKey, JSON.stringify(pinnedFiles.value))
}

function isPinned(root: MachineFileRoot, path: string): boolean {
  return pinnedFiles.value.some((entry) => entry.root === root && entry.path === path)
}

function pinFile(entry: PinnedMachineFile): void {
  if (isPinned(entry.root, entry.path)) return
  pinnedFiles.value = [...pinnedFiles.value, entry]
  persist()
}

function unpinFile(root: MachineFileRoot, path: string): void {
  if (!isPinned(root, path)) return
  pinnedFiles.value = pinnedFiles.value.filter(
    (entry) => !(entry.root === root && entry.path === path),
  )
  persist()
}

/**
 * Carries a pin through a rename, move, or delete — `nextPath: null` drops it,
 * otherwise it is repointed to the new path. Matches by exact path or by
 * `previousPath/` prefix so a folder rename or delete carries every pin nested
 * under it, the same repointing `machineFiles` itself does for open buffers:
 * without this, a pin outlives the path it was pinned to and becomes a
 * shortcut to a file that no longer exists there.
 */
function repointPinned(root: MachineFileRoot, previousPath: string, nextPath: string | null): void {
  let changed = false
  const next: PinnedMachineFile[] = []
  for (const entry of pinnedFiles.value) {
    const matches =
      entry.root === root &&
      (entry.path === previousPath || entry.path.startsWith(`${previousPath}/`))
    if (!matches) {
      next.push(entry)
      continue
    }
    changed = true
    if (nextPath === null) continue
    const path = nextPath + entry.path.slice(previousPath.length)
    next.push({ ...entry, path, name: path.slice(path.lastIndexOf('/') + 1) })
  }
  if (!changed) return
  pinnedFiles.value = next
  persist()
}

export function useMachineFilePins() {
  return {
    pinnedFiles: readonly(pinnedFiles),
    isPinned,
    pinFile,
    unpinFile,
    repointPinned,
  }
}
