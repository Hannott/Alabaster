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

  /*
   * Pins were lost more than once to a change in the shape of the file entry
   * they were copied from: a guard that demanded every field dropped every
   * stored pin, and the empty list was then saved over the real one. A pin is
   * a root and a path, so nothing else is allowed to decide whether it loads.
   */
  describe('what a stored pin needs to load', () => {
    it('keeps a pin that carries only its root and path', async () => {
      window.localStorage.setItem(
        'alabaster.machine.pinnedFiles',
        JSON.stringify([{ root: 'config', path: 'macros/start.cfg' }]),
      )
      const { useMachineFilePins } = await import('@/composables/useMachineFilePins')

      expect(useMachineFilePins().pinnedFiles.value).toEqual([
        {
          kind: 'file',
          root: 'config',
          path: 'macros/start.cfg',
          name: 'start.cfg',
          size: 0,
          modified: 0,
          permissions: 'rw',
        },
      ])
    })

    it('keeps a pin whose listing fields are not what they once were', async () => {
      window.localStorage.setItem(
        'alabaster.machine.pinnedFiles',
        JSON.stringify([
          {
            kind: 'something-else',
            root: 'logs',
            path: 'klippy.log',
            name: 'klippy.log',
            size: '10',
            modified: '2026-01-01',
            permissions: null,
            addedByAFutureVersion: true,
          },
        ]),
      )
      const { useMachineFilePins } = await import('@/composables/useMachineFilePins')

      expect(useMachineFilePins().pinnedFiles.value).toEqual([
        expect.objectContaining({ root: 'logs', path: 'klippy.log', name: 'klippy.log' }),
      ])
    })

    it('still refuses an entry that cannot name a file, and a repeat of one that can', async () => {
      window.localStorage.setItem(
        'alabaster.machine.pinnedFiles',
        JSON.stringify([
          { root: 'nowhere', path: 'printer.cfg' },
          { root: 'config', path: '' },
          { root: 'config' },
          null,
          { root: 'config', path: 'printer.cfg' },
          { root: 'config', path: 'printer.cfg' },
        ]),
      )
      const { useMachineFilePins } = await import('@/composables/useMachineFilePins')

      expect(useMachineFilePins().pinnedFiles.value.map((entry) => entry.path)).toEqual([
        'printer.cfg',
      ])
    })

    it('does not rewrite what it loaded', async () => {
      const stored = JSON.stringify([{ root: 'config', path: 'printer.cfg' }])
      window.localStorage.setItem('alabaster.machine.pinnedFiles', stored)
      const { useMachineFilePins } = await import('@/composables/useMachineFilePins')

      useMachineFilePins()

      expect(window.localStorage.getItem('alabaster.machine.pinnedFiles')).toBe(stored)
    })
  })

  describe('a settings bundle replacing the pins', () => {
    it('takes a list that is genuinely empty', async () => {
      const { useMachineFilePins } = await import('@/composables/useMachineFilePins')
      const { pinnedFiles, pinFile, replacePinned } = useMachineFilePins()

      pinFile(pin('printer.cfg'))
      replacePinned([])

      expect(pinnedFiles.value).toEqual([])
    })

    it('ignores a list that held entries but none that were readable', async () => {
      const { useMachineFilePins } = await import('@/composables/useMachineFilePins')
      const { pinnedFiles, pinFile, replacePinned } = useMachineFilePins()

      pinFile(pin('printer.cfg'))
      replacePinned([{ nothing: 'usable' }, 42])

      expect(pinnedFiles.value.map((entry) => entry.path)).toEqual(['printer.cfg'])
    })
  })

  describe('reordering', () => {
    async function pinned(...paths: string[]) {
      const { useMachineFilePins } = await import('@/composables/useMachineFilePins')
      const pins = useMachineFilePins()
      for (const path of paths) pins.pinFile(pin(path))
      return pins
    }

    const order = (pins: Awaited<ReturnType<typeof pinned>>) =>
      pins.pinnedFiles.value.map((entry) => entry.path)

    it('moves a pin before or after another', async () => {
      const pins = await pinned('a.cfg', 'b.cfg', 'c.cfg')

      pins.reorderPinned('config', 'c.cfg', 'a.cfg', 'before')
      expect(order(pins)).toEqual(['c.cfg', 'a.cfg', 'b.cfg'])

      pins.reorderPinned('config', 'c.cfg', 'b.cfg', 'after')
      expect(order(pins)).toEqual(['a.cfg', 'b.cfg', 'c.cfg'])
    })

    it('keeps the order across a reload', async () => {
      const pins = await pinned('a.cfg', 'b.cfg', 'c.cfg')
      pins.reorderPinned('config', 'c.cfg', 'a.cfg', 'before')

      vi.resetModules()
      const { useMachineFilePins } = await import('@/composables/useMachineFilePins')

      expect(useMachineFilePins().pinnedFiles.value.map((entry) => entry.path)).toEqual([
        'c.cfg',
        'a.cfg',
        'b.cfg',
      ])
    })

    it('leaves the other root where it is', async () => {
      const pins = await pinned('a.cfg', 'b.cfg')
      pins.pinFile(pin('klippy.log', { root: 'logs' }))

      pins.reorderPinned('config', 'b.cfg', 'a.cfg', 'before')

      expect(pins.pinnedFiles.value.map((entry) => `${entry.root}:${entry.path}`)).toEqual([
        'config:b.cfg',
        'config:a.cfg',
        'logs:klippy.log',
      ])
    })

    it('writes nothing when the pin would stay where it is', async () => {
      const pins = await pinned('a.cfg', 'b.cfg')
      const setItem = vi.spyOn(Storage.prototype, 'setItem')

      pins.reorderPinned('config', 'a.cfg', 'b.cfg', 'before')
      pins.reorderPinned('config', 'a.cfg', 'a.cfg', 'after')
      pins.reorderPinned('config', 'a.cfg', 'missing.cfg', 'after')

      expect(setItem).not.toHaveBeenCalled()
    })
  })
})
