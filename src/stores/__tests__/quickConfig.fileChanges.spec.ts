import { describe, expect, it } from 'vitest'

import { parseFileListChange } from '@/services/moonraker'
import { fileChangeReachesConfig } from '@/stores/quickConfig'

const loaded = ['printer.cfg', 'macros/park.cfg']
const texts: Record<string, string> = {
  'printer.cfg': '[include macros/*.cfg]\n[include hardware.cfg]\n[printer]\nkinematics: corexy\n',
  'macros/park.cfg': '[gcode_macro PARK]\ngcode: G28\n',
}
const textOf = (path: string) => texts[path]

function reaches(params: Record<string, unknown>): boolean {
  return fileChangeReachesConfig(parseFileListChange([params])!, loaded, textOf)
}

describe('fileChangeReachesConfig', () => {
  it('reloads for a change to a file Klipper reads', () => {
    expect(
      reaches({ action: 'modify_file', item: { root: 'config', path: 'macros/park.cfg' } }),
    ).toBe(true)
    expect(reaches({ action: 'delete_dir', item: { root: 'config', path: 'macros' } })).toBe(true)
  })

  it('reloads when a new file is one an include now picks up', () => {
    expect(
      reaches({ action: 'create_file', item: { root: 'config', path: 'macros/purge.cfg' } }),
    ).toBe(true)
    expect(reaches({ action: 'create_file', item: { root: 'config', path: 'hardware.cfg' } })).toBe(
      true,
    )
  })

  it('ignores files the configuration never reads', () => {
    expect(
      reaches({ action: 'modify_file', item: { root: 'config', path: 'variables.cfg' } }),
    ).toBe(false)
    expect(
      reaches({ action: 'create_file', item: { root: 'config', path: 'shaketune_results/a.png' } }),
    ).toBe(false)
    expect(reaches({ action: 'create_file', item: { root: 'gcodes', path: 'macros/x.cfg' } })).toBe(
      false,
    )
  })
})
