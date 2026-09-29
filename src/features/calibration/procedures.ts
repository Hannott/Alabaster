import { axisSteppers } from '@/features/calibration/axisRotation'
import type { CalibrationStageId } from '@/features/calibration/stages'
import {
  latestShaperRecommendations,
  setInputShaperCommand,
  type ShaperRecommendation,
} from '@/features/calibration/shaperRecommendation'

/**
 * The calibrations Calibration offers, one entry per procedure, in the order a
 * stage lists them.
 *
 * Curated, not a catalog of every command Klipper registers. Each entry is a
 * procedure Alabaster understands: what it needs before it runs, the few
 * parameters a reader has a reason to change, the command those build, and a
 * parser that turns what the printer printed into a result. A command nothing
 * here describes has its home on the Console page's command browser, not in
 * this list. Add a procedure in the same change that adds its parser and its
 * tests — an entry that cannot say what it found is a button, and the stages
 * used to be only buttons.
 */

export type ProcedureId =
  | 'endstops'
  | 'stepperBuzz'
  | 'axisRotation'
  | 'zEndstop'
  | 'endstopPhase'
  | 'tmcAutotune'
  | 'axesMap'
  | 'bedMesh'
  | 'quadGantryLevel'
  | 'zTilt'
  | 'screwsTilt'
  | 'bedScrews'
  | 'deltaCalibrate'
  | 'probeZOffset'
  | 'probeAccuracy'
  | 'bedTilt'
  | 'eddyDriveCurrent'
  | 'eddyHeight'
  | 'probeDrift'
  | 'beacon'
  | 'cartographer'
  | 'autoZ'
  | 'heaterModel'
  | 'heaterCheck'
  | 'shaperCalibrate'
  | 'shakeTuneShaper'
  | 'shakeTuneBelts'
  | 'shakeTuneVibrations'
  | 'accelerometerQuery'
  | 'axesNoise'
  | 'rotationDistance'
  | 'pressureAdvance'
  | 'runoutSensors'

/** What a procedure needs before Run is offered. Each has a word, and most have a fix. */
export type ProcedureRequirement = 'homed' | 'notPrinting' | 'probeInBed'

/** What a procedure does to the machine, stated once in its workspace. */
export type ProcedureEffect = 'moves' | 'heats' | 'probes'

/** How long a run takes, in words rather than a promise of seconds. */
export type ProcedureDuration = 'seconds' | 'minute' | 'minutes' | 'interactive'

/**
 * Where a procedure's workspace comes from: the generic form, or a panel that
 * already does the job better than a form could — a live readout, a wizard,
 * or a list that is its own result.
 */
export type ProcedurePanel =
  'endstops' | 'axisRotation' | 'rotationDistance' | 'heaterCheck' | 'runoutSensors'

/** User-facing text as data: a message key, or a Klipper name shown as it is spelled. */
export type ProcedureText = { key: string; params?: Record<string, string> } | { literal: string }

export interface ProcedureOption {
  value: string
  label: ProcedureText
}

export interface ProcedureParameter {
  /** The command's own word, as Klipper spells it. */
  key: string
  kind: 'number' | 'text' | 'select'
  /** A message key for the field's label. */
  label: string
  /** A message key for the unit suffix, if the value has one. */
  unit?: string
  /** The value the field starts with; '' leaves the word off and lets Klipper decide. */
  initial: (context: ProcedureContext) => string
  /** Klipper's own default, shown where the field is empty. */
  placeholder?: (context: ProcedureContext) => string
  options?: (context: ProcedureContext) => readonly ProcedureOption[]
  required?: boolean
  min?: number
  max?: number
}

export interface ProcedureHeater {
  objectName: string
  label: string
  kind: 'pid' | 'mpc'
}

/**
 * Everything a procedure may ask about the printer, gathered once by
 * `useProcedureContext` so the registry stays pure and testable.
 */
export interface ProcedureContext {
  hasSection: (name: string) => boolean
  /** Every configured section, lower-cased, as `configfile.settings` keys them. */
  sections: readonly string[]
  hasCommand: (command: string) => boolean
  hasMacro: (name: string) => boolean
  /** A section's loaded settings, lower-cased keys, or null. */
  settings: (section: string) => Record<string, unknown> | null
  kinematics: string | null
  hasProbe: boolean
  heaters: readonly ProcedureHeater[]
  hasRunoutSensors: boolean
  /** The pressure advance running right now, which the extruder reports and the config does not. */
  livePressureAdvance: number | null
  liveSmoothTime: number | null
}

export interface ProcedureResultRow {
  label: ProcedureText
  /** What the printer had before the run, where there is one to compare. */
  before?: string | null
  after: string
}

/**
 * Something a result offers to do with what it found. `gcode` runs a command
 * (a shaper applied until restart); `persist` writes options to the config
 * lines Klipper uses, through the same locator Quick config writes with. A
 * persist carries every option that only makes sense together — a shaper's
 * type without its frequency is a different shaper — so one press writes all
 * of them.
 */
export type ProcedureAction =
  | { kind: 'gcode'; id: string; label: ProcedureText; command: string }
  | {
      kind: 'persist'
      id: string
      label: ProcedureText
      section: string
      changes: readonly { option: string; value: string }[]
      /** Restart Klipper once written, so the file's values are the ones running. */
      restart?: boolean
    }

/**
 * Where a result's values went. `staged` waits for `SAVE_CONFIG`, which the
 * header offers; `applied` is live until the next restart; `measured` changed
 * nothing; `done` finished with nothing to report beyond that.
 */
export type ProcedureOutcome = 'staged' | 'applied' | 'measured' | 'done'

export interface ProcedureResult {
  rows: readonly ProcedureResultRow[]
  outcome: ProcedureOutcome
  actions?: readonly ProcedureAction[]
}

export type ProcedureValues = Readonly<Record<string, string>>

/** A settings snapshot taken when a run starts, so "before" survives the save that follows it. */
export type ProcedureSnapshot = Readonly<Record<string, string>>

export interface CalibrationProcedure {
  id: ProcedureId
  stage: CalibrationStageId
  /** The Klipper command a row names, in mono. */
  command: string
  available: (context: ProcedureContext) => boolean
  requires: readonly ProcedureRequirement[]
  effects: readonly ProcedureEffect[]
  duration: ProcedureDuration
  /** Days after which the last run reads as old; null for a procedure that does not age. */
  staleAfterDays: number | null
  panel?: ProcedurePanel
  params?: readonly ProcedureParameter[]
  /** The script Run sends, or null while the values cannot build one. */
  build?: (values: ProcedureValues, context: ProcedureContext) => string | null
  snapshot?: (values: ProcedureValues, context: ProcedureContext) => ProcedureSnapshot
  /** Reads the lines printed since the run started. Null until there is something to show. */
  parse?: (
    lines: readonly string[],
    before: ProcedureSnapshot,
    values: ProcedureValues,
  ) => ProcedureResult | null
  /**
   * The actions an earlier run's logged rows still support, for a run logged
   * before the log kept its actions.
   */
  actionsFromRows?: (rows: readonly ProcedureResultRow[]) => ProcedureAction[]
  /**
   * Ask before running. The heater models heat for minutes and cannot be
   * stopped halfway without losing the run; everything else here is one the
   * reader watches and can stop with the emergency stop they already have.
   */
  confirm?: boolean
}

/*
 * ------------------------------------------------------------------ helpers
 */

/** Klipper's informational prefix, kept on `consoleLines` and stripped here. */
function clean(line: string): string {
  return line.replace(/^\s*\/\/\s?/, '')
}

function allLines(lines: readonly string[]): string[] {
  return lines.flatMap((text) => text.split('\n')).map(clean)
}

function lastMatch(lines: readonly string[], pattern: RegExp): RegExpExecArray | null {
  const flat = allLines(lines)
  for (let index = flat.length - 1; index >= 0; index -= 1) {
    const match = pattern.exec(flat[index]!)
    if (match) return match
  }
  return null
}

/** Any Klipper line that mentions SAVE_CONFIG means the run staged something. */
function mentionsSaveConfig(lines: readonly string[]): boolean {
  return allLines(lines).some((line) => /SAVE_CONFIG/.test(line))
}

/** The fallback every command procedure shares: it finished, and maybe it staged something. */
function outcomeOnly(lines: readonly string[]): ProcedureResult | null {
  if (lines.length === 0) return null
  return { rows: [], outcome: mentionsSaveConfig(lines) ? 'staged' : 'done' }
}

function settingText(context: ProcedureContext, section: string, option: string): string | null {
  const value = context.settings(section)?.[option.toLowerCase()]
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.join(', ')
  return null
}

function literal(text: string): ProcedureText {
  return { literal: text }
}

function key(name: string, params?: Record<string, string>): ProcedureText {
  return params ? { key: name, params } : { key: name }
}

/** A value safe to put on a G-code command line: no spaces, quotes, or line breaks. */
function safeWord(value: string): string | null {
  const trimmed = value.trim()
  return /^[A-Za-z0-9_.,+-]+$/.test(trimmed) ? trimmed : null
}

function namesWithPrefix(context: ProcedureContext, prefix: string): string[] {
  return context.sections
    .filter((section) => section.startsWith(`${prefix} `))
    .map((section) => section.slice(prefix.length + 1))
}

function steppers(context: ProcedureContext): string[] {
  return context.sections.filter((section) =>
    /^(stepper_[a-z0-9]+|extruder\d*|extruder_stepper \S+)$/.test(section),
  )
}

const accelerometerSections = ['adxl345', 'lis2dw', 'lis3dh', 'mpu9250', 'icm20948', 'bmi160']

function accelerometers(context: ProcedureContext): string[] {
  return context.sections.filter((section) =>
    accelerometerSections.some((kind) => section === kind || section.startsWith(`${kind} `)),
  )
}

function isCoreKinematics(context: ProcedureContext): boolean {
  return /^corex[yz]/i.test(context.kinematics ?? '')
}

function heaterCommandName(objectName: string): string {
  return objectName.startsWith('heater_generic ')
    ? objectName.slice('heater_generic '.length)
    : objectName
}

function withWords(command: string, words: readonly (string | null)[]): string {
  return [command, ...words.filter((word): word is string => word !== null)].join(' ')
}

/** `KEY=value` for a filled field, nothing for an empty one, null for a value that is not safe. */
function word(values: ProcedureValues, name: string): string | null | undefined {
  const value = values[name]?.trim() ?? ''
  if (value === '') return null
  const safe = safeWord(value)
  return safe === null ? undefined : `${name}=${safe}`
}

function buildWithWords(
  command: string,
  values: ProcedureValues,
  names: readonly string[],
): string | null {
  const words: (string | null)[] = []
  for (const name of names) {
    const built = word(values, name)
    if (built === undefined) return null
    words.push(built)
  }
  return withWords(command, words)
}

/*
 * ------------------------------------------------------------------ parsers
 *
 * Each pattern is Klipper's own format string, from the module that prints it,
 * tolerant of the `// ` prefix informational output carries.
 */

/** `probe.py`: "%s: z_offset: %.3f" after ACCEPT; `stepper_z: position_endstop: %.3f` for the endstop. */
const zOffsetPattern = /^(\S+): z_offset: ([-\d.]+)/
const positionEndstopPattern = /^(stepper_z): position_endstop: ([-\d.]+)/
/** `z_tilt.py`/`quad_gantry_level.py`'s retry helper. */
const retriesPattern = /Retries: (\d+)\/(\d+) Probed points range: ([\d.]+) tolerance: ([\d.]+)/
/** `pid_calibrate.py`. */
const pidPattern = /PID parameters: pid_Kp=([\d.]+) pid_Ki=([\d.]+) pid_Kd=([\d.]+)/
/** Kalico's MPC calibration prints its measured model as `name=value` / `name: value` pairs. */
const mpcKeys = [
  'block_heat_capacity',
  'sensor_responsiveness',
  'ambient_transfer',
  'fan_ambient_transfer',
]
/** `shaper_calibrate.py`: the recommendation and the max_accel line before it. */
const recommendedShaperPattern =
  /Recommended shaper_type_([xy]) = (\w+), shaper_freq_[xy] = ([\d.]+) Hz/
const maxAccelPattern = /smoothing with '(\w+)', suggested max_accel <= ([\d.]+)/
/** `adxl345.py` and its siblings. */
const accelerometerPattern = /accelerometer values \(x, y, z\): ([-\d.]+), ([-\d.]+), ([-\d.]+)/
/** `resonance_tester.py`. */
const axesNoisePattern =
  /Axes noise for (\S+)-axis accelerometer: ([-\d.]+) \(x\), ([-\d.]+) \(y\), ([-\d.]+) \(z\)/
/** `probe.py`. */
const probeAccuracyPattern =
  /probe accuracy results: maximum ([-\d.]+), minimum ([-\d.]+), range ([-\d.]+), average ([-\d.]+), median ([-\d.]+), standard deviation ([-\d.]+)/i
/** `bed_tilt.py`. */
const bedTiltPattern = /x_adjust: ([-\d.]+) y_adjust: ([-\d.]+) z_adjust: ([-\d.]+)/
/** `endstop_phase.py`. */
const endstopPhasePattern = /^(\S+): trigger_phase=(\d+)\/(\d+)/
/** `screws_tilt_adjust.py`. */
const screwPattern = /^(.+?) \s*: x=.*?: adjust (CW|CCW) (\d+:\d+)$/
const baseScrewPattern = /^(.+?) \(base\) : x=/
/** Shake&Tune's `axes_map_calibration.py`: its verdict, and the map it set aside to measure. */
const detectedAxesMapPattern =
  /Detected axes_map:\s*([-+]?[xyz])\s*,\s*([-+]?[xyz])\s*,\s*([-+]?[xyz])/i
const existingAxesMapPattern = /existing axes_map \(([^)]*)\)/i

export function parseZOffset(
  lines: readonly string[],
  before: ProcedureSnapshot,
): ProcedureResult | null {
  const match = lastMatch(lines, zOffsetPattern)
  if (!match) return outcomeOnly(lines)
  return {
    rows: [{ label: literal('z_offset'), before: before.z_offset ?? null, after: match[2]! }],
    outcome: 'staged',
  }
}

export function parsePositionEndstop(
  lines: readonly string[],
  before: ProcedureSnapshot,
): ProcedureResult | null {
  const match = lastMatch(lines, positionEndstopPattern)
  if (!match) return outcomeOnly(lines)
  return {
    rows: [
      {
        label: literal('position_endstop'),
        before: before.position_endstop ?? null,
        after: match[2]!,
      },
    ],
    outcome: 'staged',
  }
}

export function parseRetries(lines: readonly string[]): ProcedureResult | null {
  const match = lastMatch(lines, retriesPattern)
  if (!match) return outcomeOnly(lines)
  return {
    rows: [
      { label: key('calibration.result.retries'), after: `${match[1]}/${match[2]}` },
      { label: key('calibration.result.range'), after: match[3]! },
      { label: key('calibration.result.tolerance'), after: match[4]! },
    ],
    outcome: 'applied',
  }
}

export function parseScrews(lines: readonly string[]): ProcedureResult | null {
  const rows: ProcedureResultRow[] = []
  for (const line of allLines(lines)) {
    const base = baseScrewPattern.exec(line)
    if (base) {
      rows.push({ label: literal(base[1]!.trim()), after: '' })
      continue
    }
    const screw = screwPattern.exec(line)
    if (screw) rows.push({ label: literal(screw[1]!.trim()), after: `${screw[2]} ${screw[3]}` })
  }
  if (rows.length === 0) return outcomeOnly(lines)
  return { rows, outcome: 'measured' }
}

export function parsePid(
  lines: readonly string[],
  before: ProcedureSnapshot,
): ProcedureResult | null {
  const match = lastMatch(lines, pidPattern)
  if (match) {
    return {
      rows: ['pid_Kp', 'pid_Ki', 'pid_Kd'].map((option, index) => ({
        label: literal(option),
        before: before[option.toLowerCase()] ?? null,
        after: match[index + 1]!,
      })),
      outcome: 'staged',
    }
  }
  const mpc: ProcedureResultRow[] = []
  for (const option of mpcKeys) {
    const found = lastMatch(lines, new RegExp(`\\b${option}\\s*[:=]\\s*([-\\d.]+)`))
    if (found)
      mpc.push({ label: literal(option), before: before[option] ?? null, after: found[1]! })
  }
  if (mpc.length > 0) return { rows: mpc, outcome: 'staged' }
  return outcomeOnly(lines)
}

export function parseShaperCalibrate(
  lines: readonly string[],
  before: ProcedureSnapshot,
): ProcedureResult | null {
  const rows: ProcedureResultRow[] = []
  const recommendations: ShaperRecommendation[] = []
  let lastAccel: Record<string, string> = {}
  for (const line of allLines(lines)) {
    const accel = maxAccelPattern.exec(line)
    if (accel) {
      lastAccel = { ...lastAccel, [accel[1]!.toLowerCase()]: accel[2]! }
      continue
    }
    const match = recommendedShaperPattern.exec(line)
    if (!match) continue
    const axis = match[1]!.toLowerCase() as 'x' | 'y'
    const shaperType = match[2]!.toLowerCase()
    const frequency = match[3]!
    rows.push(
      {
        label: literal(`shaper_type_${axis}`),
        before: before[`shaper_type_${axis}`] ?? null,
        after: shaperType,
      },
      {
        label: literal(`shaper_freq_${axis}`),
        before: before[`shaper_freq_${axis}`] ?? null,
        after: frequency,
      },
    )
    const suggested = lastAccel[shaperType]
    if (suggested !== undefined) {
      rows.push({
        label: key('calibration.result.suggestedMaxAccel', { axis: axis.toUpperCase() }),
        before: before.max_accel ?? null,
        after: suggested,
      })
    }
    lastAccel = {}
    recommendations.push({ axis, kind: 'best', shaperType, frequency: Number(frequency) })
  }
  if (rows.length === 0) return outcomeOnly(lines)
  return { rows, outcome: 'staged', actions: shaperActions(recommendations) }
}

/**
 * One Apply and one Save config for the whole run, never one per axis: the
 * two axes are one tuning, and a printer left with X saved and Y only applied
 * is a state nobody chose. The low-vibrations pick is shown but not offered,
 * since the other recommendation on the same axis is the one the run chose.
 */
function shaperActions(recommendations: readonly ShaperRecommendation[]): ProcedureAction[] {
  const chosen = new Map<ShaperRecommendation['axis'], ShaperRecommendation>()
  for (const recommendation of recommendations) {
    if (recommendation.kind === 'lowVibrations') continue
    if (setInputShaperCommand(recommendation) === null) continue
    chosen.set(recommendation.axis, recommendation)
  }
  const picks = [...chosen.values()].sort((left, right) => left.axis.localeCompare(right.axis))
  if (picks.length === 0) return []
  const words = picks.flatMap((pick) =>
    setInputShaperCommand(pick)!
      .replace(/^SET_INPUT_SHAPER /, '')
      .split(' '),
  )
  return [
    {
      kind: 'gcode',
      id: 'apply-shaper',
      label: key('calibration.result.applyShapers'),
      command: ['SET_INPUT_SHAPER', ...words].join(' '),
    },
    {
      kind: 'persist',
      id: 'save-shaper',
      label: key('calibration.result.saveShapers'),
      section: 'input_shaper',
      changes: picks.flatMap((pick) => [
        { option: `shaper_type_${pick.axis}`, value: pick.shaperType },
        { option: `shaper_freq_${pick.axis}`, value: String(pick.frequency) },
      ]),
      restart: true,
    },
  ]
}

const shaperKindKey = /^calibration\.result\.shaperKind\.(performance|lowVibrations|best)$/
const shaperRowValue = /^([a-z0-9_]+) @ ([\d.]+) Hz$/

/** The recommendations a logged Shake&Tune run's rows spell out, read back from their labels. */
export function shakeTuneShaperActionsFromRows(
  rows: readonly ProcedureResultRow[],
): ProcedureAction[] {
  const recommendations: ShaperRecommendation[] = []
  // The rows come back from the shared log, so nothing about their shape is assumed.
  for (const row of rows) {
    const label: unknown = row?.label
    if (typeof label !== 'object' || label === null || !('key' in label)) continue
    const { key: name, params } = label as { key: unknown; params?: unknown }
    if (typeof name !== 'string' || typeof row.after !== 'string') continue
    const kind = shaperKindKey.exec(name)?.[1] as ShaperRecommendation['kind'] | undefined
    const axisParam =
      typeof params === 'object' && params !== null ? (params as { axis?: unknown }).axis : null
    const axis = typeof axisParam === 'string' ? axisParam.toLowerCase() : null
    const value = shaperRowValue.exec(row.after)
    if (!kind || (axis !== 'x' && axis !== 'y') || !value) continue
    recommendations.push({ axis, kind, shaperType: value[1]!, frequency: Number(value[2]) })
  }
  return shaperActions(recommendations)
}

export function parseShakeTuneShaper(lines: readonly string[]): ProcedureResult | null {
  // The shared parser finds its run by the echoed command, which a run's own
  // output never includes; the run is already bounded, so it starts here.
  const recommendations: ShaperRecommendation[] = latestShaperRecommendations([
    'AXES_SHAPER_CALIBRATION',
    ...lines,
  ])
  if (recommendations.length === 0) return outcomeOnly(lines)
  return {
    rows: recommendations.map((recommendation) => ({
      label: key(`calibration.result.shaperKind.${recommendation.kind}`, {
        axis: recommendation.axis.toUpperCase(),
      }),
      after: `${recommendation.shaperType} @ ${recommendation.frequency} Hz`,
    })),
    outcome: 'measured',
    actions: shaperActions(recommendations),
  }
}

export function parseAccelerometer(lines: readonly string[]): ProcedureResult | null {
  const match = lastMatch(lines, accelerometerPattern)
  if (!match) return outcomeOnly(lines)
  return {
    rows: ['x', 'y', 'z'].map((axis, index) => ({
      label: literal(axis),
      after: match[index + 1]!,
    })),
    outcome: 'measured',
  }
}

export function parseAxesNoise(lines: readonly string[]): ProcedureResult | null {
  const rows: ProcedureResultRow[] = []
  for (const line of allLines(lines)) {
    const match = axesNoisePattern.exec(line)
    if (!match) continue
    rows.push({
      label: key('calibration.result.noise', { chip: match[1]! }),
      after: `${match[2]} · ${match[3]} · ${match[4]}`,
    })
  }
  if (rows.length === 0) return outcomeOnly(lines)
  return { rows, outcome: 'measured' }
}

function compactAxesMap(value: string): string {
  return value.replace(/\s+/g, '').replace(/\+/g, '').toLowerCase()
}

/**
 * The accelerometer section `AXES_MAP_CALIBRATION` measures with when no
 * `ACCEL_CHIP` is given: the one `[resonance_tester]` names for X, else the
 * only one there is. Null where that is ambiguous, so the result offers no
 * write rather than guessing which chip's section the map belongs in.
 */
function axesMapChip(context: ProcedureContext): string | null {
  const chips = accelerometers(context)
  const tester = context.settings('resonance_tester')
  for (const option of ['accel_chip', 'accel_chip_x']) {
    const named = tester?.[option]
    if (typeof named === 'string' && chips.includes(named.trim().toLowerCase())) {
      return named.trim().toLowerCase()
    }
  }
  return chips.length === 1 ? chips[0]! : null
}

export function parseAxesMap(
  lines: readonly string[],
  before: ProcedureSnapshot,
): ProcedureResult | null {
  const match = lastMatch(lines, detectedAxesMapPattern)
  if (!match) return outcomeOnly(lines)
  const detected = compactAxesMap(`${match[1]},${match[2]},${match[3]}`)
  const existing = lastMatch(lines, existingAxesMapPattern)?.[1]
  const previous = before.axes_map || existing
  const current = previous ? compactAxesMap(previous) : null
  const chip = before.accel_chip ?? ''
  return {
    rows: [{ label: literal('axes_map'), before: current, after: detected }],
    outcome: 'measured',
    actions:
      chip !== '' && current !== detected
        ? [
            {
              kind: 'persist',
              id: 'persist-axes-map',
              label: key('calibration.result.writeToSection', {
                option: 'axes_map',
                section: chip,
              }),
              section: chip,
              changes: [{ option: 'axes_map', value: detected }],
            },
          ]
        : [],
  }
}

export function parseProbeAccuracy(lines: readonly string[]): ProcedureResult | null {
  const match = lastMatch(lines, probeAccuracyPattern)
  if (!match) return outcomeOnly(lines)
  const labels = ['maximum', 'minimum', 'range', 'average', 'median', 'standardDeviation']
  return {
    rows: labels.map((label, index) => ({
      label: key(`calibration.probe.${label}`),
      after: match[index + 1]!,
    })),
    outcome: 'measured',
  }
}

export function parseBedTilt(
  lines: readonly string[],
  before: ProcedureSnapshot,
): ProcedureResult | null {
  const match = lastMatch(lines, bedTiltPattern)
  if (!match) return outcomeOnly(lines)
  return {
    rows: ['x_adjust', 'y_adjust', 'z_adjust'].map((option, index) => ({
      label: literal(option),
      before: before[option] ?? null,
      after: match[index + 1]!,
    })),
    outcome: 'staged',
  }
}

export function parseEndstopPhase(lines: readonly string[]): ProcedureResult | null {
  const rows: ProcedureResultRow[] = []
  for (const line of allLines(lines)) {
    const match = endstopPhasePattern.exec(line)
    if (match) rows.push({ label: literal(match[1]!), after: `${match[2]}/${match[3]}` })
  }
  if (rows.length === 0) return outcomeOnly(lines)
  return { rows, outcome: 'staged' }
}

function parsePressureAdvance(
  lines: readonly string[],
  before: ProcedureSnapshot,
  values: ProcedureValues,
): ProcedureResult | null {
  if (lines.length === 0) return null
  const advance = values.ADVANCE?.trim() ?? ''
  const smooth = values.SMOOTH_TIME?.trim() ?? ''
  const rows: ProcedureResultRow[] = []
  const actions: ProcedureAction[] = []
  if (advance !== '') {
    rows.push({
      label: literal('pressure_advance'),
      before: before.pressure_advance ?? null,
      after: advance,
    })
    actions.push({
      kind: 'persist',
      id: 'persist-advance',
      label: key('calibration.result.keepInFile', { option: 'pressure_advance' }),
      section: 'extruder',
      changes: [{ option: 'pressure_advance', value: advance }],
    })
  }
  if (smooth !== '') {
    rows.push({
      label: literal('pressure_advance_smooth_time'),
      before: before.pressure_advance_smooth_time ?? null,
      after: smooth,
    })
    actions.push({
      kind: 'persist',
      id: 'persist-smooth',
      label: key('calibration.result.keepInFile', { option: 'pressure_advance_smooth_time' }),
      section: 'extruder',
      changes: [{ option: 'pressure_advance_smooth_time', value: smooth }],
    })
  }
  return { rows, outcome: 'applied', actions }
}

/*
 * ------------------------------------------------------------------ parameters
 */

const stepperParameter = (required: boolean): ProcedureParameter => ({
  key: 'STEPPER',
  kind: 'select',
  label: 'calibration.param.stepper',
  required,
  initial: (context) => (required ? (steppers(context)[0] ?? '') : ''),
  options: (context) => [
    ...(required ? [] : [{ value: '', label: key('calibration.param.allSteppers') }]),
    ...steppers(context).map((name) => ({ value: name, label: literal(name) })),
  ],
})

const chipParameter = (prefix: string): ProcedureParameter => ({
  key: 'CHIP',
  kind: 'select',
  label: 'calibration.param.chip',
  required: true,
  initial: (context) => namesWithPrefix(context, prefix)[0] ?? '',
  options: (context) =>
    namesWithPrefix(context, prefix).map((name) => ({ value: name, label: literal(name) })),
})

function defaultTarget(heater: ProcedureHeater | undefined): string {
  if (!heater) return ''
  return heater.objectName === 'heater_bed'
    ? '60'
    : heater.objectName.startsWith('extruder')
      ? '200'
      : '50'
}

/*
 * ------------------------------------------------------------------ registry
 */

const always = () => true

export const calibrationProcedures: readonly CalibrationProcedure[] = [
  // Axes & frame
  {
    id: 'endstops',
    stage: 'axes',
    command: 'QUERY_ENDSTOPS',
    available: always,
    requires: [],
    effects: [],
    duration: 'seconds',
    staleAfterDays: null,
    panel: 'endstops',
  },
  {
    id: 'stepperBuzz',
    stage: 'axes',
    command: 'STEPPER_BUZZ',
    available: (context) => steppers(context).length > 0,
    requires: ['notPrinting'],
    effects: ['moves'],
    duration: 'seconds',
    staleAfterDays: null,
    params: [stepperParameter(true)],
    build: (values) => buildWithWords('STEPPER_BUZZ', values, ['STEPPER']),
    parse: (lines) => outcomeOnly(lines),
  },
  {
    id: 'axisRotation',
    stage: 'axes',
    command: 'rotation_distance',
    available: (context) => axisSteppers(context.sections).length > 0,
    requires: [],
    effects: ['moves'],
    duration: 'minute',
    staleAfterDays: null,
    panel: 'axisRotation',
  },
  {
    id: 'zEndstop',
    stage: 'axes',
    command: 'Z_ENDSTOP_CALIBRATE',
    available: (context) => {
      const pin = context.settings('stepper_z')?.endstop_pin
      return typeof pin === 'string' && !/^probe:/i.test(pin.trim())
    },
    requires: ['homed', 'notPrinting'],
    effects: ['moves'],
    duration: 'interactive',
    staleAfterDays: null,
    build: () => 'Z_ENDSTOP_CALIBRATE',
    snapshot: (_values, context) => ({
      position_endstop: settingText(context, 'stepper_z', 'position_endstop') ?? '',
    }),
    parse: parsePositionEndstop,
  },
  {
    id: 'endstopPhase',
    stage: 'axes',
    command: 'ENDSTOP_PHASE_CALIBRATE',
    available: (context) => context.hasSection('endstop_phase'),
    requires: ['notPrinting'],
    effects: [],
    duration: 'seconds',
    staleAfterDays: null,
    params: [stepperParameter(false)],
    build: (values) => buildWithWords('ENDSTOP_PHASE_CALIBRATE', values, ['STEPPER']),
    parse: parseEndstopPhase,
  },
  {
    id: 'tmcAutotune',
    stage: 'axes',
    command: 'AUTOTUNE_TMC',
    available: (context) => context.hasCommand('AUTOTUNE_TMC'),
    requires: ['notPrinting'],
    effects: [],
    duration: 'seconds',
    staleAfterDays: null,
    params: [stepperParameter(false)],
    build: (values) => buildWithWords('AUTOTUNE_TMC', values, ['STEPPER']),
    parse: (lines) => outcomeOnly(lines),
  },
  {
    id: 'axesMap',
    stage: 'axes',
    command: 'AXES_MAP_CALIBRATION',
    available: (context) => context.hasMacro('AXES_MAP_CALIBRATION'),
    requires: ['homed', 'notPrinting'],
    effects: ['moves'],
    duration: 'minute',
    staleAfterDays: null,
    build: () => 'AXES_MAP_CALIBRATION',
    snapshot: (_values, context) => {
      const chip = axesMapChip(context)
      return {
        accel_chip: chip ?? '',
        axes_map: chip ? (settingText(context, chip, 'axes_map') ?? '') : '',
      }
    },
    parse: parseAxesMap,
  },

  // Bed & probe
  {
    id: 'bedMesh',
    stage: 'bed',
    command: 'BED_MESH_CALIBRATE',
    available: (context) => context.hasSection('bed_mesh'),
    requires: ['homed', 'notPrinting'],
    effects: ['moves', 'probes'],
    duration: 'minutes',
    staleAfterDays: 30,
    params: [
      {
        key: 'PROFILE',
        kind: 'text',
        label: 'calibration.param.profile',
        initial: () => '',
        placeholder: () => 'default',
      },
      {
        key: 'PROBE_COUNT',
        kind: 'text',
        label: 'calibration.param.probeCount',
        initial: () => '',
        placeholder: (context) => settingText(context, 'bed_mesh', 'probe_count') ?? '',
      },
    ],
    build: (values) => {
      const profile = values.PROFILE?.trim() ?? ''
      if (profile !== '' && !/^[A-Za-z0-9_.-]+$/.test(profile)) return null
      const count = values.PROBE_COUNT?.trim().replace(/\s+/g, '') ?? ''
      if (count !== '' && !/^\d+(,\d+)?$/.test(count)) return null
      return withWords('BED_MESH_CALIBRATE', [
        profile === '' ? null : `PROFILE="${profile}"`,
        count === '' ? null : `PROBE_COUNT=${count}`,
      ])
    },
    parse: (lines) => outcomeOnly(lines),
  },
  {
    id: 'quadGantryLevel',
    stage: 'bed',
    command: 'QUAD_GANTRY_LEVEL',
    available: (context) => context.hasSection('quad_gantry_level'),
    requires: ['homed', 'notPrinting'],
    effects: ['moves', 'probes'],
    duration: 'minute',
    staleAfterDays: 30,
    build: () => 'QUAD_GANTRY_LEVEL',
    parse: parseRetries,
  },
  {
    id: 'zTilt',
    stage: 'bed',
    command: 'Z_TILT_ADJUST',
    available: (context) => context.hasSection('z_tilt'),
    requires: ['homed', 'notPrinting'],
    effects: ['moves', 'probes'],
    duration: 'minute',
    staleAfterDays: 30,
    build: () => 'Z_TILT_ADJUST',
    parse: parseRetries,
  },
  {
    id: 'screwsTilt',
    stage: 'bed',
    command: 'SCREWS_TILT_CALCULATE',
    available: (context) => context.hasSection('screws_tilt_adjust'),
    requires: ['homed', 'notPrinting'],
    effects: ['moves', 'probes'],
    duration: 'minute',
    staleAfterDays: 90,
    build: () => 'SCREWS_TILT_CALCULATE',
    parse: (lines) => parseScrews(lines),
  },
  {
    id: 'bedScrews',
    stage: 'bed',
    command: 'BED_SCREWS_ADJUST',
    available: (context) => context.hasSection('bed_screws'),
    requires: ['homed', 'notPrinting'],
    effects: ['moves'],
    duration: 'interactive',
    staleAfterDays: 90,
    build: () => 'BED_SCREWS_ADJUST',
    parse: (lines) => outcomeOnly(lines),
  },
  {
    id: 'deltaCalibrate',
    stage: 'bed',
    command: 'DELTA_CALIBRATE',
    available: (context) => context.hasSection('delta_calibrate'),
    requires: ['homed', 'notPrinting'],
    effects: ['moves', 'probes'],
    duration: 'minutes',
    staleAfterDays: null,
    build: () => 'DELTA_CALIBRATE',
    parse: (lines) => outcomeOnly(lines),
  },
  {
    id: 'probeZOffset',
    stage: 'bed',
    command: 'PROBE_CALIBRATE',
    available: (context) => context.hasSection('probe') || context.hasSection('bltouch'),
    requires: ['homed', 'notPrinting'],
    effects: ['moves', 'probes'],
    duration: 'interactive',
    staleAfterDays: 180,
    build: () => 'PROBE_CALIBRATE',
    snapshot: (_values, context) => ({
      z_offset:
        settingText(context, 'probe', 'z_offset') ??
        settingText(context, 'bltouch', 'z_offset') ??
        '',
    }),
    parse: parseZOffset,
  },
  {
    id: 'probeAccuracy',
    stage: 'bed',
    command: 'PROBE_ACCURACY',
    available: (context) => context.hasProbe,
    // It probes wherever the toolhead stands, and the probe is not the nozzle.
    requires: ['homed', 'notPrinting', 'probeInBed'],
    effects: ['moves', 'probes'],
    duration: 'minute',
    staleAfterDays: null,
    params: [
      {
        key: 'SAMPLES',
        kind: 'number',
        label: 'calibration.param.samples',
        initial: () => '',
        placeholder: () => '10',
        min: 1,
        max: 100,
      },
    ],
    build: (values) => buildWithWords('PROBE_ACCURACY', values, ['SAMPLES']),
    parse: (lines) => parseProbeAccuracy(lines),
  },
  {
    id: 'bedTilt',
    stage: 'bed',
    command: 'BED_TILT_CALIBRATE',
    available: (context) => context.hasSection('bed_tilt'),
    requires: ['homed', 'notPrinting'],
    effects: ['moves', 'probes'],
    duration: 'minute',
    staleAfterDays: 90,
    build: () => 'BED_TILT_CALIBRATE',
    snapshot: (_values, context) => ({
      x_adjust: settingText(context, 'bed_tilt', 'x_adjust') ?? '',
      y_adjust: settingText(context, 'bed_tilt', 'y_adjust') ?? '',
      z_adjust: settingText(context, 'bed_tilt', 'z_adjust') ?? '',
    }),
    parse: parseBedTilt,
  },
  {
    id: 'eddyDriveCurrent',
    stage: 'bed',
    command: 'LDC_CALIBRATE_DRIVE_CURRENT',
    available: (context) => namesWithPrefix(context, 'probe_eddy_current').length > 0,
    requires: ['notPrinting'],
    effects: [],
    duration: 'seconds',
    staleAfterDays: null,
    params: [chipParameter('probe_eddy_current')],
    build: (values) => buildWithWords('LDC_CALIBRATE_DRIVE_CURRENT', values, ['CHIP']),
    parse: (lines) => outcomeOnly(lines),
  },
  {
    id: 'eddyHeight',
    stage: 'bed',
    command: 'PROBE_EDDY_CURRENT_CALIBRATE',
    available: (context) => namesWithPrefix(context, 'probe_eddy_current').length > 0,
    requires: ['homed', 'notPrinting'],
    effects: ['moves', 'probes'],
    duration: 'interactive',
    staleAfterDays: 180,
    params: [chipParameter('probe_eddy_current')],
    build: (values) => buildWithWords('PROBE_EDDY_CURRENT_CALIBRATE', values, ['CHIP']),
    parse: (lines) => outcomeOnly(lines),
  },
  {
    id: 'probeDrift',
    stage: 'bed',
    command: 'TEMPERATURE_PROBE_CALIBRATE',
    available: (context) => namesWithPrefix(context, 'temperature_probe').length > 0,
    requires: ['homed', 'notPrinting'],
    effects: ['moves', 'probes', 'heats'],
    duration: 'minutes',
    staleAfterDays: null,
    params: [
      {
        key: 'PROBE',
        kind: 'select',
        label: 'calibration.param.probe',
        required: true,
        initial: (context) => namesWithPrefix(context, 'temperature_probe')[0] ?? '',
        options: (context) =>
          namesWithPrefix(context, 'temperature_probe').map((name) => ({
            value: name,
            label: literal(name),
          })),
      },
      {
        key: 'TARGET',
        kind: 'number',
        label: 'calibration.param.target',
        unit: 'dashboard.temperatureUnit',
        required: true,
        initial: () => '',
        min: 1,
        max: 150,
      },
    ],
    build: (values) => buildWithWords('TEMPERATURE_PROBE_CALIBRATE', values, ['PROBE', 'TARGET']),
    parse: (lines) => outcomeOnly(lines),
  },
  {
    id: 'beacon',
    stage: 'bed',
    command: 'BEACON_CALIBRATE',
    available: (context) => context.hasCommand('BEACON_CALIBRATE'),
    requires: ['homed', 'notPrinting'],
    effects: ['moves', 'probes'],
    duration: 'interactive',
    staleAfterDays: 180,
    build: () => 'BEACON_CALIBRATE',
    parse: (lines) => outcomeOnly(lines),
  },
  {
    id: 'cartographer',
    stage: 'bed',
    command: 'CARTOGRAPHER_CALIBRATE',
    available: (context) => context.hasCommand('CARTOGRAPHER_CALIBRATE'),
    requires: ['homed', 'notPrinting'],
    effects: ['moves', 'probes'],
    duration: 'interactive',
    staleAfterDays: 180,
    build: () => 'CARTOGRAPHER_CALIBRATE',
    parse: (lines) => outcomeOnly(lines),
  },
  {
    id: 'autoZ',
    stage: 'bed',
    command: 'CALIBRATE_Z',
    available: (context) => context.hasCommand('CALIBRATE_Z'),
    requires: ['homed', 'notPrinting'],
    effects: ['moves', 'probes'],
    duration: 'minute',
    staleAfterDays: null,
    build: () => 'CALIBRATE_Z',
    parse: (lines) => outcomeOnly(lines),
  },

  // Heaters
  {
    id: 'heaterModel',
    stage: 'heaters',
    command: 'PID_CALIBRATE · MPC_CALIBRATE',
    available: (context) => context.heaters.length > 0,
    requires: ['notPrinting'],
    effects: ['heats'],
    duration: 'minutes',
    staleAfterDays: 90,
    confirm: true,
    params: [
      {
        key: 'HEATER',
        kind: 'select',
        label: 'calibration.param.heater',
        required: true,
        initial: (context) => context.heaters[0]?.objectName ?? '',
        options: (context) =>
          context.heaters.map((heater) => ({
            value: heater.objectName,
            label: literal(heater.label),
          })),
      },
      {
        key: 'TARGET',
        kind: 'number',
        label: 'calibration.param.target',
        unit: 'dashboard.temperatureUnit',
        required: true,
        initial: (context) => defaultTarget(context.heaters[0]),
        min: 1,
        max: 999,
      },
    ],
    build: (values, context) => {
      const heater = context.heaters.find((candidate) => candidate.objectName === values.HEATER)
      const target = Number(values.TARGET)
      if (!heater || !Number.isFinite(target) || target <= 0 || target > 999) return null
      const command = heater.kind === 'mpc' ? 'MPC_CALIBRATE' : 'PID_CALIBRATE'
      return `${command} HEATER=${heaterCommandName(heater.objectName)} TARGET=${Math.round(target)}`
    },
    snapshot: (values, context) => {
      const section = values.HEATER ?? ''
      const snapshot: Record<string, string> = {}
      for (const option of ['pid_kp', 'pid_ki', 'pid_kd', ...mpcKeys]) {
        const value = settingText(context, section, option)
        if (value !== null) snapshot[option] = value
      }
      return snapshot
    },
    parse: parsePid,
  },
  {
    id: 'heaterCheck',
    stage: 'heaters',
    command: 'verify_heater',
    available: (context) => context.heaters.length > 0,
    requires: [],
    effects: [],
    duration: 'seconds',
    staleAfterDays: null,
    panel: 'heaterCheck',
  },

  // Resonance
  {
    id: 'shaperCalibrate',
    stage: 'resonance',
    command: 'SHAPER_CALIBRATE',
    available: (context) =>
      context.hasSection('resonance_tester') && context.hasSection('input_shaper'),
    requires: ['homed', 'notPrinting'],
    effects: ['moves'],
    duration: 'minutes',
    staleAfterDays: 90,
    params: [
      {
        key: 'AXIS',
        kind: 'select',
        label: 'calibration.param.axis',
        initial: () => '',
        options: () => [
          { value: '', label: key('calibration.param.bothAxes') },
          { value: 'X', label: literal('X') },
          { value: 'Y', label: literal('Y') },
        ],
      },
    ],
    build: (values) => buildWithWords('SHAPER_CALIBRATE', values, ['AXIS']),
    snapshot: (_values, context) => ({
      shaper_type_x: settingText(context, 'input_shaper', 'shaper_type_x') ?? '',
      shaper_freq_x: settingText(context, 'input_shaper', 'shaper_freq_x') ?? '',
      shaper_type_y: settingText(context, 'input_shaper', 'shaper_type_y') ?? '',
      shaper_freq_y: settingText(context, 'input_shaper', 'shaper_freq_y') ?? '',
      max_accel: settingText(context, 'printer', 'max_accel') ?? '',
    }),
    parse: parseShaperCalibrate,
  },
  {
    id: 'shakeTuneShaper',
    stage: 'resonance',
    command: 'AXES_SHAPER_CALIBRATION',
    available: (context) => context.hasMacro('AXES_SHAPER_CALIBRATION'),
    requires: ['homed', 'notPrinting'],
    effects: ['moves'],
    duration: 'minutes',
    staleAfterDays: 90,
    build: () => 'AXES_SHAPER_CALIBRATION',
    parse: (lines) => parseShakeTuneShaper(lines),
    actionsFromRows: shakeTuneShaperActionsFromRows,
  },
  {
    id: 'shakeTuneBelts',
    stage: 'resonance',
    command: 'COMPARE_BELTS_RESPONSES',
    available: (context) =>
      context.hasMacro('COMPARE_BELTS_RESPONSES') && isCoreKinematics(context),
    requires: ['homed', 'notPrinting'],
    effects: ['moves'],
    duration: 'minutes',
    staleAfterDays: 90,
    build: () => 'COMPARE_BELTS_RESPONSES',
    parse: (lines) => outcomeOnly(lines),
  },
  {
    id: 'shakeTuneVibrations',
    stage: 'resonance',
    command: 'CREATE_VIBRATIONS_PROFILE',
    available: (context) => context.hasMacro('CREATE_VIBRATIONS_PROFILE'),
    requires: ['homed', 'notPrinting'],
    effects: ['moves'],
    duration: 'minutes',
    staleAfterDays: null,
    build: () => 'CREATE_VIBRATIONS_PROFILE',
    parse: (lines) => outcomeOnly(lines),
  },
  {
    id: 'accelerometerQuery',
    stage: 'resonance',
    command: 'ACCELEROMETER_QUERY',
    available: (context) => accelerometers(context).length > 0,
    requires: [],
    effects: [],
    duration: 'seconds',
    staleAfterDays: null,
    params: [
      {
        key: 'CHIP',
        kind: 'select',
        label: 'calibration.param.chip',
        initial: () => '',
        options: (context) => {
          const named = accelerometers(context).filter((section) => section.includes(' '))
          return [
            { value: '', label: key('calibration.param.defaultChip') },
            ...named.map((section) => {
              const name = section.slice(section.indexOf(' ') + 1)
              return { value: name, label: literal(name) }
            }),
          ]
        },
      },
    ],
    build: (values) => buildWithWords('ACCELEROMETER_QUERY', values, ['CHIP']),
    parse: (lines) => parseAccelerometer(lines),
  },
  {
    id: 'axesNoise',
    stage: 'resonance',
    command: 'MEASURE_AXES_NOISE',
    available: (context) => context.hasSection('resonance_tester'),
    requires: [],
    effects: [],
    duration: 'seconds',
    staleAfterDays: null,
    build: () => 'MEASURE_AXES_NOISE',
    parse: (lines) => parseAxesNoise(lines),
  },

  // Extrusion
  {
    id: 'rotationDistance',
    stage: 'extrusion',
    command: 'rotation_distance',
    available: (context) => context.hasSection('extruder'),
    requires: ['notPrinting'],
    effects: ['heats'],
    duration: 'minutes',
    staleAfterDays: null,
    panel: 'rotationDistance',
  },
  {
    id: 'pressureAdvance',
    stage: 'extrusion',
    command: 'SET_PRESSURE_ADVANCE',
    available: (context) => context.hasSection('extruder'),
    requires: [],
    effects: [],
    duration: 'seconds',
    staleAfterDays: null,
    params: [
      {
        key: 'ADVANCE',
        kind: 'number',
        label: 'calibration.param.advance',
        unit: 'calibration.unit.seconds',
        initial: (context) =>
          context.livePressureAdvance === null ? '' : String(context.livePressureAdvance),
        min: 0,
        max: 2,
      },
      {
        key: 'SMOOTH_TIME',
        kind: 'number',
        label: 'calibration.param.smoothTime',
        unit: 'calibration.unit.seconds',
        initial: (context) =>
          context.liveSmoothTime === null ? '' : String(context.liveSmoothTime),
        min: 0,
        max: 0.2,
      },
    ],
    build: (values) => {
      const built = buildWithWords('SET_PRESSURE_ADVANCE', values, ['ADVANCE', 'SMOOTH_TIME'])
      return built === 'SET_PRESSURE_ADVANCE' ? null : built
    },
    snapshot: (_values, context) => ({
      pressure_advance:
        context.livePressureAdvance === null ? '' : String(context.livePressureAdvance),
      pressure_advance_smooth_time:
        context.liveSmoothTime === null ? '' : String(context.liveSmoothTime),
    }),
    parse: parsePressureAdvance,
  },
  {
    id: 'runoutSensors',
    stage: 'extrusion',
    command: 'QUERY_FILAMENT_SENSOR',
    available: (context) => context.hasRunoutSensors,
    requires: [],
    effects: [],
    duration: 'seconds',
    staleAfterDays: null,
    panel: 'runoutSensors',
  },
]

export function proceduresForStage(
  stage: CalibrationStageId,
  context: ProcedureContext,
): CalibrationProcedure[] {
  return calibrationProcedures.filter(
    (procedure) => procedure.stage === stage && procedure.available(context),
  )
}

export function procedureById(id: string): CalibrationProcedure | undefined {
  return calibrationProcedures.find((procedure) => procedure.id === id)
}

/** The values a procedure's fields start with. */
export function initialProcedureValues(
  procedure: CalibrationProcedure,
  context: ProcedureContext,
): Record<string, string> {
  return Object.fromEntries(
    (procedure.params ?? []).map((parameter) => [parameter.key, parameter.initial(context)]),
  )
}

/** Required fields left empty, by their command word. */
export function missingProcedureValues(
  procedure: CalibrationProcedure,
  values: ProcedureValues,
): string[] {
  return (procedure.params ?? [])
    .filter(
      (parameter) => parameter.required === true && (values[parameter.key]?.trim() ?? '') === '',
    )
    .map((parameter) => parameter.key)
}

/** Whether the last run is old enough to say so, per the procedure's own threshold. */
export function isProcedureStale(
  procedure: CalibrationProcedure,
  lastRunAt: number | null,
  now: number,
): boolean {
  if (procedure.staleAfterDays === null || lastRunAt === null) return false
  return now - lastRunAt > procedure.staleAfterDays * 86_400_000
}

/**
 * The procedure a stage opens on: the first ageing one that has never run or
 * has gone old, so the stage shows what is due without a notification; else
 * the first in the list.
 */
export function initialProcedure(
  procedures: readonly CalibrationProcedure[],
  lastRunAt: (id: ProcedureId) => number | null,
  now: number,
): CalibrationProcedure | null {
  const due = procedures.find((procedure) => {
    if (procedure.staleAfterDays === null) return false
    const last = lastRunAt(procedure.id)
    return last === null || isProcedureStale(procedure, last, now)
  })
  return due ?? procedures[0] ?? null
}
