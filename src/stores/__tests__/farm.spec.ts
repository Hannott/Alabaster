import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFarmStore, farmVisibilityGraceMs } from '@/stores/farm'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrintersStore } from '@/stores/printers'

/**
 * The rail's connection policy, which is what makes "unlimited printers" true
 * rather than aspirational: a column that is not on screen holds no socket, the
 * printer the application already drives never gets a second one, and leaving
 * the page closes everything.
 *
 * Sockets are counted through the WebSocket constructor rather than through the
 * store's internals — the store is allowed to change how it holds connections;
 * what it may not change is how many exist.
 */

const openedSockets: string[] = []

class CountingSocket {
  readyState = 0
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  closed = false

  constructor(url: string) {
    openedSockets.push(url)
  }

  send(): void {}

  close(): void {
    this.closed = true
    this.readyState = 3
  }
}

function seedPrinters(): void {
  window.localStorage.setItem(
    'alabaster.printers.v1',
    JSON.stringify({
      version: 1,
      activeId: 'printer',
      entries: [
        { id: 'printer', label: 'Active one', endpoint: 'ws://active.local:7125/websocket' },
        { id: 'printer-2', label: 'Voron', endpoint: 'ws://voron.local:7125/websocket' },
        { id: 'printer-3', label: 'Ender', endpoint: 'ws://ender.local:7125/websocket' },
      ],
    }),
  )
}

describe('the farm store', () => {
  beforeEach(() => {
    openedSockets.length = 0
    window.localStorage.clear()
    seedPrinters()
    vi.stubGlobal('WebSocket', CountingSocket as unknown as typeof WebSocket)
    setActivePinia(createPinia())
    /*
     * The application connects to the active printer at startup, before any
     * route mounts, and the stores the active column reads from assume that
     * client exists. Reproducing it here rather than working around it keeps
     * the test honest about what the store may rely on.
     */
    useMoonrakerStore().connect('ws://active.local:7125/websocket')
    openedSockets.length = 0
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('offers one column per saved printer, in the order the user arranged them', () => {
    const farm = useFarmStore()
    expect(farm.columns.map((column) => column.id)).toEqual(['printer', 'printer-2', 'printer-3'])
    expect(farm.columns.map((column) => column.label)).toEqual(['Active one', 'Voron', 'Ender'])
  })

  it('holds no connection until the page is active', () => {
    const farm = useFarmStore()
    farm.setVisible('printer-2', true)
    expect(openedSockets).toEqual([])
  })

  it('connects a visible column and never the active printer', () => {
    const farm = useFarmStore()
    farm.activate()
    farm.setVisible('printer', true)
    farm.setVisible('printer-2', true)

    // The active printer already has a fully-subscribed connection; a second
    // would double its subscription and disagree with the dashboard by a tick.
    expect(openedSockets).toEqual(['ws://voron.local:7125/websocket'])
    farm.deactivate()
  })

  it('leaves an off-screen column unconnected, so the cost follows the viewport', () => {
    const farm = useFarmStore()
    farm.activate()
    farm.setVisible('printer-2', true)
    expect(openedSockets).toHaveLength(1)

    farm.setVisible('printer-3', false)
    expect(openedSockets).toHaveLength(1)
    farm.deactivate()
  })

  it('keeps a column connected through its grace period, then drops it', () => {
    vi.useFakeTimers()
    const farm = useFarmStore()
    farm.activate()
    farm.setVisible('printer-2', true)
    const socketCount = openedSockets.length

    farm.setVisible('printer-2', false)
    // Scrolling past a column must not cost a socket teardown and a reopen.
    vi.advanceTimersByTime(farmVisibilityGraceMs - 1000)
    farm.setVisible('printer-2', true)
    vi.advanceTimersByTime(farmVisibilityGraceMs * 2)

    expect(openedSockets).toHaveLength(socketCount)
    farm.deactivate()
  })

  it('closes every connection when the page goes away', () => {
    const farm = useFarmStore()
    farm.activate()
    farm.setVisible('printer-2', true)
    farm.setVisible('printer-3', true)
    expect(openedSockets).toHaveLength(2)

    farm.deactivate()
    farm.setVisible('printer-2', true)
    // Nothing reconnects while the page is inactive.
    expect(openedSockets).toHaveLength(2)
  })

  it('reconnects a printer whose address was edited while its column was open', () => {
    const farm = useFarmStore()
    const printers = usePrintersStore()
    farm.activate()
    farm.setVisible('printer-2', true)

    printers.setEndpoint('printer-2', 'ws://voron-new.local:7125/websocket')
    farm.setVisible('printer-2', true)

    expect(openedSockets.at(-1)).toBe('ws://voron-new.local:7125/websocket')
    farm.deactivate()
  })

  it('presents the active printer from the live stores rather than from a socket', () => {
    const farm = useFarmStore()
    farm.activate()
    farm.setVisible('printer', true)

    const active = farm.columns.find((column) => column.isActive)
    expect(active?.snapshot).toBe(farm.activeSnapshot)
    expect(openedSockets).toEqual([])
    farm.deactivate()
  })
})
