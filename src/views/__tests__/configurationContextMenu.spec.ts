import { undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
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

const listing = {
  dirs: [],
  files: [
    { filename: 'printer.cfg', modified: 20, size: configFile.length, permissions: 'rw' },
    { filename: 'notes.txt', modified: 20, size: configFile.length, permissions: 'rw' },
  ],
  disk_usage: { total: 1000, used: 400, free: 600 },
  root_info: { name: 'config', permissions: 'rw' },
} as never

let pinia: Pinia

beforeEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  document.body.innerHTML = ''
  useConfigFileHistory().resetFileHistory()
  pinia = createPinia()
  setActivePinia(pinia)
  const moonraker = useMoonrakerStore(pinia)
  moonraker.connectionPhase = 'connected'
  useAvailabilityStore(pinia).moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
  vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(listing)
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(configFile))),
  )
})

async function mountWith(name: string, permissions = 'rw'): Promise<VueWrapper> {
  const view = mount(ConfigurationView, {
    global: { plugins: [i18n, pinia] },
    attachTo: document.body,
  })
  await flushPromises()
  await useMachineFilesStore(pinia).openFile({
    kind: 'file',
    name,
    size: configFile.length,
    modified: 20,
    permissions,
  })
  await flushPromises()
  await view.vm.$nextTick()
  return view
}

function editorView(view: VueWrapper): EditorView {
  const found = EditorView.findFromDOM(view.find('.cm-editor').element as HTMLElement)
  if (!found) throw new Error('the editor is not mounted')
  return found
}

function content(view: VueWrapper): HTMLElement {
  return editorView(view).contentDOM
}

/*
 * jsdom lays nothing out, so `posAtCoords` has no geometry to answer from. The
 * keyboard path reads the caret instead, which is what these tests drive; the
 * pointer path shares everything after the position is resolved.
 */
async function openMenuAtCaret(view: VueWrapper, offset: number): Promise<KeyboardEvent> {
  const editor = editorView(view)
  editor.dispatch({ selection: { anchor: offset } })
  const event = new KeyboardEvent('keydown', {
    key: 'ContextMenu',
    bubbles: true,
    cancelable: true,
  })
  editor.contentDOM.dispatchEvent(event)
  await flushPromises()
  return event
}

function menuButton(name: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll<HTMLButtonElement>('.file-context-menu button')].find(
    (button) => button.textContent?.includes(name),
  )
}

describe('Configuration editor context menu', () => {
  it('opens its own menu about the token at the caret', async () => {
    const view = await mountWith('printer.cfg')
    const event = await openMenuAtCaret(view, configFile.indexOf('kinematics') + 2)

    expect(event.defaultPrevented).toBe(true)
    expect(document.body.querySelector('.editor-context-menu__target')?.textContent).toBe(
      'kinematics',
    )
    expect(menuButton('Toggle comment')).toBeDefined()
  })

  it('leaves Shift+right-click to the browser, which is how to paste', async () => {
    const view = await mountWith('printer.cfg')
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, shiftKey: true })
    content(view).dispatchEvent(event)
    await flushPromises()

    expect(event.defaultPrevented).toBe(false)
    expect(document.body.querySelector('.file-context-menu')).toBeNull()
  })

  it('keeps the browser menu on a file that is not Klipper config', async () => {
    const view = await mountWith('notes.txt')
    const event = await openMenuAtCaret(view, 3)

    expect(event.defaultPrevented).toBe(false)
    expect(document.body.querySelector('.file-context-menu')).toBeNull()
  })

  /*
   * One transaction, so one Ctrl+Z restores the section. The old editor had to
   * express this as a single `execCommand` call against a textarea to get one
   * undo step; a transaction is one step however many ranges it touches, and
   * the history extension is what records it.
   */
  it('comments a section out as one edit, so one undo restores it', async () => {
    const view = await mountWith('printer.cfg')
    await openMenuAtCaret(view, 2)

    menuButton('Comment out section')?.click()
    await flushPromises()

    const editor = editorView(view)
    expect(editor.state.doc.toString()).toBe('# [printer]\n# kinematics: corexy\n')

    undo({ state: editor.state, dispatch: (transaction) => editor.dispatch(transaction) })
    expect(editor.state.doc.toString()).toBe(configFile)
  })

  it('offers no editing on a file the printer will not let us write', async () => {
    const view = await mountWith('printer.cfg', 'r')
    await openMenuAtCaret(view, 2)

    expect(document.body.querySelector('.file-context-menu')).not.toBeNull()
    expect(menuButton('Comment out section')).toBeUndefined()
    expect(menuButton('Toggle comment')).toBeUndefined()
    expect(menuButton('Copy')).toBeDefined()
  })

  it('closes on a press outside and lets the press through to the page', async () => {
    const view = await mountWith('printer.cfg')
    await openMenuAtCaret(view, 2)
    const press = new PointerEvent('pointerdown', { bubbles: true, cancelable: true })
    content(view).dispatchEvent(press)
    await flushPromises()

    expect(press.defaultPrevented).toBe(false)
    expect(document.body.querySelector('.file-context-menu')).toBeNull()
  })

  it('closes when the file scrolls, and not when the reader works inside the menu', async () => {
    const view = await mountWith('printer.cfg')
    await openMenuAtCaret(view, 2)
    document.body
      .querySelector('.file-context-menu')
      ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(document.body.querySelector('.file-context-menu')).not.toBeNull()

    content(view).dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 }))
    await flushPromises()
    expect(document.body.querySelector('.file-context-menu')).toBeNull()
  })
})
