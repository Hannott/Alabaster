import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useConsoleStore } from '@/stores/console'
import { buildMacroScript, formatMacroLabel, macroNamesFrom, useMacrosStore } from '@/stores/macros'
import { useMoonrakerStore } from '@/stores/moonraker'

describe('macro discovery', () => {
  it('keeps operator macros and drops helpers, overrides, and print controls', () => {
    expect(
      macroNamesFrom([
        'gcode_macro LOAD_FILAMENT',
        'gcode_macro _CLIENT_EXTRUDE',
        'gcode_macro CANCEL_PRINT',
        'gcode_macro PAUSE',
        'gcode_macro SET_PRINT_STATS_INFO',
        'gcode_macro M109',
        'gcode_macro G28',
        'gcode_macro load_filament',
        'gcode_macro CALIBRATE_MESH',
        'gcode_macro ',
        'toolhead',
        'heater_bed',
      ]),
    ).toEqual(['CALIBRATE_MESH', 'LOAD_FILAMENT'])
  })

  it('renders macro names as readable, title-cased labels', () => {
    expect(formatMacroLabel('RESONANCE_TEST_X')).toBe('Resonance Test X')
  })

  it('builds an invocation the way Klipper parses one', () => {
    expect(buildMacroScript('clean_nozzle')).toBe('CLEAN_NOZZLE')
    expect(buildMacroScript('CLEAN_NOZZLE', { WIPES: '5', TEMP: '' })).toBe('CLEAN_NOZZLE WIPES=5')
    // An empty value omits the parameter so the macro's own default applies;
    // a value with spaces takes the one quoting Klipper's splitter reads.
    expect(buildMacroScript('SET_LED_NAME', { NAME: 'chamber light' })).toBe(
      'SET_LED_NAME NAME="chamber light"',
    )
  })
})

describe('macros store', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('reports which macros the printer no longer offers', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({
      objects: ['gcode_macro LOAD_FILAMENT'],
    } as never)

    const macros = useMacrosStore()
    expect(macros.isMissing('OLD_MACRO')).toBe(false)

    await macros.refresh()

    expect(macros.discovered).toEqual(['LOAD_FILAMENT'])
    expect(macros.isMissing('OLD_MACRO')).toBe(true)
    expect(macros.isMissing('load_filament')).toBe(false)
  })

  it('reports which macros the printer confirms it offers, not merely "not yet known missing"', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({
      objects: ['gcode_macro LOAD_FILAMENT'],
    } as never)

    const macros = useMacrosStore()
    // Before discovery finishes, this must read false — `isMissing` reading
    // false at this point (nothing is "confirmed missing" yet) is not the
    // same fact, and a caller gating a control on it would flash the control
    // on before the printer had said anything at all.
    expect(macros.hasMacro('LOAD_FILAMENT')).toBe(false)

    await macros.refresh()

    expect(macros.hasMacro('load_filament')).toBe(true)
    expect(macros.hasMacro('OLD_MACRO')).toBe(false)
  })

  it('confirms a macro even when `macroNamesFrom` excludes it from the generic picker', async () => {
    // The regression case: SET_PAUSE_AT_LAYER is deliberately absent from
    // `discovered` (it's excluded from the generic macro picker on purpose —
    // see `excludedMacroNames`), which is exactly why `hasMacro` must not be
    // built on top of that list. It shipped that way once, and read false on
    // every printer that actually has the macro.
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({
      objects: ['gcode_macro SET_PAUSE_AT_LAYER', 'gcode_macro SET_PAUSE_NEXT_LAYER'],
    } as never)

    const macros = useMacrosStore()
    await macros.refresh()

    expect(macros.discovered).toEqual([])
    expect(macros.hasMacro('SET_PAUSE_AT_LAYER')).toBe(true)
    expect(macros.hasMacro('SET_PAUSE_NEXT_LAYER')).toBe(true)
  })

  it('runs a macro with no local deadline, echoing it into the console first', async () => {
    const moonraker = useMoonrakerStore()
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue('ok' as never)
    const macros = useMacrosStore()

    expect(await macros.run('load_filament', { LENGTH: '50' })).toBe(true)
    // A macro is arbitrary user G-code: its duration belongs to the printer,
    // so the request must never carry the transport's sixty-second default —
    // that deadline is what reported a healthy heat soak as failed.
    expect(rpcCall).toHaveBeenCalledWith(
      'printer.gcode.script',
      { script: 'LOAD_FILAMENT LENGTH=50' },
      { timeoutMs: null },
    )
    // The echo lands like every other card command's, so the live console
    // never disagrees with Moonraker's own gcode_store about what was sent.
    expect(useConsoleStore().consoleLines).toContain('LOAD_FILAMENT LENGTH=50')
    expect(macros.lastError).toBeNull()

    rpcCall.mockRejectedValueOnce(new Error('klipper busy'))
    expect(await macros.run('LOAD_FILAMENT')).toBe(false)
    expect(macros.lastError).toBe('LOAD_FILAMENT')
    expect(rpcCall).toHaveBeenCalledTimes(2)

    macros.clearError()
    expect(macros.lastError).toBeNull()
  })

  it('ignores a repeated run while the macro is still executing', async () => {
    const moonraker = useMoonrakerStore()
    let release: (() => void) | undefined
    vi.spyOn(moonraker, 'rpcCall').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve('ok')
        }) as never,
    )

    const macros = useMacrosStore()
    const first = macros.run('CALIBRATE_MESH')

    expect(macros.isRunning('CALIBRATE_MESH')).toBe(true)
    expect(await macros.run('CALIBRATE_MESH')).toBe(false)

    release?.()
    expect(await first).toBe(true)
    expect(macros.isRunning('CALIBRATE_MESH')).toBe(false)
  })

  it('reports a failed discovery without claiming macros are missing', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockRejectedValue(new Error('offline'))

    const macros = useMacrosStore()
    await macros.refresh()

    expect(macros.failed).toBe(true)
    expect(macros.hasDiscovered).toBe(false)
    expect(macros.isMissing('CALIBRATE_MESH')).toBe(false)
  })
})
