/** Whether `name` is a dot-hidden entry, hidden by default as on Unix systems. */
export function isHiddenEntryName(name: string): boolean {
  return name.startsWith('.')
}

const BACKUP_EXTENSION_PATTERN = /\.(bak|bkp)$/i

/**
 * Whether `name` looks like a backup rather than an active configuration file
 * or folder: Klipper's SAVE_CONFIG backups (`.bkp`), common editor backups
 * (`.bak`, a trailing `~`), or anything with "backup" in its name.
 */
export function isBackupEntryName(name: string): boolean {
  return BACKUP_EXTENSION_PATTERN.test(name) || name.endsWith('~') || /backup/i.test(name)
}

/** Whether an entry's Moonraker permission string lacks write access. */
export function isReadOnlyEntry(entry: { permissions: string }): boolean {
  return !entry.permissions.includes('w')
}
