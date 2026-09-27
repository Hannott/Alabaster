import { describe, expect, it } from 'vitest'

import { explorerTreeKeyAction, flattenExplorerTree } from '@/features/machine/explorerTree'
import type { MachineFileEntry } from '@/stores/machineFiles'

function file(name: string): MachineFileEntry {
  return { kind: 'file', name, modified: 0, size: 1, permissions: 'rw' }
}

function folder(name: string): MachineFileEntry {
  return { kind: 'directory', name, modified: 0, size: 0, permissions: 'rw' }
}

const listings = new Map<string, MachineFileEntry[]>([
  ['', [file('printer.cfg'), folder('macros'), folder('KAMP'), file('.hidden.cfg')]],
  ['macros', [file('homing.cfg'), folder('extra')]],
  ['macros/extra', [file('purge.cfg')]],
  ['KAMP', [file('Line_Purge.cfg')]],
])

const byName = {
  isVisible: (entry: MachineFileEntry) => !entry.name.startsWith('.'),
  compare: (left: MachineFileEntry, right: MachineFileEntry) =>
    left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }),
}

describe('flattenExplorerTree', () => {
  it('lists folders first, then files, at every level', () => {
    const rows = flattenExplorerTree(listings, new Set(['macros']), byName)
    expect(rows.map((row) => row.entry.path)).toEqual([
      'KAMP',
      'macros',
      'macros/extra',
      'macros/homing.cfg',
      'printer.cfg',
    ])
  })

  it('shows a folder’s entries only while it is expanded', () => {
    expect(flattenExplorerTree(listings, new Set(), byName)).toHaveLength(3)
  })

  it('shows nothing under an expanded folder whose listing has not arrived', () => {
    const rows = flattenExplorerTree(
      new Map([['', [folder('macros')]]]),
      new Set(['macros']),
      byName,
    )
    expect(rows.map((row) => row.entry.path)).toEqual(['macros'])
    expect(rows[0]!.expanded).toBe(true)
  })

  it('does not reach into a folder whose parent is collapsed', () => {
    const rows = flattenExplorerTree(listings, new Set(['macros/extra']), byName)
    expect(rows.map((row) => row.entry.path)).not.toContain('macros/extra/purge.cfg')
  })

  it('numbers levels from one and records each row’s folder', () => {
    const rows = flattenExplorerTree(listings, new Set(['macros', 'macros/extra']), byName)
    const purge = rows.find((row) => row.entry.name === 'purge.cfg')!
    expect(purge.level).toBe(3)
    expect(purge.parentPath).toBe('macros/extra')
  })
})

describe('explorerTreeKeyAction', () => {
  const rows = flattenExplorerTree(listings, new Set(['macros']), byName)
  const indexOf = (path: string) => rows.findIndex((row) => row.entry.path === path)

  it('moves between rows with the vertical arrows, Home, and End', () => {
    expect(explorerTreeKeyAction(rows, 0, 'ArrowDown')).toEqual({ kind: 'focus', index: 1 })
    expect(explorerTreeKeyAction(rows, 1, 'ArrowUp')).toEqual({ kind: 'focus', index: 0 })
    expect(explorerTreeKeyAction(rows, 2, 'Home')).toEqual({ kind: 'focus', index: 0 })
    expect(explorerTreeKeyAction(rows, 0, 'End')).toEqual({ kind: 'focus', index: rows.length - 1 })
  })

  it('leaves the key alone with nowhere to go', () => {
    expect(explorerTreeKeyAction(rows, 0, 'ArrowUp')).toBeNull()
    expect(explorerTreeKeyAction(rows, rows.length - 1, 'ArrowDown')).toBeNull()
    expect(explorerTreeKeyAction(rows, indexOf('printer.cfg'), 'ArrowRight')).toBeNull()
    expect(explorerTreeKeyAction(rows, 0, 'a')).toBeNull()
  })

  it('opens a closed folder, then steps into it', () => {
    expect(explorerTreeKeyAction(rows, indexOf('KAMP'), 'ArrowRight')).toEqual({
      kind: 'expand',
      path: 'KAMP',
    })
    expect(explorerTreeKeyAction(rows, indexOf('macros'), 'ArrowRight')).toEqual({
      kind: 'focus',
      index: indexOf('macros/extra'),
    })
  })

  it('closes an open folder, then steps out to the parent', () => {
    expect(explorerTreeKeyAction(rows, indexOf('macros'), 'ArrowLeft')).toEqual({
      kind: 'collapse',
      path: 'macros',
    })
    expect(explorerTreeKeyAction(rows, indexOf('macros/homing.cfg'), 'ArrowLeft')).toEqual({
      kind: 'focus',
      index: indexOf('macros'),
    })
    expect(explorerTreeKeyAction(rows, indexOf('printer.cfg'), 'ArrowLeft')).toBeNull()
  })
})
