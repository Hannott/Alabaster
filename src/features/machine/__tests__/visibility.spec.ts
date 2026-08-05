import { describe, expect, it } from 'vitest'

import {
  isBackupEntryName,
  isHiddenEntryName,
  isReadOnlyEntry,
} from '@/features/machine/visibility'

describe('isHiddenEntryName', () => {
  it('treats dot-prefixed names as hidden', () => {
    for (const name of ['.moonraker_backups', '.gitignore', '.env']) {
      expect(isHiddenEntryName(name)).toBe(true)
    }
  })

  it('treats ordinary names as visible', () => {
    for (const name of ['printer.cfg', 'macros', 'notes.md']) {
      expect(isHiddenEntryName(name)).toBe(false)
    }
  })
})

describe('isBackupEntryName', () => {
  it('recognizes Klipper SAVE_CONFIG and editor backup extensions', () => {
    for (const name of ['printer.cfg.bkp', 'printer.cfg.bak', 'moonraker.conf~']) {
      expect(isBackupEntryName(name)).toBe(true)
    }
  })

  it('recognizes names or folders containing "backup"', () => {
    for (const name of ['config_backup', 'Backups', 'printer-backup.cfg']) {
      expect(isBackupEntryName(name)).toBe(true)
    }
  })

  it('treats ordinary configuration files as not backups', () => {
    for (const name of ['printer.cfg', 'macros.cfg', 'notes.md']) {
      expect(isBackupEntryName(name)).toBe(false)
    }
  })
})

describe('isReadOnlyEntry', () => {
  it('treats permissions without write access as read-only', () => {
    for (const permissions of ['r', '']) {
      expect(isReadOnlyEntry({ permissions })).toBe(true)
    }
  })

  it('treats permissions with write access as not read-only', () => {
    for (const permissions of ['rw', 'w']) {
      expect(isReadOnlyEntry({ permissions })).toBe(false)
    }
  })
})
