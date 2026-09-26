import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAvailabilityStore } from '@/stores/availability'
import { useMachineFilesStore } from '@/stores/machineFiles'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { normalizeQuickConfigPins, useQuickConfigStore } from '@/stores/quickConfig'

const saveConfigBlock = [
  '#*# <---------------------- SAVE_CONFIG ---------------------->',
  '#*# DO NOT EDIT THIS BLOCK OR BELOW. The contents are auto-generated.',
  '#*#',
  '#*# [input_shaper]',
  '#*# shaper_freq_x = 53.8',
  '',
].join('\n')

/*
 * The layout that made Voyager write an ignored line: `[printer]` in
 * printer.cfg, with a later include setting one of its options again.
 */
const disk: Record<string, string> = {
  'printer.cfg': `[printer]\nmax_accel: 5000\n\n[include hardware/*.cfg]\n\n${saveConfigBlock}`,
  'hardware/limits.cfg': '[printer]\nmax_velocity: 600\nmax_accel: 6000\n',
  'unrelated.cfg': '[printer]\nmax_accel: 1\n',
}

let uploads: Array<{ url: string; body: unknown }>

function stubFiles(): void {
  uploads = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation((input, init) => {
      const url = String(input)
      if (init?.method === 'POST') {
        uploads.push({ url, body: init.body })
        return Promise.resolve(new Response(JSON.stringify({ result: 'success' })))
      }
      const path = decodeURIComponent(new URL(url).pathname.split('/server/files/config/')[1] ?? '')
      const text = disk[path]
      return Promise.resolve(
        text === undefined ? new Response('', { status: 404 }) : new Response(text),
      )
    }),
  )
}

async function loadedStore() {
  const quickConfig = useQuickConfigStore()
  await quickConfig.load()
  return quickConfig
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  setActivePinia(createPinia())
  useAvailabilityStore().moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
  const moonraker = useMoonrakerStore()
  moonraker.connectionPhase = 'connected'
  vi.spyOn(moonraker, 'rpcCall').mockImplementation((method: string) => {
    if (method === 'server.files.list') {
      return Promise.resolve(
        Object.keys(disk).map((path) => ({ path, modified: 1, size: 1, permissions: 'rw' })),
      ) as never
    }
    return Promise.resolve({}) as never
  })
  const printerConfig = usePrinterConfigStore()
  printerConfig.settings = {
    printer: { max_accel: 6000, max_velocity: 600, square_corner_velocity: 5 },
    input_shaper: { shaper_freq_x: 53.8 },
  }
  stubFiles()
})

describe('quick config store', () => {
  it('follows includes from printer.cfg and reads the effective line', async () => {
    const quickConfig = await loadedStore()
    const fields = quickConfig.cards.flatMap((card) => card.fields)

    expect(fields.find((field) => field.option === 'max_accel')).toMatchObject({
      value: '6000',
      location: { path: 'hardware/limits.cfg', line: 2 },
    })
  })

  it('edits through the shared buffers, so the editor sees the same unsaved file', async () => {
    const quickConfig = await loadedStore()
    const machineFiles = useMachineFilesStore()

    quickConfig.setValue({ section: 'printer', option: 'max_accel' }, '7000')

    expect(machineFiles.isPathDirty('hardware/limits.cfg')).toBe(true)
    expect(machineFiles.isPathDirty('printer.cfg')).toBe(false)
    expect(machineFiles.configBuffer('hardware/limits.cfg')?.content).toBe(
      '[printer]\nmax_velocity: 600\nmax_accel: 7000\n',
    )
    expect(quickConfig.unsavedCount).toBe(1)
    expect(quickConfig.unsavedPaths).toEqual(['hardware/limits.cfg'])
  })

  it('saves only the files it touched', async () => {
    const quickConfig = await loadedStore()
    const machineFiles = useMachineFilesStore()
    quickConfig.setValue({ section: 'printer', option: 'max_accel' }, '7000')
    machineFiles.setConfigBufferContent('printer.cfg', `${disk['printer.cfg']}\n# editor edit`)

    expect(await quickConfig.save(false)).toBe(true)

    expect(uploads).toHaveLength(1)
    expect(machineFiles.isPathDirty('hardware/limits.cfg')).toBe(false)
    expect(machineFiles.isPathDirty('printer.cfg')).toBe(true)
  })

  it('refuses a plain save of a SAVE_CONFIG edit, which the next SAVE_CONFIG would undo', async () => {
    const quickConfig = await loadedStore()
    quickConfig.setValue({ section: 'input_shaper', option: 'shaper_freq_x' }, '55.2')

    expect(quickConfig.requiresRestart).toBe(true)
    expect(await quickConfig.save(false)).toBe(false)
    expect(uploads).toHaveLength(0)
  })

  it('refuses to restart during a print', async () => {
    const quickConfig = await loadedStore()
    usePrinterStore().printStats.state = 'printing'
    quickConfig.setValue({ section: 'printer', option: 'max_accel' }, '7000')

    expect(await quickConfig.save(true)).toBe(false)
    expect(uploads).toHaveLength(0)
  })

  it('discards what it wrote', async () => {
    const quickConfig = await loadedStore()
    const machineFiles = useMachineFilesStore()
    quickConfig.setValue({ section: 'printer', option: 'max_accel' }, '7000')

    quickConfig.discard()

    expect(machineFiles.isPathDirty('hardware/limits.cfg')).toBe(false)
    expect(quickConfig.unsavedCount).toBe(0)
  })

  it('reverts one field to disk, taking out a line it added for a default', async () => {
    const quickConfig = await loadedStore()
    const machineFiles = useMachineFilesStore()
    const accel = { section: 'printer', option: 'max_accel' }
    const corner = { section: 'printer', option: 'square_corner_velocity' }
    quickConfig.setValue(accel, '7000')
    quickConfig.setValue(corner, '8')

    quickConfig.revert(accel)
    quickConfig.revert(corner)

    expect(machineFiles.isPathDirty('hardware/limits.cfg')).toBe(false)
    expect(quickConfig.unsavedCount).toBe(0)
  })

  it('records a value Klipper would read differently instead of writing it', async () => {
    const quickConfig = await loadedStore()
    const pin = { section: 'printer', option: 'max_accel' }

    quickConfig.setValue(pin, '7000 # fast')

    expect(quickConfig.fieldError(pin)).toBe('invalidValue')
    expect(useMachineFilesStore().isPathDirty('hardware/limits.cfg')).toBe(false)
  })

  it('never writes an option this firmware does not read', async () => {
    const quickConfig = await loadedStore()
    quickConfig.replacePins([{ section: 'printer', option: 'pressure_advance' }])

    quickConfig.setValue({ section: 'printer', option: 'pressure_advance' }, '0.04')

    expect(useMachineFilesStore().unsavedFilePaths).toEqual([])
  })

  it('shows the defaults this printer has until the list is changed, then keeps the change', async () => {
    const quickConfig = await loadedStore()

    expect(quickConfig.storedPins).toBeNull()
    expect(quickConfig.pins.map((pin) => pin.option)).toEqual([
      'max_velocity',
      'max_accel',
      'square_corner_velocity',
      'shaper_freq_x',
    ])

    quickConfig.unpin({ section: 'printer', option: 'max_velocity' })

    expect(quickConfig.storedPins?.map((pin) => pin.option)).toEqual([
      'max_accel',
      'square_corner_velocity',
      'shaper_freq_x',
    ])
    expect(window.localStorage.getItem('alabaster.quickConfig.pins')).toContain('max_accel')
  })
})

describe('quick config card options', () => {
  it('replaces one section’s options in order and leaves the others', async () => {
    const quickConfig = await loadedStore()

    quickConfig.setSectionPins('printer', ['square_corner_velocity', 'max_accel'])

    expect(quickConfig.pins).toEqual([
      { section: 'input_shaper', option: 'shaper_freq_x' },
      { section: 'printer', option: 'square_corner_velocity' },
      { section: 'printer', option: 'max_accel' },
    ])
    expect(
      quickConfig.cards.find((card) => card.key === 'printer')?.fields.map((field) => field.option),
    ).toEqual(['square_corner_velocity', 'max_accel'])
  })

  it('removes the card when a section is left with no options', async () => {
    const quickConfig = await loadedStore()

    quickConfig.setSectionPins('printer', [])

    expect(quickConfig.cards.map((card) => card.key)).toEqual(['input_shaper'])
  })
})

describe('keeping a running value', () => {
  it('writes it to the effective line and saves, without a restart', async () => {
    const quickConfig = useQuickConfigStore()

    const result = await quickConfig.persistOption('printer', 'max_accel', '6500')

    expect(result).toEqual({ status: 'saved', path: 'hardware/limits.cfg' })
    expect(uploads).toHaveLength(1)
    expect(useMachineFilesStore().isPathDirty('hardware/limits.cfg')).toBe(false)
    expect(quickConfig.savedValue('printer', 'max_accel')).toBe('6500')
  })

  it('leaves it in the buffer when the file holds someone else’s unsaved edits', async () => {
    const quickConfig = await loadedStore()
    const machineFiles = useMachineFilesStore()
    machineFiles.setConfigBufferContent(
      'hardware/limits.cfg',
      `${disk['hardware/limits.cfg']}# editor edit
`,
    )

    const result = await quickConfig.persistOption('printer', 'max_accel', '6500')

    expect(result).toEqual({ status: 'buffered', path: 'hardware/limits.cfg' })
    expect(uploads).toHaveLength(0)
  })

  it('refuses a SAVE_CONFIG line and an option among pending results', async () => {
    const quickConfig = await loadedStore()

    expect(await quickConfig.persistOption('input_shaper', 'shaper_freq_x', '60')).toEqual({
      status: 'refused',
      reason: 'autosave',
    })

    usePrinterStore().saveConfigPendingItems = { printer: { max_accel: '6000' } }
    expect(await quickConfig.persistOption('printer', 'max_accel', '6500')).toEqual({
      status: 'refused',
      reason: 'pending',
    })
    expect(uploads).toHaveLength(0)
  })
})

describe('normalizeQuickConfigPins', () => {
  it('lower-cases, drops invalid entries and duplicates, and keeps null for untouched', () => {
    expect(normalizeQuickConfigPins(undefined)).toBeNull()
    expect(
      normalizeQuickConfigPins([
        { section: 'Printer', option: 'Max_Accel' },
        { section: 'printer', option: 'max_accel' },
        { section: '', option: 'x' },
        'nonsense',
      ]),
    ).toEqual([{ section: 'printer', option: 'max_accel' }])
  })
})
