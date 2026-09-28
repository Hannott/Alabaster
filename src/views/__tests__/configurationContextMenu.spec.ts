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

function textarea(view: VueWrapper): HTMLTextAreaElement {
  return view.find('textarea').element as HTMLTextAreaElement
}

/*
 * jsdom lays nothing out, so the pointer hit test has no character width to
 * measure. The keyboard path reads the caret instead, which is what these
 * tests drive; the pointer path shares everything after the hit test.
 */
async function openMenuAtCaret(view: VueWrapper, offset: number): Promise<MouseEvent> {
  const element = textarea(view)
  element.setSelectionRange(offset, offset)
  element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true }))
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  element.dispatchEvent(event)
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
    textarea(view).dispatchEvent(event)
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

  it('comments a section out as one edit, so one undo restores it', async () => {
    const execCommand = vi.fn().mockReturnValue(true)
    document.execCommand = execCommand
    const view = await mountWith('printer.cfg')
    await openMenuAtCaret(view, 2)

    menuButton('Comment out section')?.click()
    await flushPromises()

    expect(execCommand).toHaveBeenCalledOnce()
    expect(execCommand).toHaveBeenCalledWith(
      'insertText',
      false,
      '# [printer]\n# kinematics: corexy',
    )
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
    textarea(view).dispatchEvent(press)
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

    textarea(view).dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 }))
    await flushPromises()
    expect(document.body.querySelector('.file-context-menu')).toBeNull()
  })
})
