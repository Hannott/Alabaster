/**
 * Where the configuration editor's context menu sends a reader to read about
 * what they clicked: Klipper's or Kalico's own reference, and Jinja's.
 *
 * Every anchor comes from `docsAnchors.json`, generated from each project's
 * documentation sources by `scripts/extract-docs-anchors.mjs`, never from a
 * slug guessed off the name. A guessed anchor fails silently — `[stepper_x]`
 * is documented as `[stepper]`, `[extruder1]` under its own heading, every
 * add-on nowhere — and a link to an anchor that does not exist opens the top
 * of a five-thousand-line page while looking as though it worked. So a name
 * the table does not know gets no link at all.
 *
 * Kept free of Vue: the table is passed in, so the URLs can be tested against
 * a fixture, and the view decides when the table is loaded.
 */

import type { MoonrakerUpdateEntry } from '@/services/moonraker/types'

export type DocsSite = 'klipper' | 'kalico'

export const docsSites: readonly DocsSite[] = ['klipper', 'kalico']

export type TemplateTopic = 'parameters' | 'rawparams' | 'printer' | 'actions' | 'variables'

export interface DocsSiteAnchors {
  /** Documentation pages the site has, without their extension. */
  pages: readonly string[]
  /** A Config_Reference heading's bracketed name, as written, to its anchor. */
  configSections: Readonly<Record<string, string>>
  /** An upper-case command to its anchor on G-Codes. */
  commands: Readonly<Record<string, string>>
  /** A Status_Reference heading to its anchor. */
  statusObjects: Readonly<Record<string, string>>
  templateTopics: Readonly<Partial<Record<TemplateTopic, string>>>
}

export type DocsAnchors = Readonly<Record<DocsSite, DocsSiteAnchors>>

export function isDocsSite(value: unknown): value is DocsSite {
  return value === 'klipper' || value === 'kalico'
}

const siteRoots: Readonly<Record<DocsSite, string>> = {
  klipper: 'https://www.klipper3d.org',
  kalico: 'https://docs.kalico.gg',
}

const jinjaRoot = 'https://jinja.palletsprojects.com/en/stable/templates/'

let anchorsRequest: Promise<DocsAnchors> | null = null
let loadedAnchors: DocsAnchors | null = null

/**
 * The table, loaded on first use rather than bundled into the route: it is
 * three times the size of the rest of the editor, and only a context menu
 * reads it.
 */
export function loadDocsAnchors(): Promise<DocsAnchors> {
  anchorsRequest ??= import('@/features/machine/docsAnchors.json').then((module) => {
    loadedAnchors = module.default as DocsAnchors
    return loadedAnchors
  })
  return anchorsRequest
}

/**
 * The table if it has already loaded. A menu reads this on its first render,
 * because rows arriving a tick later would re-render the menu under the row
 * that was just given focus.
 */
export function loadedDocsAnchors(): DocsAnchors | null {
  return loadedAnchors
}

/*
 * Matched by the repository's name, not its owner: a printer running a fork —
 * `someone/kalico` — runs Kalico's code and reads Kalico's manual. Kalico was
 * Danger Klipper until 2024, and a clone made before the rename still reports
 * the old name.
 */
const kalicoRepositoryNames = new Set(['kalico', 'danger-klipper'])

function repositoryName(entry: MoonrakerUpdateEntry & { remote_url?: string }): string | null {
  if (entry.repo_name) return entry.repo_name.toLowerCase()
  const match = /[/:]([^/:]+?)(?:\.git)?\/?$/.exec(entry.remote_url ?? '')
  return match?.[1] ? match[1].toLowerCase() : null
}

/**
 * Which project's documentation describes the firmware this printer runs, read
 * from the repository Moonraker's update manager tracks for it. Null when the
 * update manager does not manage Klipper, which leaves the choice to the
 * caller's fallback.
 *
 * This is the one question Alabaster asks about what the firmware *is* rather
 * than what it can do, and it is allowed because the answer is only ever a
 * documentation site — see the note on `extruderSettings` in `printerConfig.ts`.
 */
export function detectDocsSite(
  entry: (MoonrakerUpdateEntry & { remote_url?: string }) | null | undefined,
): DocsSite | null {
  if (!entry) return null
  const name = repositoryName(entry)
  if (!name) return null
  return kalicoRepositoryNames.has(name) ? 'kalico' : 'klipper'
}

/**
 * The heading a section is documented under. The name as written wins when a
 * heading carries it; otherwise the section type, then the numbered and named
 * instances each reference documents once on behalf of the rest.
 */
export function documentedSection(anchors: DocsSiteAnchors, section: string): string | null {
  const name = section.trim().replace(/\s+/g, ' ')
  const lower = name.toLowerCase()
  const sections = anchors.configSections
  if (sections[lower]) return sections[lower]
  const [type = '', ...rest] = lower.split(' ')
  if (rest.length > 0) {
    const named = Object.keys(sections).find((key) => key.startsWith(`${type} `))
    if (named && sections[named]) return sections[named]
  }
  if (sections[type]) return sections[type]
  if (/^extruder\d+$/.test(type) && sections.extruder1) return sections.extruder1
  if (/^stepper_[a-z]+\d+$/.test(type) && sections.stepper_z1) return sections.stepper_z1
  if (/^stepper_[a-z]+$/.test(type) && sections.stepper) return sections.stepper
  return null
}

/**
 * A section's entry on Config_Reference. An option has no anchor of its own
 * there, so it adds `?h=`, which both sites' search highlighting reads to mark
 * the word on the page the section's anchor lands on.
 */
export function configReferenceUrl(
  site: DocsSite,
  anchors: DocsSiteAnchors,
  section: string,
  option?: string,
): string | null {
  const anchor = documentedSection(anchors, section)
  if (!anchor) return null
  const highlight = option ? `?h=${encodeURIComponent(option)}` : ''
  return `${siteRoots[site]}/Config_Reference.html${highlight}#${anchor}`
}

/*
 * The sections with a guide of their own beside their reference entry. A page
 * the site does not have is skipped, so Kalico's extra guides can be listed
 * here without Klipper ever offering them.
 */
const sectionGuides: Readonly<Record<string, string>> = {
  bed_mesh: 'Bed_Mesh',
  input_shaper: 'Resonance_Compensation',
  resonance_tester: 'Measuring_Resonances',
  adxl345: 'Measuring_Resonances',
  lis2dw: 'Measuring_Resonances',
  lis3dh: 'Measuring_Resonances',
  mpu9250: 'Measuring_Resonances',
  icm20948: 'Measuring_Resonances',
  bmi160: 'Measuring_Resonances',
  tmc2130: 'TMC_Drivers',
  tmc2208: 'TMC_Drivers',
  tmc2209: 'TMC_Drivers',
  tmc2660: 'TMC_Drivers',
  tmc2240: 'TMC_Drivers',
  tmc5160: 'TMC_Drivers',
  probe: 'Probe_Calibrate',
  bltouch: 'BLTouch',
  probe_eddy_current: 'Eddy_Probe',
  load_cell: 'Load_Cell',
  load_cell_probe: 'Load_Cell',
  gcode_macro: 'Command_Templates',
  delayed_gcode: 'Command_Templates',
  exclude_object: 'Exclude_Object',
  skew_correction: 'Skew_Correction',
  endstop_phase: 'Endstop_Phase',
  bed_screws: 'Manual_Level',
  screws_tilt_adjust: 'Manual_Level',
  axis_twist_compensation: 'Axis_Twist_Compensation',
  delta_calibrate: 'Delta_Calibrate',
  extruder: 'Pressure_Advance',
  stepper: 'Rotation_Distance',
  pwm_tool: 'Using_PWM_Tools',
  hall_filament_width_sensor: 'Hall_Filament_Width_Sensor',
  tsl1401cl_filament_width_sensor: 'TSL1401CL_Filament_Width_Sensor',
}

export interface DocsGuide {
  /** The page's own name, as its title reads: `Bed Mesh`. */
  title: string
  url: string
}

export function sectionGuide(
  site: DocsSite,
  anchors: DocsSiteAnchors,
  section: string,
): DocsGuide | null {
  const type = section.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  const key = /^extruder\d*$/.test(type) ? 'extruder' : /^stepper_/.test(type) ? 'stepper' : type
  const page = sectionGuides[key]
  if (!page || !anchors.pages.includes(page)) return null
  return { title: page.replace(/_/g, ' '), url: `${siteRoots[site]}/${page}.html` }
}

const CLASSIC_CODE = /^[GMT]\d+(?:\.\d+)?$/

/** A command's entry on G-Codes; the standard numbered codes share one list there. */
export function commandReferenceUrl(
  site: DocsSite,
  anchors: DocsSiteAnchors,
  command: string,
): string | null {
  const name = command.toUpperCase()
  if (CLASSIC_CODE.test(name)) return `${siteRoots[site]}/G-Codes.html#g-code-commands`
  const anchor = anchors.commands[name]
  return anchor ? `${siteRoots[site]}/G-Codes.html#${anchor}` : null
}

/*
 * Status_Reference documents several object types under one heading each, as
 * its own prose says: every heater under `heater`, every TMC driver under `tmc
 * drivers`, the fan flavours under `fan`.
 */
function statusHeading(object: string): string {
  const type = object.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  if (/^extruder\d*$/.test(type) || type === 'heater_bed' || type === 'heater_generic') {
    return 'heater'
  }
  if (/^tmc\d+$/.test(type)) return 'tmc drivers'
  if (type === 'heater_fan' || type === 'controller_fan') return 'fan'
  return type
}

/** A printer object's entry on Status_Reference, for `printer.toolhead` and its kind. */
export function statusReferenceUrl(
  site: DocsSite,
  anchors: DocsSiteAnchors,
  object: string,
): string | null {
  const heading = anchors.statusObjects[object.toLowerCase()]
    ? object.toLowerCase()
    : statusHeading(object)
  const anchor = anchors.statusObjects[heading]
  return anchor ? `${siteRoots[site]}/Status_Reference.html#${anchor}` : null
}

export function templateGuideUrl(
  site: DocsSite,
  anchors: DocsSiteAnchors,
  topic: TemplateTopic,
): string | null {
  const anchor = anchors.templateTopics[topic]
  return anchor ? `${siteRoots[site]}/Command_Templates.html#${anchor}` : null
}

/** What Klipper adds to a template's context, and the guide topic that documents it. */
export function klipperGlobalTopic(name: string): TemplateTopic | null {
  if (name === 'printer') return 'printer'
  if (name === 'params') return 'parameters'
  if (name === 'rawparams') return 'rawparams'
  if (name.startsWith('action_')) return 'actions'
  return null
}

/*
 * Anchors on Jinja's Template Designer page. A closing keyword links to the
 * statement it closes, since that section is where both are explained.
 */
const jinjaKeywordAnchors: Readonly<Record<string, string>> = {
  if: 'if',
  elif: 'if',
  else: 'if',
  endif: 'if',
  for: 'for',
  endfor: 'for',
  recursive: 'for',
  set: 'assignments',
  endset: 'block-assignments',
  macro: 'macros',
  endmacro: 'macros',
  call: 'call',
  endcall: 'call',
  filter: 'filters',
  endfilter: 'filters',
  raw: 'escaping',
  endraw: 'escaping',
  with: 'with-statement',
  endwith: 'with-statement',
  break: 'loop-controls',
  continue: 'loop-controls',
  in: 'other-operators',
  is: 'tests',
  not: 'logic',
  and: 'logic',
  or: 'logic',
}

const jinjaFilters = new Set([
  'abs',
  'attr',
  'batch',
  'capitalize',
  'center',
  'default',
  'dictsort',
  'escape',
  'filesizeformat',
  'first',
  'float',
  'forceescape',
  'format',
  'groupby',
  'indent',
  'int',
  'items',
  'join',
  'last',
  'length',
  'list',
  'lower',
  'map',
  'max',
  'min',
  'pprint',
  'random',
  'reject',
  'rejectattr',
  'replace',
  'reverse',
  'round',
  'safe',
  'select',
  'selectattr',
  'slice',
  'sort',
  'string',
  'striptags',
  'sum',
  'title',
  'tojson',
  'trim',
  'truncate',
  'unique',
  'upper',
  'urlencode',
  'urlize',
  'wordcount',
  'wordwrap',
  'xmlattr',
])
const jinjaFilterAliases: Readonly<Record<string, string>> = {
  d: 'default',
  e: 'escape',
  count: 'length',
}

const jinjaTests = new Set([
  'boolean',
  'callable',
  'defined',
  'divisibleby',
  'eq',
  'escaped',
  'even',
  'false',
  'filter',
  'float',
  'ge',
  'gt',
  'in',
  'integer',
  'iterable',
  'le',
  'lower',
  'lt',
  'mapping',
  'ne',
  'none',
  'number',
  'odd',
  'sameas',
  'sequence',
  'string',
  'test',
  'true',
  'undefined',
  'upper',
])
const jinjaTestAliases: Readonly<Record<string, string>> = {
  equalto: 'eq',
  greaterthan: 'gt',
  lessthan: 'lt',
}

const jinjaGlobals = new Set(['range', 'lipsum', 'dict', 'cycler', 'joiner', 'namespace'])

export type JinjaName =
  | { kind: 'keyword'; name: string }
  | { kind: 'filter'; name: string }
  | { kind: 'test'; name: string }
  | { kind: 'global'; name: string }

/** The documented name a word resolves to, or null for one Jinja does not define. */
export function jinjaName(kind: JinjaName['kind'], word: string): JinjaName | null {
  const lower = word.toLowerCase()
  if (kind === 'keyword') return jinjaKeywordAnchors[lower] ? { kind, name: lower } : null
  if (kind === 'filter') {
    const name = jinjaFilterAliases[lower] ?? lower
    return jinjaFilters.has(name) ? { kind, name } : null
  }
  if (kind === 'test') {
    const name = jinjaTestAliases[lower] ?? lower
    return jinjaTests.has(name) ? { kind, name } : null
  }
  return jinjaGlobals.has(lower) ? { kind, name: lower } : null
}

export function jinjaUrl(name: JinjaName): string {
  if (name.kind === 'keyword') return `${jinjaRoot}#${jinjaKeywordAnchors[name.name] ?? ''}`
  if (name.kind === 'filter') return `${jinjaRoot}#jinja-filters.${name.name}`
  if (name.kind === 'test') return `${jinjaRoot}#jinja-tests.${name.name}`
  return `${jinjaRoot}#jinja-globals.${name.name}`
}
