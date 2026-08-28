import { describe, expect, it } from 'vitest'

import { fileIcon } from '@/features/machine/fileIcons'

describe('fileIcon', () => {
  it('gives printer.cfg its own glyph ahead of the generic config icon', () => {
    expect(fileIcon('printer.cfg')).toBe('filePrinter')
  })

  it('falls back to the generic config icon for every other includable file', () => {
    expect(fileIcon('macros.cfg')).toBe('fileCode')
    expect(fileIcon('moonraker.conf')).toBe('fileCode')
  })

  it('gives jpg and png their own format icon', () => {
    expect(fileIcon('snapshot.jpg')).toBe('fileJpg')
    expect(fileIcon('snapshot.jpeg')).toBe('fileJpg')
    expect(fileIcon('snapshot.png')).toBe('filePng')
  })

  it('falls back to the generic text icon for everything else', () => {
    expect(fileIcon('notes.md')).toBe('fileText')
    expect(fileIcon('klippy.log')).toBe('fileText')
    expect(fileIcon('snapshot.gif')).toBe('fileText')
  })
})
