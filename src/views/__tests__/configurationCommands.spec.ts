import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useConfigFileHistory } from '@/composables/useConfigFileHistory'
import { i18n } from '@/i18n'
import { useAvailabilityStore } from '@/stores/availability'
import { useMachineFilesStore } from '@/stores/machineFiles'
import { useMoonrakerStore } from '@/stores/moonraker'
import ConfigurationView from '@/views/ConfigurationView.vue'

enableAutoUnmount(afterEach)

const configFile = ['[printer]', 'kinematics: corexy', ''].join('\n')

const configListing = {
  dirs: [],
  files: [{ filename: 'printer.cfg', modified: 20, size: configFile.length, permissions: 'rw' }],
  disk_usage: { total: 1000, used: 400, free: 600 },
  root_info: { name: 'config', permissions: 'rw' },
} as never

const printerCfg = {
  kind: 'file',
  name: 'printer.cfg',
  size: configFile.length,
  modified: 20,
  permissions: 'rw',
} as const

let pinia: Pinia

beforeEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  useConfigFileHistory().resetFileHistory()
  pinia = createPinia()
  setActivePinia(pinia)
  const moonraker = useMoonrakerStore(pinia)
  moonraker.connectionPhase = 'connected'
  useAvailabilityStore(pinia).moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
  vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(configListing)
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(configFile))),
  )
})

async function mountView(): Promise<VueWrapper> {
  const view = mount(ConfigurationView, { global: { plugins: [i18n, pinia] } })
  await flushPromises()
  return view
}

async function openPrinterCfg(view: VueWrapper): Promise<void> {
  await useMachineFilesStore(pinia).openFile(printerCfg)
  await flushPromises()
  await view.vm.$nextTick()
}

function buttonNamed(scope: VueWrapper | ReturnType<VueWrapper['find']>, name: string) {
  return scope
    .findAll('button')
    .find((button) => button.text() === name || button.attributes('aria-label') === name)
}

describe('Configuration file commands', () => {
  /*
   * The defect: Save, Save and restart and Discard changes were icon-only in the
   * tab well, and Save all / Discard all sat in the explorer header on the same
   * glyphs, so two save and two discard buttons a card apart looked identical —
   * and Save and restart shared its glyph with the explorer's Refresh folder.
   */
  it('labels the open file’s actions in the command bar, not the tab well', async () => {
    const view = await mountView()
    await openPrinterCfg(view)

    const bar = view.find('.machine-command-bar')
    for (const label of ['Save', 'Save and restart', 'Discard changes']) {
      expect(buttonNamed(bar, label), label).toBeDefined()
      expect(buttonNamed(view.find('.document-tabs'), label), label).toBeUndefined()
    }
    const header = view.find('.machine-pane-header')
    expect(buttonNamed(header, 'Save all files')).toBeUndefined()
    expect(buttonNamed(header, 'Discard all changes')).toBeUndefined()
  })

  /*
   * Closing a tab keeps its buffer, so an unsaved file can outlive every tab.
   * With Save all gone from the explorer header, the bar's menu is the one way
   * back to it, so the bar is there with nothing open.
   */
  it('still reaches every unsaved file after its tab is closed', async () => {
    const view = await mountView()
    await openPrinterCfg(view)
    const files = useMachineFilesStore(pinia)
    files.editorContent = `${configFile}# edit\n`
    await files.closeTab('printer.cfg')
    await flushPromises()

    expect(files.currentFile).toBeNull()
    const bar = view.find('.machine-command-bar')
    expect(bar.text()).toContain('Unsaved files: 1')

    await bar.find('[aria-label="More file actions"]').trigger('click')
    const saveAll = buttonNamed(bar, 'Save all files')
    expect(saveAll?.attributes('disabled')).toBeUndefined()
  })

  /*
   * The hide toggle was disabled with nothing open, which on the Logs root —
   * where nothing is open until a log is chosen — meant the explorer could
   * never be put away there at all.
   */
  it('can unpin the explorer with nothing open', async () => {
    const view = await mountView()
    const pin = view.find('.machine-side-strip .machine-explorer-pin')

    expect(pin.attributes('disabled')).toBeUndefined()
    expect(pin.attributes('aria-label')).toBe('Unpin explorer')
    await pin.trigger('click')

    const workspace = view.find('.machine-workspace')
    expect(workspace.classes()).toContain('machine-workspace--explorer-unpinned')
    expect(workspace.classes()).not.toContain('machine-workspace--explorer-peek')
    expect(pin.attributes('aria-label')).toBe('Pin explorer')
  })

  // The icon carries the state; a pressed state would add the accent ring.
  it('shows the pin’s state by its icon alone', async () => {
    const view = await mountView()
    const pin = view.find('.machine-side-strip .machine-explorer-pin')

    expect(pin.attributes('aria-pressed')).toBeUndefined()
    expect(pin.classes()).toContain('button--quiet')
  })

  it('slides an unpinned explorer out when a root is chosen', async () => {
    const view = await mountView()
    await openPrinterCfg(view)
    const workspace = view.find('.machine-workspace')

    await view.find('.machine-side-strip .machine-explorer-pin').trigger('click')
    expect(workspace.classes()).not.toContain('machine-workspace--explorer-peek')

    await buttonNamed(view.find('.machine-side-strip'), 'Config')!.trigger('click')
    expect(workspace.classes()).toContain('machine-workspace--explorer-peek')
  })
})
