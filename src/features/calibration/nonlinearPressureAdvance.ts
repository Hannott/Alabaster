import { formatNumber } from '@/features/calibration/axisRotation'

/**
 * Kalico's nonlinear pressure advance, tuned the way its own guide describes:
 * print a tower that sweeps one coefficient with height, find the height where
 * the tower looks best on the side and on the front, turn that height into a
 * value, and keep it in `[extruder]` before the next tower.
 *
 * The towers come from `RUN_PA_TEST`, the macro Kalico's Setup section has the
 * owner paste into their config together with their own start G-code — the
 * same arrangement Shake&Tune's macros have, and gated the same way.
 *
 * A tower's first print sweeps from zero with the macro's own `FACTOR`s and
 * sends no `PA_VALUE` or `PA_RANGE`: the guide's `FACTOR`s, with its Bowden
 * adjustment, are exactly `firstRange`. Every later print of the same tower is
 * centred on the value the previous reading of it found, which the log keeps
 * across a reload, and sends that value as `PA_VALUE` with the spread as
 * `PA_RANGE`. Re-sending the first sweep's top as both words made every
 * reprint start over from zero at the first sweep's coarse resolution,
 * however close the previous reading had already come.
 *
 * The coefficients interact, so the guide is iterative rather than linear:
 * a tower can say "keep this value, then print the next one" or "nudge the
 * other coefficient and print this one again". Which one it says is decided
 * here from the reading, the path, and the readings before it; nothing here
 * sends a command or writes a file.
 */

/** Direct drive at ordinary speed is dominated by the offset; Bowden and fast machines by the slope. */
export type NpaPath = 'direct' | 'bowden'

export type NpaTower = 'offset' | 'advance' | 'timeOffset'

export type NpaOption = 'linear_advance' | 'nonlinear_offset' | 'pressure_advance_time_offset'

/** `RUN_PA_TEST`'s `TESTPARAM`: 0 = advance, 1 = offset, 2 = time offset. */
export const towerTestParam: Readonly<Record<NpaTower, number>> = {
  advance: 0,
  offset: 1,
  timeOffset: 2,
}

export const towerOption: Readonly<Record<NpaTower, NpaOption>> = {
  advance: 'linear_advance',
  offset: 'nonlinear_offset',
  timeOffset: 'pressure_advance_time_offset',
}

/** The order the guide prints towers in on each path. */
export const pathTowers: Readonly<Record<NpaPath, readonly NpaTower[]>> = {
  direct: ['offset', 'advance', 'timeOffset'],
  bowden: ['advance', 'offset', 'timeOffset'],
}

/** Kalico's `pa_test` default, used where the section does not report one. */
export const defaultTowerHeight = 50

/**
 * Two readings this close, in millimetres, count as the same height. A tower
 * layer is 0.2 mm and the eye reads a band rather than a layer, so anything
 * tighter would send the reader chasing a difference the tower cannot show.
 */
export const convergenceTolerance = 1

/** The guide's first nudge to the other coefficient, as a fraction. */
const initialStep = 0.1
/** Below this a nudge is smaller than a tower can resolve. */
const minimumStep = 0.025
/** The Bowden path keeps 80% of the first advance reading, per the guide. */
const bowdenAdvanceShare = 0.8

const decimals: Readonly<Record<NpaTower, number>> = {
  advance: 4,
  offset: 4,
  timeOffset: 5,
}

/**
 * The first sweep for each tower, taken from the `FACTOR`s the guide's macro
 * ships with over its 50 mm default height, so the first tower matches the
 * one the guide's photographs show.
 */
const firstRangeTop: Readonly<Record<NpaPath, Readonly<Record<NpaTower, number>>>> = {
  direct: { offset: 0.5, advance: 0.05, timeOffset: 0.005 },
  bowden: { offset: 1, advance: 0.5, timeOffset: 0.005 },
}

export const startingVelocity: Readonly<Record<NpaPath, number>> = { direct: 1, bowden: 2 }
export const startingSmoothTime = 0.02
export const nonlinearModels = ['recipr', 'tanh'] as const
export type NonlinearModel = (typeof nonlinearModels)[number]

/** Which heights a tower is read at, on each path: the side, the front, or both. */
export function towerReads(path: NpaPath, tower: NpaTower): { side: boolean; front: boolean } {
  if (tower === 'timeOffset') return { side: false, front: true }
  if (path === 'direct') {
    return tower === 'offset' ? { side: true, front: false } : { side: true, front: true }
  }
  return tower === 'advance' ? { side: false, front: true } : { side: true, front: true }
}

export function formatTowerValue(tower: NpaTower, value: number): string {
  return formatNumber(value, decimals[tower])
}

export interface NpaRange {
  from: number
  to: number
}

export function firstRange(path: NpaPath, tower: NpaTower): NpaRange {
  return { from: 0, to: firstRangeTop[path][tower] }
}

/**
 * A narrower sweep around a value a tower already found, for a second look:
 * a third either side, so the found value sits mid-tower with room to be
 * wrong in both directions.
 */
export function rangeAround(tower: NpaTower, value: number): NpaRange {
  const spread = value / 3
  return {
    from: Number(formatTowerValue(tower, Math.max(0, value - spread))),
    to: Number(formatTowerValue(tower, value + spread)),
  }
}

export function isValidRange(range: NpaRange): boolean {
  return (
    Number.isFinite(range.from) &&
    Number.isFinite(range.to) &&
    range.from >= 0 &&
    range.to > range.from
  )
}

/**
 * `PA_VALUE` and `PA_RANGE` that make the guide's macro sweep exactly
 * From–To. The macro starts at zero with a span of `PA_RANGE` when
 * `PA_VALUE - PA_RANGE <= 0`, and otherwise sweeps `PA_VALUE ± PA_RANGE`.
 */
export function macroRangeWords(range: NpaRange): { value: number; range: number } {
  if (range.from <= 0) return { value: range.to, range: range.to }
  return { value: (range.from + range.to) / 2, range: (range.to - range.from) / 2 }
}

/** The value the tower was printing at a height, as `TUNING_TOWER` computes it. */
export function valueAtHeight(range: NpaRange, towerHeight: number, height: number): number {
  const clamped = Math.min(Math.max(height, 0), towerHeight)
  return range.from + ((range.to - range.from) * clamped) / towerHeight
}

function isFirstRange(path: NpaPath, tower: NpaTower, range: NpaRange): boolean {
  const first = firstRange(path, tower)
  return range.from === first.from && range.to === first.to
}

/**
 * The sweep a tower's next print uses: around the value its latest reading
 * found, else that reading's own sweep when it found nothing usable, else the
 * first sweep.
 */
export function nextRange(
  path: NpaPath,
  tower: NpaTower,
  readings: readonly NpaReading[],
): NpaRange {
  const last = readings.filter((reading) => reading.path === path && reading.tower === tower).at(-1)
  if (!last) return firstRange(path, tower)
  const value = readingValue(last)
  if (value !== null && value > 0) {
    const around = rangeAround(tower, value)
    if (isValidRange(around)) return around
  }
  return { ...last.range }
}

export interface TowerRequest {
  path: NpaPath
  tower: NpaTower
  range: NpaRange
  nozzle: number
  targetTemp: number
  bedTemp: number
}

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

/** The `RUN_PA_TEST` line a tower sends, or null while a value cannot build one. */
export function buildTowerScript(request: TowerRequest): string | null {
  if (!isValidRange(request.range)) return null
  if (!isPositive(request.nozzle) || !isPositive(request.targetTemp)) return null
  if (!Number.isFinite(request.bedTemp) || request.bedTemp < 0) return null
  const line = [
    'RUN_PA_TEST',
    `NOZZLE=${formatNumber(request.nozzle, 3)}`,
    `TARGET_TEMP=${formatNumber(request.targetTemp, 1)}`,
    `BED_TEMP=${formatNumber(request.bedTemp, 1)}`,
    `TESTPARAM=${towerTestParam[request.tower]}`,
  ]
  if (!isFirstRange(request.path, request.tower, request.range)) {
    const words = macroRangeWords(request.range)
    line.push(
      `PA_VALUE=${formatNumber(words.value, 6)}`,
      `PA_RANGE=${formatNumber(words.range, 6)}`,
    )
  }
  return line.join(' ')
}

/*
 * ------------------------------------------------------------------ config
 */

export interface NpaConfig {
  model: string | null
  linearAdvance: number | null
  nonlinearOffset: number | null
  linearizationVelocity: number | null
  timeOffset: number | null
  smoothTime: number | null
  /** A linear `pressure_advance` line, which a nonlinear model leaves unread and Klipper refuses. */
  hasLinearAdvanceOption: boolean
}

function numberOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function readNpaConfig(section: Record<string, unknown> | null): NpaConfig {
  const model = section?.pressure_advance_model
  return {
    model: typeof model === 'string' && model.trim() !== '' ? model.trim().toLowerCase() : null,
    linearAdvance: numberOf(section?.linear_advance),
    nonlinearOffset: numberOf(section?.nonlinear_offset),
    linearizationVelocity: numberOf(section?.linearization_velocity),
    timeOffset: numberOf(section?.pressure_advance_time_offset),
    smoothTime: numberOf(section?.pressure_advance_smooth_time),
    hasLinearAdvanceOption: section !== null && section.pressure_advance !== undefined,
  }
}

export function isNonlinearModel(model: string | null): boolean {
  return model === 'recipr' || model === 'tanh'
}

export function configValue(config: NpaConfig, option: NpaOption): number | null {
  if (option === 'linear_advance') return config.linearAdvance
  if (option === 'nonlinear_offset') return config.nonlinearOffset
  return config.timeOffset
}

/** The `[extruder]` lines the guide starts from, as the one write that sets all of them. */
export function startingChanges(
  path: NpaPath,
  model: NonlinearModel,
): { option: string; value: string }[] {
  return [
    { option: 'pressure_advance_model', value: model },
    { option: 'linear_advance', value: '0' },
    { option: 'nonlinear_offset', value: '0' },
    { option: 'linearization_velocity', value: String(startingVelocity[path]) },
    { option: 'pressure_advance_smooth_time', value: String(startingSmoothTime) },
    { option: 'pressure_advance_time_offset', value: '0' },
  ]
}

export function matchesStart(config: NpaConfig, path: NpaPath): boolean {
  return (
    isNonlinearModel(config.model) &&
    !config.hasLinearAdvanceOption &&
    (config.linearAdvance ?? 0) === 0 &&
    (config.nonlinearOffset ?? 0) === 0 &&
    config.linearizationVelocity === startingVelocity[path] &&
    config.smoothTime === startingSmoothTime &&
    (config.timeOffset ?? 0) === 0
  )
}

/*
 * ------------------------------------------------------------------ readings
 */

export interface NpaReading {
  at: number
  path: NpaPath
  tower: NpaTower
  range: NpaRange
  towerHeight: number
  side: number | null
  front: number | null
  /** The config the tower printed against, which is what a nudge is a percentage of. */
  linearAdvance: number | null
  nonlinearOffset: number | null
}

/**
 * What a reading says to do next.
 *
 * `keep` writes the tower's own coefficient and moves on; `next` is null when
 * the guide is finished. `nudge` writes the other coefficient, up or down by
 * `step`, and prints the same tower again. `unreadable` is a nudge whose base
 * is zero — ten percent of nothing — which means the tower that sets it has
 * not been printed yet.
 */
export type NpaSuggestion =
  | {
      kind: 'keep'
      option: NpaOption
      value: string
      /** The reading before the Bowden path's 80%, shown beside the value kept. */
      ideal?: string
      next: NpaTower | null
    }
  | {
      kind: 'nudge'
      option: NpaOption
      value: string
      direction: 'up' | 'down'
      step: number
      reprint: NpaTower
    }
  | { kind: 'unreadable'; option: NpaOption; first: NpaTower }

/** The height a reading's value is taken at: the middle of two that agree, else the one there is. */
function readHeight(reading: NpaReading): number | null {
  if (reading.side !== null && reading.front !== null) return (reading.side + reading.front) / 2
  return reading.front ?? reading.side
}

export function readingValue(reading: NpaReading): number | null {
  const height = readHeight(reading)
  return height === null ? null : valueAtHeight(reading.range, reading.towerHeight, height)
}

function isComplete(reading: NpaReading): boolean {
  const reads = towerReads(reading.path, reading.tower)
  return (!reads.side || reading.side !== null) && (!reads.front || reading.front !== null)
}

/**
 * Which way the other coefficient moves when the side and the front disagree.
 * On the direct path the advance tower tunes the offset: a side that converges
 * low has too much offset. On the Bowden path the offset tower tunes the
 * advance, the other way round — a side that converges low wants more advance.
 */
function nudgeFor(reading: NpaReading): { option: NpaOption; direction: 'up' | 'down' } | null {
  if (reading.side === null || reading.front === null) return null
  const difference = reading.side - reading.front
  if (Math.abs(difference) <= convergenceTolerance) return null
  const sideLow = difference < 0
  if (reading.path === 'direct' && reading.tower === 'advance') {
    return { option: 'nonlinear_offset', direction: sideLow ? 'down' : 'up' }
  }
  if (reading.path === 'bowden' && reading.tower === 'offset') {
    return { option: 'linear_advance', direction: sideLow ? 'up' : 'down' }
  }
  return null
}

/**
 * The step for this nudge: the guide's 10% to start, halved each time the
 * direction reverses, which is the binary search the guide asks for "if you
 * overshoot". Only the readings of the same tower on the same path count; an
 * unbroken run in one direction keeps the step it had.
 */
function stepFor(
  previous: readonly NpaReading[],
  reading: NpaReading,
  direction: 'up' | 'down',
): number {
  let step = initialStep
  let lastDirection: 'up' | 'down' | null = null
  for (const earlier of previous) {
    if (earlier.path !== reading.path || earlier.tower !== reading.tower) continue
    const nudge = nudgeFor(earlier)
    if (nudge === null) {
      step = initialStep
      lastDirection = null
      continue
    }
    if (lastDirection !== null && nudge.direction !== lastDirection) {
      step = Math.max(minimumStep, step / 2)
    }
    lastDirection = nudge.direction
  }
  if (lastDirection !== null && direction !== lastDirection) {
    step = Math.max(minimumStep, step / 2)
  }
  return step
}

function nextAfter(
  path: NpaPath,
  tower: NpaTower,
  previous: readonly NpaReading[],
): NpaTower | null {
  if (path === 'direct') {
    if (tower === 'offset') return 'advance'
    if (tower === 'advance') return 'timeOffset'
    return null
  }
  if (tower === 'advance') return 'offset'
  if (tower === 'offset') {
    const timed = previous.some(
      (earlier) => earlier.path === 'bowden' && earlier.tower === 'timeOffset',
    )
    return timed ? null : 'timeOffset'
  }
  // The guide's last Bowden step: back to the offset tower with the time offset in.
  return 'offset'
}

/**
 * What a reading says, given the readings before it in the same session.
 * Null until every height the tower is read at has been entered.
 */
export function suggestFor(
  reading: NpaReading,
  previous: readonly NpaReading[],
): NpaSuggestion | null {
  if (!isComplete(reading)) return null
  const value = readingValue(reading)
  if (value === null) return null

  const nudge = nudgeFor(reading)
  if (nudge !== null) {
    const base =
      nudge.option === 'nonlinear_offset' ? reading.nonlinearOffset : reading.linearAdvance
    if (base === null || base <= 0) {
      return {
        kind: 'unreadable',
        option: nudge.option,
        first: nudge.option === 'nonlinear_offset' ? 'offset' : 'advance',
      }
    }
    const step = stepFor(previous, reading, nudge.direction)
    const factor = nudge.direction === 'up' ? 1 + step : 1 - step
    const tower: NpaTower = nudge.option === 'nonlinear_offset' ? 'offset' : 'advance'
    return {
      kind: 'nudge',
      option: nudge.option,
      value: formatTowerValue(tower, base * factor),
      direction: nudge.direction,
      step,
      reprint: reading.tower,
    }
  }

  const option = towerOption[reading.tower]
  const next = nextAfter(reading.path, reading.tower, previous)
  if (reading.path === 'bowden' && reading.tower === 'advance') {
    return {
      kind: 'keep',
      option,
      value: formatTowerValue(reading.tower, value * bowdenAdvanceShare),
      ideal: formatTowerValue(reading.tower, value),
      next,
    }
  }
  return { kind: 'keep', option, value: formatTowerValue(reading.tower, value), next }
}

/**
 * The tower to print next: the first on the path until one has been read,
 * then whatever the latest reading said. A nudge reprints its tower; a keep
 * moves on; a finished guide returns null.
 */
export function nextTower(path: NpaPath, readings: readonly NpaReading[]): NpaTower | null {
  const onPath = readings.filter((reading) => reading.path === path)
  const latest = onPath.at(-1)
  if (!latest) return pathTowers[path][0]!
  const suggestion = suggestFor(latest, onPath.slice(0, -1))
  if (suggestion === null) return latest.tower
  if (suggestion.kind === 'nudge') return suggestion.reprint
  if (suggestion.kind === 'unreadable') return suggestion.first
  return suggestion.next
}

/*
 * ------------------------------------------------------------------ log shape
 *
 * Readings live in the calibration log as string maps, like every other
 * procedure's values, so the log's reader needs no second shape.
 */

export function readingToValues(reading: NpaReading): Record<string, string> {
  const text = (value: number | null) => (value === null ? '' : String(value))
  return {
    kind: 'reading',
    path: reading.path,
    tower: reading.tower,
    from: String(reading.range.from),
    to: String(reading.range.to),
    towerHeight: String(reading.towerHeight),
    side: text(reading.side),
    front: text(reading.front),
    linearAdvance: text(reading.linearAdvance),
    nonlinearOffset: text(reading.nonlinearOffset),
  }
}

function optionalNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isPath(value: string | undefined): value is NpaPath {
  return value === 'direct' || value === 'bowden'
}

function isTower(value: string | undefined): value is NpaTower {
  return value === 'offset' || value === 'advance' || value === 'timeOffset'
}

export function readingFromValues(at: number, values: Record<string, string>): NpaReading | null {
  if (values.kind !== 'reading' || !isPath(values.path) || !isTower(values.tower)) return null
  const from = optionalNumber(values.from)
  const to = optionalNumber(values.to)
  const towerHeight = optionalNumber(values.towerHeight)
  if (from === null || to === null || towerHeight === null || towerHeight <= 0) return null
  const range = { from, to }
  if (!isValidRange(range)) return null
  return {
    at,
    path: values.path,
    tower: values.tower,
    range,
    towerHeight,
    side: optionalNumber(values.side),
    front: optionalNumber(values.front),
    linearAdvance: optionalNumber(values.linearAdvance),
    nonlinearOffset: optionalNumber(values.nonlinearOffset),
  }
}

/**
 * The readings since the guide was last started over. A start writes the
 * starting values, so readings from before it describe coefficients that are
 * no longer in the file and would only mislead the step size.
 */
export function sessionReadings(
  entries: readonly { at: number; values: Record<string, string> }[],
): NpaReading[] {
  let lastStart = -1
  entries.forEach((entry, index) => {
    if (entry.values.kind === 'start') lastStart = index
  })
  return entries
    .slice(lastStart + 1)
    .map((entry) => readingFromValues(entry.at, entry.values))
    .filter((reading): reading is NpaReading => reading !== null)
}

/** The path the last session was on, so a reload reopens where the reader left it. */
export function sessionPath(
  entries: readonly { values: Record<string, string> }[],
): NpaPath | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const path = entries[index]!.values.path
    if (isPath(path)) return path
  }
  return null
}
