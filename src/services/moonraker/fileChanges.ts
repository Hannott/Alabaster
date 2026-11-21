/**
 * `notify_filelist_changed`, read once into a typed change.
 *
 * Moonraker names the one item that changed — its root, its path, and for a
 * file its new size and modified time — so a client already holding a listing
 * can apply the change instead of asking for the listing again. Asking again is
 * not free: `server.files.list` walks the whole root on Moonraker's event loop,
 * stalling every other client while it runs, and a root changes often while a
 * printer works (`SAVE_VARIABLE`, Shake&Tune's graphs, a slicer's upload).
 */

import { normalizeMoonrakerRelativePath } from '@/services/moonraker/files'
import { isRecord } from '@/utils/records'

export type FileListAction =
  | 'create_file'
  | 'create_dir'
  | 'delete_file'
  | 'delete_dir'
  | 'move_file'
  | 'move_dir'
  | 'modify_file'
  | 'root_update'

const actions = new Set<string>([
  'create_file',
  'create_dir',
  'delete_file',
  'delete_dir',
  'move_file',
  'move_dir',
  'modify_file',
  'root_update',
])

export interface FileListItem {
  root: string
  /** Relative to `root`, without a leading or trailing slash. */
  path: string
  modified?: number
  size?: number
  permissions?: string
}

export interface FileListChange {
  action: FileListAction
  item: FileListItem
  /** Where a moved file or folder came from; only on `move_file` and `move_dir`. */
  source?: { root: string; path: string }
}

function readItem(value: unknown): FileListItem | null {
  if (!isRecord(value) || typeof value.root !== 'string' || typeof value.path !== 'string') {
    return null
  }
  let path: string
  try {
    path = normalizeMoonrakerRelativePath(value.path)
  } catch {
    return null
  }
  const item: FileListItem = { root: value.root, path }
  if (typeof value.modified === 'number') item.modified = value.modified
  if (typeof value.size === 'number') item.size = value.size
  if (typeof value.permissions === 'string') item.permissions = value.permissions
  return item
}

/** The change a `notify_filelist_changed` notification's first parameter reports, or null. */
export function parseFileListChange(params: readonly unknown[]): FileListChange | null {
  const change = params[0]
  if (!isRecord(change) || typeof change.action !== 'string' || !actions.has(change.action)) {
    return null
  }
  const item = readItem(change.item)
  if (!item) return null
  const parsed: FileListChange = { action: change.action as FileListAction, item }
  const source = readItem(change.source_item)
  if (source) parsed.source = { root: source.root, path: source.path }
  return parsed
}

/** Whether the change adds, removes, or alters anything under `root`. */
export function fileChangeTouchesRoot(change: FileListChange, root: string): boolean {
  return change.item.root === root || change.source?.root === root
}

/** The paths the change names under `root`: the item's, and a move's source. */
export function fileChangePathsIn(change: FileListChange, root: string): string[] {
  const paths: string[] = []
  if (change.item.root === root) paths.push(change.item.path)
  if (change.source?.root === root) paths.push(change.source.path)
  return paths
}

/** The folder holding `path`, relative to its root; `''` for the root itself. */
export function parentFolder(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

/** Whether `path` is `folder` or anything beneath it. */
export function isPathWithin(path: string, folder: string): boolean {
  return folder === '' || path === folder || path.startsWith(`${folder}/`)
}
