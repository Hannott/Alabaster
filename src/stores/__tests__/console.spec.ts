import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NotificationHandler } from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useBedMeshStore } from '@/stores/bedMesh'
import { useConsoleStore } from '@/stores/console'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'

function storedHistory(): unknown {
  return JSON.parse(window.localStorage.getItem('alabaster.console.history') ?? 'null')
}

function storedClearedAt(): unknown {
  return JSON.parse(window.localStorage.getItem('alabaster.console.clearedAt') ?? 'null')
}

describe('console store', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('echoes a command before dispatching it, so Klipper answers underneath it', async () => {
    const moonraker = useMoonrakerStore()
    let respond: NotificationHandler | undefined
    vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
      if (method === 'notify_gcode_response') respond = handler
      return () => undefined
    })
    const gcodeConsole = useConsoleStore()
    gcodeConsole.start()

    // Klipper answers while the request is still in flight, which is the whole
    // reason the echo cannot wait for it: the transcript would read backwards.
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((() => {
      respond?.({
        jsonrpc: '2.0',
        method: 'notify_gcode_response',
        params: ['// mesh bed leveling complete'],
      })
      return Promise.resolve('ok')
    }) as never)

    await expect(gcodeConsole.sendConsoleCommand('BED_MESH_CALIBRATE')).resolves.toBe(true)
    expect(gcodeConsole.consoleEntries.map((entry) => [entry.kind, entry.message])).toEqual([
      ['command', 'BED_MESH_CALIBRATE'],
      ['response', 'mesh bed leveling complete'],
    ])
    gcodeConsole.stop()
  })

  it('keeps the echo and the history when Klipper refuses the command', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockRejectedValue(new Error('unknown command'))
    const gcodeConsole = useConsoleStore()
    const printer = usePrinterStore()

    await expect(gcodeConsole.sendConsoleCommand('  NOT_A_COMMAND  ')).resolves.toBe(false)
    // A console that shows nothing for a rejected line reads as having dropped
    // the keystroke, and the failure is reported separately.
    expect(gcodeConsole.consoleEntries.map((entry) => entry.message)).toEqual(['NOT_A_COMMAND'])
    expect(gcodeConsole.commandHistory).toEqual(['NOT_A_COMMAND'])
    // The failure lands on the printer store's command runner, since that is
    // the layer that actually dispatched.
    expect(printer.lastCommandError).toBe('console')
  })

  it('takes the easter-egg word out of the stream before it reaches the printer', async () => {
    // The console is the one place in the application where what is typed goes
    // straight to the machine. Klipper has no such command and would answer
    // with an error, so a word meant for the interface has to be intercepted
    // where the stream begins rather than filtered out of the reply.
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
    const bedMesh = useBedMeshStore()
    const gcodeConsole = useConsoleStore()
    const printer = usePrinterStore()

    await expect(gcodeConsole.sendConsoleCommand('  YaRrr  ')).resolves.toBe(true)

    expect(rpcCall).not.toHaveBeenCalled()
    expect(bedMesh.voyageRequests).toBe(1)
    expect(printer.lastCommandError).toBe(null)
    // Still echoed and still remembered: it is a thing the user typed, and a
    // console that swallows a line reads as having dropped the keystroke.
    expect(gcodeConsole.consoleEntries.map((entry) => [entry.kind, entry.message])).toEqual([
      ['command', 'YaRrr'],
      [
        'response',
        'Anchors aweigh! Heave to and mind the swell — ten seconds of open water, then back to the bed.',
      ],
    ])
    expect(gcodeConsole.commandHistory).toEqual(['YaRrr'])
  })

  it('asks again every time it is typed, rather than latching a flag on', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
    const bedMesh = useBedMeshStore()
    const gcodeConsole = useConsoleStore()

    await gcodeConsole.sendConsoleCommand('yarrr')
    await gcodeConsole.sendConsoleCommand('yarrr')
    expect(bedMesh.voyageRequests).toBe(2)
  })

  it('sends anything that merely contains the word, because it is not the word', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
    const bedMesh = useBedMeshStore()
    const gcodeConsole = useConsoleStore()

    await gcodeConsole.sendConsoleCommand('SET_PIN PIN=yarrr VALUE=1')
    expect(rpcCall).toHaveBeenCalled()
    expect(bedMesh.voyageRequests).toBe(0)
  })

  it('refuses a second command before echoing it, rather than logging one it drops', async () => {
    const moonraker = useMoonrakerStore()
    const gcodeConsole = useConsoleStore()
    const printer = usePrinterStore()
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

    const first = gcodeConsole.sendConsoleCommand('BED_MESH_CALIBRATE')
    expect(printer.pendingCommands.console).toBe(true)

    // The runner refused this dispatch either way; going through `sendGcode`
    // anyway echoed it first, so the transcript claimed a command that never
    // reached the machine — and with the deadline waived, for as long as the
    // printer takes.
    await expect(gcodeConsole.sendConsoleCommand('M115')).resolves.toBe(false)
    expect(dispatched).toEqual(['BED_MESH_CALIBRATE'])
    expect(gcodeConsole.consoleEntries.map((entry) => entry.message)).toEqual([
      'BED_MESH_CALIBRATE',
    ])
    expect(gcodeConsole.commandHistory).toEqual(['BED_MESH_CALIBRATE'])

    release?.()
    await first

    // Once the answer is in, the same command goes through normally. Started
    // before it is released, since dispatching it is what hands over the
    // resolver.
    const second = gcodeConsole.sendConsoleCommand('M115')
    release?.()
    await expect(second).resolves.toBe(true)
    expect(dispatched).toEqual(['BED_MESH_CALIBRATE', 'M115'])
  })

  it('waives the transport deadline for a typed line, whatever it turns out to be', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
    const gcodeConsole = useConsoleStore()

    // Klipper answers `printer.gcode.script` only once the script finishes, and
    // a heat-up wait or a mesh run outlives the sixty-second default — a failure
    // reported for a printer that is working perfectly.
    await gcodeConsole.sendConsoleCommand('M190 S60')

    expect(rpcCall).toHaveBeenCalledWith(
      'printer.gcode.script',
      { script: 'M190 S60' },
      { timeoutMs: null },
    )
  })

  it('keeps the newest use of a repeated command once in the history', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
    const gcodeConsole = useConsoleStore()

    await gcodeConsole.sendConsoleCommand('G28')
    await gcodeConsole.sendConsoleCommand('M105')
    await gcodeConsole.sendConsoleCommand('G28')

    // Walking back from the input must not step through copies of one command.
    expect(gcodeConsole.commandHistory).toEqual(['M105', 'G28'])
    // Stored per printer: another machine's macros are not this machine's.
    expect(storedHistory()).toEqual({ 'ws://localhost:3000/websocket': ['M105', 'G28'] })

    gcodeConsole.clearCommandHistory()
    expect(gcodeConsole.commandHistory).toEqual([])
    // Emptied for this printer, and only for this printer.
    expect(storedHistory()).toEqual({ 'ws://localhost:3000/websocket': [] })
  })

  it("restores Moonraker's retained history under any line that arrived first", async () => {
    const moonraker = useMoonrakerStore()
    const availability = useAvailabilityStore()
    let respond: NotificationHandler | undefined
    vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
      if (method === 'notify_gcode_response') respond = handler
      return () => undefined
    })
    vi.spyOn(moonraker, 'rpcCall').mockImplementation(((method: string) => {
      if (method === 'server.gcode_store') {
        return Promise.resolve({
          gcode_store: [
            { message: 'G28', time: 1_700_000_000, type: 'command' },
            { message: '// Klipper state: Ready', time: 1_700_000_001, type: 'response' },
          ],
        })
      }
      return Promise.resolve({
        eventtime: 1,
        status: { gcode: { commands: { G28: { help: 'Home axes' }, M105: {} } } },
      })
    }) as never)

    const gcodeConsole = useConsoleStore()
    gcodeConsole.start()
    availability.transportState = 'connected'
    availability.klipperState = 'ready'
    availability.subscriptionState = 'ready'
    await vi.waitFor(() => expect(gcodeConsole.consoleEntries.length).toBeGreaterThan(0))

    // A live line that beat the read must end up after the history, not replaced
    // by it — the backfill is older output by definition.
    expect(gcodeConsole.consoleEntries.map((entry) => [entry.kind, entry.message])).toEqual([
      ['command', 'G28'],
      ['response', 'Klipper state: Ready'],
    ])
    // Moonraker reports epoch seconds; the entries carry real times, not now.
    expect(gcodeConsole.consoleEntries[0]?.at).toBe(1_700_000_000_000)

    // The command list backs Tab completion and the command browser.
    expect(gcodeConsole.gcodeHelp).toEqual([
      { command: 'G28', help: 'Home axes' },
      { command: 'M105', help: '' },
    ])

    respond?.({ jsonrpc: '2.0', method: 'notify_gcode_response', params: ['ok'] })
    expect(gcodeConsole.consoleEntries).toHaveLength(3)

    gcodeConsole.clearConsole()
    expect(gcodeConsole.consoleEntries).toEqual([])
    gcodeConsole.stop()
  })

  it('remembers when the console was cleared, so a reload does not bring back what it hid', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_500_000)
    const gcodeConsole = useConsoleStore()

    gcodeConsole.clearConsole()
    expect(storedClearedAt()).toEqual({ 'ws://localhost:3000/websocket': 1_700_000_500_000 })
  })

  it('adopts a pre-scoping console history for the printer in use, then supersedes it', async () => {
    // The shape written before either key was scoped: one flat array.
    window.localStorage.setItem('alabaster.console.history', '["M114"]')
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
    const gcodeConsole = useConsoleStore()

    expect(gcodeConsole.commandHistory).toEqual(['M114'])

    await gcodeConsole.sendConsoleCommand('G28')

    // Absorbed under the printer, so a second printer cannot inherit it.
    expect(storedHistory()).toEqual({ 'ws://localhost:3000/websocket': ['M114', 'G28'] })
  })

  it('hides backfilled history at or before the last clear', async () => {
    // Simulates a clear from a previous tab: the cutoff is already in storage
    // before this store, standing in for the next reload, is even created.
    window.localStorage.setItem('alabaster.console.clearedAt', '1700000000500')
    const moonraker = useMoonrakerStore()
    const availability = useAvailabilityStore()
    vi.spyOn(moonraker, 'onNotification').mockImplementation(() => () => undefined)
    vi.spyOn(moonraker, 'rpcCall').mockImplementation(((method: string) => {
      if (method === 'server.gcode_store') {
        return Promise.resolve({
          gcode_store: [
            // At 1_700_000_000_000ms, before the cutoff: what Clear hid.
            { message: 'G28', time: 1_700_000_000, type: 'command' },
            // At 1_700_000_001_000ms, after the cutoff: sent once the console
            // was already showing empty, so it must survive the reload.
            { message: 'ok', time: 1_700_000_001, type: 'response' },
          ],
        })
      }
      return Promise.resolve({ eventtime: 1, status: {} })
    }) as never)

    const gcodeConsole = useConsoleStore()
    gcodeConsole.start()
    availability.transportState = 'connected'
    availability.klipperState = 'ready'
    availability.subscriptionState = 'ready'
    await vi.waitFor(() => expect(gcodeConsole.consoleEntries.length).toBeGreaterThan(0))

    expect(gcodeConsole.consoleEntries.map((entry) => entry.message)).toEqual(['ok'])
    gcodeConsole.stop()
  })
})
