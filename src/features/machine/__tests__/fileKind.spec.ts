import { describe, expect, it } from 'vitest'

import {
  classifyFileKind,
  isLargeFile,
  LARGE_IMAGE_FILE_BYTES,
  LARGE_TEXT_FILE_BYTES,
} from '@/features/machine/fileKind'

describe('classifyFileKind', () => {
  it('recognizes common image extensions regardless of case', () => {
    for (const name of ['photo.png', 'Photo.JPG', 'icon.svg', 'anim.GIF', 'shot.webp']) {
      expect(classifyFileKind(name)).toBe('image')
    }
  })

  it('recognizes common configuration and text extensions', () => {
    for (const name of ['printer.cfg', 'moonraker.conf', 'notes.md', 'macro.gcode']) {
      expect(classifyFileKind(name)).toBe('text')
    }
  })

  it('treats extensionless files as text, matching prior behavior', () => {
    expect(classifyFileKind('README')).toBe('text')
  })

  it('treats unrecognized extensions as unsupported', () => {
    for (const name of ['backup.zip', 'model.stl', 'archive.tar.gz']) {
      expect(classifyFileKind(name)).toBe('unsupported')
    }
  })

  it('recognizes HTML files regardless of case', () => {
    for (const name of ['report.html', 'Index.HTM']) {
      expect(classifyFileKind(name)).toBe('html')
    }
  })

  it('treats a rotated log ending in a date as the extension underneath it', () => {
    for (const name of [
      'klippy.log.2024-01-15',
      'moonraker.log.2024-01-15_00-00-00',
      'moonraker.log.20240115',
    ]) {
      expect(classifyFileKind(name)).toBe('text')
    }
  })

  it('does not treat a non-date rotation suffix as a date', () => {
    expect(classifyFileKind('klippy.log.1')).toBe('unsupported')
  })
})

describe('isLargeFile', () => {
  it('applies the image threshold for image files', () => {
    expect(isLargeFile('image', LARGE_IMAGE_FILE_BYTES)).toBe(false)
    expect(isLargeFile('image', LARGE_IMAGE_FILE_BYTES + 1)).toBe(true)
  })

  it('applies the smaller text threshold for text and unsupported files', () => {
    expect(isLargeFile('text', LARGE_TEXT_FILE_BYTES + 1)).toBe(true)
    expect(isLargeFile('unsupported', LARGE_TEXT_FILE_BYTES + 1)).toBe(true)
    expect(isLargeFile('text', LARGE_TEXT_FILE_BYTES)).toBe(false)
  })

  it('applies the text threshold to HTML files too, since they are read into memory the same way', () => {
    expect(isLargeFile('html', LARGE_TEXT_FILE_BYTES + 1)).toBe(true)
    expect(isLargeFile('html', LARGE_TEXT_FILE_BYTES)).toBe(false)
  })
})
