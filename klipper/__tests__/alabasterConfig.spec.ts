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
const userTemplate = readFileSync(join(process.cwd(), 'klipper', 'alabaster-user.cfg'), 'utf8')

/** The settings blocks: the pack's defaults, mirrored in the user template. */
const settingsMacros = ['_ALABASTER', '_ALABASTER_FILAMENT', '_ALABASTER_PURGE']

/** `variable_` name to raw value, from lines that may be commented out with `#`. */
function variables(body: string, commented: boolean): Map<string, string> {
  const pattern = commented ? /^#variable_(\w+):\s*(.*)$/gm : /^variable_(\w+):\s*(.*)$/gm
  return new Map([...body.matchAll(pattern)].map((match) => [match[1]!, match[2]!.trim()]))
}

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

  it('never waits on the motion queue inside the per-layer wrapper', () => {
    /*
     * SET_PRINT_STATS_INFO runs at every layer change. An M400 in it drains
     * the planner each time, so the toolhead stops and leaves a blob on every
     * layer of every print — on the printers of everyone who installs the pack.
     */
    expect(macroBody(config, 'SET_PRINT_STATS_INFO')).not.toMatch(/\bM400\b/)
  })

  it('reaches user macros only through the guarded hook', () => {
    /*
     * The hooks are how an owner adds their own pause, resume, and cancel steps
     * without redefining the macros, which Klipper lets them do silently and
     * which drops everything the pack does. Each hook must be a setting the
     * owner can find, and must go through `_ALABASTER_HOOK`: called blind, a
     * misspelled name is only an "Unknown command" line in the console.
     */
    const settings = macroBody(config, '_ALABASTER')
    const hooks: Record<string, string> = {
      PAUSE: 'user_pause_macro',
      RESUME: 'user_resume_macro',
      CANCEL_PRINT: 'user_cancel_macro',
    }
    for (const [macro, setting] of Object.entries(hooks)) {
      expect(settings, `_ALABASTER must declare ${setting}`).toContain(`variable_${setting}:`)
      expect(macroBody(config, macro)).toContain(`_ALABASTER_HOOK SETTING=${setting}`)
    }
  })

  it('cancels before running the owner cancel macro', () => {
    // A failing cancel macro of the owner's must not be able to leave the print
    // running, so the base cancel has to come first.
    const cancel = macroBody(config, 'CANCEL_PRINT')
    expect(cancel.indexOf('_ALABASTER_CANCEL_BASE')).toBeGreaterThanOrEqual(0)
    expect(cancel.indexOf('_ALABASTER_CANCEL_BASE')).toBeLessThan(
      cancel.indexOf('_ALABASTER_HOOK SETTING=user_cancel_macro'),
    )
  })

  it('keeps its helpers out of the user macro picker', () => {
    /*
     * A pack that puts eight internal helpers in front of the user has made
     * the picker worse for everyone who installs it. `isSelectableMacroObject`
     * is the interface's own rule, so this asks the question the picker will.
     */
    const userFacing = new Set(['LOAD_FILAMENT', 'UNLOAD_FILAMENT', 'ADAPTIVE_PURGE'])
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

  it('sizes the purge from the printer it runs on', () => {
    /*
     * The adaptive purges this replaces hard-coded what they should have read:
     * clamping at 0 instead of the axis limits sent a line past X max and
     * stopped the print, and a fixed 5 mm² cross-section delivered half the
     * requested flow on 1.75 mm filament. Each of these is a value Klipper
     * already knows; the purge must ask rather than assume.
     */
    const purge = macroBody(config, '_ALABASTER_PURGE_LINE')
    for (const source of [
      'printer.toolhead.axis_minimum',
      'printer.toolhead.axis_maximum',
      'config.max_extrude_cross_section',
      'config.filament_diameter',
      'config.nozzle_diameter',
      'printer.exclude_object.objects',
    ]) {
      expect(purge, `_ALABASTER_PURGE_LINE must read ${source}`).toContain(source)
    }
  })

  it('checks the hotend before the purge plans a single move', () => {
    // ADAPTIVE_PURGE waits for temperature and then calls the planner, so
    // can_extrude is read after the wait. Planning in the same macro would
    // read it before M109 had run.
    const purge = macroBody(config, 'ADAPTIVE_PURGE')
    expect(purge.indexOf('M109')).toBeGreaterThanOrEqual(0)
    expect(purge.indexOf('M109')).toBeLessThan(purge.indexOf('_ALABASTER_PURGE_LINE'))
    expect(macroBody(config, '_ALABASTER_PURGE_LINE')).toContain('can_extrude')
  })

  it('lists every setting in the user template, at its default', () => {
    /*
     * alabaster.cfg is read-only on an installed printer, so alabaster-user.cfg
     * is the only place the owner can see what is adjustable. A setting
     * missing from it is one nobody finds; one listed at a different value
     * than the pack's default tells the owner the wrong default.
     */
    for (const name of settingsMacros) {
      const defaults = variables(macroBody(config, name), false)
      const listed = variables(macroBody(userTemplate, name), true)
      expect([...listed.keys()].sort(), `${name} in alabaster-user.cfg`).toEqual(
        [...defaults.keys()].sort(),
      )
      for (const [variable, value] of defaults) {
        expect(listed.get(variable), `${name}.${variable} default`).toBe(value)
      }
    }
  })

  it('ships a user template that changes nothing until the owner edits it', () => {
    /*
     * The installer copies the template once and never again. An active line
     * in it would pin that value on every new install, so a later release
     * improving the default would never reach them.
     */
    expect(userTemplate).not.toMatch(/^\s*variable_/m)
    expect(userTemplate).not.toMatch(/^\s*gcode:/m)
  })

  it('includes the user settings last, without requiring them', () => {
    /*
     * Last, so each value set there replaces the default above it. A pattern,
     * because Klipper refuses to start on a plain include whose file is
     * missing, and the pack updates on its own, ahead of the installer that
     * creates the file.
     */
    const sections = [...config.matchAll(/^\[([^\n]+)\]\s*$/gm)].map((match) => match[1]!)
    expect(sections.at(-1)).toMatch(/^include alabaster-user\.cf\[g\]$/)
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
