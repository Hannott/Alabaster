import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { useMachineFilesSettings } from '@/composables/useMachineFilesSettings'
import { i18n } from '@/i18n'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import ConfigurationView from '@/views/ConfigurationView.vue'

enableAutoUnmount(afterEach)

beforeAll(() => {
  // jsdom ships <dialog> without its modal methods, so the shared dialog's
  // open/close watcher has nothing to call.
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
   * An empty state is an answer, so it waits for one. Rendering "this folder is
   * empty" while the listing is still on its way blinks a false answer for a
   * frame or two — the recent-files band shipped exactly that before the tree
   * replaced it.
   */
  it('waits for the listing before calling the root empty', async () => {
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

    expect(view.find('.machine-empty-state').exists()).toBe(false)
    expect(view.find('.machine-explorer-footer').exists()).toBe(true)

    settle?.({ ...(logsListing as object), files: [] })
    await flushPromises()

    expect(view.find('.machine-empty-state').exists()).toBe(true)
  })

  it('names the root being browsed at the top of the tree', async () => {
    const view = await mountAtLogs()

    const root = view.find('.machine-tree-row--root')
    expect(root.text()).toContain('logs')
    expect(root.text()).not.toContain('config')
    expect(root.attributes('aria-expanded')).toBe('true')
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

  it('answers a right-click on a log the way it does on a config file', async () => {
    const view = await mountAtLogs()
    const row = view.findAll('[data-tree-path]').find((item) => item.text().includes('klippy.log'))

    await row!.trigger('contextmenu')
    await flushPromises()

    const labels = [
      ...document.body.querySelectorAll<HTMLButtonElement>('.file-context-menu button'),
    ]
    const named = (text: string) => labels.find((button) => button.textContent?.includes(text))
    expect(named('Pin')?.disabled).toBe(false)
    expect(named('Download')?.disabled).toBe(false)
    expect(named('Rename')?.disabled).toBe(true)
    expect(named('Delete')?.disabled).toBe(true)
    expect(named('printer.cfg')).toBeUndefined()
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

  /*
   * klippy.log runs to megabytes. By run, it is read a piece at a time from
   * its end, so opening it never downloads the whole file, and never asks
   * whether to; asking for the whole file is what passes the large-file gate.
   */
  it('opens klippy.log by run without reading the whole file', async () => {
    const view = mount(ConfigurationView, {
      global: { plugins: [i18n, pinia] },
      attachTo: document.body,
    })
    await flushPromises()
    await view
      .findAll('.machine-root-tabs button')
      .find((button) => button.text() === 'Logs')!
      .trigger('click')
    await flushPromises()

    await view.get('[data-tree-path="klippy.log"]').trigger('click')
    await flushPromises()

    const requests = vi
      .mocked(fetch)
      .mock.calls.filter(([input]) => String(input).includes('/server/files/logs/'))
    expect(requests.length).toBeGreaterThan(0)
    expect(
      requests.every(([, init]) => new Headers(init?.headers).get('Range')?.startsWith('bytes=')),
    ).toBe(true)
    expect(view.find('.log-run').exists()).toBe(true)
    expect(document.querySelector('dialog[open]')).toBeNull()

    const fullFile = view
      .findAll('.log-run__views .tab-select')
      .find((button) => button.text() === 'Full file')!
    await fullFile.trigger('click')
    await flushPromises()

    expect(document.querySelector('dialog[open]')?.textContent).toContain('klippy.log')
  })
})
