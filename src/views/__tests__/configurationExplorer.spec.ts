import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useConfigFileHistory } from '@/composables/useConfigFileHistory'
import { useMachineFilesSettings } from '@/composables/useMachineFilesSettings'
import { i18n } from '@/i18n'
import { useAvailabilityStore } from '@/stores/availability'
import { useMachineFilesStore } from '@/stores/machineFiles'
import { useMoonrakerStore } from '@/stores/moonraker'
import ConfigurationView from '@/views/ConfigurationView.vue'

enableAutoUnmount(afterEach)

function listing(dirs: string[], files: string[]) {
  return {
    dirs: dirs.map((dirname) => ({ dirname, modified: 1, size: 0, permissions: 'rw' })),
    files: files.map((filename) => ({ filename, modified: 1, size: 10, permissions: 'rw' })),
    disk_usage: { total: 1000, used: 400, free: 600 },
    root_info: { name: 'config', permissions: 'rw' },
  }
}

let pinia: Pinia

beforeEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  useConfigFileHistory().resetFileHistory()
  const settings = useMachineFilesSettings()
  settings.setShowHiddenFiles(false)
  settings.setShowBackupFiles(false)
  settings.setShowReadOnlyFiles(true)
  settings.setSortKey('name')
  pinia = createPinia()
  setActivePinia(pinia)
  const moonraker = useMoonrakerStore(pinia)
  moonraker.connectionPhase = 'connected'
  useAvailabilityStore(pinia).moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
  vi.spyOn(moonraker, 'rpcCall').mockImplementation(((
    method: string,
    params?: { path?: string },
  ) => {
    if (method !== 'server.files.get_directory') return Promise.resolve([])
    return Promise.resolve(
      params?.path === 'config/macros'
        ? listing([], ['homing.cfg'])
        : listing(['macros'], ['printer.cfg']),
    )
  }) as never)
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response('[x]\n'))),
  )
})

async function mountView(): Promise<VueWrapper> {
  const view = mount(ConfigurationView, {
    attachTo: document.body,
    global: { plugins: [i18n, pinia] },
  })
  await flushPromises()
  return view
}

function row(view: VueWrapper, path: string) {
  return view.find(`.machine-file-tree [data-tree-path="${path}"]`)
}

function treePaths(view: VueWrapper): string[] {
  return view
    .findAll('.machine-file-tree [role="treeitem"]')
    .map((item) => item.attributes('data-tree-path')!)
}

describe('the Configuration explorer tree', () => {
  it('lists the root, then its folders, then its files', async () => {
    const view = await mountView()

    expect(treePaths(view)).toEqual(['', 'macros', 'printer.cfg'])
    expect(row(view, '').attributes('aria-level')).toBe('1')
    expect(row(view, 'macros').attributes('aria-level')).toBe('2')
    expect(row(view, 'macros').attributes('aria-expanded')).toBe('false')
  })

  it('opens a folder in place', async () => {
    const view = await mountView()

    await row(view, 'macros').trigger('click')
    await flushPromises()

    expect(row(view, 'macros').attributes('aria-expanded')).toBe('true')
    expect(treePaths(view)).toEqual(['', 'macros', 'macros/homing.cfg', 'printer.cfg'])
    expect(row(view, 'macros/homing.cfg').attributes('aria-level')).toBe('3')
  })

  it('opens a file in the preview tab on a click, and keeps it on a double click', async () => {
    const view = await mountView()
    const files = useMachineFilesStore(pinia)

    await row(view, 'printer.cfg').trigger('click')
    await flushPromises()
    expect(files.currentFile?.path).toBe('printer.cfg')
    expect(files.openTabs).toEqual([expect.objectContaining({ preview: true })])
    expect(row(view, 'printer.cfg').attributes('aria-current')).toBe('true')

    await row(view, 'printer.cfg').trigger('dblclick')
    expect(files.openTabs).toEqual([expect.objectContaining({ preview: false })])
  })

  it('moves with the arrow keys and opens a folder with Right', async () => {
    const view = await mountView()

    await row(view, '').trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    expect(document.activeElement?.getAttribute('data-tree-path')).toBe('macros')

    await row(view, 'macros').trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(row(view, 'macros').attributes('aria-expanded')).toBe('true')

    await row(view, 'macros').trigger('keydown', { key: 'ArrowLeft' })
    await flushPromises()
    expect(row(view, 'macros').attributes('aria-expanded')).toBe('false')
  })

  it('opens the folders above a file opened some other way', async () => {
    const view = await mountView()

    await useMachineFilesStore(pinia).openFileByPath({
      kind: 'file',
      name: 'homing.cfg',
      path: 'macros/homing.cfg',
      modified: 1,
      size: 10,
      permissions: 'rw',
    })
    await flushPromises()

    expect(row(view, 'macros').attributes('aria-expanded')).toBe('true')
    expect(row(view, 'macros/homing.cfg').attributes('aria-current')).toBe('true')
  })

  it('describes the file on screen in the footer', async () => {
    const view = await mountView()

    await row(view, 'printer.cfg').trigger('click')
    await flushPromises()

    expect(view.find('.machine-explorer-footer').text()).toContain('printer.cfg')
  })

  it('closes a tab without losing the file’s unsaved edit', async () => {
    const view = await mountView()
    const files = useMachineFilesStore(pinia)
    await row(view, 'printer.cfg').trigger('click')
    await flushPromises()
    files.editorContent = '[changed]\n'
    await flushPromises()

    await view.find('.document-tabs__rows .document-tab__control--close').trigger('click')
    await flushPromises()

    expect(files.openTabs).toHaveLength(0)
    expect(row(view, 'printer.cfg').text()).toContain('Unsaved')
  })
})
