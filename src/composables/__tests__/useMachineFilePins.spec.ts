import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PinnedMachineFile } from '@/composables/useMachineFilePins'

function pin(path: string, overrides: Partial<PinnedMachineFile> = {}): PinnedMachineFile {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return {
    kind: 'file',
    root: 'config',
    path,
    name,
    size: 10,
    modified: 1000,
    permissions: 'rw',
    ...overrides,
  }
}

describe('useMachineFilePins', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  it('starts with nothing pinned', async () => {
    const { useMachineFilePins } = await import('@/composables/useMachineFilePins')
    const { pinnedFiles, isPinned } = useMachineFilePins()

    expect(pinnedFiles.value).toEqual([])
    expect(isPinned('config', 'printer.cfg')).toBe(false)
  })

  it('pins and unpins a file', async () => {
    const { useMachineFilePins } = await import('@/composables/useMachineFilePins')
    const { pinnedFiles, isPinned, pinFile, unpinFile } = useMachineFilePins()

    pinFile(pin('printer.cfg'))
    expect(isPinned('config', 'printer.cfg')).toBe(true)
    expect(pinnedFiles.value).toHaveLength(1)

    unpinFile('config', 'printer.cfg')
    expect(isPinned('config', 'printer.cfg')).toBe(false)
    expect(pinnedFiles.value).toEqual([])
  })

  it('does not pin the same root and path twice', async () => {
    const { useMachineFilePins } = await import('@/composables/useMachineFilePins')
    const { pinnedFiles, pinFile } = useMachineFilePins()

    pinFile(pin('printer.cfg'))
    pinFile(pin('printer.cfg'))
    expect(pinnedFiles.value).toHaveLength(1)
  })

  it('keeps pins for different roots independent', async () => {
    const { useMachineFilePins } = await import('@/composables/useMachineFilePins')
    const { isPinned, pinFile, unpinFile } = useMachineFilePins()

    pinFile(pin('klippy.log', { root: 'logs' }))
    expect(isPinned('logs', 'klippy.log')).toBe(true)
    expect(isPinned('config', 'klippy.log')).toBe(false)

    unpinFile('config', 'klippy.log')
    expect(isPinned('logs', 'klippy.log')).toBe(true)
  })

  it('persists pins across a reload', async () => {
    const first = await import('@/composables/useMachineFilePins')
    first.useMachineFilePins().pinFile(pin('macros.cfg'))

    vi.resetModules()
    const second = await import('@/composables/useMachineFilePins')
    expect(second.useMachineFilePins().isPinned('config', 'macros.cfg')).toBe(true)
  })

  it('ignores malformed stored data', async () => {
    window.localStorage.setItem('alabaster.machine.pinnedFiles', '{"not":"an array"}')
    const { useMachineFilePins } = await import('@/composables/useMachineFilePins')
    expect(useMachineFilePins().pinnedFiles.value).toEqual([])
  })

  it('drops a pin when repointed to null, matching an exact path', async () => {
    const { useMachineFilePins } = await import('@/composables/useMachineFilePins')
    const { pinnedFiles, pinFile, repointPinned } = useMachineFilePins()

    pinFile(pin('macros/start.cfg'))
    repointPinned('config', 'macros/start.cfg', null)
    expect(pinnedFiles.value).toEqual([])
  })

  it('drops every pin nested under a deleted folder', async () => {
    const { useMachineFilePins } = await import('@/composables/useMachineFilePins')
    const { pinnedFiles, pinFile, repointPinned } = useMachineFilePins()

    pinFile(pin('macros/start.cfg'))
    pinFile(pin('printer.cfg'))
    repointPinned('config', 'macros', null)

    expect(pinnedFiles.value.map((entry) => entry.path)).toEqual(['printer.cfg'])
  })

  it('follows a renamed file to its new path and name', async () => {
    const { useMachineFilePins } = await import('@/composables/useMachineFilePins')
    const { pinnedFiles, pinFile, repointPinned } = useMachineFilePins()

    pinFile(pin('printer.cfg'))
    repointPinned('config', 'printer.cfg', 'printer-old.cfg')

    expect(pinnedFiles.value).toEqual([
      expect.objectContaining({ path: 'printer-old.cfg', name: 'printer-old.cfg' }),
    ])
  })

  it('follows every pin nested under a moved folder', async () => {
    const { useMachineFilePins } = await import('@/composables/useMachineFilePins')
    const { pinnedFiles, pinFile, repointPinned } = useMachineFilePins()

    pinFile(pin('macros/start.cfg'))
    repointPinned('config', 'macros', 'archive/macros')

    expect(pinnedFiles.value).toEqual([
      expect.objectContaining({ path: 'archive/macros/start.cfg', name: 'start.cfg' }),
    ])
  })

  it('leaves other roots and unrelated paths untouched when repointing', async () => {
    const { useMachineFilePins } = await import('@/composables/useMachineFilePins')
    const { pinnedFiles, pinFile, repointPinned } = useMachineFilePins()

    pinFile(pin('printer.cfg'))
    pinFile(pin('printer.cfg', { root: 'logs' }))
    repointPinned('config', 'printer.cfg', 'renamed.cfg')

    expect(pinnedFiles.value).toEqual([
      expect.objectContaining({ root: 'config', path: 'renamed.cfg' }),
      expect.objectContaining({ root: 'logs', path: 'printer.cfg' }),
    ])
  })
})
