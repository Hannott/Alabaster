import { readonly, ref } from 'vue'

import { moveBeside, type TabDropPlacement } from '@/features/machine/tabRows'
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

/**
 * A pin is a root and a path; name, size, modified and permissions are only the
 * listing it was copied from. Reading by identity is deliberate: a guard that
 * demanded every field made any change to the file-entry shape drop every
 * stored pin without a word, and the empty list was then saved and synced over
 * the user's real one. Whatever is missing is filled in, and an entry is
 * refused only when it cannot name a file.
 */
function toPinnedMachineFile(value: unknown): PinnedMachineFile | null {
  if (typeof value !== 'object' || value === null) return null
  const entry = value as Record<string, unknown>
  if (!isMachineFileRoot(entry.root)) return null
  if (typeof entry.path !== 'string' || entry.path.length === 0) return null
  const path = entry.path
  return {
    kind: 'file',
    root: entry.root,
    path,
    name:
      typeof entry.name === 'string' && entry.name.length > 0
        ? entry.name
        : path.slice(path.lastIndexOf('/') + 1),
    size: typeof entry.size === 'number' ? entry.size : 0,
    modified: typeof entry.modified === 'number' ? entry.modified : 0,
    permissions: typeof entry.permissions === 'string' ? entry.permissions : 'rw',
  }
}

function readPinnedFiles(input: readonly unknown[]): PinnedMachineFile[] {
  const seen = new Set<string>()
  const pins: PinnedMachineFile[] = []
  for (const item of input) {
    const pin = toPinnedMachineFile(item)
    if (!pin) continue
    const key = `${pin.root}:${pin.path}`
    if (seen.has(key)) continue
    seen.add(key)
    pins.push(pin)
  }
  return pins
}

function loadPinnedFiles(): PinnedMachineFile[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(pinnedFilesStorageKey) ?? '[]')
    return Array.isArray(parsed) ? readPinnedFiles(parsed) : []
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

/**
 * A settings bundle's copy; an entry that is not a pin is dropped. A list that
 * held entries but yielded no pin at all is unreadable rather than empty, and
 * is ignored: applying it would erase the pins this browser still has.
 */
function replacePinned(input: unknown): void {
  if (!Array.isArray(input)) return
  const next = readPinnedFiles(input)
  if (input.length > 0 && next.length === 0) return
  pinnedFiles.value = next
  persist()
}

/** Puts a pin next to another of the same root; pins of the other root keep their places. */
function reorderPinned(
  root: MachineFileRoot,
  path: string,
  targetPath: string,
  placement: TabDropPlacement,
): void {
  const moving = pinnedFiles.value.find((entry) => entry.root === root && entry.path === path)
  const target = pinnedFiles.value.find((entry) => entry.root === root && entry.path === targetPath)
  if (!moving || !target) return
  const next = moveBeside(pinnedFiles.value, moving, target, placement)
  if (next === pinnedFiles.value) return
  pinnedFiles.value = [...next]
  persist()
}

export function useMachineFilePins() {
  return {
    pinnedFiles: readonly(pinnedFiles),
    replacePinned,
    isPinned,
    pinFile,
    unpinFile,
    repointPinned,
    reorderPinned,
  }
}
