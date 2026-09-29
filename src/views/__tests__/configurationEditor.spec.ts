import { EditorView } from '@codemirror/view'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { useConfigFileHistory } from '@/composables/useConfigFileHistory'
import { useEditorIndent } from '@/composables/useEditorIndent'
import { i18n } from '@/i18n'
import { useAvailabilityStore } from '@/stores/availability'
import { useMachineFilesStore } from '@/stores/machineFiles'
import { useMoonrakerStore } from '@/stores/moonraker'
import ConfigurationView from '@/views/ConfigurationView.vue'

enableAutoUnmount(afterEach)

beforeAll(() => {
  // CodeMirror measures text through a Range on the next animation frame, and
  // jsdom's Range has no layout methods. Without them the frame throws after
  // the test that scheduled it, and only when the suite is slow enough for the
  // frame to land while an editor is still mounted.
  const rangePrototype = window.Range.prototype as unknown as Record<string, unknown>
  if (typeof rangePrototype.getClientRects !== 'function') {
    rangePrototype.getClientRects = () => []
    rangePrototype.getBoundingClientRect = () => new DOMRect()
  }
})

/** Roughly the shape of a sliced file or a Klipper log: long, and not a config. */
const hugeLog = Array.from({ length: 20_000 }, (_, index) => `G1 X${index} Y${index} E0.02`).join(
  '\n',
)

const configFile = ['[stepper_x]', 'step_pin: X_STEP', 'enable_pin: !X_EN', ''].join('\n')

const configListing = {
  dirs: [],
  files: [{ filename: 'printer.cfg', modified: 20, size: configFile.length, permissions: 'rw' }],
  disk_usage: { total: 1000, used: 400, free: 600 },
  root_info: { name: 'config', permissions: 'rw' },
} as never

const logsListing = {
  dirs: [],
  files: [{ filename: 'klippy.log', modified: 20, size: hugeLog.length, permissions: 'r' }],
  disk_usage: { total: 1000, used: 400, free: 600 },
  root_info: { name: 'logs', permissions: 'r' },
} as never

let pinia: Pinia

function stubFetch(body: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(body))),
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  // Module-level state (it must survive leaving and returning to the
  // Configuration route), so it outlives `createPinia()` and one test's
  // trail leaks into the next unless cleared explicitly.
  useConfigFileHistory().resetFileHistory()
  pinia = createPinia()
  setActivePinia(pinia)
  const moonraker = useMoonrakerStore(pinia)
  moonraker.connectionPhase = 'connected'
  useAvailabilityStore(pinia).moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
})

/**
 * `attach` puts the view in the real document, which only the dialog-versus-
 * window-keydown test needs: the guard that keeps Escape from reaching both asks
 * the document whether any `<dialog>` is open, and a detached mount has none.
 */
async function openConfigFile({ attach = false } = {}) {
  const moonraker = useMoonrakerStore(pinia)
  vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(configListing)
  stubFetch(configFile)
  const view = mount(ConfigurationView, {
    attachTo: attach ? document.body : undefined,
    global: { plugins: [i18n, pinia] },
  })
  await flushPromises()
  await useMachineFilesStore(pinia).openFile({
    kind: 'file',
    name: 'printer.cfg',
    size: configFile.length,
    modified: 20,
    permissions: 'rw',
  })
  await flushPromises()
  return view
}

/**
 * Places the caret (or a selection) in the open file and presses one key, the
 * way the editor's own keymap sees it. Returns the event too, so a test can
 * assert what the editor did *not* claim.
 */
async function press(
  view: VueWrapper,
  content: string,
  selection: [number, number],
  init: KeyboardEventInit,
): Promise<{ content: string; event: KeyboardEvent }> {
  const files = useMachineFilesStore(pinia)
  files.editorContent = content
  await nextTick()
  const editor = editorView(view)
  editor.dispatch({ selection: { anchor: selection[0], head: selection[1] } })
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  editor.contentDOM.dispatchEvent(event)
  await nextTick()
  return { content: files.editorContent, event }
}

/** The CodeMirror view behind the editor component, which owns the document. */
function editorView(view: VueWrapper): EditorView {
  const element = view.find('.cm-editor').element as HTMLElement
  const found = EditorView.findFromDOM(element)
  if (!found) throw new Error('the editor is not mounted')
  return found
}

async function openLogFile() {
  const moonraker = useMoonrakerStore(pinia)
  vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(logsListing)
  stubFetch(hugeLog)
  const view = mount(ConfigurationView, { global: { plugins: [i18n, pinia] } })
  await flushPromises()
  const files = useMachineFilesStore(pinia)
  await files.setRoot('logs')
  await flushPromises()
  await files.openFile({
    kind: 'file',
    name: 'klippy.log',
    size: hugeLog.length,
    modified: 20,
    permissions: 'r',
  })
  await nextTick()
  return view
}

describe('the code editor renders a window, not a file', () => {
  /**
   * A log is not a Klipper config file, and colouring it against that grammar
   * invents structure: a capitalised first word becomes a command, `key: value`
   * inside a stack trace becomes a property.
   */
  it('shows a log as plain text', async () => {
    const view = await openLogFile()

    for (const kind of ['command', 'parameter', 'section', 'key', 'comment']) {
      expect(view.findAll(`.machine-syntax--${kind}`), kind).toHaveLength(0)
    }
    // Still shown — plain, not withheld.
    expect(editorView(view).state.doc.line(1).text).toContain('G1 X0 Y0')
  })

  /**
   * The whole file is in the document even though only a viewport of it is in
   * the DOM. The editor this replaced held the file in a textarea and mounted a
   * hand-rolled window of coloured rows beside it, and the two could disagree;
   * here there is one document and the rendering is CodeMirror's business.
   */
  it('holds the whole file while rendering a fraction of it', async () => {
    const view = await openLogFile()

    expect(editorView(view).state.doc.lines).toBe(20_000)
    expect(view.findAll('.cm-line').length).toBeLessThan(20_000)
  })

  it('colors a config file in the config root', async () => {
    const view = await openConfigFile()

    expect(view.find('.machine-syntax--section').text()).toBe('[stepper_x]')
    expect(view.find('.machine-syntax--key').exists()).toBe(true)
    // An inverted pin keeps its own color — the safety-relevant token.
    expect(view.find('.machine-syntax--pin').text()).toBe('!X_EN')
  })

  it('does not mount the section outline while it is collapsed', async () => {
    const view = await openConfigFile()

    expect(view.find('#machine-file-structure').exists()).toBe(false)
    await view.find('[aria-controls="machine-file-structure"]').trigger('click')
    expect(view.find('#machine-file-structure').exists()).toBe(true)
  })

  it('offers no outline for a file whose brackets are not sections', async () => {
    const view = await openLogFile()

    expect(view.find('[aria-controls="machine-file-structure"]').exists()).toBe(false)
  })
})

describe('the editor indents with spaces', () => {
  beforeEach(() => {
    useEditorIndent().setIndentWidth(2)
  })

  async function typeInto(view: VueWrapper, content: string, key: string): Promise<string> {
    const { content: after } = await press(view, content, [content.length, content.length], { key })
    return after
  }

  it('inserts spaces rather than a tab when Tab is pressed', async () => {
    const view = await openConfigFile()

    const content = await typeInto(view, '[stepper_x]\n', 'Tab')

    expect(content).toBe('[stepper_x]\n  ')
    expect(content).not.toContain('\t')
  })

  it('inserts the width the reader chose', async () => {
    const view = await openConfigFile()
    useEditorIndent().setIndentWidth(8)

    expect(await typeInto(view, '[stepper_x]\n', 'Tab')).toBe(`[stepper_x]\n${' '.repeat(8)}`)
  })

  /*
   * Not a fixed run of the width: a run inserted mid-line leaves everything
   * after it off the grid, and the continuation lines under it stop aligning.
   */
  it('pads to the next tab stop rather than by a fixed run', async () => {
    const view = await openConfigFile()
    useEditorIndent().setIndentWidth(4)

    expect(await typeInto(view, 'ab', 'Tab')).toBe('ab  ')
  })

  /* The line a `gcode:` block opens under — the one that used to get a tab. */
  it('opens a property with no value yet one level deep, in spaces', async () => {
    const view = await openConfigFile()

    expect(await typeInto(view, '[gcode_macro TEST]\ngcode:', 'Enter')).toBe(
      '[gcode_macro TEST]\ngcode:\n  ',
    )
  })

  /*
   * The preference governs what the editor inserts, never what it rewrites: a
   * file opened to read one value out of must not have its neighboring lines
   * re-indented to a width chosen after they were written.
   */
  it('repeats an existing tab indent rather than converting it', async () => {
    const view = await openConfigFile()

    expect(await typeInto(view, '[gcode_macro TEST]\n\tG28', 'Enter')).toBe(
      '[gcode_macro TEST]\n\tG28\n\t',
    )
  })
})

describe('the editor’s line commands', () => {
  beforeEach(() => {
    useEditorIndent().setIndentWidth(2)
  })

  it('comments the caret’s line and uncomments it again', async () => {
    const view = await openConfigFile()
    const key = { key: '/', ctrlKey: true }

    const commented = await press(view, '  G28', [4, 4], key)
    expect(commented.content).toBe('  # G28')

    const restored = await press(view, '  # G28', [4, 4], key)
    expect(restored.content).toBe('  G28')
  })

  it('moves the caret’s line down past the next one', async () => {
    const view = await openConfigFile()

    const result = await press(view, 'first\nsecond', [0, 0], {
      key: 'ArrowDown',
      altKey: true,
    })

    expect(result.content).toBe('second\nfirst')
  })

  it('duplicates the caret’s line', async () => {
    const view = await openConfigFile()

    const result = await press(view, 'G28', [3, 3], {
      key: 'ArrowDown',
      altKey: true,
      shiftKey: true,
    })

    expect(result.content).toBe('G28\nG28')
  })

  it('indents a selection that spans lines rather than replacing it', async () => {
    const view = await openConfigFile()

    const result = await press(view, 'G28\nG1 Z10', [0, 10], { key: 'Tab' })

    expect(result.content).toBe('  G28\n  G1 Z10')
  })

  it('outdents a selection that spans lines', async () => {
    const view = await openConfigFile()

    const result = await press(view, '  G28\n  G1 Z10', [0, 14], {
      key: 'Tab',
      shiftKey: true,
    })

    expect(result.content).toBe('G28\nG1 Z10')
  })

  /*
   * Tab inside a textarea already costs a keyboard-only reader their way
   * forward out of the editor. Shift+Tab on a line with no indentation to
   * remove has to stay the browser's, or there is no way out at all.
   */
  it('leaves Shift+Tab to the browser when there is nothing to outdent', async () => {
    const view = await openConfigFile()

    const result = await press(view, '[stepper_x]', [11, 11], {
      key: 'Tab',
      shiftKey: true,
    })

    expect(result.content).toBe('[stepper_x]')
    expect(result.event.defaultPrevented).toBe(false)
  })

  /*
   * Ctrl+Shift+S was unusable: a screen-capture tool holds it globally on
   * Windows, and a global hotkey never reaches the page at all.
   */
  it('saves on Ctrl+S and saves-and-restarts on Ctrl+Alt+S', async () => {
    const view = await openConfigFile()
    // Restarting the firmware needs Klipper available, which is Moonraker
    // connected, Klipper ready, *and* the first subscription synchronized.
    useAvailabilityStore(pinia).printerSnapshotSynchronized()
    const files = useMachineFilesStore(pinia)
    const saveFile = vi.spyOn(files, 'saveFile').mockResolvedValue(true)
    files.editorContent = `${configFile}# edited`
    await nextTick()
    const element = editorView(view).contentDOM

    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }),
    )
    await flushPromises()
    expect(saveFile).toHaveBeenLastCalledWith(false)

    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 's',
        ctrlKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    await flushPromises()
    expect(saveFile).toHaveBeenLastCalledWith(true)

    /*
     * And Shift is nobody's here. Falling through to a plain save would write a
     * half-edited config to the printer because someone reached for a
     * screenshot; the press is left un-prevented so whatever wants it gets it.
     */
    saveFile.mockClear()
    const screenshot = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    element.dispatchEvent(screenshot)
    await flushPromises()
    expect(saveFile).not.toHaveBeenCalled()
    expect(screenshot.defaultPrevented).toBe(false)
  })

  it('fixes the indentation throughout the file', async () => {
    const view = await openConfigFile()

    const result = await press(
      view,
      ['  [stepper_x]', 'gcode:', '\t\tG28', '\t\t\tM117 nested   '].join('\n'),
      [0, 0],
      { key: 'F', altKey: true, shiftKey: true },
    )

    expect(result.content).toBe(['[stepper_x]', 'gcode:', '  G28', '    M117 nested'].join('\n'))
  })

  /*
   * Every one of these commands asserts something about Klipper's format — `#` is
   * its comment marker, a continuation block is its indentation rule — so a
   * `.txt` sitting in the config root gets none of them. Typing still behaves:
   * the soft tab is whitespace and claims nothing about the format.
   */
  it('leaves a file that is not a config alone', async () => {
    const view = await openConfigFile()
    const files = useMachineFilesStore(pinia)
    await files.openFile({
      kind: 'file',
      name: 'notes.txt',
      size: 10,
      modified: 20,
      permissions: 'rw',
    })
    await flushPromises()

    expect((await press(view, '  G28', [4, 4], { key: '/', ctrlKey: true })).content).toBe('  G28')
    expect(
      (await press(view, '\t\tG28', [0, 0], { key: 'F', altKey: true, shiftKey: true })).content,
    ).toBe('\t\tG28')
    expect((await press(view, 'a\nb', [0, 3], { key: 'ArrowDown', altKey: true })).content).toBe(
      'a\nb',
    )
    // Typing is not a command, and still inserts spaces rather than a tab.
    expect((await press(view, 'G28', [3, 3], { key: 'Tab' })).content).toBe('G28 ')
  })

  /*
   * A read-only file is read-only to the commands too, not just to typing.
   * Marking the view uneditable stops the browser writing into it and says
   * nothing to a command that dispatches a transaction itself, so both halves
   * have to be set — and reconfigured together when the open file changes.
   */
  it('refuses a command on a file the printer will not let us write', async () => {
    const view = await openConfigFile()
    const files = useMachineFilesStore(pinia)
    await files.openFile({
      kind: 'file',
      name: 'readonly.cfg',
      size: 10,
      modified: 20,
      permissions: 'r',
    })
    await flushPromises()

    expect(editorView(view).state.readOnly).toBe(true)
    expect((await press(view, '  G28', [4, 4], { key: '/', ctrlKey: true })).content).toBe('  G28')
  })

  /* Nothing here may act on a file the printer will not let us write. */
  it('does nothing at all in a read-only file', async () => {
    const view = await openLogFile()
    const files = useMachineFilesStore(pinia)
    const before = files.editorContent

    const editor = editorView(view)
    editor.dispatch({ selection: { anchor: 0 } })
    editor.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: '/', ctrlKey: true, bubbles: true, cancelable: true }),
    )
    await nextTick()

    expect(files.editorContent).toBe(before)
  })
})

describe('finding the editor’s shortcuts', () => {
  beforeEach(() => {
    // jsdom ships <dialog> without its modal methods.
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

  function reference(view: VueWrapper) {
    return view.find('.editor-shortcuts-dialog').element as HTMLDialogElement
  }

  /*
   * The reason this dialog exists: the line commands were keyboard-only and
   * nothing in the interface named them, so the header needs a way in that does
   * not require already knowing the chord.
   */
  it('opens from the editor header', async () => {
    const view = await openConfigFile()
    const trigger = view
      .findAll('.machine-editor-actions button')
      .find((button) => button.attributes('aria-haspopup') === 'dialog')

    expect(trigger).toBeDefined()
    await trigger!.trigger('click')

    expect(reference(view).open).toBe(true)
  })

  it('opens from the keyboard', async () => {
    const view = await openConfigFile()
    const element = editorView(view).contentDOM

    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: '?', ctrlKey: true, bubbles: true, cancelable: true }),
    )
    await nextTick()

    expect(reference(view).open).toBe(true)
  })

  /*
   * Ahead of the read-only gate: the shortcuts for reading a file apply to one
   * the printer will not let us write, and so does the list of them.
   */
  it('opens in a read-only file too', async () => {
    const view = await openLogFile()

    const element = editorView(view).contentDOM
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: '?', ctrlKey: true, bubbles: true, cancelable: true }),
    )
    await nextTick()

    expect(reference(view).open).toBe(true)
  })

  /*
   * An open dialog owns the keyboard. Both the dialog's cancel path and the
   * window handler used to answer the same Escape, so dismissing this list from
   * the fullscreen editor left fullscreen along with it.
   */
  it('does not take the editor out of fullscreen when it is dismissed', async () => {
    window.localStorage.setItem('alabaster.machine.editorDisplayMode', 'fullscreen')
    const view = await openConfigFile({ attach: true })
    expect(view.find('.machine-view--fullscreen').exists()).toBe(true)

    await view.find('.machine-editor-actions button[aria-haspopup="dialog"]').trigger('click')
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    await flushPromises()

    expect(view.find('.machine-view--fullscreen').exists()).toBe(true)
  })
})

describe('the mouse’s own back and forward buttons', () => {
  /** Buttons 3 and 4 are "browser back" and "browser forward". */
  function pressMouseButton(button: 3 | 4): MouseEvent {
    const event = new MouseEvent('mousedown', { button, bubbles: true, cancelable: true })
    window.dispatchEvent(event)
    return event
  }

  async function openSecondFile(): Promise<void> {
    await useMachineFilesStore(pinia).openFile({
      kind: 'file',
      name: 'macros.cfg',
      size: configFile.length,
      modified: 30,
      permissions: 'rw',
    })
    await flushPromises()
  }

  it('steps back through the files this route opened', async () => {
    await openConfigFile()
    await openSecondFile()
    const files = useMachineFilesStore(pinia)
    expect(files.currentFile?.name).toBe('macros.cfg')

    const event = pressMouseButton(3)
    await flushPromises()

    expect(event.defaultPrevented).toBe(true)
    expect(files.currentFile?.name).toBe('printer.cfg')
  })

  it('steps forward again', async () => {
    await openConfigFile()
    await openSecondFile()
    pressMouseButton(3)
    await flushPromises()

    const event = pressMouseButton(4)
    await flushPromises()

    expect(event.defaultPrevented).toBe(true)
    expect(useMachineFilesStore(pinia).currentFile?.name).toBe('macros.cfg')
  })

  /*
   * The rule the whole binding rests on: with nowhere to step, the button is
   * left to the browser. It is how some readers leave a page at all, so taking
   * it unconditionally would strand them here.
   */
  it('leaves the button to the browser with nowhere to step', async () => {
    await openConfigFile()

    expect(pressMouseButton(3).defaultPrevented).toBe(false)
    expect(pressMouseButton(4).defaultPrevented).toBe(false)
  })

  /*
   * The keyboard twin, and the reason it is Alt+arrow rather than Ctrl+Tab: the
   * browser reserves Ctrl+Tab and never delivers it, while Alt+arrow is its own
   * back/forward chord and a page may cancel it.
   */
  it('steps with Alt and the horizontal arrows', async () => {
    await openConfigFile()
    await openSecondFile()
    const files = useMachineFilesStore(pinia)

    const back = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(back)
    await flushPromises()

    expect(back.defaultPrevented).toBe(true)
    expect(files.currentFile?.name).toBe('printer.cfg')

    const forward = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(forward)
    await flushPromises()

    expect(forward.defaultPrevented).toBe(true)
    expect(files.currentFile?.name).toBe('macros.cfg')
  })

  it('leaves Alt and an arrow alone with nowhere to step', async () => {
    await openConfigFile()

    const event = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(event)
    await flushPromises()

    expect(event.defaultPrevented).toBe(false)
  })

  it('ignores every other mouse button', async () => {
    await openConfigFile()
    await openSecondFile()

    for (const button of [0, 1, 2] as const) {
      const event = new MouseEvent('mousedown', { button, bubbles: true, cancelable: true })
      window.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(useMachineFilesStore(pinia).currentFile?.name).toBe('macros.cfg')
  })

  /* One click steps once: the release and the auxclick after a claimed press are
   * swallowed rather than acted on a second time. */
  it('steps once per click', async () => {
    await openConfigFile()
    await openSecondFile()
    const files = useMachineFilesStore(pinia)

    pressMouseButton(3)
    window.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true }))
    window.dispatchEvent(new MouseEvent('auxclick', { button: 3, bubbles: true, cancelable: true }))
    await flushPromises()

    expect(files.currentFile?.name).toBe('printer.cfg')
  })

  /*
   * The defect this pins: the trail used to live in a component-local ref, so
   * leaving the Configuration route and coming back reset it to empty even
   * though the store's open file never closed.
   */
  it('survives leaving and returning to the route', async () => {
    const view = await openConfigFile()
    await openSecondFile()
    view.unmount()

    const secondView = mount(ConfigurationView, { global: { plugins: [i18n, pinia] } })
    await flushPromises()

    const back = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(back)
    await flushPromises()

    expect(back.defaultPrevented).toBe(true)
    expect(useMachineFilesStore(pinia).currentFile?.name).toBe('printer.cfg')
    secondView.unmount()
  })

  /*
   * The defect this pins: the trail only grew on a *change* of the open file,
   * so a file already open when the route mounts — the first selection of a
   * session, or one left open from before an earlier visit — was never itself
   * a step, leaving back with one fewer place to land than the user expects.
   */
  it('records the file already open when the route mounts', async () => {
    const files = useMachineFilesStore(pinia)
    const moonraker = useMoonrakerStore(pinia)
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(configListing)
    stubFetch(configFile)
    await files.openFile({
      kind: 'file',
      name: 'printer.cfg',
      size: configFile.length,
      modified: 20,
      permissions: 'rw',
    })
    await flushPromises()
    useConfigFileHistory().resetFileHistory()

    const view = mount(ConfigurationView, { global: { plugins: [i18n, pinia] } })
    await flushPromises()
    await openSecondFile()

    const back = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(back)
    await flushPromises()

    expect(back.defaultPrevented).toBe(true)
    expect(files.currentFile?.name).toBe('printer.cfg')
    view.unmount()
  })
})
