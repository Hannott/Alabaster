import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import ConsoleView from '@/views/ConsoleView.vue'
import { i18n } from '@/i18n'
import { consoleEntryFromCommand, consoleEntryFromResponse } from '@/services/console/transcript'
import { useAvailabilityStore } from '@/stores/availability'
import { useConfirmationsStore } from '@/stores/confirmations'
import { useConsoleStore } from '@/stores/console'

function ready() {
  const availability = useAvailabilityStore()
  availability.transportState = 'connected'
  availability.klipperState = 'ready'
  availability.subscriptionState = 'ready'
}

function seed() {
  const gcodeConsole = useConsoleStore()
  gcodeConsole.consoleEntries = [
    consoleEntryFromCommand('G28', 1, 1_700_000_000_000),
    consoleEntryFromResponse('// Klipper state: Ready', 2, 1_700_000_001_000),
    consoleEntryFromResponse('ok T:24.1 /0.0 B:23.8 /0.0', 3, 1_700_000_002_000),
  ]
  gcodeConsole.gcodeHelp = [
    { command: 'BED_MESH_CALIBRATE', help: 'Calibrate the bed mesh' },
    { command: 'G28', help: 'Home the axes' },
    { command: 'TIMELAPSE_RENDER', help: 'Render the timelapse' },
  ]
  return gcodeConsole
}

function mountView() {
  return mount(ConsoleView, {
    global: {
      plugins: [i18n],
      stubs: { RouterLink: { template: '<a><slot></slot></a>' } },
    },
  })
}

beforeAll(() => {
  // jsdom ships <dialog> without its modal methods, so the clear confirmations'
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

describe('ConsoleView', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('names itself with a page-heading, and does not repeat that name in the toolbar', () => {
    ready()
    seed()
    const wrapper = mountView()
    expect(wrapper.get('section').classes()).toContain('workspace-page')
    expect(wrapper.get('h1').classes()).toContain('page-heading__title')
    expect(wrapper.get('h1').text()).toBe('Console')
    // The transcript toolbar named itself "Console" before the route carried a
    // visible heading; now that the page-heading states it, repeating it here
    // would be the same landmark name announced twice.
    expect(wrapper.find('#console-main-title').exists()).toBe(false)
  })

  it('filters the transcript and says how much it is holding back', () => {
    ready()
    seed()
    const wrapper = mountView()

    // The temperature filter defaults on, so the M105-style line is gone and the
    // reader is told why rather than left wondering.
    expect(wrapper.findAll('.gcode-console__line')).toHaveLength(2)
    expect(wrapper.get('.console-toolbar__note').text()).toBe('1 hidden by filters')
  })

  it('drops the note entirely rather than reading "0 hidden"', async () => {
    ready()
    const gcodeConsole = seed()
    gcodeConsole.consoleEntries = [consoleEntryFromCommand('G28', 1, 1_700_000_000_000)]
    await flushPromises()
    expect(mountView().find('.console-toolbar__note').exists()).toBe(false)
  })

  it('opens one aside at a time, so narrow widths have one thing to stack', async () => {
    ready()
    seed()
    const wrapper = mountView()
    const [commands, , settings] = wrapper.findAll('.console-toolbar__actions button')

    expect(wrapper.find('.console-aside').exists()).toBe(false)
    await commands?.trigger('click')
    expect(wrapper.get('.console-aside').attributes('aria-label')).toBe('Commands')

    await settings?.trigger('click')
    expect(wrapper.get('.console-aside').attributes('aria-label')).toBe('Console')
    expect(wrapper.findAll('.console-aside')).toHaveLength(1)

    // Pressing the open one again closes it.
    await settings?.trigger('click')
    expect(wrapper.find('.console-aside').exists()).toBe(false)
  })

  it('states the match count, and swaps it for the empty line rather than reading "0 commands"', async () => {
    ready()
    seed()
    const wrapper = mountView()
    await wrapper.findAll('.console-toolbar__actions button')[0]?.trigger('click')
    expect(wrapper.get('.console-aside').text()).toContain('3 commands')

    await wrapper.get('.console-browser__search').setValue('nothing matches this')

    const aside = wrapper.get('.console-aside')
    expect(aside.text()).toContain('No command matches that.')
    expect(aside.text()).not.toContain('0 commands')
  })

  it('offers the timelapse filter only when the machine reports timelapse commands', async () => {
    ready()
    const gcodeConsole = seed()
    const wrapper = mountView()
    const settings = wrapper.findAll('.console-toolbar__actions button')[2]
    await settings?.trigger('click')
    expect(wrapper.text()).toContain('Hide timelapse commands')

    gcodeConsole.gcodeHelp = [{ command: 'G28', help: 'Home the axes' }]
    await flushPromises()
    expect(wrapper.text()).not.toContain('Hide timelapse commands')
  })

  it('never offers a line count on a transcript that fills its pane', async () => {
    ready()
    seed()
    const wrapper = mountView()
    await wrapper.findAll('.console-toolbar__actions button')[2]?.trigger('click')
    expect(wrapper.text()).not.toContain('Visible lines')
    expect(wrapper.get('.gcode-console').classes()).toContain('gcode-console--fill')
  })

  it('puts a browsed command in the prompt rather than running it', async () => {
    // A command the user has not seen before must be readable and editable before
    // it moves the machine.
    ready()
    seed()
    const wrapper = mountView()
    const sendGcode = vi.spyOn(useConsoleStore(), 'sendConsoleCommand')
    await wrapper.findAll('.console-toolbar__actions button')[0]?.trigger('click')
    await wrapper.get('.console-browser__list button').trigger('click')

    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe(
      'BED_MESH_CALIBRATE',
    )
    expect(sendGcode).not.toHaveBeenCalled()
  })

  it('sends what was typed through the store, which owns the echo', async () => {
    ready()
    seed()
    const wrapper = mountView()
    const gcodeConsole = useConsoleStore()
    const sendGcode = vi.spyOn(gcodeConsole, 'sendConsoleCommand').mockResolvedValue(true)

    await wrapper.get('textarea').setValue('M114')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    expect(sendGcode).toHaveBeenCalledWith('M114')
  })

  it('disables the prompt while Klipper is unreachable', () => {
    // Not connected: no ready() call.
    seed()
    expect(mountView().get('textarea').attributes('disabled')).toBeDefined()
  })

  it('asks before clearing the transcript, then disables the control when empty', async () => {
    ready()
    const gcodeConsole = seed()
    const wrapper = mountView()
    const clear = wrapper.findAll('.console-toolbar__actions button')[3]

    expect(clear?.attributes('disabled')).toBeUndefined()
    await clear?.trigger('click')
    await flushPromises()
    // Clearing writes a printer-wide cutoff that keeps Moonraker's retained
    // output hidden for good, so it is not a press that can be taken back.
    expect(gcodeConsole.consoleEntries).toHaveLength(3)

    await wrapper
      .get('.confirm-dialog[open] .confirm-dialog__actions .button--danger')
      .trigger('click')
    expect(gcodeConsole.consoleEntries).toEqual([])
    await flushPromises()
    expect(
      wrapper.findAll('.console-toolbar__actions button')[3]?.attributes('disabled'),
    ).toBeDefined()
  })

  it('clears without asking once the shared confirmation is skipped', async () => {
    ready()
    const gcodeConsole = seed()
    useConfirmationsStore().setSkip('clearConsole', true)
    const wrapper = mountView()

    await wrapper.findAll('.console-toolbar__actions button')[3]?.trigger('click')
    await flushPromises()

    expect(gcodeConsole.consoleEntries).toEqual([])
    expect(wrapper.find('.confirm-dialog[open]').exists()).toBe(false)
  })

  it('says how much typed history it holds, and forgets it only after asking', async () => {
    ready()
    const gcodeConsole = seed()
    await gcodeConsole.sendConsoleCommand('yarrr')
    const wrapper = mountView()
    await wrapper.findAll('.console-toolbar__actions button')[1]?.trigger('click')

    const aside = wrapper.get('.console-aside')
    expect(aside.text()).toContain('1 remembered')

    const forget = aside
      .findAll('button')
      .find((button) => button.text() === 'Clear command history')
    expect(forget?.attributes('disabled')).toBeUndefined()
    await forget?.trigger('click')
    await flushPromises()
    expect(gcodeConsole.commandHistory).toHaveLength(1)

    await wrapper
      .get('.confirm-dialog[open] .confirm-dialog__actions .button--danger')
      .trigger('click')
    expect(gcodeConsole.commandHistory).toEqual([])
    await flushPromises()
    expect(wrapper.get('.console-aside').text()).toContain('Nothing typed at this printer yet')
  })

  it('offers nothing to forget when no command has been typed at this printer', async () => {
    ready()
    seed()
    const wrapper = mountView()
    await wrapper.findAll('.console-toolbar__actions button')[1]?.trigger('click')

    const forget = wrapper
      .get('.console-aside')
      .findAll('button')
      .find((button) => button.text() === 'Clear command history')
    expect(forget?.attributes('disabled')).toBeDefined()
  })

  it('lists sent commands newest first, narrows them by search, and puts a pick back in the prompt', async () => {
    ready()
    const gcodeConsole = seed()
    gcodeConsole.commandHistory = ['G28', 'BED_MESH_CALIBRATE', 'M114']
    const wrapper = mountView()
    const sendGcode = vi.spyOn(gcodeConsole, 'sendConsoleCommand')
    await wrapper.findAll('.console-toolbar__actions button')[1]?.trigger('click')

    const aside = wrapper.get('.console-aside')
    const listed = () =>
      aside.findAll('.console-browser__list button').map((button) => button.text())
    expect(listed()).toEqual(['M114', 'BED_MESH_CALIBRATE', 'G28'])

    await aside.get('.console-browser__search').setValue('bed_mesh')
    expect(listed()).toEqual(['BED_MESH_CALIBRATE'])

    await aside.get('.console-browser__list button').trigger('click')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe(
      'BED_MESH_CALIBRATE',
    )
    expect(sendGcode).not.toHaveBeenCalled()
  })
})
