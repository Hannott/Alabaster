import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { JsonRpcNotification, NotificationHandler } from '@/services/moonraker'
import { parseFileListChange } from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import {
  applyFileChangeToIndex,
  useMachineFilesStore,
  type OpenMachineFile,
} from '@/stores/machineFiles'
import { useMoonrakerStore } from '@/stores/moonraker'

function file(path: string, modified = 1): OpenMachineFile {
  return {
    kind: 'file',
    name: path.slice(path.lastIndexOf('/') + 1),
    path,
    modified,
    size: 10,
    permissions: 'rw',
  }
}

function change(params: Record<string, unknown>) {
  return parseFileListChange([params])!
}

describe('applyFileChangeToIndex', () => {
  const index = [file('printer.cfg'), file('macros/park.cfg'), file('macros/purge.cfg')]

  it('adds a created file and updates a modified one in place of its old record', () => {
    const created = applyFileChangeToIndex(
      index,
      change({
        action: 'create_file',
        item: { root: 'config', path: 'new.cfg', modified: 9, size: 3 },
      }),
      'config',
    )
    expect(created?.map((entry) => entry.path)).toContain('new.cfg')

    const modified = applyFileChangeToIndex(
      index,
      change({ action: 'modify_file', item: { root: 'config', path: 'printer.cfg', modified: 7 } }),
      'config',
    )
    expect(modified?.filter((entry) => entry.path === 'printer.cfg')).toEqual([
      { ...file('printer.cfg', 7) },
    ])
  })

  it('drops a deleted file, and everything inside a deleted folder', () => {
    expect(
      applyFileChangeToIndex(
        index,
        change({ action: 'delete_dir', item: { root: 'config', path: 'macros' } }),
        'config',
      )?.map((entry) => entry.path),
    ).toEqual(['printer.cfg'])
  })

  it('carries a renamed folder’s files to their new paths', () => {
    expect(
      applyFileChangeToIndex(
        index,
        change({
          action: 'move_dir',
          item: { root: 'config', path: 'klipper/macros' },
          source_item: { root: 'config', path: 'macros' },
        }),
        'config',
      )?.map((entry) => entry.path),
    ).toEqual(['printer.cfg', 'klipper/macros/park.cfg', 'klipper/macros/purge.cfg'])
  })

  it('asks for a fresh listing when the change does not say which files it brought', () => {
    expect(
      applyFileChangeToIndex(
        index,
        change({
          action: 'move_dir',
          item: { root: 'config', path: 'imported' },
          source_item: { root: 'gcodes', path: 'imported' },
        }),
        'config',
      ),
    ).toBeNull()
    expect(
      applyFileChangeToIndex(
        index,
        change({ action: 'root_update', item: { root: 'config', path: '' } }),
        'config',
      ),
    ).toBeNull()
  })

  it('leaves the index alone for a change in another root', () => {
    expect(
      applyFileChangeToIndex(
        index,
        change({ action: 'delete_file', item: { root: 'gcodes', path: 'printer.cfg' } }),
        'config',
      ),
    ).toEqual(index)
  })
})

describe('machine files following notify_filelist_changed', () => {
  let notify: (params: Record<string, unknown>) => void
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
  let rpcCall: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useFakeTimers()
    window.localStorage.clear()
    setActivePinia(createPinia())
    useAvailabilityStore().moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const moonraker = useMoonrakerStore()
    const handlers: NotificationHandler[] = []
    vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
      if (method === 'notify_filelist_changed') handlers.push(handler)
      return () => undefined
    })
    notify = (params) =>
      handlers.forEach((handler) =>
        handler({
          jsonrpc: '2.0',
          method: 'notify_filelist_changed',
          params: [params],
        } as JsonRpcNotification),
      )
    rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation((async (method: string) => {
      if (method === 'server.files.list') {
        return [
          { path: 'printer.cfg', modified: 1, size: 20 },
          { path: 'macros/park.cfg', modified: 1, size: 20 },
        ]
      }
      return {
        dirs: [],
        files: [{ filename: 'printer.cfg', modified: 1, size: 20, permissions: 'rw' }],
        disk_usage: { total: 1, used: 0, free: 1 },
        root_info: { name: 'config', permissions: 'rw' },
      }
    }) as never)
    fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(new Response('[gcode_macro PARK]\ngcode: G28')))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function listCalls(): number {
    return rpcCall.mock.calls.filter((call: unknown[]) => call[0] === 'server.files.list').length
  }

  it('reads each file once per version across searches', async () => {
    const machineFiles = useMachineFilesStore()
    machineFiles.start()
    await vi.runAllTimersAsync()
    fetchMock.mockClear()
    await machineFiles.searchFileContents('park')
    await machineFiles.searchFileContents('g28')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect([...machineFiles.contentSearchMatches.keys()].sort()).toEqual([
      'macros/park.cfg',
      'printer.cfg',
    ])

    notify({
      action: 'modify_file',
      item: { root: 'config', path: 'macros/park.cfg', modified: 2, size: 20 },
    })
    await machineFiles.searchFileContents('park')

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(String(fetchMock.mock.calls[2]![0])).toContain('/server/files/config/macros/park.cfg')
    machineFiles.stop()
  })

  it('keeps the index current from the change rather than walking the root again', async () => {
    const machineFiles = useMachineFilesStore()
    machineFiles.start()
    await machineFiles.ensureSearchFiles()
    await vi.runAllTimersAsync()
    const walked = listCalls()

    notify({
      action: 'create_file',
      item: { root: 'config', path: 'new.cfg', modified: 3, size: 1 },
    })
    await vi.runAllTimersAsync()
    await machineFiles.refreshDirectory()

    expect(listCalls()).toBe(walked)
    expect(machineFiles.searchFiles.map((entry) => entry.path)).toContain('new.cfg')
    machineFiles.stop()
  })

  it('lists only folders a change lands in, and ignores other roots', async () => {
    const machineFiles = useMachineFilesStore()
    machineFiles.start()
    await vi.runAllTimersAsync()
    rpcCall.mockClear()

    notify({ action: 'create_file', item: { root: 'gcodes', path: 'part.gcode', modified: 3 } })
    notify({
      action: 'create_file',
      item: { root: 'config', path: 'shaketune_results/belts/a.png' },
    })
    await vi.runAllTimersAsync()
    expect(rpcCall).not.toHaveBeenCalled()

    notify({ action: 'modify_file', item: { root: 'config', path: 'printer.cfg', modified: 4 } })
    await vi.runAllTimersAsync()
    expect(rpcCall).toHaveBeenCalledWith('server.files.get_directory', { path: 'config' })
    machineFiles.stop()
  })
})
