import type { AppIconName } from '@/components/AppIcon.vue'
import { classifyFileKind, fileExtension, PRIMARY_CONFIG } from '@/features/machine/fileKind'
import { INCLUDABLE_EXTENSIONS } from '@/features/machine/includes'

const IMAGE_ICONS: Record<string, AppIconName> = {
  jpg: 'fileJpg',
  jpeg: 'fileJpg',
  png: 'filePng',
}

/**
 * The icon for a file row. Directories are always `folder`, decided by the
 * caller. `printer.cfg` gets its own glyph before the generic config check,
 * since it is the one file every printer has and the root Klipper actually
 * loads — worth telling apart from an ordinary included `.cfg` at a glance.
 * Only jpg/png get a format-specific glyph beyond that — `classifyFileKind`'s
 * other image extensions (gif, webp, svg, ...) fall to the generic `fileText`
 * rather than guessing a misleading jpg/png shape for them.
 */
export function fileIcon(name: string): AppIconName {
  if (name === PRIMARY_CONFIG) return 'filePrinter'
  if (INCLUDABLE_EXTENSIONS.has(fileExtension(name))) return 'fileCode'
  if (classifyFileKind(name) === 'image') return IMAGE_ICONS[fileExtension(name)] ?? 'fileText'
  return 'fileText'
}
