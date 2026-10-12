import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import TimelapseView from '@/views/TimelapseView.vue'

enableAutoUnmount(afterEach)

beforeAll(() => {
  // jsdom ships <dialog> without its modal methods; see SettingsView.spec.ts.
  const dialogPrototype = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>
  if (typeof dialogPrototype.showModal !== 'function') {
    dialogPrototype.showModal = function showModal(this: HTMLDialogElement): void {
      this.open = true
    }
    dialogPrototype.close = function close(this: HTMLDialogElement): void {
      this.open = false
    }
  }
})

const day = 86_400

function listing(files: Array<{ filename: string; modified: number }>) {
  return {
    dirs: [],
    files: files.map((file) => ({ size: 4_404_019, permissions: 'rw', ...file })),
    disk_usage: { total: 100, used: 40, free: 60 },
    root_info: { name: 'timelapse', permissions: 'rw' },
  } as never
}

let pinia: Pinia

async function mountView(files: Array<{ filename: string; modified: number }>) {
  vi.spyOn(useMoonrakerStore(pinia), 'rpcCall').mockResolvedValue(listing(files))
  const view = mount(TimelapseView, { global: { plugins: [i18n, pinia] } })
  await flushPromises()
  return view
}

beforeEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  pinia = createPinia()
  setActivePinia(pinia)
  const moonraker = useMoonrakerStore(pinia)
  moonraker.connectionPhase = 'connected'
  useAvailabilityStore(pinia).moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
})

describe('Timelapse view', () => {
  it('opens on the newest video, named after its print', async () => {
    const view = await mountView([
      { filename: 'older.mp4', modified: 1_700_000_000 },
      { filename: 'timelapse_Cable clip_202610112314.mp4', modified: 1_800_000_000 },
    ])

    expect(view.get('#timelapse-player-heading').text()).toBe('Cable clip')
    expect(view.find('.timelapse-player video').exists()).toBe(true)
  })

  it('groups the videos under the day they were recorded', async () => {
    const now = Math.floor(Date.now() / 1000)
    const view = await mountView([
      { filename: 'today.mp4', modified: now },
      { filename: 'old.mp4', modified: 1_700_000_000 },
    ])

    const labels = view
      .findAll('.timelapse-videos .machine-list__label')
      .map((label) => label.text())
    expect(labels[0]).toBe('Today')
    expect(labels).toHaveLength(2)
    expect(view.get('.timelapse-videos .machine-panel-summary').text()).toContain('2 videos')
  })

  it('marks the playing video with the list wash, not the selected-row border', async () => {
    const now = Math.floor(Date.now() / 1000)
    const view = await mountView([
      { filename: 'first.mp4', modified: now },
      { filename: 'second.mp4', modified: now - day },
    ])

    const rows = () => view.findAll('.timelapse-video')
    expect(rows()[0]!.classes()).toContain('machine-row--current')
    expect(rows()[0]!.classes()).not.toContain('selection-row')
    expect(rows()[0]!.get('.machine-row__toggle').attributes('aria-current')).toBe('true')

    await rows()[1]!.get('.machine-row__toggle').trigger('click')

    expect(rows()[1]!.classes()).toContain('machine-row--current')
    expect(rows()[0]!.classes()).not.toContain('machine-row--current')
    expect(view.get('#timelapse-player-heading').text()).toBe('second')
  })

  it('reads the length and frame size from the video itself once it loads', async () => {
    const view = await mountView([{ filename: 'clip.mp4', modified: 1_700_000_000 }])

    const video = view.get('.timelapse-player video')
    Object.defineProperty(video.element, 'duration', { value: 72.4 })
    Object.defineProperty(video.element, 'videoWidth', { value: 1280 })
    Object.defineProperty(video.element, 'videoHeight', { value: 720 })
    await video.trigger('loadedmetadata')

    const stats = view.get('.timelapse-player .machine-host__stats').text()
    expect(stats).toContain('1:12')
    expect(stats).toContain('1280 × 720')
  })

  it('shows no player when there is nothing to play, and says so', async () => {
    const view = await mountView([])

    expect(view.find('.timelapse-player').exists()).toBe(false)
    expect(view.get('.timelapse-grid').classes()).toContain('timelapse-grid--empty')
    expect(view.get('.timelapse-videos .machine-panel-summary').text()).toBe(
      'No rendered timelapses yet.',
    )
  })

  it('deletes from a row menu after asking, naming the file', async () => {
    const now = Math.floor(Date.now() / 1000)
    const view = await mountView([{ filename: 'clip.mp4', modified: now }])
    const rpcCall = vi.spyOn(useMoonrakerStore(pinia), 'rpcCall').mockResolvedValue({} as never)
    rpcCall.mockClear()

    const row = view.get('.timelapse-video')
    await row.get('.machine-row__menu > .button').trigger('click')
    await row.get('.timelapse-video__delete').trigger('click')
    expect(view.text()).toContain('clip.mp4')
    expect(rpcCall).not.toHaveBeenCalled()

    const confirm = view.findAll('dialog button').find((button) => button.text() === 'Delete')
    await confirm!.trigger('click')
    await flushPromises()

    expect(rpcCall).toHaveBeenCalledWith('server.files.delete_file', { path: 'timelapse/clip.mp4' })
  })
})
