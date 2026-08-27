import { describe, expect, it } from 'vitest'

import {
  atParamBoundary,
  classifyResponse,
  cleanConsoleMessage,
  commandNameFromLine,
  completeCommand,
  filterConsoleEntries,
  isFilteredEntry,
  unfilledMacroParams,
  type ConsoleEntry,
} from '@/services/console/transcript'
import type { MacroParameter } from '@/dashboard/macroParams'

function entry(raw: string, overrides: Partial<ConsoleEntry> = {}): ConsoleEntry {
  return {
    id: 1,
    kind: classifyResponse(raw),
    raw,
    message: cleanConsoleMessage(raw),
    at: 0,
    ...overrides,
  }
}

describe('console transcript', () => {
  it('reads a line kind off the prefix Klipper marks it with', () => {
    expect(classifyResponse('!! Move out of range')).toBe('error')
    expect(classifyResponse('// action:prompt_begin Nozzle')).toBe('action')
    expect(classifyResponse('// debug:probe accuracy')).toBe('debug')
    expect(classifyResponse('// Klipper state: Ready')).toBe('response')
    expect(classifyResponse('ok')).toBe('response')
  })

  it('strips prefixes from every line of a multi-line response', () => {
    // A single gcode response carrying several lines prefixes each one, so
    // cleaning only the first would leave the rest showing the punctuation.
    expect(cleanConsoleMessage('// Kp=22.2\n// Ki=1.08\n// Kd=114')).toBe(
      'Kp=22.2\nKi=1.08\nKd=114',
    )
    expect(cleanConsoleMessage('!! Printer is shutdown')).toBe('Printer is shutdown')
    expect(cleanConsoleMessage('echo: SET_FAN_SPEED')).toBe('SET_FAN_SPEED')
    // Both markers go: the line is already dimmed as debug output, so repeating
    // that as punctuation only costs the reader width.
    expect(cleanConsoleMessage('// debug:probe accuracy\n')).toBe('probe accuracy')
  })

  it('leaves text that merely starts with a slash alone', () => {
    // Only Klipper's own `// ` and `!! ` markers are punctuation; a path is data.
    expect(cleanConsoleMessage('/home/pi/printer_data')).toBe('/home/pi/printer_data')
  })

  it('hides temperature reports in both the bare and ok-prefixed forms', () => {
    const options = { hideTemperatureReports: true, hideTimelapseCommands: false }
    expect(isFilteredEntry(entry('T:24.1 /0.0 B:23.8 /0.0'), options)).toBe(true)
    expect(isFilteredEntry(entry('ok T:24.1 /0.0 B:23.8 /0.0'), options)).toBe(true)
    expect(isFilteredEntry(entry('T0:210.0 /210.0'), options)).toBe(true)
    expect(isFilteredEntry(entry('B:60.0 /60.0'), options)).toBe(true)
  })

  it('keeps a response that merely mentions a temperature', () => {
    // The pattern is anchored precisely so this survives — an unanchored match
    // would swallow the answer to any question about a heater.
    const options = { hideTemperatureReports: true, hideTimelapseCommands: false }
    expect(isFilteredEntry(entry('// Extruder max_temp is 300'), options)).toBe(false)
    expect(isFilteredEntry(entry('!! Heater extruder not heating at expected rate'), options)).toBe(
      false,
    )
  })

  it('never hides a command the user typed', () => {
    // A filter quiets the printer. Dropping someone's own input would read as
    // the console having missed it.
    const options = { hideTemperatureReports: true, hideTimelapseCommands: true }
    expect(isFilteredEntry(entry('M105', { kind: 'command' }), options)).toBe(false)
    expect(isFilteredEntry(entry('TIMELAPSE_RENDER', { kind: 'command' }), options)).toBe(false)
  })

  it('hides timelapse macro chatter only while that filter is on', () => {
    const line = entry('// TIMELAPSE_TAKE_FRAME')
    expect(
      isFilteredEntry(line, { hideTemperatureReports: true, hideTimelapseCommands: true }),
    ).toBe(true)
    expect(
      isFilteredEntry(line, { hideTemperatureReports: true, hideTimelapseCommands: false }),
    ).toBe(false)
  })

  it('filters a transcript without disturbing the order of what remains', () => {
    const entries = [
      entry('M105', { id: 1, kind: 'command' }),
      entry('ok T:24.1 /0.0', { id: 2 }),
      entry('// Ready', { id: 3 }),
    ]
    expect(
      filterConsoleEntries(entries, {
        hideTemperatureReports: true,
        hideTimelapseCommands: false,
      }).map((line) => line.id),
    ).toEqual([1, 3])
  })

  it('completes a unique command outright', () => {
    expect(completeCommand('bed_mes', ['BED_MESH_CALIBRATE', 'BED_SCREWS_ADJUST'])).toEqual({
      value: 'BED_MESH_CALIBRATE',
      matches: ['BED_MESH_CALIBRATE'],
    })
  })

  it('fills to the longest shared prefix and offers every match', () => {
    // Converging rather than cycling is what makes a second Tab press useful:
    // `SET_` lists the options, one more character narrows them.
    const commands = ['SET_FAN_SPEED', 'SET_GCODE_OFFSET', 'SET_PRESSURE_ADVANCE']
    expect(completeCommand('set', commands)).toEqual({ value: 'SET_', matches: commands })
    expect(completeCommand('set_g', commands)).toEqual({
      value: 'SET_GCODE_OFFSET',
      matches: ['SET_GCODE_OFFSET'],
    })
  })

  it('leaves the input alone when nothing matches or there is nothing to add', () => {
    expect(completeCommand('zzz', ['G28'])).toEqual({ value: 'zzz', matches: [] })
    expect(completeCommand('', ['G28'])).toEqual({ value: '', matches: [] })
    // Both candidates share exactly what was typed, so Tab must not shorten it
    // to the machine's casing and lose the user's characters.
    expect(completeCommand('SET_', ['SET_FAN_SPEED', 'SET_GCODE_OFFSET']).value).toBe('SET_')
  })

  it('reads the macro name as the word before the first space', () => {
    expect(commandNameFromLine('RUN_PA_TEST')).toBe('RUN_PA_TEST')
    expect(commandNameFromLine('RUN_PA_TEST NOZZLE=0.4')).toBe('RUN_PA_TEST')
    expect(commandNameFromLine('  RUN_PA_TEST  ')).toBe('RUN_PA_TEST')
    expect(commandNameFromLine('')).toBe('')
  })

  it('only reports a parameter unfilled until its NAME= token appears', () => {
    const params: MacroParameter[] = [
      { name: 'NOZZLE', defaultValue: null },
      { name: 'BED', defaultValue: '60' },
    ]
    expect(unfilledMacroParams('RUN_PA_TEST ', params)).toEqual(params)
    expect(unfilledMacroParams('RUN_PA_TEST NOZZLE=0.4 ', params)).toEqual([
      { name: 'BED', defaultValue: '60' },
    ])
    // Case-insensitive: Klipper uppercases whatever case a parameter is typed in.
    expect(unfilledMacroParams('RUN_PA_TEST nozzle=0.4 bed=60', params)).toEqual([])
    expect(unfilledMacroParams('RUN_PA_TEST', [])).toEqual([])
  })

  it('only offers a suggestion right after whitespace, never mid-word', () => {
    expect(atParamBoundary('RUN_PA_TEST ')).toBe(true)
    expect(atParamBoundary('RUN_PA_TEST')).toBe(false)
    expect(atParamBoundary('RUN_PA_TEST NOZZLE=0.4 ')).toBe(true)
    expect(atParamBoundary('RUN_PA_TEST NOZ')).toBe(false)
  })
})
