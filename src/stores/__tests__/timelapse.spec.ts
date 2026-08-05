import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { useTimelapseStore } from '@/stores/timelapse'

function listing(files: Array<{ filename: string; modified: number; size?: number }>) {
  return {
    dirs: [],
    files: files.map((file) => ({ size: 1000, permissions: 'rw', ...file })),
    disk_usage: { total: 100, used: 40, free: 60 },
    root_info: { name: 'timelapse', permissions: 'rw' },
  } as never
}

describe('timelapse store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setActivePinia(createPinia())
    useAvailabilityStore().moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
  })

  it('reads the timelapse root, newest first', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(
      listing([
        { filename: 'older.mp4', modified: 10 },
        { filename: 'newest.mp4', modified: 30 },
        { filename: 'middle.mp4', modified: 20 },
      ]),
    )
    const timelapse = useTimelapseStore()

    await timelapse.refresh()

    expect(rpcCall).toHaveBeenCalledWith('server.files.get_directory', { path: 'timelapse' })
    expect(timelapse.videos.map((video) => video.name)).toEqual([
      'newest.mp4',
      'middle.mp4',
      'older.mp4',
    ])
  })

  /**
   * The component leaves its captured frames in this root while it renders. A
   * gallery listing ten thousand PNGs is not what anyone opened the page for.
   */
  it('lists only finished videos, not the frames beside them', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(
      listing([
        { filename: 'print.mp4', modified: 30 },
        { filename: 'frame000001.jpg', modified: 29 },
        { filename: 'timelapse.log', modified: 28 },
        { filename: 'other.webm', modified: 27 },
      ]),
    )
    const timelapse = useTimelapseStore()

    await timelapse.refresh()

    expect(timelapse.videos.map((video) => video.name)).toEqual(['print.mp4', 'other.webm'])
  })

  it('builds a playable URL from the endpoint', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(listing([{ filename: 'a.mp4', modified: 1 }]))
    moonraker.endpoint = 'ws://printer.local:7125/websocket'
    const timelapse = useTimelapseStore()
    await timelapse.refresh()

    expect(timelapse.urlFor(timelapse.videos[0]!)).toBe(
      'http://printer.local:7125/server/files/timelapse/a.mp4',
    )
  })

  it('drops a deleted video and its selection', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi
      .spyOn(moonraker, 'rpcCall')
      .mockResolvedValue(listing([{ filename: 'a.mp4', modified: 1 }]))
    const timelapse = useTimelapseStore()
    await timelapse.refresh()
    timelapse.select('a.mp4')

    await timelapse.remove(timelapse.videos[0]!)

    expect(rpcCall).toHaveBeenCalledWith('server.files.delete_file', { path: 'timelapse/a.mp4' })
    expect(timelapse.videos).toEqual([])
    expect(timelapse.selectedPath).toBeNull()
  })

  it('clears a selection whose video is gone after a refresh', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi
      .spyOn(moonraker, 'rpcCall')
      .mockResolvedValue(listing([{ filename: 'a.mp4', modified: 1 }]))
    const timelapse = useTimelapseStore()
    await timelapse.refresh()
    timelapse.select('a.mp4')

    rpcCall.mockResolvedValue(listing([{ filename: 'b.mp4', modified: 2 }]))
    await timelapse.refresh()

    expect(timelapse.selectedPath).toBeNull()
  })

  it('reports a failed read instead of pretending the folder is empty', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockRejectedValue(new Error('no such root'))
    const timelapse = useTimelapseStore()

    await expect(timelapse.refresh()).resolves.toBe(false)

    expect(timelapse.failed).toBe(true)
    expect(timelapse.hasVideos).toBe(false)
  })
})
