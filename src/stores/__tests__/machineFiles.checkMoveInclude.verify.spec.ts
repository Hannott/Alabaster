import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAvailabilityStore } from '@/stores/availability'
import { useMachineFilesStore } from '@/stores/machineFiles'
import { useMoonrakerStore } from '@/stores/moonraker'

describe('machine files store: checkMoveInclude', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('reports the include rewrite without moving the file or writing printer.cfg', async () => {
    const availability = useAvailabilityStore()
    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall')
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('[include hardware/bed.cfg]\n', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const machineFiles = useMachineFilesStore()
    machineFiles.currentPath = 'hardware'

    await expect(
      machineFiles.checkMoveInclude(
        { kind: 'file', name: 'bed.cfg', modified: 1, size: 10, permissions: 'rw' },
        'moved',
      ),
    ).resolves.toEqual({
      previousPath: 'hardware/bed.cfg',
      nextPath: 'moved/bed.cfg',
      rewrite: {
        from: 'hardware/bed.cfg',
        to: 'moved/bed.cfg',
        content: '[include moved/bed.cfg]\n',
      },
    })

    expect(rpcCall).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.method ?? undefined).not.toBe('POST')
    expect(machineFiles.notice).toBeNull()
  })
})
