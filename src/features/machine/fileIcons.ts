import type { AppIconName } from '@/components/AppIcon.vue'
import { classifyFileKind, fileExtension } from '@/features/machine/fileKind'
import { INCLUDABLE_EXTENSIONS } from '@/features/machine/includes'

const IMAGE_ICONS: Record<string, AppIconName> = {
  jpg: 'fileJpg',
  jpeg: 'fileJpg',
  png: 'filePng',
}

/**
 * The icon for a file row. Directories are always `folder`, decided by the
 * caller. Only jpg/png get a format-specific glyph — `classifyFileKind`'s
 * other image extensions (gif, webp, svg, ...) fall to the generic `fileText`
 * rather than guessing a misleading jpg/png shape for them.
 */
export function fileIcon(name: string): AppIconName {
  if (INCLUDABLE_EXTENSIONS.has(fileExtension(name))) return 'fileCode'
  if (classifyFileKind(name) === 'image') return IMAGE_ICONS[fileExtension(name)] ?? 'fileText'
  return 'fileText'
}
