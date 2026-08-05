import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import ConsoleModule from '@/components/dashboard/modules/ConsoleModule.vue'
import {
  dashboardModuleContextKey,
  dashboardModuleHeaderActionKey,
  type DashboardModuleHeaderAction,
} from '@/dashboard/context'
import { i18n } from '@/i18n'
import { consoleEntryFromCommand, consoleEntryFromResponse } from '@/services/console/transcript'
import { useAvailabilityStore } from '@/stores/availability'
import { useConfirmationsStore } from '@/stores/confirmations'
import { useConsoleStore } from '@/stores/console'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import { useToastsStore } from '@/stores/toasts'

function mountModule(config: Record<string, unknown> = {}) {
  const availability = useAvailabilityStore()
  availability.transportState = 'connected'
  availability.klipperState = 'ready'
  availability.subscriptionState = 'ready'

  const printer = usePrinterStore()
  const gcodeConsole = useConsoleStore()
  gcodeConsole.consoleEntries = [
    consoleEntryFromCommand('G28', 1, 1_700_000_000_000),
    consoleEntryFromResponse('// Klipper state: Ready', 2, 1_700_000_001_000),
    consoleEntryFromResponse('ok T:24.1 /0.0', 3, 1_700_000_002_000),
  ]

  const stored = ref<Record<string, unknown>>({ ...config })
  const settingsOpen = ref(false)
  const headerAction = ref<DashboardModuleHeaderAction | null>(null)
  const wrapper = mount(ConsoleModule, {
    global: {
      plugins: [i18n],
      stubs: { RouterLink: { template: '<a><slot></slot></a>' } },
      provide: {
        [dashboardModuleContextKey as symbol]: {
          instanceId: 'console',
          moduleId: 'console',
          config: computed(() => stored.value),
          updateConfig: (patch: Record<string, unknown>) => {
            stored.value = { ...stored.value, ...patch }
          },
          isSettingsOpen: computed(() => settingsOpen.value),
          openSettings: () => {
            settingsOpen.value = true
          },
          closeSettings: () => {
            settingsOpen.value = false
          },
          isSurfaceOpen: computed(() => false),
          openSurface: () => undefined,
          closeSurface: () => undefined,
        },
        [dashboardModuleHeaderActionKey as symbol]: {
          setHeaderAction: (action: DashboardModuleHeaderAction | null) => {
            headerAction.value = action
          },
        },
      },
    },
  })
  return { wrapper, printer, gcodeConsole, stored, settingsOpen, headerAction }
}

beforeAll(() => {
  // jsdom ships <dialog> without its modal methods, so the clear confirmation's
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

describe('ConsoleModule', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('hides temperature reports by default, since they are the bulk of the noise', () => {
    const { wrapper } = mountModule()
    expect(wrapper.findAll('.gcode-console__line')).toHaveLength(2)
    expect(wrapper.text()).not.toContain('T:24.1')
  })

  it('clamps a hand-edited line count instead of sizing the card from it', () => {
    // The value lives in a profile a user can edit by hand; an absurd count would
    // either collapse the card or push everything below it off the dashboard.
    expect(
      mountModule({ visibleLines: 400 }).wrapper.get('.gcode-console').attributes('style'),
    ).toContain('--console-lines: 100')
    expect(
      mountModule({ visibleLines: 1 }).wrapper.get('.gcode-console').attributes('style'),
    ).toContain('--console-lines: 5')
    // Past the slider's span but within what the field accepts, so it survives.
    expect(
      mountModule({ visibleLines: 40 }).wrapper.get('.gcode-console').attributes('style'),
    ).toContain('--console-lines: 40')
    expect(
      mountModule({ visibleLines: 'twelve' }).wrapper.get('.gcode-console').attributes('style'),
    ).toContain('--console-lines: 12')
  })

  it('sends through the store, which echoes before the command is dispatched', async () => {
    const { wrapper, gcodeConsole } = mountModule()
    const send = vi.spyOn(gcodeConsole, 'sendConsoleCommand').mockResolvedValue(true)
    await wrapper.get('textarea').setValue('M114')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    expect(send).toHaveBeenCalledWith('M114')
  })

  it('puts a clicked command back in the prompt', async () => {
    const { wrapper } = mountModule()
    await wrapper.get('.gcode-console__command').trigger('click')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('G28')
  })

  it('reveals its quick settings and a way to the page, not a second copy of it', async () => {
    const { wrapper, settingsOpen } = mountModule()
    expect(wrapper.find('.module-settings').exists()).toBe(false)

    settingsOpen.value = true
    await wrapper.vm.$nextTick()
    const rows = wrapper.findAll('.check-row')
    expect(rows.map((row) => row.text())).toEqual([
      'Hide temperature reports',
      'Show timestamps',
      'Compact rows',
    ])
    // Reading back through history and browsing commands are the page's job.
    expect(wrapper.get('.module-settings a').text()).toBe('Open the console page')
  })

  it('puts its disclosure layer first, the way every other module does', async () => {
    const { wrapper, settingsOpen } = mountModule()
    settingsOpen.value = true
    await wrapper.vm.$nextTick()

    // Document order, not sibling index: the card body root is
    // `AppDashboardModule`'s own generic element now, and this module
    // contributes no class of its own to it, so what the rule actually says —
    // the panel comes before the transcript — is asserted directly rather
    // than through whichever wrapper depth the shell happens to use.
    const panel = wrapper.get('.module-settings').element
    const body = wrapper.get('.console-module__body').element
    expect(panel.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('moves the prompt above the transcript without remounting either', async () => {
    const { wrapper, stored } = mountModule()
    expect(wrapper.get('.console-module__body').classes()).not.toContain(
      'console-module__body--input-top',
    )
    expect(wrapper.get('.gcode-console').classes()).toContain('gcode-console--anchored')

    // A half-typed command must survive the move, which is why the order is a
    // flex reversal on one DOM order rather than two branches of markup.
    await wrapper.get('textarea').setValue('SET_FAN_SPE')
    stored.value = { ...stored.value, inputPosition: 'top' }
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.console-module__body').classes()).toContain(
      'console-module__body--input-top',
    )
    expect(wrapper.get('.gcode-console').classes()).not.toContain('gcode-console--anchored')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('SET_FAN_SPE')
  })

  it('offers the card header a clear action, disabled once the transcript is empty', async () => {
    const { wrapper, gcodeConsole, headerAction } = mountModule()

    expect(headerAction.value?.icon).toBe('trash')
    expect(headerAction.value?.disabled).toBe(false)

    // A trash icon between Settings and Collapse is a plausible misclick, and
    // what it costs — Moonraker's retained output from before the cutoff — is
    // not recoverable from anywhere, so the transcript survives the press
    // itself.
    headerAction.value?.onClick()
    await flushPromises()
    expect(gcodeConsole.consoleEntries).toHaveLength(3)
    expect(wrapper.find('.confirm-dialog[open]').exists()).toBe(true)

    await wrapper.get('.confirm-dialog__actions .button--danger').trigger('click')
    expect(gcodeConsole.consoleEntries).toEqual([])

    await wrapper.vm.$nextTick()
    expect(headerAction.value?.disabled).toBe(true)
  })

  it('cancelling the clear leaves the transcript alone', async () => {
    const { wrapper, gcodeConsole, headerAction } = mountModule()

    headerAction.value?.onClick()
    await flushPromises()
    await wrapper.get('.confirm-dialog__actions .button:not(.button--danger)').trigger('click')

    expect(gcodeConsole.consoleEntries).toHaveLength(3)
    expect(wrapper.find('.confirm-dialog[open]').exists()).toBe(false)
  })

  it('clears without asking once the shared confirmation is skipped', async () => {
    const { wrapper, gcodeConsole, headerAction } = mountModule()
    // The page's toolbar clears the same transcript, so the setting is the
    // shared page-level key rather than one of this module's own.
    useConfirmationsStore().setSkip('clearConsole', true)

    headerAction.value?.onClick()
    await flushPromises()

    expect(gcodeConsole.consoleEntries).toEqual([])
    expect(wrapper.find('.confirm-dialog[open]').exists()).toBe(false)
  })

  it('holds sending while a command is in flight, rather than echoing one it drops', async () => {
    const { wrapper, printer, gcodeConsole } = mountModule()
    const moonraker = useMoonrakerStore()
    let release: (() => void) | undefined
    const dispatched: string[] = []
    vi.spyOn(moonraker, 'rpcCall').mockImplementation(((
      _method: string,
      params: { script: string },
    ) => {
      dispatched.push(params.script)
      return new Promise((resolve) => {
        release = () => resolve('ok')
      })
    }) as never)

    await wrapper.get('textarea').setValue('BED_MESH_CALIBRATE')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(printer.pendingCommands.console).toBe(true)

    // Enter, not the button: the button was always disabled here, and the
    // keyboard walking past that guard is what put a command in the transcript
    // that Moonraker never received.
    await wrapper.get('textarea').setValue('M115')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(dispatched).toEqual(['BED_MESH_CALIBRATE'])
    expect(gcodeConsole.consoleEntries.filter((entry) => entry.kind === 'command')).toHaveLength(2)
    expect(gcodeConsole.consoleEntries.map((entry) => entry.message)).not.toContain('M115')
    // The draft is kept, so the held command is one Enter away once the printer
    // answers rather than something the user has to retype.
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('M115')
    expect(wrapper.get('button[type="submit"]').attributes('data-pending')).toBe('true')

    release?.()
    await flushPromises()
  })

  it('waives the transport deadline for a typed line, whose duration it cannot know', async () => {
    const { wrapper } = mountModule()
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)

    // Not a homing script, which is the only command `sendGcode` recognized as
    // slow — a bed mesh, a probe accuracy run or an `M190` outlives the
    // sixty-second default just as easily.
    await wrapper.get('textarea').setValue('BED_MESH_CALIBRATE')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(rpcCall).toHaveBeenCalledWith(
      'printer.gcode.script',
      { script: 'BED_MESH_CALIBRATE' },
      { timeoutMs: null },
    )
  })

  it('reports a refused command without hiding what was sent', async () => {
    const { wrapper } = mountModule()
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockRejectedValue(new Error('Klipper refused'))

    await wrapper.get('textarea').setValue('BAD_COMMAND')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    // The refused command still shows in the transcript, and the failure
    // itself is a toast now — a global notice, not a paragraph on this card.
    expect(wrapper.text()).toContain('BAD_COMMAND')
    const toasts = useToastsStore()
    expect(toasts.entries).toHaveLength(1)
    expect(toasts.entries[0]?.message).toContain('Klipper refused')
  })
})
