import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { printerDisplayLabel, printerHost, usePrintersStore } from '@/stores/printers'

const storageKey = 'alabaster.printers.v1'

function stored(): { activeId?: string; entries?: Array<Record<string, unknown>> } {
  return JSON.parse(window.localStorage.getItem(storageKey) ?? '{}') as {
    activeId?: string
    entries?: Array<Record<string, unknown>>
  }
}

describe('printers store', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('starts empty and still knows where to connect', () => {
    const printers = usePrintersStore()

    expect(printers.entries).toEqual([])
    expect(printers.hasPrinters).toBe(false)
    // A printer's own Pi serves the interface, so same-origin needs no setup.
    expect(printers.activeEndpoint).toMatch(/\/websocket$/)
  })

  it('carries a single-printer install forward, name included', () => {
    window.localStorage.setItem('alabaster.moonraker.endpoint', 'ws://voron.local:7125/websocket')
    window.localStorage.setItem('alabaster.printer.name', 'Voron 2.4')

    const printers = usePrintersStore()

    expect(printers.entries).toEqual([
      { id: 'printer', label: 'Voron 2.4', endpoint: 'ws://voron.local:7125/websocket' },
    ])
    expect(printers.activeId).toBe('printer')
    expect(printers.activeEndpoint).toBe('ws://voron.local:7125/websocket')
  })

  it('derives ids without a clock or a random source', () => {
    const printers = usePrintersStore()

    expect(printers.addPrinter('voron.local:7125')?.id).toBe('printer')
    expect(printers.addPrinter('prusa.local:7125')?.id).toBe('printer-2')
    expect(printers.addPrinter('ender.local:7125')?.id).toBe('printer-3')
  })

  it('normalizes what the user typed', () => {
    const printers = usePrintersStore()

    expect(printers.addPrinter('voron.local:7125')?.endpoint).toBe(
      'ws://voron.local:7125/websocket',
    )
    expect(printers.addPrinter('http://prusa.local:7125')?.endpoint).toBe(
      'ws://prusa.local:7125/websocket',
    )
  })

  it('refuses an endpoint it cannot understand, without disturbing the list', () => {
    const printers = usePrintersStore()
    printers.addPrinter('voron.local:7125')

    expect(printers.addPrinter('not a url at all')).toBeNull()
    expect(printers.addPrinter('')).toBeNull()
    expect(printers.entries).toHaveLength(1)
  })

  it('keeps a printer’s identity when its address changes', () => {
    const printers = usePrintersStore()
    const entry = printers.addPrinter('voron.local:7125', 'Voron')

    // Reaching the same machine by IP must not make it a second printer, or its
    // dashboard and learned data — both keyed on the id — would be left behind.
    expect(printers.setEndpoint(entry!.id, '192.168.1.50:7125')).toBe(true)

    expect(printers.entries).toEqual([
      { id: 'printer', label: 'Voron', endpoint: 'ws://192.168.1.50:7125/websocket' },
    ])
  })

  it('stores and clears a printer’s Moonraker refresh token', () => {
    const printers = usePrintersStore()
    const entry = printers.addPrinter('voron.local:7125')

    expect(printers.setRefreshToken(entry!.id, 'refresh-token-value')).toBe(true)
    expect(printers.entries[0]?.refreshToken).toBe('refresh-token-value')

    expect(printers.setRefreshToken(entry!.id, null)).toBe(true)
    expect(printers.entries[0]?.refreshToken).toBeUndefined()
  })

  it('reloads a stored refresh token along with everything else', () => {
    const first = usePrintersStore()
    const entry = first.addPrinter('voron.local:7125')
    first.setRefreshToken(entry!.id, 'refresh-token-value')

    setActivePinia(createPinia())
    const second = usePrintersStore()

    expect(second.entries[0]?.refreshToken).toBe('refresh-token-value')
  })

  it('opts a printer into settings/layout sync and back out, reloading the choice', () => {
    const printers = usePrintersStore()
    const entry = printers.addPrinter('voron.local:7125')

    expect(printers.setDbSyncEnabled(entry!.id, true)).toBe(true)
    expect(printers.entries[0]?.dbSyncEnabled).toBe(true)

    setActivePinia(createPinia())
    const reloaded = usePrintersStore()
    expect(reloaded.entries[0]?.dbSyncEnabled).toBe(true)

    expect(reloaded.setDbSyncEnabled(entry!.id, false)).toBe(true)
    expect(reloaded.entries[0]?.dbSyncEnabled).toBeUndefined()
  })

  it('does not opt a re-added printer back into sync on its own', () => {
    const printers = usePrintersStore()
    const entry = printers.addPrinter('voron.local:7125')
    printers.setDbSyncEnabled(entry!.id, true)

    printers.removePrinter(entry!.id)
    printers.addPrinter('voron.local:7125')

    expect(printers.entries[0]?.dbSyncEnabled).toBeUndefined()
  })

  it('selects an endpoint already on the list instead of duplicating it', () => {
    const printers = usePrintersStore()
    printers.addPrinter('voron.local:7125')
    printers.addPrinter('prusa.local:7125')

    const again = printers.addPrinter('voron.local:7125')

    expect(printers.entries).toHaveLength(2)
    expect(again?.id).toBe('printer')
    expect(printers.activeId).toBe('printer')
  })

  it('never leaves the interface pointed at a printer that is gone', () => {
    const printers = usePrintersStore()
    printers.addPrinter('voron.local:7125')
    const prusa = printers.addPrinter('prusa.local:7125')
    expect(printers.activeId).toBe(prusa!.id)

    printers.removePrinter(prusa!.id)

    expect(printers.activeId).toBe('printer')
    expect(printers.activeEndpoint).toBe('ws://voron.local:7125/websocket')
  })

  it('falls back to same-origin once the last printer is removed', () => {
    const printers = usePrintersStore()
    const only = printers.addPrinter('voron.local:7125')

    printers.removePrinter(only!.id)

    expect(printers.activeId).toBe('')
    expect(printers.activeEndpoint).toMatch(/\/websocket$/)
  })

  it('reloads the list and the printer in front', () => {
    const first = usePrintersStore()
    first.addPrinter('voron.local:7125', 'Voron')
    first.addPrinter('prusa.local:7125', 'Prusa')
    first.selectPrinter('printer')

    expect(stored().activeId).toBe('printer')

    setActivePinia(createPinia())
    const reloaded = usePrintersStore()

    expect(reloaded.entries.map((entry) => entry.label)).toEqual(['Voron', 'Prusa'])
    expect(reloaded.activeId).toBe('printer')
  })

  it('drops an unreadable entry rather than the whole list', () => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        activeId: 'printer-2',
        entries: [
          { id: 'printer', label: 'Voron', endpoint: 'ws://voron.local:7125/websocket' },
          // A bare word is a valid hostname, so this has to be genuinely
          // unparseable to be dropped: a scheme Moonraker never speaks.
          { id: 'printer-2', label: 'Broken', endpoint: 'ftp://printer.local:7125' },
        ],
      }),
    )

    const printers = usePrintersStore()

    expect(printers.entries.map((entry) => entry.id)).toEqual(['printer'])
    // The stored active printer went with it, so the first survivor takes over.
    expect(printers.activeId).toBe('printer')
  })

  it('prefers its own list over the pre-registry endpoint', () => {
    window.localStorage.setItem('alabaster.moonraker.endpoint', 'ws://old.local:7125/websocket')
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        activeId: 'printer',
        entries: [{ id: 'printer', label: '', endpoint: 'ws://voron.local:7125/websocket' }],
      }),
    )

    const printers = usePrintersStore()

    expect(printers.activeEndpoint).toBe('ws://voron.local:7125/websocket')
  })
})

describe('printerHost and printerDisplayLabel', () => {
  it('reads the host out of a normalized endpoint', () => {
    expect(printerHost('ws://voron.local:7125/websocket')).toBe('voron.local:7125')
  })

  it('falls back to the raw string for something that is not a URL at all', () => {
    expect(printerHost('not a url')).toBe('not a url')
  })

  it('shows the chosen name when there is one, and the host otherwise', () => {
    expect(
      printerDisplayLabel({ id: 'printer', label: 'Voron', endpoint: 'ws://a/websocket' }),
    ).toBe('Voron')
    expect(
      printerDisplayLabel({ id: 'printer', label: '', endpoint: 'ws://voron.local/websocket' }),
    ).toBe('voron.local')
  })

  /*
   * The address is the last answer, not the second one. An unnamed entry used
   * to show it even when the printer had said what it was called, which made a
   * wall of machines reached by IP into a wall of IP addresses.
   */
  it('prefers what the printer calls itself over its address', () => {
    expect(
      printerDisplayLabel({
        id: 'printer',
        label: '',
        discoveredName: 'voron24',
        endpoint: 'ws://192.168.1.50:7125/websocket',
      }),
    ).toBe('voron24')
  })

  it("still lets a chosen name win over the printer's own", () => {
    expect(
      printerDisplayLabel({
        id: 'printer',
        label: 'Left bench',
        discoveredName: 'voron24',
        endpoint: 'ws://192.168.1.50:7125/websocket',
      }),
    ).toBe('Left bench')
  })
})

describe('remembering what a printer calls itself', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('stores the name so an offline printer keeps it', () => {
    const printers = usePrintersStore()
    const entry = printers.addPrinter('192.168.1.50:7125')!

    expect(printers.rememberDiscoveredName(entry.id, 'voron24')).toBe(true)
    expect(stored().entries?.[0]?.discoveredName).toBe('voron24')

    // Read back from storage alone, the way a fresh page load sees it.
    setActivePinia(createPinia())
    expect(printerDisplayLabel(usePrintersStore().entries[0]!)).toBe('voron24')
  })

  /*
   * Both producers report this — the live store for the printer in front, a
   * Farm column's own connection for the rest — so a rail reconnecting must not
   * rewrite the list once per column for no difference.
   */
  it('writes nothing when the name has not changed', () => {
    const printers = usePrintersStore()
    const entry = printers.addPrinter('192.168.1.50:7125')!
    printers.rememberDiscoveredName(entry.id, 'voron24')

    expect(printers.rememberDiscoveredName(entry.id, 'voron24')).toBe(false)
  })

  it('ignores an empty answer rather than forgetting the name', () => {
    const printers = usePrintersStore()
    const entry = printers.addPrinter('192.168.1.50:7125')!
    printers.rememberDiscoveredName(entry.id, 'voron24')

    expect(printers.rememberDiscoveredName(entry.id, '   ')).toBe(false)
    expect(printers.entries[0]?.discoveredName).toBe('voron24')
  })

  it('corrects itself when the machine answers to a different name', () => {
    const printers = usePrintersStore()
    const entry = printers.addPrinter('192.168.1.50:7125')!
    printers.rememberDiscoveredName(entry.id, 'voron24')
    printers.rememberDiscoveredName(entry.id, 'trident')

    expect(printers.entries[0]?.discoveredName).toBe('trident')
  })
})

describe('scopeKeysFor', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('gives an existing printer both its identity and its endpoint', () => {
    const printers = usePrintersStore()
    const entry = printers.addPrinter('voron.local:7125')!

    expect(printers.scopeKeysFor(entry.id)).toEqual([entry.id, 'ws://voron.local:7125/websocket'])
  })

  it('answers with no keys for an id nothing is saved under', () => {
    const printers = usePrintersStore()
    printers.addPrinter('voron.local:7125')

    expect(printers.scopeKeysFor('printer-9')).toEqual([])
    expect(printers.scopeKeysFor('')).toEqual([])
  })

  it('is what a copy-from choice hands to the dashboard store', () => {
    // The one invariant that actually matters here: whatever this returns is
    // exactly what `copyProfileFrom` is willing to read from, so an id it does
    // not recognize must translate to "nothing to copy," not an empty-string
    // key that could collide with the local-scope default.
    const printers = usePrintersStore()
    expect(printers.scopeKeysFor('unknown')).not.toContain('')
  })
})
