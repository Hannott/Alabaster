import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { excludedMacroNames, isSelectableMacroObject } from '@/stores/macros'

/*
 * `alabaster.cfg` is the other half of features the interface only half owns.
 * Print's pause-at-layer row calls `SET_PAUSE_AT_LAYER` with the parameters it
 * decided on, and the macro that answers lives in a file no compiler reads —
 * so renaming a parameter in the component ships a config that silently stops
 * answering, on printers nobody can run a test on.
 *
 * These assertions are the join. They read the real file, not a fixture: a
 * fixture would go stale in exactly the way this exists to prevent.
 */

const config = readFileSync(join(process.cwd(), 'klipper', 'alabaster.cfg'), 'utf8')

/** Every `[gcode_macro NAME]` the pack defines, upper-cased as Klipper reads them. */
function definedMacros(source: string): Set<string> {
  const names = new Set<string>()
  for (const match of source.matchAll(/^\[gcode_macro\s+([^\]]+)\]/gm)) {
    names.add(match[1]!.trim().toUpperCase())
  }
  return names
}

/** The body of one macro: everything from its header to the next section. */
function macroBody(source: string, name: string): string {
  const start = source.search(new RegExp(`^\\[gcode_macro\\s+${name}\\]`, 'm'))
  expect(start, `${name} is not defined in alabaster.cfg`).toBeGreaterThanOrEqual(0)
  const rest = source.slice(start)
  const nextSection = rest.slice(1).search(/^\[/m)
  return nextSection < 0 ? rest : rest.slice(0, nextSection + 1)
}

/** The body of one `[section]` — not a macro — up to the next section header. */
function sectionBody(source: string, header: string): string {
  const start = source.search(new RegExp(`^\\[${header}\\]`, 'm'))
  expect(start, `[${header}] is not declared in alabaster.cfg`).toBeGreaterThanOrEqual(0)
  const rest = source.slice(start)
  const nextSection = rest.slice(1).search(/^\[/m)
  return nextSection < 0 ? rest : rest.slice(0, nextSection + 1)
}

const macros = definedMacros(config)

describe('alabaster.cfg', () => {
  it('defines every macro the print controls own', () => {
    /*
     * `excludedMacroNames` is the interface's own list of macros it dispatches
     * itself and keeps out of the user's macro picker. It is therefore exactly
     * the set the pack has to supply — imported rather than repeated, so
     * adding a name there fails here until the config catches up.
     */
    for (const name of excludedMacroNames) {
      expect(macros, `alabaster.cfg must define ${name}`).toContain(name)
    }
  })

  it('answers the parameters the pause-at-layer controls send', () => {
    // PrintModule.vue sends ENABLE, LAYER, and MACRO to the first, and
    // ENABLE and MACRO to the second.
    const atLayer = macroBody(config, 'SET_PAUSE_AT_LAYER')
    for (const parameter of ['ENABLE', 'LAYER', 'MACRO']) {
      expect(atLayer, `SET_PAUSE_AT_LAYER must read params.${parameter}`).toContain(
        `params.${parameter}`,
      )
    }

    const nextLayer = macroBody(config, 'SET_PAUSE_NEXT_LAYER')
    for (const parameter of ['ENABLE', 'MACRO']) {
      expect(nextLayer, `SET_PAUSE_NEXT_LAYER must read params.${parameter}`).toContain(
        `params.${parameter}`,
      )
    }
  })

  it('compares an armed layer against the counter the interface reads', () => {
    /*
     * Print's layer readout comes from `print_stats.info.current_layer`, and
     * the dialog seeds itself from that same number. A macro comparing against
     * anything else would pause at a layer other than the one the user typed.
     */
    const wrapper = macroBody(config, 'SET_PRINT_STATS_INFO')
    expect(wrapper).toContain('params.CURRENT_LAYER')
    expect(macroBody(config, 'SET_PAUSE_NEXT_LAYER')).toContain(
      'printer.print_stats.info.current_layer',
    )
  })

  it('runs the base command before acting on it', () => {
    /*
     * The layer counters Alabaster displays come from Klipper's own
     * SET_PRINT_STATS_INFO. Wrapping it and forgetting to call through would
     * freeze the readout on every printer that installs this pack — a much
     * larger failure than the pause it was added for.
     */
    const wrapper = macroBody(config, 'SET_PRINT_STATS_INFO')
    const renamed = /rename_existing:\s*(\S+)/.exec(wrapper)?.[1]
    expect(renamed, 'SET_PRINT_STATS_INFO must rename the existing command').toBeDefined()
    expect(wrapper).toContain(`${renamed} {rawparams}`)
  })

  it('keeps its helpers out of the user macro picker', () => {
    /*
     * A pack that puts eight internal helpers in front of the user has made
     * the picker worse for everyone who installs it. `isSelectableMacroObject`
     * is the interface's own rule, so this asks the question the picker will.
     */
    const userFacing = new Set(['LOAD_FILAMENT', 'UNLOAD_FILAMENT'])
    for (const name of macros) {
      if (userFacing.has(name)) continue
      expect(
        isSelectableMacroObject(`gcode_macro ${name}`),
        `${name} would appear in the macro picker; prefix it with _ or exclude it`,
      ).toBe(false)
    }
  })

  it('offers the filament macros the Extruder card expects', () => {
    for (const name of ['LOAD_FILAMENT', 'UNLOAD_FILAMENT']) {
      expect(macros).toContain(name)
      expect(isSelectableMacroObject(`gcode_macro ${name}`)).toBe(true)
    }
  })

  it('renames overridden commands out of the way', () => {
    /*
     * `rename_existing` moves Klipper's original command to a new name. Give it
     * a name without the underscore and the original turns up in the picker
     * beside the override, which is a confusing thing to hand someone.
     */
    for (const match of config.matchAll(/rename_existing:\s*(\S+)/g)) {
      const renamed = match[1]!
      expect(renamed.startsWith('_'), `${renamed} should start with _`).toBe(true)
      expect(
        macros.has(renamed.toUpperCase()),
        `${renamed} collides with a macro this file defines`,
      ).toBe(false)
    }
  })

  it('declares the printer objects the interface subscribes to', () => {
    // exclude_object backs Print's "Exclude object"; pause_resume is what
    // PAUSE/RESUME are built on and what the interface reads to tell whether
    // a pause took.
    for (const section of ['pause_resume', 'exclude_object']) {
      expect(config).toContain(`[${section}]`)
    }
  })

  it('cleans up after a file error the way CANCEL_PRINT is meant to', () => {
    // A file read/print error is exactly the case CANCEL_PRINT exists to
    // recover from — heaters off, nozzle parked. Wiring virtual_sdcard to
    // anything else would leave that failure mode without the cleanup this
    // pack was written to provide.
    expect(sectionBody(config, 'virtual_sdcard')).toMatch(/on_error_gcode:\s*CANCEL_PRINT/)
  })
})
