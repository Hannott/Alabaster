import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useMachineFilesSettings } from '@/composables/useMachineFilesSettings'
import { i18n } from '@/i18n'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import ConfigurationView from '@/views/ConfigurationView.vue'

enableAutoUnmount(afterEach)

/** Every entry in the logs root is read-only, which is what Moonraker reports. */
const logsListing = {
  dirs: [],
  files: [
    { filename: 'klippy.log', modified: 20, size: 4_500_000, permissions: 'r' },
    { filename: 'moonraker.log', modified: 10, size: 231_700, permissions: 'r' },
  ],
  disk_usage: { total: 1000, used: 400, free: 600 },
  root_info: { name: 'logs', permissions: 'r' },
} as never

let pinia: Pinia

beforeEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  /*
   * These settings are module-level refs read once at import, so clearing
   * localStorage does not reset them and one test's choice leaks into the next.
   * Put them back to their shipped defaults explicitly.
   */
  const settings = useMachineFilesSettings()
  settings.setShowHiddenFiles(false)
  settings.setShowBackupFiles(false)
  settings.setShowReadOnlyFiles(true)
  pinia = createPinia()
  setActivePinia(pinia)
  const moonraker = useMoonrakerStore(pinia)
  moonraker.connectionPhase = 'connected'
  useAvailabilityStore(pinia).moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
  vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(logsListing)
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(''))),
  )
})

async function mountAtLogs() {
  const view = mount(ConfigurationView, { global: { plugins: [i18n, pinia] } })
  await flushPromises()
  const logsTab = view
    .findAll('.machine-root-tabs button')
    .find((button) => button.text() === 'Logs')
  await logsTab!.trigger('click')
  await flushPromises()
  return view
}

describe('Configuration roots', () => {
  /**
   * The defect: with "show read-only files" switched off — a reasonable choice in
   * a configuration browser, where read-only means "not yours to edit" — the
   * filter hid every entry in the logs root and the workspace reported an empty
   * folder for a directory holding a dozen logs.
   */
  it('lists a read-only root even when read-only files are filtered out', async () => {
    useMachineFilesSettings().setShowReadOnlyFiles(false)

    const view = await mountAtLogs()

    expect(view.text()).toContain('klippy.log')
    expect(view.text()).toContain('moonraker.log')
    expect(view.text()).not.toContain('This folder is empty')
  })

  it('still filters read-only files where the distinction means something', async () => {
    useMachineFilesSettings().setShowReadOnlyFiles(false)
    const moonraker = useMoonrakerStore(pinia)
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({
      dirs: [],
      files: [
        { filename: 'printer.cfg', modified: 20, size: 100, permissions: 'rw' },
        { filename: 'locked.cfg', modified: 10, size: 100, permissions: 'r' },
      ],
      disk_usage: { total: 1000, used: 400, free: 600 },
      root_info: { name: 'config', permissions: 'rw' },
    } as never)

    const view = mount(ConfigurationView, { global: { plugins: [i18n, pinia] } })
    await flushPromises()

    expect(view.text()).toContain('printer.cfg')
    expect(view.text()).not.toContain('locked.cfg')
  })

  /**
   * Recents are derived from the directory listing, and a root switch clears them
   * before the new listing lands. Saying "nothing opened yet" in that gap blinks a
   * false answer for a frame or two, which is what was reported. The band keeps its
   * height throughout either way.
   */
  it('waits for the listing before saying nothing has been opened', async () => {
    const moonraker = useMoonrakerStore(pinia)
    // Only the directory read is held open; anything else the view asks for
    // resolves, so what is under test is the listing's own pending state.
    let settle: ((value: unknown) => void) | undefined
    vi.spyOn(moonraker, 'rpcCall').mockImplementation(((method: string) =>
      method === 'server.files.get_directory'
        ? new Promise((resolve) => (settle = resolve))
        : Promise.resolve([])) as never)

    const view = mount(ConfigurationView, { global: { plugins: [i18n, pinia] } })
    await flushPromises()

    const band = view.find('.machine-recent-files')
    expect(band.exists()).toBe(true)
    expect(band.find('.machine-recent-files__empty').exists()).toBe(false)

    // An empty folder is the case that legitimately has nothing to offer, so this
    // is where the empty state belongs — after the answer, not before it.
    settle?.({ ...(logsListing as object), files: [] })
    await flushPromises()

    expect(view.find('.machine-recent-files__empty').exists()).toBe(true)
    expect(view.find('.machine-recent-files').exists()).toBe(true)
  })

  it('names the root being browsed in the path trail', async () => {
    const view = await mountAtLogs()

    const trail = view.find('.machine-breadcrumbs')
    expect(trail.text()).toContain('logs')
    expect(trail.text()).not.toContain('config')
  })

  /**
   * One fact stated once. In a wholly read-only root every row would carry the
   * same mark, which is the repetition the Movement card's shared-precondition
   * rule exists to prevent — the selected tab already says it.
   */
  it('does not repeat a read-only mark on every row of a read-only root', async () => {
    const view = await mountAtLogs()

    expect(view.findAll('.machine-readonly-mark')).toHaveLength(0)
  })

  it('marks the read-only exception in a root that also holds writable files', async () => {
    const moonraker = useMoonrakerStore(pinia)
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({
      dirs: [],
      files: [
        { filename: 'printer.cfg', modified: 20, size: 100, permissions: 'rw' },
        { filename: 'locked.cfg', modified: 10, size: 100, permissions: 'r' },
      ],
      disk_usage: { total: 1000, used: 400, free: 600 },
      root_info: { name: 'config', permissions: 'rw' },
    } as never)

    const view = mount(ConfigurationView, { global: { plugins: [i18n, pinia] } })
    await flushPromises()

    expect(view.findAll('.machine-readonly-mark')).toHaveLength(1)
  })
})
