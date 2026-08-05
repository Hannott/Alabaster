import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAvailabilityStore } from '@/stores/availability'
import { useMachineFilesStore } from '@/stores/machineFiles'
import { useMoonrakerStore } from '@/stores/moonraker'

function listing(root: 'config' | 'logs', filename: string) {
  return {
    dirs: [],
    files: [
      {
        filename,
        modified: 1,
        size: 10,
        // What Moonraker actually reports: the logs root is served read-only.
        permissions: root === 'config' ? 'rw' : 'r',
      },
    ],
    disk_usage: { total: 100, used: 40, free: 60 },
    root_info: { name: root, permissions: root === 'config' ? 'rw' : 'r' },
  } as never
}

describe('machine files roots', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.localStorage.clear()
    setActivePinia(createPinia())
    useAvailabilityStore().moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
  })

  it('browses the config root until told otherwise', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi
      .spyOn(moonraker, 'rpcCall')
      .mockResolvedValue(listing('config', 'printer.cfg'))
    const machineFiles = useMachineFilesStore()

    await machineFiles.refreshDirectory()

    expect(machineFiles.currentRoot).toBe('config')
    expect(machineFiles.isRootEditable).toBe(true)
    expect(rpcCall).toHaveBeenCalledWith('server.files.get_directory', { path: 'config' })
  })

  it('asks for the logs root once switched, and reports it read-only', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(listing('logs', 'klippy.log'))
    const machineFiles = useMachineFilesStore()

    await machineFiles.setRoot('logs')

    expect(machineFiles.currentRoot).toBe('logs')
    expect(machineFiles.isRootEditable).toBe(false)
    expect(rpcCall).toHaveBeenLastCalledWith('server.files.get_directory', { path: 'logs' })
    expect(machineFiles.entries.map((entry) => entry.name)).toEqual(['klippy.log'])
  })

  it('returns to the root of the tree when the root changes', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(listing('config', 'printer.cfg'))
    const machineFiles = useMachineFilesStore()
    await machineFiles.navigate('subfolder')
    expect(machineFiles.currentPath).toBe('subfolder')

    await machineFiles.setRoot('logs')

    // A path from one root means nothing in another.
    expect(machineFiles.currentPath).toBe('')
  })

  it('refuses every write while a read-only root is browsed', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(listing('logs', 'klippy.log'))
    const machineFiles = useMachineFilesStore()
    await machineFiles.setRoot('logs')
    rpcCall.mockClear()

    const entry = machineFiles.entries[0]!
    await expect(machineFiles.createFile('new.cfg')).resolves.toBe(false)
    await expect(machineFiles.createDirectory('folder')).resolves.toBe(false)
    await expect(machineFiles.deleteEntry(entry)).resolves.toBe(false)
    await expect(machineFiles.renameEntry(entry, 'other.log')).resolves.toBe(false)
    await expect(machineFiles.saveFile()).resolves.toBe(false)
    await expect(machineFiles.saveAllFiles()).resolves.toBe(false)
    await expect(machineFiles.moveEntryTo(entry, 'elsewhere')).resolves.toBeNull()

    // The refusal is the store's, not the button's: nothing reached Moonraker.
    expect(rpcCall).not.toHaveBeenCalled()
  })

  /**
   * The failure this guards is the reason logs never get a buffer entry. Buffers
   * are keyed by path, so a log and a config file sharing a filename would share
   * one buffer — and the consequence of that is a log's text being saved over a
   * config file.
   */
  it('never lets a file in a read-only root touch the edit buffers', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(listing('config', 'shared.cfg'))
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation((input) =>
          Promise.resolve(
            new Response(String(input).includes('/logs/') ? 'log text' : 'config text'),
          ),
        ),
    )
    const machineFiles = useMachineFilesStore()
    await machineFiles.refreshDirectory()

    await machineFiles.openFile(machineFiles.entries[0]!)
    machineFiles.editorContent = 'edited config'
    expect(machineFiles.isPathDirty('shared.cfg')).toBe(true)

    // The same filename, in the read-only root.
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(listing('logs', 'shared.cfg'))
    await machineFiles.setRoot('logs')
    await machineFiles.openFile(machineFiles.entries[0]!)

    expect(machineFiles.editorContent).toBe('log text')
    expect(machineFiles.isDirty).toBe(false)

    // Typing into a read-only file changes nothing at all.
    machineFiles.editorContent = 'typed into a log'
    expect(machineFiles.editorContent).toBe('log text')

    // And the config edit is still there, untouched, waiting to be saved.
    expect(machineFiles.isPathDirty('shared.cfg')).toBe(true)
    expect(machineFiles.unsavedFilePaths).toEqual(['shared.cfg'])
  })

  it('keeps unsaved config edits across a trip to the logs and back', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(listing('config', 'printer.cfg'))
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response('saved text'))),
    )
    const machineFiles = useMachineFilesStore()
    await machineFiles.refreshDirectory()
    await machineFiles.openFile(machineFiles.entries[0]!)
    machineFiles.editorContent = 'unsaved edit'

    await machineFiles.setRoot('logs')
    await machineFiles.setRoot('config')

    expect(machineFiles.hasUnsavedFiles).toBe(true)
    expect(machineFiles.isPathDirty('printer.cfg')).toBe(true)
  })

  it('drops the search index when the root changes rather than answering from the other one', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation((async (method: string) => {
      if (method === 'server.files.list') return [{ path: 'printer.cfg', modified: 1, size: 1 }]
      return listing('config', 'printer.cfg')
    }) as never)
    const machineFiles = useMachineFilesStore()

    await machineFiles.ensureSearchFiles()
    expect(machineFiles.searchFilesLoaded).toBe(true)
    expect(machineFiles.searchFiles).toHaveLength(1)

    await machineFiles.setRoot('logs')

    expect(machineFiles.searchFilesLoaded).toBe(false)
    expect(machineFiles.searchFiles).toEqual([])

    await machineFiles.ensureSearchFiles()
    expect(rpcCall).toHaveBeenCalledWith('server.files.list', { root: 'logs' })
  })

  it('does nothing when asked for the root already shown', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi
      .spyOn(moonraker, 'rpcCall')
      .mockResolvedValue(listing('config', 'printer.cfg'))
    const machineFiles = useMachineFilesStore()
    await machineFiles.navigate('subfolder')
    rpcCall.mockClear()

    await expect(machineFiles.setRoot('config')).resolves.toBe(true)

    expect(machineFiles.currentPath).toBe('subfolder')
    expect(rpcCall).not.toHaveBeenCalled()
  })
})
