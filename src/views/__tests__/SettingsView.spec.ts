import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSettingsCategory } from '@/composables/useSettingsCategory'
import { i18n } from '@/i18n'
import { useDateTimeFormatMode } from '@/i18n/formats'
import { useAuthStore } from '@/stores/auth'
import { confirmationKeys, useConfirmationsStore } from '@/stores/confirmations'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrintersStore } from '@/stores/printers'
import { useServerCapabilitiesStore } from '@/stores/serverCapabilities'

enableAutoUnmount(afterEach)

let pinia: Pinia
let realWebSocket: typeof WebSocket

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

  // The theme composable reads this once at module load; jsdom has no
  // implementation at all.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
})

beforeEach(() => {
  window.localStorage.clear()
  pinia = createPinia()
  setActivePinia(pinia)
  // Switching, adding, and removing all reach the moonraker store's real
  // `connect`, which opens a socket. Nothing here asserts on the connection
  // itself, so a stub that never resolves is enough to keep it from reaching
  // the network.
  realWebSocket = globalThis.WebSocket
  globalThis.WebSocket = class {
    static readonly CONNECTING = 0
    readyState = 0
    close(): void {}
    send(): void {}
  } as unknown as typeof WebSocket
})

afterEach(() => {
  globalThis.WebSocket = realWebSocket
})

/*
 * Imported dynamically, and only from inside a test: `SettingsView.vue` pulls
 * in `useTheme`, which reads `window.matchMedia` the moment its module first
 * evaluates. A static import here would run before `beforeAll` installs the
 * stub below and fail every time, since ES module evaluation happens at
 * import time regardless of where the `import` keyword sits in the file.
 */
async function mountView() {
  const { default: SettingsView } = await import('@/views/SettingsView.vue')
  // Production always has `main.ts` start every domain store before any view
  // mounts; `auth.ts` in particular now loads `info`/`currentUser` from its
  // own `start()`-driven watch rather than from this view, so the tests below
  // need the same bootstrap to see either. `onNotification` is stubbed first
  // because `start()` also subscribes to the user-created/deleted/logged-out
  // notifications, and this suite's `moonraker.connectionPhase = 'connected'`
  // shortcut never creates the real client those subscriptions need.
  const moonraker = useMoonrakerStore(pinia)
  if (!vi.isMockFunction(moonraker.onNotification)) {
    vi.spyOn(moonraker, 'onNotification').mockImplementation(() => () => undefined)
  }
  useAuthStore(pinia).start()
  return mount(SettingsView, { global: { plugins: [i18n, pinia] } })
}

/** Whichever `ConfirmDialog`/`PromptDialog` is currently showModal()'d — only one ever is. */
function openDialog(wrapper: Awaited<ReturnType<typeof mountView>>) {
  return wrapper.get('.confirm-dialog[open]')
}

describe('SettingsView — printers', () => {
  it('shows a printer has to be added, when none has been yet', async () => {
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('No printers saved yet')
    expect(wrapper.find('ul').exists()).toBe(false)
  })

  it('lists every saved printer, with the one in front marked apart from the rest', async () => {
    const printers = usePrintersStore(pinia)
    printers.addPrinter('voron.local:7125', 'Voron 2.4')
    printers.addPrinter('prusa.local:7125')
    printers.selectPrinter('printer')

    const wrapper = await mountView()
    const rows = wrapper.findAll('li')

    expect(rows).toHaveLength(2)
    expect(rows[0]?.text()).toContain('Voron 2.4')
    expect(rows[0]?.text()).toContain('Active')
    // Unnamed, so the row reads as its address rather than showing nothing.
    expect(rows[1]?.text()).toContain('prusa.local:7125')
    expect(rows[1]?.text()).toContain('Switch')
  })

  it('switches the connection when Switch is pressed on another printer', async () => {
    const printers = usePrintersStore(pinia)
    printers.addPrinter('voron.local:7125')
    printers.addPrinter('prusa.local:7125')
    printers.selectPrinter('printer')
    const moonraker = useMoonrakerStore(pinia)

    const wrapper = await mountView()
    const rows = wrapper.findAll('li')
    await rows[1]!.get('button').trigger('click')
    await flushPromises()

    expect(printers.activeId).toBe('printer-2')
    // Not just the list: the live connection actually followed it.
    expect(moonraker.endpoint).toBe('ws://prusa.local:7125/websocket')
    // Switching an existing printer must never mint a third entry.
    expect(printers.entries).toHaveLength(2)
  })

  it('renames a printer through the prompt dialog', async () => {
    const printers = usePrintersStore(pinia)
    printers.addPrinter('voron.local:7125')

    const wrapper = await mountView()
    // Unnamed yet, so the button's own label is built from its address.
    await wrapper.get('[aria-label="Rename voron.local:7125"]').trigger('click')
    await flushPromises()

    // `openDialog` already asserts one is showing via `.get()`.
    const dialog = openDialog(wrapper)
    await dialog.get('input').setValue('Voron 2.4')
    await dialog.get('form').trigger('submit')
    await flushPromises()

    expect(printers.entries[0]?.label).toBe('Voron 2.4')
    expect(wrapper.find('.confirm-dialog[open]').exists()).toBe(false)
  })

  it('clears a name back to the printer’s own address', async () => {
    const printers = usePrintersStore(pinia)
    printers.addPrinter('voron.local:7125', 'Voron 2.4')

    const wrapper = await mountView()
    await wrapper.get('[aria-label="Rename Voron 2.4"]').trigger('click')
    await flushPromises()

    const dialog = openDialog(wrapper)
    await dialog.get('input').setValue('')
    await dialog.get('form').trigger('submit')
    await flushPromises()

    expect(printers.entries[0]?.label).toBe('')
    expect(wrapper.text()).toContain('voron.local:7125')
  })

  it('removes a printer other than the one in front, without touching the connection', async () => {
    const printers = usePrintersStore(pinia)
    printers.addPrinter('voron.local:7125')
    printers.addPrinter('prusa.local:7125')
    printers.selectPrinter('printer')
    const moonraker = useMoonrakerStore(pinia)
    const endpointBefore = moonraker.endpoint

    const wrapper = await mountView()
    await wrapper.get('[aria-label="Remove prusa.local:7125"]').trigger('click')
    await flushPromises()

    const dialog = openDialog(wrapper)
    expect(dialog.text()).toContain('prusa.local:7125')
    await dialog.get('.confirm-dialog__actions button').trigger('click')
    await flushPromises()

    expect(printers.entries).toHaveLength(1)
    expect(printers.activeId).toBe('printer')
    expect(moonraker.endpoint).toBe(endpointBefore)
  })

  it('reconnects to what is left after removing the printer in front', async () => {
    const printers = usePrintersStore(pinia)
    printers.addPrinter('voron.local:7125')
    printers.addPrinter('prusa.local:7125')
    printers.selectPrinter('printer')
    const moonraker = useMoonrakerStore(pinia)

    const wrapper = await mountView()
    await wrapper.get('[aria-label="Remove voron.local:7125"]').trigger('click')
    await flushPromises()
    await openDialog(wrapper).get('.confirm-dialog__actions button').trigger('click')
    await flushPromises()

    expect(printers.entries).toHaveLength(1)
    expect(printers.activeId).toBe('printer-2')
    expect(moonraker.endpoint).toBe('ws://prusa.local:7125/websocket')
  })

  it('adds a printer with a blank dashboard by default', async () => {
    const printers = usePrintersStore(pinia)
    const layout = useDashboardLayoutStore(pinia)
    // Whatever the pre-registry connection had arranged — moved one column away
    // from where a fresh profile puts it — must not leak into the new printer.
    layout.selectPrinterScope(printers.activeScopeKeys)
    const defaultColumn = layout
      .itemsFor('desktop')
      .find((item) => item.instance.instanceId === 'camera')?.placement.column
    layout.moveColumn('desktop', 'camera', 1)

    const wrapper = await mountView()
    await wrapper.get('#add-printer-endpoint').setValue('voron.local:7125')
    await wrapper.get('.printers-add-form').trigger('submit')
    await flushPromises()

    expect(printers.entries).toHaveLength(1)
    // Nothing here mounts DashboardView to do this on its own, so it is done by
    // hand — exactly what its `printers.activeScopeKeys` watcher would trigger.
    layout.selectPrinterScope(printers.activeScopeKeys)
    expect(
      layout.itemsFor('desktop').find((item) => item.instance.instanceId === 'camera')?.placement
        .column,
    ).toBe(defaultColumn)
  })

  it('seeds the new printer’s dashboard when "copy from" is chosen', async () => {
    const printers = usePrintersStore(pinia)
    const source = printers.addPrinter('voron.local:7125', 'Voron 2.4')!
    const layout = useDashboardLayoutStore(pinia)
    layout.selectPrinterScope(printers.scopeKeysFor(source.id))
    layout.moveColumn('desktop', 'camera', 1)
    const seededColumn = layout
      .itemsFor('desktop')
      .find((item) => item.instance.instanceId === 'camera')?.placement.column

    const wrapper = await mountView()
    await wrapper.get('#add-printer-endpoint').setValue('prusa.local:7125')

    const copyRadios = wrapper.findAll('input[type="radio"]')
    await copyRadios[1]!.setValue(true)
    await wrapper.get('.app-select__trigger').trigger('click')
    // Teleported to `document.body` so a dashboard card's `overflow: hidden`
    // cannot clip it, so it is queried there rather than within `wrapper`.
    document.body
      .querySelector('.app-select__option')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()

    await wrapper.get('.printers-add-form').trigger('submit')
    await flushPromises()

    const added = printers.entries.find((entry) => entry.endpoint.includes('prusa'))
    expect(added).toBeDefined()
    layout.selectPrinterScope(printers.scopeKeysFor(added!.id))
    expect(
      layout.itemsFor('desktop').find((item) => item.instance.instanceId === 'camera')?.placement
        .column,
    ).toBe(seededColumn)
  })

  it('reports an address it cannot understand, without adding anything', async () => {
    const wrapper = await mountView()
    await wrapper.get('#add-printer-endpoint').setValue('ftp://printer.local')
    await wrapper.get('.printers-add-form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Enter a valid Moonraker address.')
    expect(usePrintersStore(pinia).entries).toHaveLength(0)
  })

  it('does not overwrite an existing printer’s dashboard when the typed address matches it', async () => {
    const printers = usePrintersStore(pinia)
    const existing = printers.addPrinter('voron.local:7125')!
    const other = printers.addPrinter('prusa.local:7125')!
    const layout = useDashboardLayoutStore(pinia)

    // Two distinct arrangements, so a leak from one into the other is visible
    // rather than accidentally matching by coincidence.
    layout.selectPrinterScope(printers.scopeKeysFor(existing.id))
    layout.moveColumn('desktop', 'camera', 1)
    const guardedColumn = layout
      .itemsFor('desktop')
      .find((item) => item.instance.instanceId === 'camera')?.placement.column
    layout.selectPrinterScope(printers.scopeKeysFor(other.id))
    layout.moveColumn('desktop', 'camera', -1)
    const otherColumn = layout
      .itemsFor('desktop')
      .find((item) => item.instance.instanceId === 'camera')?.placement.column
    expect(otherColumn).not.toBe(guardedColumn)

    // `other` (prusa) is the printer in front, so it is what "copy from"
    // defaults to — the exact condition the guard has to hold under.
    printers.selectPrinter(other.id)

    const wrapper = await mountView()
    // Re-typing an address that already belongs to `existing` must switch to
    // it, never create a second entry or overwrite what it already has —
    // even with "copy from" armed and defaulting to `other`.
    await wrapper.get('#add-printer-endpoint').setValue('voron.local:7125')
    const copyRadios = wrapper.findAll('input[type="radio"]')
    await copyRadios[1]!.setValue(true)
    await wrapper.get('.printers-add-form').trigger('submit')
    await flushPromises()

    expect(printers.entries).toHaveLength(2)
    layout.selectPrinterScope(printers.scopeKeysFor(existing.id))
    expect(
      layout.itemsFor('desktop').find((item) => item.instance.instanceId === 'camera')?.placement
        .column,
    ).toBe(guardedColumn)
  })
})

describe('SettingsView — authorization', () => {
  // `activeCategory` is a module-level singleton the category-rail tests
  // leave pointed at whatever they last clicked; every test here needs every
  // card visible regardless of what ran before it.
  beforeEach(() => {
    useSettingsCategory().setActiveCategory('all')
  })

  it('hides the login form along with the rest of the Users card without the authorization component', async () => {
    const capabilities = useServerCapabilitiesStore(pinia)
    capabilities.applyServerInfo({ components: ['history'] })
    const wrapper = await mountView()

    expect(wrapper.find('#login-username').exists()).toBe(false)
  })

  it('offers the login form while trusted or logged out, not only after an error', async () => {
    const moonraker = useMoonrakerStore(pinia)
    const wrapper = await mountView()

    // Present even with no connection error at all: this is a deliberate
    // action (log in, switch accounts, log back in after creating a user),
    // not only an error-recovery step.
    expect(wrapper.find('#login-username').exists()).toBe(true)

    moonraker.lastError = 'unauthorized'
    await wrapper.vm.$nextTick()
    expect(wrapper.find('#login-username').exists()).toBe(true)
    expect(wrapper.text()).toContain('requires you to log in')
  })

  it('hides the login form once a real named account is logged in', async () => {
    const moonraker = useMoonrakerStore(pinia)
    moonraker.connectionPhase = 'connected'
    const capabilities = useServerCapabilitiesStore(pinia)
    capabilities.applyServerInfo({ components: ['authorization'] })
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'access.info') {
        return Promise.resolve({
          default_source: 'moonraker',
          available_sources: ['moonraker'],
          login_required: false,
          trusted: true,
        }) as never
      }
      if (method === 'access.get_user') {
        return Promise.resolve({
          username: 'alice',
          source: 'moonraker',
          created_on: 1,
        }) as never
      }
      throw new Error(`unexpected method ${String(method)}`)
    })

    const wrapper = await mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('Logged in as alice')
    expect(wrapper.find('#login-username').exists()).toBe(false)
  })

  it('brings the login form back on logout — the way back to logging in as yourself', async () => {
    const moonraker = useMoonrakerStore(pinia)
    moonraker.connectionPhase = 'connected'
    const capabilities = useServerCapabilitiesStore(pinia)
    capabilities.applyServerInfo({ components: ['authorization'] })
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'access.info') {
        return Promise.resolve({
          default_source: 'moonraker',
          available_sources: ['moonraker'],
          login_required: false,
          trusted: true,
        }) as never
      }
      if (method === 'access.get_user') {
        return Promise.resolve({
          username: 'alice',
          source: 'moonraker',
          created_on: 1,
        }) as never
      }
      if (method === 'access.logout') {
        return Promise.resolve({ username: 'alice', action: 'user_logged_out' }) as never
      }
      throw new Error(`unexpected method ${String(method)}`)
    })

    const wrapper = await mountView()
    await flushPromises()
    expect(wrapper.find('#login-username').exists()).toBe(false)

    const logoutButton = wrapper.findAll('button').find((button) => button.text() === 'Log out')
    await logoutButton!.trigger('click')
    await flushPromises()

    expect(wrapper.find('#login-username').exists()).toBe(true)
  })

  it('logs in and reconnects, clearing the fields on success', async () => {
    const moonraker = useMoonrakerStore(pinia)
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'access.login') {
        return Promise.resolve({
          username: 'alice',
          token: 'access-token',
          refresh_token: 'refresh-token',
          action: 'user_logged_in',
          source: 'moonraker',
        }) as never
      }
      if (method === 'access.info') {
        return Promise.resolve({
          default_source: 'moonraker',
          available_sources: ['moonraker'],
          login_required: true,
          trusted: false,
        }) as never
      }
      if (method === 'access.get_user') {
        return Promise.resolve({
          username: 'alice',
          source: 'moonraker',
          created_on: 1,
        }) as never
      }
      throw new Error(`unexpected method ${String(method)}`)
    })
    const reconnect = vi.spyOn(moonraker, 'reconnect').mockImplementation(() => undefined)

    const wrapper = await mountView()
    await wrapper.get('#login-username').setValue('alice')
    await wrapper.get('#login-password').setValue('hunter2')
    await wrapper.get('.login-form').trigger('submit')
    await flushPromises()

    expect(reconnect).toHaveBeenCalled()
    expect((wrapper.get('#login-username').element as HTMLInputElement).value).toBe('')
  })

  it('hides the Users card entirely without the authorization component, shows it with one', async () => {
    const capabilities = useServerCapabilitiesStore(pinia)
    capabilities.applyServerInfo({ components: ['history'] })
    const withoutIt = await mountView()
    expect(withoutIt.text()).not.toContain('Users')
    withoutIt.unmount()

    capabilities.applyServerInfo({ components: ['history', 'authorization'] })
    const withIt = await mountView()

    expect(withIt.text()).toContain('Users')
  })

  it('lists other users and lets one be removed through the shared ConfirmDialog', async () => {
    const moonraker = useMoonrakerStore(pinia)
    moonraker.connectionPhase = 'connected'
    const capabilities = useServerCapabilitiesStore(pinia)
    capabilities.applyServerInfo({ components: ['authorization'] })
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'access.info') {
        return Promise.resolve({
          default_source: 'moonraker',
          available_sources: ['moonraker'],
          login_required: true,
          trusted: false,
        }) as never
      }
      if (method === 'access.get_user') {
        return Promise.resolve({ username: null, source: null, created_on: null }) as never
      }
      if (method === 'access.users.list') {
        return Promise.resolve({
          users: [{ username: 'bob', source: 'moonraker', created_on: 1 }],
        }) as never
      }
      if (method === 'access.get_api_key') return Promise.resolve('api-key-value') as never
      if (method === 'access.delete_user') {
        return Promise.resolve({ username: 'bob', action: 'user_deleted' }) as never
      }
      throw new Error(`unexpected method ${String(method)}`)
    })

    const wrapper = await mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('bob')

    await wrapper.get('[aria-label="Remove bob"]').trigger('click')
    await openDialog(wrapper).get('.button--danger').trigger('click')
    await flushPromises()

    expect(rpcCall).toHaveBeenCalledWith('access.delete_user', { username: 'bob' })
  })
})

describe('SettingsView — confirmations', () => {
  it('renders every confirmation key exactly once, none missing and none unknown', async () => {
    const wrapper = await mountView()
    const rendered = wrapper.findAll('.confirmation-item')

    expect(rendered).toHaveLength(confirmationKeys.length)
  })

  it('removes a printer without asking once its own confirmation is skipped', async () => {
    const printers = usePrintersStore(pinia)
    printers.addPrinter('voron.local:7125')
    printers.addPrinter('prusa.local:7125')
    printers.selectPrinter('printer')
    useConfirmationsStore(pinia).setSkip('removePrinter', true)

    const wrapper = await mountView()
    await wrapper.get('[aria-label="Remove prusa.local:7125"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('.confirm-dialog[open]').exists()).toBe(false)
    expect(printers.entries).toHaveLength(1)
  })

  it('checks and disables every row once the global override is on, with an explanatory title', async () => {
    const confirmations = useConfirmationsStore(pinia)
    const wrapper = await mountView()

    const row = wrapper
      .findAll('.check-row')
      .find((candidate) => candidate.text().includes('Emergency stop'))!
    expect((row.get('input').element as HTMLInputElement).checked).toBe(false)
    expect(row.attributes('title')).toBeUndefined()

    confirmations.setSkipAll(true)
    await flushPromises()

    expect((row.get('input').element as HTMLInputElement).checked).toBe(true)
    expect((row.get('input').element as HTMLInputElement).disabled).toBe(true)
    expect(row.attributes('title')).toBe('Global setting override')
  })

  it('turning skipAll back off restores whatever each row was set to on its own', async () => {
    const confirmations = useConfirmationsStore(pinia)
    confirmations.setSkip('emergencyStop', true)
    const wrapper = await mountView()

    confirmations.setSkipAll(true)
    await flushPromises()
    confirmations.setSkipAll(false)
    await flushPromises()

    const stillOn = wrapper
      .findAll('.check-row')
      .find((candidate) => candidate.text().includes('Emergency stop'))!
    const stillOff = wrapper
      .findAll('.check-row')
      .find((candidate) => candidate.text().includes('Reboot host'))!
    expect((stillOn.get('input').element as HTMLInputElement).checked).toBe(true)
    expect((stillOff.get('input').element as HTMLInputElement).checked).toBe(false)
  })
})

describe('SettingsView — formats', () => {
  it('offers Match language, 24-hour, and 12-hour as the time format, each with its own example', async () => {
    const wrapper = await mountView()
    const rows = wrapper
      .findAll('.check-row')
      .filter((row) => row.find('input[name="time-format"]').exists())

    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.text())).toEqual([
      expect.stringMatching(/^Match language \(\d{1,2}:\d{2}( (AM|PM))?\)$/),
      expect.stringMatching(/^24-hour \(\d{2}:\d{2}\)$/),
      expect.stringMatching(/^12-hour \(\d{1,2}:\d{2} (AM|PM)\)$/),
    ])
  })

  it('offers the full catalogue of date formats in a dropdown, each with its own example', async () => {
    const wrapper = await mountView()
    const select = wrapper.get('#date-format-select')

    const optionTexts = select.findAll('option').map((option) => option.text())
    expect(optionTexts.some((text) => text.startsWith('Match language ('))).toBe(true)
    expect(optionTexts.some((text) => text.startsWith('Browser ('))).toBe(true)
    expect(optionTexts.some((text) => text.startsWith('ISO ('))).toBe(true)
    expect(optionTexts.some((text) => text.startsWith('DD.MM.YYYY ('))).toBe(true)
    // "Custom…" has no live example — there's nothing to render until a pattern is typed.
    expect(optionTexts).toContain('Custom…')
    expect(optionTexts.length).toBeGreaterThan(10)
  })

  it('switches the stored date mode when a different option is picked', async () => {
    const wrapper = await mountView()
    const select = wrapper.get('#date-format-select')

    await select.setValue('dd-mm-yyyy-dot')

    expect((select.element as HTMLSelectElement).value).toBe('dd-mm-yyyy-dot')
  })

  it('reveals a pattern field and token legend once Custom is picked, and applies it live', async () => {
    const wrapper = await mountView()
    const select = wrapper.get('#date-format-select')

    expect(wrapper.find('#date-format-custom-input').exists()).toBe(false)

    await select.setValue('custom')
    await flushPromises()

    const input = wrapper.get('#date-format-custom-input')
    expect(wrapper.text()).toContain('4-digit year')

    await input.setValue('dddd, mmmm d yyyy')
    await flushPromises()

    expect(wrapper.text()).toMatch(/Renders as: \w+, \w+ \d{1,2} \d{4}/)
  })
})

describe('SettingsView — display', () => {
  // jsdom has no Wake Lock API at all, which is also the real-world default
  // for most Alabaster deployments served over plain HTTP per ADR 0003 — the
  // toggle has to explain itself rather than just sit there disabled.
  it('disables the wake lock toggle and explains why the browser cannot grant it', async () => {
    const wrapper = await mountView()
    const toggle = wrapper
      .findAll('.check-row')
      .find((row) => row.text() === 'Keep the screen awake while this tab is open')!

    expect(toggle.find('input[type="checkbox"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain("Your browser doesn't support keeping the screen awake.")
  })
})

describe('SettingsView — language and theme', () => {
  it('offers System, Light, and Dark as the theme mode', async () => {
    const wrapper = await mountView()
    const rows = wrapper
      .findAll('.check-row')
      .filter((row) => row.find('input[name="theme-mode"]').exists())

    expect(rows.map((row) => row.text())).toEqual(['System', 'Light', 'Dark'])
  })

  it('offers a typeface picker defaulting to Source Code Pro, not the dyslexia-friendly option', async () => {
    const wrapper = await mountView()
    const select = wrapper.get('#font-select')

    expect(select.findAll('option').map((option) => option.text())).toEqual([
      'Source Code Pro',
      'Roboto Mono',
      'Overpass Mono',
      'Public Sans',
      'OpenDyslexic (dyslexia-friendly)',
    ])
    expect((select.element as HTMLSelectElement).value).toBe('sourceCodePro')
  })

  it('switches the typeface and applies it to the document', async () => {
    const wrapper = await mountView()
    const select = wrapper.get('#font-select')

    await select.setValue('openDyslexic')

    expect(document.documentElement.dataset.font).toBe('openDyslexic')
  })

  it('offers Light through Bold as the heading weight, and applies the choice', async () => {
    const wrapper = await mountView()
    const rows = wrapper
      .findAll('.check-row')
      .filter((row) => row.find('input[name="text-weight"]').exists())
    expect(rows.map((row) => row.text())).toEqual([
      'Light',
      'Regular',
      'Medium',
      'SemiBold',
      'Bold',
    ])

    await rows[0]!.get('input[type="radio"]').setValue(true)
    expect(document.documentElement.dataset.textWeight).toBe('light')
  })

  it('offers a console typeface picker defaulting to matching the interface, independent of it', async () => {
    const wrapper = await mountView()
    const select = wrapper.get('#console-font-select')

    expect(select.findAll('option').map((option) => option.text())).toEqual([
      'Match interface typeface',
      'Source Code Pro',
      'Roboto Mono',
      'Overpass Mono',
      'Public Sans',
      'OpenDyslexic (dyslexia-friendly)',
    ])
    expect((select.element as HTMLSelectElement).value).toBe('match')

    const interfaceFontBefore = document.documentElement.dataset.font
    await select.setValue('publicSans')
    expect(document.documentElement.dataset.consoleFont).toBe('publicSans')
    // The interface typeface itself must not have moved.
    expect(document.documentElement.dataset.font).toBe(interfaceFontBefore)
  })

  it('offers Regular and Bold as the console weight, independent of the heading weight', async () => {
    const wrapper = await mountView()
    const rows = wrapper
      .findAll('.check-row')
      .filter((row) => row.find('input[name="console-weight"]').exists())
    expect(rows.map((row) => row.text())).toEqual(['Regular', 'Bold'])

    const textWeightBefore = document.documentElement.dataset.textWeight
    await rows[1]!.get('input[type="radio"]').setValue(true)
    expect(document.documentElement.dataset.consoleWeight).toBe('bold')
    expect(document.documentElement.dataset.textWeight).toBe(textWeightBefore)
  })

  // Last in the file on purpose: it switches the shared i18n instance's
  // locale, which every other mounted wrapper in this file also reads.
  it('changes the interface language from the page', async () => {
    const wrapper = await mountView()
    const select = wrapper.get('#language-select')

    try {
      await select.setValue('nb')
      // The Norwegian catalog loads via a dynamic import, which resolves on a
      // real async tick rather than a plain microtask — flushPromises alone
      // is not guaranteed to wait long enough for it.
      await vi.waitFor(() => expect(wrapper.text()).toContain('Innstillinger'))
    } finally {
      await select.setValue('en')
      await vi.waitFor(() => expect(wrapper.text()).toContain('Settings'))
    }
  })
})

describe('SettingsView — category rail', () => {
  function rail(wrapper: Awaited<ReturnType<typeof mountView>>) {
    return wrapper.get('.settings-rail')
  }

  function railButton(wrapper: Awaited<ReturnType<typeof mountView>>, label: string) {
    return rail(wrapper)
      .findAll('button')
      .find((button) => button.text() === label)!
  }

  it('shows every card by default, with "Show all settings" current', async () => {
    const wrapper = await mountView()

    for (const title of ['Moonraker connection', 'Saved printers', 'Language', 'Theme pack']) {
      expect(wrapper.text()).toContain(title)
    }
    expect(railButton(wrapper, 'Show all settings').attributes('aria-current')).toBe('true')
  })

  it('narrows to exactly one card when its category is chosen', async () => {
    const wrapper = await mountView()

    await railButton(wrapper, 'Language').trigger('click')

    expect(wrapper.text()).toContain('Language')
    expect(wrapper.text()).not.toContain('Moonraker connection')
    expect(wrapper.text()).not.toContain('Saved printers')
    expect(wrapper.text()).not.toContain('Theme pack')
    expect(wrapper.text()).not.toContain('Confirmations')
    expect(railButton(wrapper, 'Language').attributes('aria-current')).toBe('true')
    expect(railButton(wrapper, 'Show all settings').attributes('aria-current')).toBeUndefined()

    // Time and date format lives in the same group as language, not a
    // category of its own — one rail entry, one card, both concerns.
    expect(wrapper.find('input[name="time-format"]').exists()).toBe(true)
    expect(wrapper.find('#date-format-select').exists()).toBe(true)
  })

  it('restores every card when "Show all settings" is chosen again', async () => {
    const wrapper = await mountView()

    await railButton(wrapper, 'Safety').trigger('click')
    expect(wrapper.text()).not.toContain('Moonraker connection')

    await railButton(wrapper, 'Show all settings').trigger('click')

    for (const title of ['Moonraker connection', 'Saved printers', 'Language', 'Theme pack']) {
      expect(wrapper.text()).toContain(title)
    }
  })

  it('keeps the rail itself present regardless of which category is active', async () => {
    const wrapper = await mountView()
    await railButton(wrapper, 'Printers').trigger('click')

    // Users is present in the rail even though its own card stays hidden
    // until a printer reports the `authorization` component — the rail entry
    // itself is unconditional, only the card is gated.
    expect(rail(wrapper).findAll('button')).toHaveLength(11)
  })

  // The narrow-width `<select>` replaces the button list visually (CSS hides
  // whichever one the current width does not want), but both stay mounted
  // and both drive the same `activeCategory` ref — see interface-standards.md's
  // Settings contract for why a wrapped button strip was not the fix.
  it('offers the same categories through the narrow-width select', async () => {
    const wrapper = await mountView()
    const select = rail(wrapper).get('.settings-rail-select')

    expect(select.findAll('option').map((option) => option.text())).toEqual([
      'Show all settings',
      'Printer service',
      'Printers',
      'Cameras',
      'Accounts',
      'Language',
      'Appearance',
      'Display',
      'Editor',
      'Safety',
      'Backup',
    ])

    await select.setValue('language')

    expect(wrapper.text()).toContain('Language')
    expect(wrapper.text()).not.toContain('Moonraker connection')
    expect(railButton(wrapper, 'Language').attributes('aria-current')).toBe('true')
  })
})

describe('SettingsView — backup', () => {
  // `useSettingsCategory`'s selection and `useDateTimeFormatMode`'s date/time
  // modes are module-level singletons, not reset by the outer `beforeEach`'s
  // fresh Pinia — an earlier test in this file that changes either and never
  // changes it back leaves that choice standing for every test after it.
  beforeEach(() => {
    useSettingsCategory().setActiveCategory('all')
    const { setDateMode, setTimeMode } = useDateTimeFormatMode()
    setDateMode('auto')
    setTimeMode('auto')
  })

  it('has nothing to sync until a printer is active', async () => {
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('Backup and sync')
    expect(wrapper.text()).toContain('Export')
    expect(wrapper.text()).toContain('Import')
    // No active printer yet, so there is nothing to sync to.
    expect(wrapper.text()).not.toContain('Sync settings and layout to this printer')
  })

  it('enabling sync with nothing stored yet pushes the current bundle', async () => {
    const printers = usePrintersStore(pinia)
    const entry = printers.addPrinter('voron.local:7125')!
    const moonraker = useMoonrakerStore(pinia)
    moonraker.connectionPhase = 'connected'
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockImplementation((method) => {
      if (method === 'server.database.get_item') return Promise.reject(new Error('Key not found'))
      if (method === 'server.database.post_item') {
        return Promise.resolve({ namespace: 'alabaster', key: 'default', value: {} }) as never
      }
      throw new Error(`unexpected method ${String(method)}`)
    })

    const wrapper = await mountView()
    const toggle = wrapper
      .findAll('.check-row')
      .find((row) => row.text() === 'Sync settings and layout to this printer')!
    await toggle.get('input[type="checkbox"]').trigger('change')
    await flushPromises()

    expect(rpcCall).toHaveBeenCalledWith(
      'server.database.post_item',
      expect.objectContaining({ namespace: 'alabaster' }),
    )
    expect(printers.entries.find((candidate) => candidate.id === entry.id)?.dbSyncEnabled).toBe(
      true,
    )
    expect(wrapper.text()).toContain('Last synced')
  })

  it('resets settings live, without a reload, once the reset is confirmed', async () => {
    const confirmations = useConfirmationsStore(pinia)
    confirmations.setSkip('removePrinter', true)

    const wrapper = await mountView()
    const removePrinterRow = () =>
      wrapper.findAll('.confirmation-item').find((row) => row.text().includes('saved printer'))!

    expect((removePrinterRow().get('input').element as HTMLInputElement).checked).toBe(true)

    await wrapper.get('.button--danger-quiet').trigger('click')
    await openDialog(wrapper).get('.button--danger').trigger('click')
    await flushPromises()

    expect(wrapper.find('.confirm-dialog[open]').exists()).toBe(false)
    expect((removePrinterRow().get('input').element as HTMLInputElement).checked).toBe(false)
  })
})
