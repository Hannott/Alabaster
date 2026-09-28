/**
 * What Quick config shows for each pinned option: its value now, on disk, and
 * as Klipper loaded it, where it lives, and whether it may be edited.
 *
 * Three sources, because each answers a different question and a field needs
 * all three. The buffers say what the user is editing; the saved text says
 * what is on disk; `configfile.config` says what Klipper is running. The
 * difference between the first two is an unsaved edit, and between the last
 * two a saved change still waiting for a restart. A field that read only what
 * Klipper loaded would snap back to the old value after a plain save, which
 * reads as the save having failed.
 *
 * Kept free of Vue and i18n: it returns facts, and the view picks the words.
 */

import {
  effectiveOption,
  optionKey,
  sectionKey,
  type ConfigIndex,
} from '@/features/config/optionLocator'
import { optionUnit, type OptionUnit } from '@/features/config/optionUnits'

/** A pinned option. Both names are stored lower-cased, the way Klipper reports them. */
export interface QuickConfigPin {
  section: string
  option: string
}

/**
 * What a first open shows before the user has pinned anything: the limits,
 * leveling, shaping, and retraction values people come back to, filtered to
 * the sections the printer actually has.
 */
export const defaultQuickConfigPins: readonly QuickConfigPin[] = [
  { section: 'printer', option: 'max_velocity' },
  { section: 'printer', option: 'max_accel' },
  { section: 'printer', option: 'square_corner_velocity' },
  { section: 'printer', option: 'max_z_velocity' },
  { section: 'bed_mesh', option: 'probe_count' },
  { section: 'bed_mesh', option: 'mesh_min' },
  { section: 'bed_mesh', option: 'mesh_max' },
  { section: 'bed_mesh', option: 'algorithm' },
  { section: 'z_tilt', option: 'retries' },
  { section: 'z_tilt', option: 'retry_tolerance' },
  { section: 'quad_gantry_level', option: 'retries' },
  { section: 'quad_gantry_level', option: 'retry_tolerance' },
  { section: 'input_shaper', option: 'shaper_type_x' },
  { section: 'input_shaper', option: 'shaper_freq_x' },
  { section: 'input_shaper', option: 'shaper_type_y' },
  { section: 'input_shaper', option: 'shaper_freq_y' },
  { section: 'extruder', option: 'pressure_advance' },
  { section: 'extruder', option: 'pressure_advance_smooth_time' },
  { section: 'firmware_retraction', option: 'retract_length' },
  { section: 'firmware_retraction', option: 'retract_speed' },
]

export type QuickConfigFieldKind = 'number' | 'boolean' | 'text'

export type QuickConfigLock =
  /**
   * Klipper holds unsaved calibration results that would overwrite this line
   * on the next `SAVE_CONFIG`: either this option is among them, or the line
   * is in the `#*#` block, which `SAVE_CONFIG` regenerates whole from memory.
   */
  | 'pendingCalibration'
  /** The value spans lines; it is edited in the file. */
  | 'multiline'
  /**
   * Neither the file nor Klipper has this option, so this firmware does not
   * read it — and Klipper refuses to start on an option it does not read, so
   * adding the line would take the printer down. Kalico's non-linear pressure
   * advance has no `pressure_advance`, which is the case that found this.
   */
  | 'unknownOption'

export interface QuickConfigField {
  section: string
  option: string
  kind: QuickConfigFieldKind
  unit: OptionUnit | null
  /** The value in the buffer, or null when the option is not in the file. */
  value: string | null
  /** The value on disk, or null when the option is not in the saved file. */
  savedValue: string | null
  /** Klipper's resolved value, which is its default when the file does not set one. */
  defaultValue: string | null
  location: { path: string; line: number } | null
  /** The effective line is in the `#*#` block, so only a restart keeps an edit to it. */
  autosave: boolean
  unsaved: boolean
  /** On disk differs from what Klipper loaded: saved, not yet applied. */
  unapplied: boolean
  lock: QuickConfigLock | null
}

export interface QuickConfigCard {
  /** The section as written in the file, or the pinned name when it is missing. */
  section: string
  key: string
  /** Files holding a block of this section, in Klipper's reading order. */
  files: string[]
  /** The section is not in the configuration; the card keeps its pins until they are removed. */
  missing: boolean
  fields: QuickConfigField[]
}

export interface QuickConfigInputs {
  pins: readonly QuickConfigPin[]
  /** The index over buffer contents. */
  current: ConfigIndex
  /** The index over the text last saved to disk. */
  saved: ConfigIndex
  /** `configfile.settings`: typed, lower-cased, defaults included. */
  settings: Readonly<Record<string, unknown>>
  /** `configfile.config`, lower-cased; empty until Klipper has reported it. */
  loadedConfig: Readonly<Record<string, Readonly<Record<string, string>>>>
  savePending: boolean
  pendingItems: Readonly<Record<string, Readonly<Record<string, string | undefined>> | undefined>>
}

function settingOf(
  settings: QuickConfigInputs['settings'],
  section: string,
  option: string,
): unknown {
  const values = settings[sectionKey(section)]
  if (values === null || typeof values !== 'object') return undefined
  return (values as Record<string, unknown>)[option.toLowerCase()]
}

function kindOf(setting: unknown): QuickConfigFieldKind {
  if (typeof setting === 'number') return 'number'
  if (typeof setting === 'boolean') return 'boolean'
  return 'text'
}

/** A `configfile.settings` value as the file would spell it, or null for one that is not a single value. */
export function textOf(setting: unknown): string | null {
  if (setting === null || setting === undefined) return null
  if (typeof setting === 'boolean') return setting ? 'True' : 'False'
  if (Array.isArray(setting)) return setting.join(', ')
  if (typeof setting === 'object') return null
  return String(setting)
}

/** Line by line, trimmed, without blank lines, so a value's layout is not read as a change. */
function comparable(value: string): string {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n')
}

function pendingKeys(items: QuickConfigInputs['pendingItems']): Set<string> {
  const keys = new Set<string>()
  for (const [section, options] of Object.entries(items)) {
    if (!options) continue
    for (const option of Object.keys(options)) keys.add(optionKey(section, option))
  }
  return keys
}

/** The pins to show: the stored list, or the defaults this printer's config actually has. */
export function visiblePins(
  stored: readonly QuickConfigPin[] | null,
  hasOption: (pin: QuickConfigPin) => boolean,
): QuickConfigPin[] {
  if (stored) return [...stored]
  return defaultQuickConfigPins.filter(hasOption)
}

export function buildQuickConfigCards(inputs: QuickConfigInputs): QuickConfigCard[] {
  const pending = pendingKeys(inputs.pendingItems)
  const hasLoadedConfig = Object.keys(inputs.loadedConfig).length > 0
  const hasSettings = Object.keys(inputs.settings).length > 0
  const cards = new Map<string, QuickConfigCard>()

  for (const pin of inputs.pins) {
    const key = sectionKey(pin.section)
    let card = cards.get(key)
    if (!card) {
      const blocks = inputs.current.sections.get(key) ?? []
      card = {
        section: blocks[0]?.section ?? pin.section,
        key,
        files: [...new Set(blocks.map((block) => block.path))],
        missing: blocks.length === 0,
        fields: [],
      }
      cards.set(key, card)
    }

    const current = effectiveOption(inputs.current, pin.section, pin.option)
    const saved = effectiveOption(inputs.saved, pin.section, pin.option)
    const setting = settingOf(inputs.settings, pin.section, pin.option)
    const loaded = inputs.loadedConfig[key]?.[pin.option.toLowerCase()] ?? null
    const savedValue = saved?.value ?? null
    const value = current?.value ?? null

    const unapplied =
      hasLoadedConfig &&
      (savedValue === null || loaded === null
        ? savedValue !== loaded
        : comparable(savedValue) !== comparable(loaded))

    const autosave = current?.autosave ?? false
    let lock: QuickConfigLock | null = null
    if (current?.multiline) lock = 'multiline'
    else if (!current && hasSettings && setting === undefined) lock = 'unknownOption'
    else if (pending.has(optionKey(pin.section, pin.option)) || (autosave && inputs.savePending)) {
      lock = 'pendingCalibration'
    }

    card.fields.push({
      section: pin.section,
      option: pin.option,
      kind: kindOf(setting),
      unit: optionUnit(pin.section, pin.option),
      value,
      savedValue,
      defaultValue: textOf(setting),
      location: current ? { path: current.path, line: current.line } : null,
      autosave,
      unsaved: value !== savedValue,
      unapplied,
      lock,
    })
  }

  return [...cards.values()].sort((left, right) => {
    if (left.missing !== right.missing) return left.missing ? 1 : -1
    return left.key.localeCompare(right.key)
  })
}

export interface OptionCatalogueEntry {
  option: string
  /** The value in the file, or Klipper's default when the file does not set it. */
  value: string | null
  isDefault: boolean
}

export interface OptionCatalogueSection {
  section: string
  key: string
  options: OptionCatalogueEntry[]
}

/*
 * Sections that are either not options at all or data a calibration writes:
 * a shell command registered as G-code, an include, a pin alias table, and a
 * saved mesh profile's grid (`bed_mesh default`, as opposed to `bed_mesh`
 * itself). A macro is pinnable only by its `variable_*` values — its body and
 * description are not fields, but a park height or a purge length is exactly
 * the kind of value people come back to tune.
 */
const unpinnableSectionTypes = new Set([
  'delayed_gcode',
  'gcode_shell_command',
  'include',
  'board_pins',
])

export function isPinnableOption(section: string, option: string): boolean {
  const key = sectionKey(section)
  const type = key.split(/\s+/)[0] ?? ''
  if (unpinnableSectionTypes.has(type)) return false
  if (type === 'gcode_macro') return option.toLowerCase().startsWith('variable_')
  return !(type === 'bed_mesh' && key.includes(' '))
}

/**
 * Every option Quick config can pin, grouped by section: what the files set
 * plus every default Klipper resolved, which is the reason to search here at
 * all. A value that spans lines is left out, since it cannot be a field.
 */
export function buildOptionCatalogue(
  current: ConfigIndex,
  settings: QuickConfigInputs['settings'],
): OptionCatalogueSection[] {
  const sections = new Map<string, OptionCatalogueSection>()

  function add(section: string, option: string, value: string | null, isDefault: boolean): void {
    const key = sectionKey(section)
    if (!isPinnableOption(section, option)) return
    let entry = sections.get(key)
    if (!entry) {
      entry = { section: current.sections.get(key)?.[0]?.section ?? section, key, options: [] }
      sections.set(key, entry)
    }
    const name = option.toLowerCase()
    if (entry.options.some((existing) => existing.option === name)) return
    entry.options.push({ option: name, value, isDefault })
  }

  for (const occurrences of current.options.values()) {
    const effective = occurrences.at(-1)
    if (!effective || effective.multiline) continue
    add(effective.section, effective.option, effective.value, false)
  }
  for (const [section, values] of Object.entries(settings)) {
    if (values === null || typeof values !== 'object') continue
    for (const [option, setting] of Object.entries(values as Record<string, unknown>)) {
      if (current.options.has(optionKey(section, option))) continue
      if (Array.isArray(setting) && setting.some(Array.isArray)) continue
      const text = textOf(setting)
      if (text === null || text.includes('\n')) continue
      add(section, option, text, true)
    }
  }

  return [...sections.values()]
    .map((entry) => ({
      ...entry,
      options: [...entry.options].sort((left, right) => left.option.localeCompare(right.option)),
    }))
    .sort((left, right) => left.key.localeCompare(right.key))
}

export interface UnappliedChange {
  section: string
  option: string
  /** On disk now, or null when the line has been removed since Klipper loaded it. */
  disk: string | null
  /** What Klipper loaded, or null for a line added since. */
  loaded: string | null
  location: { path: string; line: number } | null
  multiline: boolean
}

/**
 * Every option whose text on disk differs from what Klipper loaded, across
 * the whole configuration rather than only pinned options — the answer to
 * "why does my change not work?" is usually an edit nobody restarted for, in
 * a file nobody has open. Empty until Klipper has reported its config, since
 * without that there is nothing to compare against.
 */
export function unappliedChanges(
  saved: ConfigIndex,
  loadedConfig: QuickConfigInputs['loadedConfig'],
): UnappliedChange[] {
  if (Object.keys(loadedConfig).length === 0) return []
  const changes: UnappliedChange[] = []
  const seen = new Set<string>()

  for (const [key, occurrences] of saved.options) {
    const effective = occurrences.at(-1)
    if (!effective) continue
    seen.add(key)
    const section = sectionKey(effective.section)
    if (section.startsWith('include ')) continue
    const loaded = loadedConfig[section]?.[effective.option.toLowerCase()] ?? null
    if (loaded !== null && comparable(loaded) === comparable(effective.value)) continue
    changes.push({
      section: effective.section,
      option: effective.option,
      disk: effective.value,
      loaded,
      location: { path: effective.path, line: effective.line },
      multiline: effective.multiline || (loaded?.includes('\n') ?? false),
    })
  }

  /*
   * A loaded option with no line on disk counts as removed only where its
   * section is still on disk. A whole section missing from the files is not a
   * removal: plugins register sections into Klipper's config at startup —
   * Shake&Tune's macros are the case that found this — and a file the files API
   * could not read leaves its sections out of the index too.
   */
  for (const [section, options] of Object.entries(loadedConfig)) {
    if (!saved.sections.has(section)) continue
    for (const [option, loaded] of Object.entries(options)) {
      if (seen.has(optionKey(section, option))) continue
      changes.push({
        section,
        option,
        disk: null,
        loaded,
        location: null,
        multiline: loaded.includes('\n'),
      })
    }
  }

  return changes.sort(
    (left, right) =>
      sectionKey(left.section).localeCompare(sectionKey(right.section)) ||
      left.option.localeCompare(right.option),
  )
}

export interface ConfigWarning {
  kind: 'deprecatedOption' | 'deprecatedValue' | 'runtime'
  /** Klipper's own sentence, shown as it wrote it. */
  message: string
  section: string | null
  option: string | null
  value: string | null
}

/**
 * `configfile.warnings`, the deprecations Klipper found while loading and any
 * warning raised since. Klipper otherwise only writes these to `klippy.log`,
 * where nobody reads them until an upgrade removes the option outright.
 */
export function readConfigWarnings(value: unknown): ConfigWarning[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): ConfigWarning[] => {
    if (entry === null || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    if (typeof record.message !== 'string') return []
    const kind =
      record.type === 'deprecated_option'
        ? 'deprecatedOption'
        : record.type === 'deprecated_value'
          ? 'deprecatedValue'
          : 'runtime'
    return [
      {
        kind,
        message: record.message,
        section: typeof record.section === 'string' ? record.section : null,
        option: typeof record.option === 'string' ? record.option : null,
        value: typeof record.value === 'string' ? record.value : null,
      },
    ]
  })
}
