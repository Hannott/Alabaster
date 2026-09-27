import type { MachineFileEntry } from '@/stores/machineFiles'

export interface ExplorerTreeEntry extends MachineFileEntry {
  path: string
}

export interface ExplorerTreeRow {
  entry: ExplorerTreeEntry
  /** 1 for the root's own entries; a row standing for the root itself is 0. */
  level: number
  /** The folder this row sits in; '' for the root. */
  parentPath: string
  /** Whether a folder row is open. Always false for a file. */
  expanded: boolean
}

export interface ExplorerTreeOptions {
  isVisible: (entry: ExplorerTreeEntry) => boolean
  /** Orders two entries of the same kind; folders always come first regardless. */
  compare: (left: ExplorerTreeEntry, right: ExplorerTreeEntry) => number
}

function joinTreePath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

/**
 * The tree as the rows on screen, top to bottom: each folder's entries follow
 * it only while it is expanded and its listing has arrived. An expanded folder
 * still waiting for its listing shows no children rather than a placeholder,
 * so the rows below it move once, when the answer lands.
 */
export function flattenExplorerTree(
  listings: ReadonlyMap<string, readonly MachineFileEntry[]>,
  expanded: ReadonlySet<string>,
  options: ExplorerTreeOptions,
): ExplorerTreeRow[] {
  const rows: ExplorerTreeRow[] = []
  const visit = (parentPath: string, level: number) => {
    const listing = listings.get(parentPath)
    if (!listing) return
    const entries = listing
      .map((entry) => ({ ...entry, path: joinTreePath(parentPath, entry.name) }))
      .filter(options.isVisible)
      .sort((left, right) => {
        if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
        return options.compare(left, right)
      })
    for (const entry of entries) {
      const isOpen = entry.kind === 'directory' && expanded.has(entry.path)
      rows.push({ entry, level, parentPath, expanded: isOpen })
      if (isOpen) visit(entry.path, level + 1)
    }
  }
  visit('', 1)
  return rows
}

export type ExplorerTreeKeyAction =
  | { kind: 'focus'; index: number }
  | { kind: 'expand'; path: string }
  | { kind: 'collapse'; path: string }

/**
 * What a key does on the row at `index`, following the WAI-ARIA tree pattern:
 * the vertical arrows and Home/End move between rows, Right opens a folder and
 * then steps into it, Left closes it and then steps out to its parent. Enter
 * and Space are left to the row's own button. Null for any other key, and for
 * a key with nowhere to go, so the event is left alone.
 */
export function explorerTreeKeyAction(
  rows: readonly ExplorerTreeRow[],
  index: number,
  key: string,
): ExplorerTreeKeyAction | null {
  const row = rows[index]
  if (!row) return null
  const focus = (target: number): ExplorerTreeKeyAction | null =>
    target >= 0 && target < rows.length && target !== index
      ? { kind: 'focus', index: target }
      : null
  switch (key) {
    case 'ArrowDown':
      return focus(index + 1)
    case 'ArrowUp':
      return focus(index - 1)
    case 'Home':
      return focus(0)
    case 'End':
      return focus(rows.length - 1)
    case 'ArrowRight':
      if (row.entry.kind !== 'directory') return null
      if (!row.expanded) return { kind: 'expand', path: row.entry.path }
      return rows[index + 1]?.parentPath === row.entry.path ? focus(index + 1) : null
    case 'ArrowLeft':
      if (row.expanded) return { kind: 'collapse', path: row.entry.path }
      return focus(rows.findIndex((candidate) => candidate.entry.path === row.parentPath))
    default:
      return null
  }
}
