import { describe, expect, it } from 'vitest'

import {
  fileChangePathsIn,
  fileChangeTouchesRoot,
  isPathWithin,
  parentFolder,
  parseFileListChange,
} from '@/services/moonraker/fileChanges'

describe('parseFileListChange', () => {
  it('reads the item a notification names, with its new size and time', () => {
    expect(
      parseFileListChange([
        {
          action: 'modify_file',
          item: {
            root: 'config',
            path: 'macros/park.cfg',
            modified: 5,
            size: 12,
            permissions: 'rw',
          },
        },
      ]),
    ).toEqual({
      action: 'modify_file',
      item: { root: 'config', path: 'macros/park.cfg', modified: 5, size: 12, permissions: 'rw' },
    })
  })

  it("keeps a move's source", () => {
    const change = parseFileListChange([
      {
        action: 'move_file',
        item: { root: 'gcodes', path: 'sub/a.gcode' },
        source_item: { root: 'gcodes', path: 'a.gcode' },
      },
    ])
    expect(change?.source).toEqual({ root: 'gcodes', path: 'a.gcode' })
  })

  it('refuses a payload it cannot read rather than guessing at it', () => {
    expect(parseFileListChange([])).toBeNull()
    expect(
      parseFileListChange([{ action: 'explode', item: { root: 'config', path: 'a' } }]),
    ).toBeNull()
    expect(parseFileListChange([{ action: 'create_file', item: { root: 'config' } }])).toBeNull()
    expect(
      parseFileListChange([{ action: 'create_file', item: { root: 'config', path: '../a.cfg' } }]),
    ).toBeNull()
  })
})

describe('file change helpers', () => {
  const moveAcross = parseFileListChange([
    {
      action: 'move_file',
      item: { root: 'config', path: 'kept.cfg' },
      source_item: { root: 'gcodes', path: 'dropped.cfg' },
    },
  ])!

  it('counts a move as touching both the root it left and the one it reached', () => {
    expect(fileChangeTouchesRoot(moveAcross, 'config')).toBe(true)
    expect(fileChangeTouchesRoot(moveAcross, 'gcodes')).toBe(true)
    expect(fileChangeTouchesRoot(moveAcross, 'logs')).toBe(false)
    expect(fileChangePathsIn(moveAcross, 'config')).toEqual(['kept.cfg'])
    expect(fileChangePathsIn(moveAcross, 'gcodes')).toEqual(['dropped.cfg'])
  })

  it('names the folder holding a path, and what lies within a folder', () => {
    expect(parentFolder('printer.cfg')).toBe('')
    expect(parentFolder('a/b/c.cfg')).toBe('a/b')
    expect(isPathWithin('a/b/c.cfg', 'a')).toBe(true)
    expect(isPathWithin('ab/c.cfg', 'a')).toBe(false)
    expect(isPathWithin('a', 'a')).toBe(true)
  })
})
