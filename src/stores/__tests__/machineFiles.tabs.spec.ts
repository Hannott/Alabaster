import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAvailabilityStore } from '@/stores/availability'
import { useMachineFilesStore, type MachineFileEntry } from '@/stores/machineFiles'
import { useMoonrakerStore } from '@/stores/moonraker'

function file(name: string, path = name): MachineFileEntry & { kind: 'file'; path: string } {
  return { kind: 'file', name, path, modified: 1, size: 10, permissions: 'rw' }
}

function listing(dirs: string[], files: string[]) {
  return {
    dirs: dirs.map((dirname) => ({ dirname, modified: 1, size: 0, permissions: 'rw' })),
    files: files.map((filename) => ({ filename, modified: 1, size: 10, permissions: 'rw' })),
    disk_usage: { total: 1000, used: 400, free: 600 },
    root_info: { name: 'config', permissions: 'rw' },
  }
}

/** Every file's content is its own path, read fresh on each fetch. */
function stubFileContents(contents = new Map<string, string>()) {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
    const url = decodeURIComponent(String(input)).split('?')[0]!
    const path = url.slice(url.indexOf('/server/files/') + '/server/files/'.length)
    const relative = path.slice(path.indexOf('/') + 1)
    return Promise.resolve(new Response(contents.get(relative) ?? `# ${relative}\n`))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function setup(rpc?: (method: string, params?: Record<string, unknown>) => unknown) {
  useAvailabilityStore().moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
  const moonraker = useMoonrakerStore()
  const rpcCall = vi
    .spyOn(moonraker, 'rpcCall')
    .mockImplementation(((method: string, params?: Record<string, unknown>) =>
      Promise.resolve(rpc ? rpc(method, params) : listing([], []))) as never)
  return { machineFiles: useMachineFilesStore(), rpcCall }
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  setActivePinia(createPinia())
})

describe('machine file tabs', () => {
  it('gives every opened file a tab, in the order they were opened', async () => {
    stubFileContents()
    const { machineFiles } = setup()

    await machineFiles.openFileByPath(file('printer.cfg'))
    await machineFiles.openFileByPath(file('macros.cfg'))

    expect(machineFiles.openTabs.map((tab) => tab.file.path)).toEqual(['printer.cfg', 'macros.cfg'])
    expect(machineFiles.openTabs.every((tab) => !tab.preview)).toBe(true)
    expect(machineFiles.currentFile?.path).toBe('macros.cfg')
  })

  /*
   * The point of a preview tab: glancing at five files in the tree leaves one
   * tab behind, not five.
   */
  it('reuses the preview tab in place for each preview open', async () => {
    stubFileContents()
    const { machineFiles } = setup()

    await machineFiles.openFileByPath(file('printer.cfg'))
    await machineFiles.openFileByPath(file('a.cfg'), { preview: true })
    await machineFiles.openFileByPath(file('b.cfg'), { preview: true })

    expect(machineFiles.openTabs).toEqual([
      expect.objectContaining({
        preview: false,
        file: expect.objectContaining({ path: 'printer.cfg' }),
      }),
      expect.objectContaining({ preview: true, file: expect.objectContaining({ path: 'b.cfg' }) }),
    ])
  })

  it('keeps a preview tab once it is kept, or once it is edited', async () => {
    stubFileContents()
    const { machineFiles } = setup()

    await machineFiles.openFileByPath(file('a.cfg'), { preview: true })
    machineFiles.keepTab('a.cfg')
    expect(machineFiles.openTabs[0]!.preview).toBe(false)

    await machineFiles.openFileByPath(file('b.cfg'), { preview: true })
    machineFiles.editorContent = '# edited\n'
    await nextTick()
    expect(machineFiles.openTabs.find((tab) => tab.file.path === 'b.cfg')?.preview).toBe(false)

    await machineFiles.openFileByPath(file('c.cfg'), { preview: true })
    expect(machineFiles.openTabs.map((tab) => tab.file.path)).toEqual(['a.cfg', 'b.cfg', 'c.cfg'])
  })

  it('never demotes a kept tab to a preview', async () => {
    stubFileContents()
    const { machineFiles } = setup()

    await machineFiles.openFileByPath(file('a.cfg'))
    await machineFiles.openFileByPath(file('b.cfg'))
    await machineFiles.openFileByPath(file('a.cfg'), { preview: true })

    expect(machineFiles.openTabs.map((tab) => [tab.file.path, tab.preview])).toEqual([
      ['a.cfg', false],
      ['b.cfg', false],
    ])
  })

  it('puts an unpinned file first among the tabs, opened or not', async () => {
    stubFileContents()
    const { machineFiles } = setup()
    await machineFiles.openFileByPath(file('a.cfg'))
    await machineFiles.openFileByPath(file('b.cfg'), { preview: true })

    machineFiles.placeTabFirst(file('b.cfg'))
    machineFiles.placeTabFirst(file('never-opened.cfg'))

    expect(machineFiles.openTabs.map((tab) => [tab.file.path, tab.preview])).toEqual([
      ['never-opened.cfg', false],
      ['b.cfg', false],
      ['a.cfg', false],
    ])
    expect(machineFiles.currentFile?.path).toBe('b.cfg')
  })

  it('keeps an unsaved edit when its tab is closed', async () => {
    stubFileContents()
    const { machineFiles } = setup()

    await machineFiles.openFileByPath(file('a.cfg'))
    machineFiles.editorContent = '# edited\n'
    await machineFiles.closeTab('a.cfg')

    expect(machineFiles.openTabs).toHaveLength(0)
    expect(machineFiles.currentFile).toBeNull()
    expect(machineFiles.isPathDirty('a.cfg')).toBe(true)

    await machineFiles.openFileByPath(file('a.cfg'))
    expect(machineFiles.editorContent).toBe('# edited\n')
  })

  it('hands the viewer to the right-hand neighbour, or the left at the end', async () => {
    stubFileContents()
    const { machineFiles } = setup()
    for (const name of ['a.cfg', 'b.cfg', 'c.cfg']) await machineFiles.openFileByPath(file(name))

    await machineFiles.activateTab('b.cfg')
    await machineFiles.closeTab('b.cfg')
    expect(machineFiles.currentFile?.path).toBe('c.cfg')

    await machineFiles.closeTab('c.cfg')
    expect(machineFiles.currentFile?.path).toBe('a.cfg')
  })

  it('leaves the file on screen alone when another tab closes', async () => {
    stubFileContents()
    const { machineFiles } = setup()
    for (const name of ['a.cfg', 'b.cfg', 'c.cfg']) await machineFiles.openFileByPath(file(name))

    await machineFiles.closeTabs(['a.cfg', 'b.cfg'])

    expect(machineFiles.currentFile?.path).toBe('c.cfg')
    expect(machineFiles.openTabs.map((tab) => tab.file.path)).toEqual(['c.cfg'])
  })

  /*
   * Switching tabs must not dim the editor for a fetch every time. The buffer
   * already holds what disk had, so it is shown at once and refreshed behind.
   */
  it('shows a clean buffer at once when its tab is activated, and refreshes it behind', async () => {
    const contents = new Map([['a.cfg', 'first\n']])
    const fetchMock = stubFileContents(contents)
    const { machineFiles } = setup()
    await machineFiles.openFileByPath(file('a.cfg'))
    await machineFiles.openFileByPath(file('b.cfg'))
    contents.set('a.cfg', 'changed on disk\n')

    const activation = machineFiles.activateTab('a.cfg')
    expect(machineFiles.currentFile?.path).toBe('a.cfg')
    expect(machineFiles.isEditorLoading).toBe(false)
    expect(machineFiles.editorContent).toBe('first\n')
    await activation
    await flushPromises()

    expect(machineFiles.editorContent).toBe('changed on disk\n')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not overwrite an edit typed while the refresh was on its way', async () => {
    const contents = new Map([['a.cfg', 'first\n']])
    stubFileContents(contents)
    const { machineFiles } = setup()
    await machineFiles.openFileByPath(file('a.cfg'))
    await machineFiles.openFileByPath(file('b.cfg'))
    contents.set('a.cfg', 'changed on disk\n')

    const activation = machineFiles.activateTab('a.cfg')
    machineFiles.editorContent = 'typed\n'
    await activation
    await flushPromises()

    expect(machineFiles.editorContent).toBe('typed\n')
  })

  it('moves the tabs, and the file on screen, with a renamed folder', async () => {
    stubFileContents()
    const { machineFiles } = setup()
    await machineFiles.openFileByPath(file('bed.cfg', 'hardware/bed.cfg'))
    await machineFiles.openFileByPath(file('printer.cfg'))
    await machineFiles.activateTab('hardware/bed.cfg')

    await machineFiles.renameEntry(
      {
        kind: 'directory',
        name: 'hardware',
        path: 'hardware',
        modified: 1,
        size: 0,
        permissions: 'rw',
      },
      'parts',
    )

    expect(machineFiles.openTabs.map((tab) => tab.file.path)).toEqual([
      'parts/bed.cfg',
      'printer.cfg',
    ])
    expect(machineFiles.currentFile?.path).toBe('parts/bed.cfg')
  })

  it('closes every tab under a deleted folder', async () => {
    stubFileContents()
    const { machineFiles } = setup()
    await machineFiles.openFileByPath(file('bed.cfg', 'hardware/bed.cfg'))
    await machineFiles.openFileByPath(file('printer.cfg'))

    await machineFiles.deleteEntry({
      kind: 'directory',
      name: 'hardware',
      path: 'hardware',
      modified: 1,
      size: 0,
      permissions: 'rw',
    })

    expect(machineFiles.openTabs.map((tab) => tab.file.path)).toEqual(['printer.cfg'])
  })

  it('keeps each root’s tabs apart, and brings them back with the root', async () => {
    stubFileContents()
    const { machineFiles } = setup()
    await machineFiles.openFileByPath(file('printer.cfg'))

    await machineFiles.setRoot('logs')
    expect(machineFiles.openTabs).toHaveLength(0)
    await machineFiles.openFileByPath({ ...file('klippy.log'), permissions: 'r' })

    await machineFiles.setRoot('config')
    expect(machineFiles.openTabs.map((tab) => tab.file.path)).toEqual(['printer.cfg'])
    expect(machineFiles.currentFile?.path).toBe('printer.cfg')
  })
})

describe('machine file tree', () => {
  it('holds a listing for each expanded folder', async () => {
    const { machineFiles } = setup((method, params) =>
      params?.path === 'config/macros'
        ? listing([], ['homing.cfg'])
        : listing(['macros'], ['printer.cfg']),
    )
    await machineFiles.refreshDirectory()
    await machineFiles.expandDirectory('macros')

    expect(machineFiles.expandedDirectories.has('macros')).toBe(true)
    expect(machineFiles.directoryListings.get('macros')?.map((entry) => entry.name)).toEqual([
      'homing.cfg',
    ])
    expect(machineFiles.directoryListings.get('')?.map((entry) => entry.name)).toEqual([
      'macros',
      'printer.cfg',
    ])
  })

  /*
   * The hard rule on remote data: a notification says something changed, and
   * every listing on screen has to follow it, not just the browsed folder's.
   */
  it('refreshes every expanded folder with the browsed one', async () => {
    let macros = ['homing.cfg']
    const { machineFiles, rpcCall } = setup((method, params) =>
      params?.path === 'config/macros' ? listing([], macros) : listing(['macros'], []),
    )
    await machineFiles.refreshDirectory()
    await machineFiles.expandDirectory('macros')
    macros = ['homing.cfg', 'purge.cfg']
    rpcCall.mockClear()

    await machineFiles.refreshDirectory()
    await flushPromises()

    expect(rpcCall).toHaveBeenCalledWith('server.files.get_directory', { path: 'config/macros' })
    expect(machineFiles.directoryListings.get('macros')?.map((entry) => entry.name)).toEqual([
      'homing.cfg',
      'purge.cfg',
    ])
  })

  it('stops expanding a folder that no longer answers', async () => {
    let gone = false
    const { machineFiles } = setup((method, params) => {
      if (params?.path === 'config/macros' && gone) throw new Error('missing')
      return params?.path === 'config/macros' ? listing([], []) : listing(['macros'], [])
    })
    await machineFiles.expandDirectory('macros')
    gone = true

    await machineFiles.refreshDirectory()
    await flushPromises()

    expect(machineFiles.expandedDirectories.has('macros')).toBe(false)
  })

  it('opens every folder above a path to reveal it', async () => {
    const { machineFiles } = setup(() => listing([], []))

    await machineFiles.revealPath('a/b/c.cfg')

    expect([...machineFiles.expandedDirectories].sort()).toEqual(['a', 'a/b'])
  })

  it('makes a folder the target for new files without refetching a listing it holds', async () => {
    const { machineFiles, rpcCall } = setup((method, params) =>
      params?.path === 'config/macros' ? listing([], ['homing.cfg']) : listing(['macros'], []),
    )
    await machineFiles.expandDirectory('macros')
    rpcCall.mockClear()

    await machineFiles.selectDirectory('macros')

    expect(rpcCall).not.toHaveBeenCalled()
    expect(machineFiles.currentPath).toBe('macros')
    expect(machineFiles.entries.map((entry) => entry.name)).toEqual(['homing.cfg'])
  })

  it('renames, moves, and deletes an entry at its own path, not the browsed folder’s', async () => {
    const { machineFiles, rpcCall } = setup(() => listing([], []))
    machineFiles.currentPath = 'elsewhere'

    await machineFiles.renameEntry(file('homing.cfg', 'macros/homing.cfg'), 'home.cfg')

    expect(rpcCall).toHaveBeenCalledWith('server.files.move', {
      source: 'config/macros/homing.cfg',
      dest: 'config/macros/home.cfg',
    })
  })
})
