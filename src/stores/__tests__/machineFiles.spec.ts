import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAvailabilityStore } from '@/stores/availability'
import { useMachineFilesStore } from '@/stores/machineFiles'
import { useMoonrakerStore } from '@/stores/moonraker'

describe('machine files store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('sorts directories before files and retains data when a refresh fails', async () => {
    const availability = useAvailabilityStore()
    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValueOnce({
      dirs: [
        { dirname: 'zeta', modified: 1, size: 0, permissions: 'rw' },
        { dirname: 'Alpha', modified: 1, size: 0, permissions: 'r' },
      ],
      files: [
        { filename: 'printer.cfg', modified: 2, size: 100, permissions: 'rw' },
        { filename: 'moonraker.conf', modified: 3, size: 80, permissions: 'rw' },
      ],
      disk_usage: { total: 1000, used: 400, free: 600 },
      root_info: { name: 'config', permissions: 'rw' },
    } as never)
    const machineFiles = useMachineFilesStore()

    await expect(machineFiles.refreshDirectory()).resolves.toBe(true)
    expect(machineFiles.entries.map((entry) => entry.name)).toEqual([
      'Alpha',
      'zeta',
      'moonraker.conf',
      'printer.cfg',
    ])
    expect(machineFiles.diskUsage.free).toBe(600)

    rpcCall.mockRejectedValueOnce(new Error('restarting'))
    await expect(machineFiles.refreshDirectory()).resolves.toBe(false)
    expect(machineFiles.entries).toHaveLength(4)
    expect(machineFiles.lastError).toBe('directory')
  })

  it('rejects invalid mutation names without sending a command', async () => {
    const availability = useAvailabilityStore()
    availability.moonrakerConnected({ klippy_connected: false, klippy_state: 'disconnected' })
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall')
    const machineFiles = useMachineFilesStore()

    await expect(machineFiles.createDirectory('../outside')).resolves.toBe(false)
    expect(rpcCall).not.toHaveBeenCalled()
  })

  it('creates a directory at an arbitrary path, for a hotlink to a missing folder', async () => {
    const availability = useAvailabilityStore()
    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({
      dirs: [],
      files: [],
      disk_usage: { total: 1000, used: 400, free: 600 },
      root_info: { name: 'config', permissions: 'rw' },
    } as never)
    const machineFiles = useMachineFilesStore()

    await expect(machineFiles.createDirectoryAt('hardware/extra')).resolves.toBe(true)
    expect(rpcCall).toHaveBeenCalledWith('server.files.post_directory', {
      path: 'config/hardware/extra',
    })
  })

  it('refuses to create a directory that would escape the config root', async () => {
    const availability = useAvailabilityStore()
    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall')
    const machineFiles = useMachineFilesStore()

    await expect(machineFiles.createDirectoryAt('../outside')).resolves.toBe(false)
    expect(rpcCall).not.toHaveBeenCalled()
    expect(machineFiles.lastError).toBe('mutation')
  })

  it('creates an empty file at an arbitrary path, for a hotlink to a missing include target', async () => {
    const availability = useAvailabilityStore()
    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({
      dirs: [],
      files: [],
      disk_usage: { total: 1000, used: 400, free: 600 },
      root_info: { name: 'config', permissions: 'rw' },
    } as never)
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ item: { path: 'hardware/steppers.cfg', root: 'config' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const machineFiles = useMachineFilesStore()

    await expect(machineFiles.createFileAt('hardware/steppers.cfg')).resolves.toBe(true)
    const uploadCall = fetchMock.mock.calls[0]
    const body = uploadCall?.[1]?.body as FormData
    expect(body.get('path')).toBe('hardware')
    expect((body.get('file') as File).name).toBe('steppers.cfg')
  })

  it('refuses to create a file that would escape the config root', async () => {
    const availability = useAvailabilityStore()
    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    const machineFiles = useMachineFilesStore()

    await expect(machineFiles.createFileAt('../outside.cfg')).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(machineFiles.lastError).toBe('mutation')
  })

  it('uploads to an explicit directory instead of the one currently displayed', async () => {
    const availability = useAvailabilityStore()
    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({
      dirs: [],
      files: [],
      disk_usage: { total: 1000, used: 400, free: 600 },
      root_info: { name: 'config', permissions: 'rw' },
    } as never)
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ item: { path: 'hardware/bed.cfg', root: 'config' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const machineFiles = useMachineFilesStore()
    const file = new File(['[bed_mesh]'], 'bed.cfg', { type: 'text/plain' })

    // currentPath is still '' here — dropping onto a subfolder must not upload
    // to the folder currently on screen.
    await expect(machineFiles.uploadFiles([file], 'hardware')).resolves.toBe(true)

    const uploadCall = fetchMock.mock.calls[0]
    const body = uploadCall?.[1]?.body as FormData
    expect(body.get('path')).toBe('hardware')
  })

  it('keeps showing the previous folder while navigating, then switches in one step', async () => {
    const availability = useAvailabilityStore()
    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const moonraker = useMoonrakerStore()
    let resolveNextDirectory: ((value: unknown) => void) | undefined
    const rpcCall = vi
      .spyOn(moonraker, 'rpcCall')
      .mockResolvedValueOnce({
        dirs: [],
        files: [{ filename: 'printer.cfg', modified: 1, size: 10, permissions: 'rw' }],
        disk_usage: { total: 1000, used: 400, free: 600 },
        root_info: { name: 'config', permissions: 'rw' },
      } as never)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNextDirectory = resolve
          }) as never,
      )
    const machineFiles = useMachineFilesStore()

    await machineFiles.refreshDirectory()
    expect(machineFiles.entries).toHaveLength(1)

    const navigation = machineFiles.navigate('hardware')
    // Nothing about the view has switched yet: no frame should ever show the
    // new path paired with the old (or an empty) file list.
    expect(machineFiles.currentPath).toBe('')
    expect(machineFiles.entries.map((entry) => entry.name)).toEqual(['printer.cfg'])
    expect(machineFiles.isDirectoryLoading).toBe(true)

    resolveNextDirectory?.({
      dirs: [],
      files: [{ filename: 'bed.cfg', modified: 2, size: 20, permissions: 'rw' }],
      disk_usage: { total: 1000, used: 400, free: 600 },
      root_info: { name: 'hardware', permissions: 'rw' },
    })
    await navigation

    expect(machineFiles.currentPath).toBe('hardware')
    expect(machineFiles.entries.map((entry) => entry.name)).toEqual(['bed.cfg'])
    expect(rpcCall).toHaveBeenCalledTimes(2)
  })

  it('preserves an unsaved open document while navigating folders', async () => {
    const availability = useAvailabilityStore()
    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({
      dirs: [],
      files: [{ filename: 'bed.cfg', modified: 2, size: 20, permissions: 'rw' }],
      disk_usage: { total: 1000, used: 400, free: 600 },
      root_info: { name: 'hardware', permissions: 'rw' },
    } as never)
    const machineFiles = useMachineFilesStore()
    machineFiles.currentFile = {
      ...entry('printer.cfg'),
      kind: 'file',
      path: 'printer.cfg',
    }
    machineFiles.savedContent = '[printer]\n'
    machineFiles.editorContent = '[printer]\n# unsaved\n'

    await expect(machineFiles.navigate('hardware')).resolves.toBe(true)

    expect(machineFiles.currentPath).toBe('hardware')
    expect(machineFiles.currentFile?.path).toBe('printer.cfg')
    expect(machineFiles.isDirty).toBe(true)
  })

  it('leaves the current folder untouched when navigation fails', async () => {
    const availability = useAvailabilityStore()
    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall')
      .mockResolvedValueOnce({
        dirs: [],
        files: [{ filename: 'printer.cfg', modified: 1, size: 10, permissions: 'rw' }],
        disk_usage: { total: 1000, used: 400, free: 600 },
        root_info: { name: 'config', permissions: 'rw' },
      } as never)
      .mockRejectedValueOnce(new Error('boom'))
    const machineFiles = useMachineFilesStore()

    await machineFiles.refreshDirectory()
    await expect(machineFiles.navigate('hardware')).resolves.toBe(false)

    expect(machineFiles.currentPath).toBe('')
    expect(machineFiles.entries.map((entry) => entry.name)).toEqual(['printer.cfg'])
    expect(machineFiles.lastError).toBe('directory')
  })

  it('keeps the three newest edited files across visited folders', async () => {
    const availability = useAvailabilityStore()
    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall')
      .mockResolvedValueOnce({
        dirs: [{ dirname: 'hardware', modified: 1, size: 0, permissions: 'rw' }],
        files: [
          { filename: 'older.cfg', modified: 10, size: 10, permissions: 'rw' },
          { filename: 'moonraker.conf', modified: 20, size: 20, permissions: 'rw' },
          { filename: 'macros.cfg', modified: 30, size: 30, permissions: 'rw' },
          { filename: 'printer.cfg', modified: 40, size: 40, permissions: 'rw' },
        ],
        disk_usage: { total: 1000, used: 400, free: 600 },
        root_info: { name: 'config', permissions: 'rw' },
      } as never)
      .mockResolvedValueOnce({
        dirs: [],
        files: [{ filename: 'bed.cfg', modified: 50, size: 50, permissions: 'rw' }],
        disk_usage: { total: 1000, used: 400, free: 600 },
        root_info: { name: 'hardware', permissions: 'rw' },
      } as never)
    const machineFiles = useMachineFilesStore()

    await machineFiles.refreshDirectory()
    expect(machineFiles.recentFiles.map((file) => file.path)).toEqual([
      'printer.cfg',
      'macros.cfg',
      'moonraker.conf',
    ])

    await machineFiles.navigate('hardware')
    expect(machineFiles.recentFiles.map((file) => file.path)).toEqual([
      'hardware/bed.cfg',
      'printer.cfg',
      'macros.cfg',
    ])
  })

  it('navigates to and opens a recent file from another folder', async () => {
    const availability = useAvailabilityStore()
    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValueOnce({
      dirs: [],
      files: [{ filename: 'bed.cfg', modified: 50, size: 50, permissions: 'rw' }],
      disk_usage: { total: 1000, used: 400, free: 600 },
      root_info: { name: 'hardware', permissions: 'rw' },
    } as never)
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('[bed_mesh]\n', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      ),
    )
    const machineFiles = useMachineFilesStore()

    await expect(
      machineFiles.openRecentFile({
        kind: 'file',
        name: 'bed.cfg',
        path: 'hardware/bed.cfg',
        modified: 50,
        size: 50,
        permissions: 'rw',
      }),
    ).resolves.toBe(true)
    expect(machineFiles.currentPath).toBe('hardware')
    expect(machineFiles.currentFile?.path).toBe('hardware/bed.cfg')
    expect(machineFiles.editorContent).toBe('[bed_mesh]\n')
  })

  it('opens image files without fetching their contents as text', async () => {
    const availability = useAvailabilityStore()
    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    const machineFiles = useMachineFilesStore()

    await expect(
      machineFiles.openFile({
        kind: 'file',
        name: 'bed-mesh.png',
        modified: 1,
        size: 2048,
        permissions: 'rw',
      }),
    ).resolves.toBe(true)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(machineFiles.currentFileKind).toBe('image')
    expect(machineFiles.currentImageUrl).toContain('bed-mesh.png')
    expect(machineFiles.editorContent).toBe('')
    expect(machineFiles.isDirty).toBe(false)
  })

  it('opens HTML files by fetching their contents rather than pointing an iframe at the download URL', async () => {
    // A direct `src` navigation to Moonraker's file-download endpoint would be
    // treated as a download (it answers with `Content-Disposition:
    // attachment`) and never render, so this file must go through `fetch`
    // like a text file — unlike an image, which an <img> tag can safely point
    // at that same URL because loading an image is not a navigation.
    const availability = useAvailabilityStore()
    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<html><head></head><body>Report</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const machineFiles = useMachineFilesStore()

    await expect(
      machineFiles.openFile({
        kind: 'file',
        name: 'report.html',
        modified: 1,
        size: 2048,
        permissions: 'rw',
      }),
    ).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalled()
    expect(machineFiles.currentFileKind).toBe('html')
    expect(machineFiles.currentImageUrl).toBeNull()
    expect(machineFiles.currentHtmlDocument).toContain('<body>Report</body>')
    expect(machineFiles.currentHtmlDocument).toContain('<base href=')
    expect(machineFiles.editorContent).toBe('')
    expect(machineFiles.isDirty).toBe(false)
  })

  it('refuses to save an image file', async () => {
    const availability = useAvailabilityStore()
    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    vi.stubGlobal('fetch', vi.fn<typeof fetch>())
    const machineFiles = useMachineFilesStore()
    await machineFiles.openFile({
      kind: 'file',
      name: 'bed-mesh.png',
      modified: 1,
      size: 2048,
      permissions: 'rw',
    })

    await expect(machineFiles.saveFile()).resolves.toBe(false)
  })
  function connect() {
    const availability = useAvailabilityStore()
    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation(async (method: string) => {
      if (method === 'server.files.get_directory') {
        return {
          dirs: [],
          files: [],
          disk_usage: { total: 1, used: 0, free: 1 },
          root_info: { name: 'config', permissions: 'rw' },
        } as never
      }
      return {} as never
    })
    return { rpcCall, machineFiles: useMachineFilesStore() }
  }

  const entry = (name: string, kind: 'file' | 'directory' = 'file') => ({
    kind,
    name,
    modified: 1,
    size: 10,
    permissions: 'rw',
  })

  it('moves an entry into a subdirectory of the shown folder', async () => {
    const { rpcCall, machineFiles } = connect()
    machineFiles.currentPath = 'sub'

    await expect(machineFiles.moveEntryTo(entry('macros.cfg'), 'sub/nested')).resolves.toEqual({
      previousPath: 'sub/macros.cfg',
      nextPath: 'sub/nested/macros.cfg',
    })
    expect(rpcCall).toHaveBeenCalledWith('server.files.move', {
      source: 'config/sub/macros.cfg',
      dest: 'config/sub/nested/macros.cfg',
    })
    expect(machineFiles.notice).toBe('moved')
  })

  it('moves an entry up to the config root', async () => {
    const { rpcCall, machineFiles } = connect()
    machineFiles.currentPath = 'a/b'

    await expect(machineFiles.moveEntryTo(entry('up.cfg'), 'a')).resolves.toEqual({
      previousPath: 'a/b/up.cfg',
      nextPath: 'a/up.cfg',
    })
    expect(rpcCall).toHaveBeenCalledWith('server.files.move', {
      source: 'config/a/b/up.cfg',
      dest: 'config/a/up.cfg',
    })
  })

  it('refuses a move that would not change anything', async () => {
    const { rpcCall, machineFiles } = connect()
    machineFiles.currentPath = 'sub'

    await expect(machineFiles.moveEntryTo(entry('same.cfg'), 'sub')).resolves.toBeNull()
    expect(rpcCall).not.toHaveBeenCalledWith('server.files.move', expect.anything())
  })

  it('refuses to move a directory into its own subtree', async () => {
    const { rpcCall, machineFiles } = connect()
    machineFiles.currentPath = ''

    await expect(
      machineFiles.moveEntryTo(entry('macros', 'directory'), 'macros/nested'),
    ).resolves.toBeNull()
    expect(rpcCall).not.toHaveBeenCalledWith('server.files.move', expect.anything())
  })

  it('deletes a directory recursively and a file directly', async () => {
    const { rpcCall, machineFiles } = connect()
    machineFiles.currentPath = 'sub'

    await expect(machineFiles.deleteEntry(entry('macros', 'directory'))).resolves.toBe(true)
    expect(rpcCall).toHaveBeenCalledWith('server.files.delete_directory', {
      path: 'config/sub/macros',
      force: true,
    })

    await expect(machineFiles.deleteEntry(entry('gone.cfg'))).resolves.toBe(true)
    expect(rpcCall).toHaveBeenCalledWith('server.files.delete_file', {
      path: 'config/sub/gone.cfg',
    })
    expect(machineFiles.notice).toBe('deleted')
  })

  it('renames an entry in place and rejects an unchanged or invalid name', async () => {
    const { rpcCall, machineFiles } = connect()
    machineFiles.currentPath = 'sub'

    await expect(machineFiles.renameEntry(entry('old.cfg'), 'new.cfg')).resolves.toBe(true)
    expect(rpcCall).toHaveBeenCalledWith('server.files.move', {
      source: 'config/sub/old.cfg',
      dest: 'config/sub/new.cfg',
    })
    expect(machineFiles.notice).toBe('renamed')

    rpcCall.mockClear()
    await expect(machineFiles.renameEntry(entry('same.cfg'), 'same.cfg')).resolves.toBe(false)
    await expect(machineFiles.renameEntry(entry('bad.cfg'), 'no/slashes.cfg')).resolves.toBe(false)
    expect(rpcCall).not.toHaveBeenCalled()
  })

  it('closes the editor when the file it is showing is deleted', async () => {
    const { machineFiles } = connect()
    machineFiles.currentPath = ''
    machineFiles.currentFile = { ...entry('open.cfg'), kind: 'file', path: 'open.cfg' }

    await expect(machineFiles.deleteEntry(entry('open.cfg'))).resolves.toBe(true)
    expect(machineFiles.currentFile).toBeNull()
  })

  it('repoints the open editor at the new path when that file is moved', async () => {
    const { machineFiles } = connect()
    machineFiles.currentPath = ''
    machineFiles.currentFile = { ...entry('moved.cfg'), kind: 'file', path: 'moved.cfg' }

    await machineFiles.moveEntryTo(entry('moved.cfg'), 'macros')
    expect(machineFiles.currentFile?.path).toBe('macros/moved.cfg')
  })

  it('leaves an unrelated open file alone when another entry moves', async () => {
    const { machineFiles } = connect()
    machineFiles.currentPath = ''
    machineFiles.currentFile = { ...entry('kept.cfg'), kind: 'file', path: 'kept.cfg' }

    await machineFiles.moveEntryTo(entry('other.cfg'), 'macros')
    expect(machineFiles.currentFile?.path).toBe('kept.cfg')
  })

  it('offers a download url for files but not directories', () => {
    const { machineFiles } = connect()
    machineFiles.currentPath = 'sub'

    expect(machineFiles.downloadUrlFor(entry('macros', 'directory'))).toBeNull()
    expect(machineFiles.downloadUrlFor(entry('thing.cfg'))).toContain('sub/thing.cfg')
  })

  it('adds an include and reflects it in the cache without an extra fetch', async () => {
    const { machineFiles } = connect()
    machineFiles.currentPath = ''
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ item: { path: 'printer.cfg', root: 'config' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('[printer]\n', { status: 200, headers: { 'content-type': 'text/plain' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(machineFiles.isPathIncluded('mob.cfg')).toBe(false)
    await expect(machineFiles.addIncludeFor(entry('mob.cfg'))).resolves.toBe(true)
    expect(machineFiles.isPathIncluded('mob.cfg')).toBe(true)
    // One GET to read printer.cfg, one POST to upload it — the cache is
    // updated from that same content, not a redundant re-fetch.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('removing an include clears it from the cache', async () => {
    const { machineFiles } = connect()
    machineFiles.currentPath = ''
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
        if (init?.method === 'POST') {
          return new Response(JSON.stringify({ item: { path: 'printer.cfg', root: 'config' } }), {
            status: 200,
          })
        }
        return new Response('[include mob.cfg]\n', { status: 200 })
      }),
    )

    await machineFiles.addIncludeFor(entry('mob.cfg'))
    expect(machineFiles.isPathIncluded('mob.cfg')).toBe(true)

    await expect(machineFiles.removeIncludeFor(entry('mob.cfg'))).resolves.toBe(true)
    expect(machineFiles.isPathIncluded('mob.cfg')).toBe(false)
  })

  it('loads the directory via start() without waiting on the background include-paths fetch', async () => {
    const availability = useAvailabilityStore()
    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({
      dirs: [],
      files: [{ filename: 'printer.cfg', modified: 1, size: 1, permissions: 'rw' }],
      disk_usage: { total: 1, used: 0, free: 1 },
      root_info: { name: 'config', permissions: 'rw' },
    } as never)
    // The include-paths fetch never resolves; the directory listing must not wait on it.
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {})),
    )
    const machineFiles = useMachineFilesStore()

    machineFiles.start()
    await vi.waitFor(() => expect(machineFiles.entries).toHaveLength(1))
    machineFiles.stop()
  })

  /*
   * Saving is not applying: the file on disk changes, and Klipper keeps running
   * the config it loaded until the firmware restarts. The editor's own "Save and
   * restart" disables itself the instant the buffer is clean, so this flag is
   * the only thing left telling anyone the change is not live.
   */
  describe('a saved config file that is not in effect yet', () => {
    async function openSavedFile() {
      const availability = useAvailabilityStore()
      availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
      availability.printerSnapshotSynchronized()
      const moonraker = useMoonrakerStore()
      vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({
        dirs: [],
        files: [{ filename: 'printer.cfg', modified: 2, size: 10, permissions: 'rw' }],
        disk_usage: { total: 1000, used: 400, free: 600 },
        root_info: { name: 'config', permissions: 'rw' },
      } as never)
      /*
       * The upload reads its response as JSON and opening the file reads it as
       * text, so one body cannot answer both.
       */
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockImplementation((_input, init) =>
          Promise.resolve(
            String(init?.method ?? 'GET').toUpperCase() === 'POST'
              ? new Response('{"item":{"path":"printer.cfg","root":"config"}}', {
                  headers: { 'content-type': 'application/json' },
                })
              : new Response('[stepper_x]'),
          ),
        ),
      )
      const machineFiles = useMachineFilesStore()
      await machineFiles.refreshDirectory()
      await machineFiles.openFile({
        kind: 'file',
        name: 'printer.cfg',
        path: 'printer.cfg',
        size: 10,
        modified: 2,
        permissions: 'rw',
      } as never)
      return { machineFiles, moonraker, availability }
    }

    it('is not set before anything has been written', async () => {
      const { machineFiles } = await openSavedFile()

      expect(machineFiles.hasUnappliedConfigChanges).toBe(false)
    })

    it('is set by a plain save, which does not restart', async () => {
      const { machineFiles } = await openSavedFile()
      machineFiles.editorContent = '[stepper_x]\nstep_pin: PA0'

      await expect(machineFiles.saveFile()).resolves.toBe(true)

      expect(machineFiles.isDirty).toBe(false)
      expect(machineFiles.hasUnappliedConfigChanges).toBe(true)
    })

    it('is cleared by a save that restarts', async () => {
      const { machineFiles } = await openSavedFile()
      machineFiles.editorContent = '[stepper_x]\nstep_pin: PA0'

      await expect(machineFiles.saveFile(true)).resolves.toBe(true)

      expect(machineFiles.hasUnappliedConfigChanges).toBe(false)
    })

    /*
     * A restart that never happened leaves the change unapplied, so the reminder
     * has to survive the failure rather than being cleared by the attempt.
     */
    it('survives a restart that failed', async () => {
      const { machineFiles, moonraker } = await openSavedFile()
      machineFiles.editorContent = '[stepper_x]\nstep_pin: PA0'
      vi.spyOn(moonraker, 'rpcCall').mockRejectedValue(new Error('no route to host'))

      await expect(machineFiles.saveFile(true)).resolves.toBe(false)

      expect(machineFiles.hasUnappliedConfigChanges).toBe(true)
      expect(machineFiles.lastError).toBe('restart')
    })

    /*
     * Cleared by Klipper coming back, whoever restarted it — the header's own
     * restart, the power menu's, KlipperScreen's, or a command typed into the
     * console.
     */
    it('is cleared when Klipper comes back up', async () => {
      const { machineFiles, availability } = await openSavedFile()
      machineFiles.editorContent = '[stepper_x]\nstep_pin: PA0'
      await machineFiles.saveFile()
      expect(machineFiles.hasUnappliedConfigChanges).toBe(true)

      availability.setKlipperState('startup')
      await nextTick()
      availability.setKlipperState('ready')
      availability.printerSnapshotSynchronized()
      await nextTick()

      expect(machineFiles.hasUnappliedConfigChanges).toBe(false)
    })

    /* A different printer has its own config and its own restart state. */
    it('does not follow a printer switch', async () => {
      const { machineFiles, moonraker } = await openSavedFile()
      machineFiles.editorContent = '[stepper_x]\nstep_pin: PA0'
      await machineFiles.saveFile()
      // Fired through the registry rather than by reconnecting a transport: the
      // reset is what this asserts, not how Moonraker notices the switch.
      let firePrinterChange: (() => void) | undefined
      vi.spyOn(moonraker, 'onPrinterChange').mockImplementation((handler) => {
        firePrinterChange = handler
        return () => undefined
      })
      machineFiles.start()

      firePrinterChange?.()
      await nextTick()

      expect(machineFiles.hasUnappliedConfigChanges).toBe(false)
      machineFiles.stop()
    })
  })
})
