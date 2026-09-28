import { describe, expect, it } from 'vitest'

import { defaultQuickConfigPins } from '@/features/config/quickConfigFields'
import anchors from '@/features/machine/docsAnchors.json'
import {
  commandReferenceUrl,
  configReferenceUrl,
  detectDocsSite,
  documentedSection,
  jinjaName,
  jinjaUrl,
  sectionGuide,
  statusReferenceUrl,
  templateGuideUrl,
  type DocsAnchors,
} from '@/features/machine/docsLinks'

const table = anchors as DocsAnchors
const klipper = table.klipper
const kalico = table.kalico

describe('detectDocsSite', () => {
  it('reads Kalico from the repository the update manager tracks', () => {
    expect(detectDocsSite({ owner: 'KalicoCrew', repo_name: 'kalico' })).toBe('kalico')
    expect(detectDocsSite({ owner: 'Klipper3d', repo_name: 'klipper' })).toBe('klipper')
  })

  it('reads a clone made before the rename, and a remote URL when owner is missing', () => {
    expect(detectDocsSite({ owner: 'DangerKlippers', repo_name: 'danger-klipper' })).toBe('kalico')
    expect(detectDocsSite({ remote_url: 'https://github.com/KalicoCrew/kalico.git' })).toBe(
      'kalico',
    )
  })

  it('reads a fork by the project it forks, whoever owns it', () => {
    expect(detectDocsSite({ owner: 'Hannott', repo_name: 'kalico' })).toBe('kalico')
    expect(detectDocsSite({ remote_url: 'git@github.com:someone/kalico.git' })).toBe('kalico')
  })

  it('reads a fork of Klipper as Klipper, and no entry as no answer', () => {
    expect(detectDocsSite({ owner: 'someone', repo_name: 'klipper' })).toBe('klipper')
    expect(detectDocsSite(undefined)).toBeNull()
    expect(detectDocsSite({})).toBeNull()
  })
})

describe('documentedSection', () => {
  it('maps numbered and named instances onto the heading that documents them', () => {
    expect(documentedSection(klipper, 'bed_mesh')).toBe('bed_mesh')
    expect(documentedSection(klipper, 'stepper_x')).toBe('stepper')
    expect(documentedSection(klipper, 'stepper_z2')).toBe('stepper_z1')
    expect(documentedSection(klipper, 'extruder')).toBe('extruder')
    expect(documentedSection(klipper, 'extruder3')).toBe('extruder1')
    expect(documentedSection(klipper, 'tmc2209 stepper_x')).toBe('tmc2209')
    expect(documentedSection(klipper, 'mcu EBBCan')).toBe('mcu-my_extra_mcu')
    expect(documentedSection(klipper, 'gcode_macro PARK')).toBe('gcode_macro')
  })

  it('knows no anchor for a section neither reference documents', () => {
    expect(documentedSection(klipper, 'shaketune')).toBeNull()
    expect(documentedSection(klipper, 'z_tilt_ng')).toBeNull()
    expect(documentedSection(kalico, 'z_tilt_ng')).toBe('z_tilt_ng')
  })

  it('has an anchor on both sites for every section Quick config offers by default', () => {
    for (const { section } of defaultQuickConfigPins) {
      expect(documentedSection(klipper, section), section).not.toBeNull()
      expect(documentedSection(kalico, section), section).not.toBeNull()
    }
  })
})

describe('reference URLs', () => {
  it('links a section, and an option with the highlight both sites read', () => {
    expect(configReferenceUrl('klipper', klipper, 'bed_mesh')).toBe(
      'https://www.klipper3d.org/Config_Reference.html#bed_mesh',
    )
    expect(configReferenceUrl('kalico', kalico, 'bed_mesh', 'probe_count')).toBe(
      'https://docs.kalico.gg/Config_Reference.html?h=probe_count#bed_mesh',
    )
    expect(configReferenceUrl('klipper', klipper, 'shaketune')).toBeNull()
  })

  it('offers a guide only where the site has the page', () => {
    expect(sectionGuide('klipper', klipper, 'bed_mesh')).toEqual({
      title: 'Bed Mesh',
      url: 'https://www.klipper3d.org/Bed_Mesh.html',
    })
    expect(sectionGuide('klipper', klipper, 'tmc5160 stepper_y')?.title).toBe('TMC Drivers')
    expect(sectionGuide('klipper', klipper, 'printer')).toBeNull()
    expect(sectionGuide('klipper', { ...klipper, pages: [] }, 'bed_mesh')).toBeNull()
  })

  it('links commands, sharing one anchor for the numbered codes', () => {
    expect(commandReferenceUrl('klipper', klipper, 'bed_mesh_calibrate')).toBe(
      'https://www.klipper3d.org/G-Codes.html#bed_mesh_calibrate',
    )
    expect(commandReferenceUrl('klipper', klipper, 'EXCLUDE_OBJECT')).toBe(
      'https://www.klipper3d.org/G-Codes.html#exclude_object_1',
    )
    expect(commandReferenceUrl('klipper', klipper, 'G28')).toBe(
      'https://www.klipper3d.org/G-Codes.html#g-code-commands',
    )
    expect(commandReferenceUrl('klipper', klipper, 'PARK')).toBeNull()
  })

  it('links a status object under the heading that documents its kind', () => {
    expect(statusReferenceUrl('klipper', klipper, 'toolhead')).toBe(
      'https://www.klipper3d.org/Status_Reference.html#toolhead',
    )
    expect(statusReferenceUrl('klipper', klipper, 'extruder1')).toBe(
      'https://www.klipper3d.org/Status_Reference.html#heater',
    )
    expect(statusReferenceUrl('klipper', klipper, 'tmc2209 stepper_x')).toBe(
      'https://www.klipper3d.org/Status_Reference.html#tmc-drivers',
    )
    expect(statusReferenceUrl('klipper', klipper, 'gcode_macro PARK')).toBe(
      'https://www.klipper3d.org/Status_Reference.html#gcode_macro',
    )
  })

  it('finds the template guide topics under each site’s own headings', () => {
    expect(templateGuideUrl('klipper', klipper, 'printer')).toBe(
      'https://www.klipper3d.org/Command_Templates.html#the-printer-variable',
    )
    expect(templateGuideUrl('kalico', kalico, 'parameters')).toBe(
      'https://docs.kalico.gg/Command_Templates.html#jinja2-macro-parameters',
    )
  })
})

describe('Jinja', () => {
  it('resolves keywords, filters with their aliases, tests, and globals', () => {
    expect(jinjaName('keyword', 'endif')).toEqual({ kind: 'keyword', name: 'endif' })
    expect(jinjaName('filter', 'd')).toEqual({ kind: 'filter', name: 'default' })
    expect(jinjaName('test', 'greaterthan')).toEqual({ kind: 'test', name: 'gt' })
    expect(jinjaName('global', 'range')).toEqual({ kind: 'global', name: 'range' })
    expect(jinjaName('filter', 'not_a_filter')).toBeNull()
  })

  it('links each to its anchor on the Template Designer page', () => {
    const root = 'https://jinja.palletsprojects.com/en/stable/templates/'
    expect(jinjaUrl({ kind: 'keyword', name: 'endif' })).toBe(`${root}#if`)
    expect(jinjaUrl({ kind: 'keyword', name: 'set' })).toBe(`${root}#assignments`)
    expect(jinjaUrl({ kind: 'filter', name: 'round' })).toBe(`${root}#jinja-filters.round`)
    expect(jinjaUrl({ kind: 'test', name: 'defined' })).toBe(`${root}#jinja-tests.defined`)
    expect(jinjaUrl({ kind: 'global', name: 'range' })).toBe(`${root}#jinja-globals.range`)
  })
})
