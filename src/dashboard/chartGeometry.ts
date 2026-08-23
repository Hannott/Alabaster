/**
 * The arithmetic behind a time-series plot, with no Vue and no DOM, because
 * deciding what a chart claims is a different job from drawing it — and the
 * claims are what can be wrong. Everything here is pure and unit-tested.
 */

export interface TimedValue {
  eventtime: number
  value: number
}

export interface ValueScale {
  /** The bounds the plot maps onto its height. */
  minimum: number
  maximum: number
  /** Round numbers strictly inside those bounds, for the grid and its labels. */
  ticks: number[]
}

export interface TimeTick {
  eventtime: number
  /** Seconds past midnight, for labelling. */
  wallSeconds: number
}

export interface TimeScale {
  start: number
  end: number
  ticks: TimeTick[]
}

/**
 * Ladders, not a computed magnitude. `1/2/5 × 10ⁿ` alone jumps straight from 10
 * to 100 across the range a heat-up actually occupies, and a 26–228° climb then
 * gets two gridlines. The extra rungs are the ones a thermometer is read in.
 */
const valueSteps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500] as const
/** Wall-clock rungs: a chart labelled every 90 seconds reads as broken. */
const timeSteps = [15, 30, 60, 120, 300, 600, 900, 1800] as const

/**
 * The axis moves in whole steps, never continuously. A bound fitted tightly to
 * the data is redrawn on every push, so during a heat-up the whole plot creeps
 * downward under a trace that is trying to climb — the gridlines slide, the
 * labels renumber, and nothing holds still long enough to read.
 *
 * The step is chosen from how much the data actually covers, because one fixed
 * size cannot serve both cases. Twenty is right for a heat-up, and far too
 * coarse for two sensors sitting nine degrees apart: it framed 29–38 as 20–60
 * and spent three quarters of the plot on nothing. Anything above the ladder
 * keeps the largest rung — going coarser to fit a big range costs more than the
 * rounding saves, since a 27–215 climb framed on fifties draws 0–300.
 */
const valueStepLadder: readonly number[] = [5, 10, 20]
/** Steps a frame should span, roughly — enough gridlines to read against. */
const targetStepsPerFrame = 4

function valueStepFor(span: number): number {
  for (const step of valueStepLadder) {
    if (span <= step * targetStepsPerFrame) return step
  }
  return coarsestValueStep
}

/** The largest rung, and the span the empty axis falls back to. */
const coarsestValueStep = valueStepLadder[valueStepLadder.length - 1] as number

/**
 * How close a reading may come to the top before the axis takes another step,
 * and the slack that has to open before it steps back down. Half a step keeps
 * the familiar ten degrees on the twenty grid.
 *
 * Upward only. The floor snaps to the same grid but claims no room beneath the
 * coldest reading, because there is nothing down there to make space for — a
 * temperature is not going to surprise anyone by falling off the bottom the way
 * a heat-up climbs off the top. Giving both ends the allowance drew a 0–60 axis
 * around readings of 29 and 38, which spent 85% of the plot on nothing.
 */
function valueHeadroomFor(step: number): number {
  return step / 2
}

function stepFor(ladder: readonly number[], range: number, maximumTicks: number): number {
  for (const step of ladder) {
    if (range / step <= maximumTicks) return step
  }
  return ladder[ladder.length - 1] as number
}

/**
 * Bounds from the data; ticks are round numbers placed **inside** them.
 *
 * The usual shortcut is to snap the bounds outward onto the tick step, and it
 * is wrong in a way that only shows up as wasted space: a 26–228° range snapped
 * to a step of 100 draws 0–300, spending a quarter of a card that is 271px wide
 * on empty air above a trace that never goes there.
 *
 * `extraValues` carries the targets a heater is driving toward. A target of
 * zero is not one of them — an idle heater would otherwise drag the floor of
 * the plot to zero and squash every real reading into the top of it.
 */
/**
 * Steps one bound of the axis onto the `valueStep` grid, keeping at least
 * `valueHeadroom` between it and the data, and holding where it already is
 * unless the data has left it by a whole step.
 *
 * The hysteresis is the point. Without it a reading sitting on a boundary —
 * a bed holding at exactly 60 while the axis wants to end at 60 — flips the
 * whole plot between two framings every time the last decimal moves. Requiring
 * a full step of slack before retreating means the axis only ever changes when
 * something actually changed.
 */
export function steppedBound(
  value: number,
  previous: number | null,
  direction: 'up' | 'down',
  step = 20,
): number {
  const required = direction === 'up' ? value + valueHeadroomFor(step) : value
  const natural =
    direction === 'up' ? Math.ceil(required / step) * step : Math.floor(required / step) * step

  if (previous === null) return natural

  /*
   * Compared against the framing the data would choose on its own, not against
   * the raw reading. Measuring the raw reading made the axis hold an old frame
   * long after what justified it had scrolled out of the window — a bed that
   * had been at 60 kept a 60 on the axis while the plot showed 38.
   *
   * Room is given immediately and taken back slowly, and the margin is strict:
   * releasing as soon as the natural framing is one step lower puts the release
   * exactly on the trigger to climb again, so a heater merely holding near a
   * boundary flips the plot between two framings every second, forever. The
   * cost is that the axis can lag its data by a single step, which is invisible
   * next to an axis that renumbers itself under a trace being read.
   */
  if (direction === 'up') {
    if (natural > previous) return natural
    return natural + step < previous ? natural : previous
  }
  if (natural < previous) return natural
  return natural - step > previous ? natural : previous
}

export interface ValueScaleOptions {
  /** Live setpoints, so a gap being closed is on screen before the trace reaches it. */
  activeTargets?: readonly number[]
  maximumTicks?: number
  /** Where the axis settled last frame, so it can hold rather than refit. */
  previous?: { minimum: number; maximum: number } | null
  /** Anchor the floor at zero rather than under the coldest reading. */
  lockToZero?: boolean
  /**
   * A ceiling the machine cannot exceed, used instead of fitting to the data.
   * An axis that never moves is the easiest of all to read across time — every
   * frame is the same frame — at the cost of a heat-up occupying a fraction of
   * it on a printer that can reach 300.
   */
  fixedMaximum?: number | null
}

export function valueScale(
  series: ReadonlyArray<readonly TimedValue[]>,
  options: ValueScaleOptions = {},
): ValueScale {
  const { activeTargets = [], maximumTicks = 5, previous = null, lockToZero = false } = options
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY

  for (const points of series) {
    for (const point of points) {
      if (point.value < low) low = point.value
      if (point.value > high) high = point.value
    }
  }
  for (const value of activeTargets) {
    if (value < low) low = value
    if (value > high) high = value
  }

  // Nothing to draw yet: a neutral span, so the axis is not NaN before the
  // first reading arrives and does not jump when it does.
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    low = 0
    high = coarsestValueStep * targetStepsPerFrame
  }
  if (lockToZero) low = Math.min(0, low)

  const fixed = options.fixedMaximum ?? null
  if (fixed !== null && Number.isFinite(fixed)) {
    const minimum = lockToZero ? 0 : steppedBound(low, previous?.minimum ?? null, 'down')
    const step = stepFor(valueSteps, Math.max(1, fixed - minimum), maximumTicks)
    return { minimum, maximum: fixed, ticks: ticksWithin(minimum, fixed, step) }
  }

  // Chosen from what the data covers, so nine degrees apart and a full heat-up
  // are not framed on the same grid.
  const frameStep = valueStepFor(Math.max(0, high - low))
  const minimum = lockToZero ? 0 : steppedBound(low, previous?.minimum ?? null, 'down', frameStep)
  let maximum = steppedBound(high, previous?.maximum ?? null, 'up', frameStep)
  const minimumSpan = frameStep * 2
  if (maximum - minimum < minimumSpan) {
    maximum = minimum + minimumSpan
  }

  const step = stepFor(valueSteps, maximum - minimum, maximumTicks)
  return { minimum, maximum, ticks: ticksWithin(minimum, maximum, step) }
}

function ticksWithin(minimum: number, maximum: number, step: number): number[] {
  const ticks: number[] = []
  for (let tick = Math.ceil(minimum / step) * step; tick <= maximum; tick += step) {
    // Steps below 1 are not offered, so rounding here only removes the float
    // dust that repeated addition accumulates.
    ticks.push(Math.round(tick * 1000) / 1000)
  }
  return ticks
}

/**
 * The window ends at the newest sample and runs back `windowSeconds`, always —
 * never "the oldest point I happen to hold, stretched to fit". A session forty
 * seconds old therefore draws forty seconds of trace against the right-hand
 * edge of a five-minute axis, rather than a full-width line claiming to be five
 * minutes of history that was never recorded.
 *
 * Ticks land on wall-clock boundaries rather than on equal fractions of the
 * window, which read as an irregular 23:02 / 23:03 / 23:05 / 23:07. Klipper's
 * `eventtime` is a monotonic clock with no relation to the wall, so the caller
 * supplies the offset between them; a sub-second error in it is invisible at
 * minute resolution.
 */
export function timeScale(options: {
  latestEventtime: number
  windowSeconds: number
  wallClockOffsetSeconds: number
  maximumTicks?: number
  /**
   * Whole tick steps generated beyond each end of the window.
   *
   * A static axis wants none: a tick outside the window is a tick outside the
   * plot. A scrolling one needs the tick that is about to enter to exist
   * already, because the caller draws the axis shifted by a fraction of a
   * step — without the overscan the tick has nothing to slide in from and
   * springs into being against the edge instead. The caller is expected to
   * clip, since these are deliberately outside the plot rectangle.
   */
  overscanSteps?: number
}): TimeScale {
  const { latestEventtime, windowSeconds, wallClockOffsetSeconds } = options
  const maximumTicks = options.maximumTicks ?? 5
  const overscanSteps = options.overscanSteps ?? 0
  const start = latestEventtime - windowSeconds
  const step = stepFor(timeSteps, windowSeconds, maximumTicks)

  const ticks: TimeTick[] = []
  const firstWall = Math.ceil((start + wallClockOffsetSeconds) / step) * step - overscanSteps * step
  const lastWall = latestEventtime + wallClockOffsetSeconds + overscanSteps * step
  for (let wallSeconds = firstWall; wallSeconds <= lastWall; wallSeconds += step) {
    ticks.push({ wallSeconds, eventtime: wallSeconds - wallClockOffsetSeconds })
  }

  return { start, end: latestEventtime, ticks }
}

/**
 * Thins a series to roughly `maximum` points while keeping every extreme.
 *
 * Plain striding is what loses a spike: drop three points in four and the one
 * sample where a heater overshot is the one thrown away three times out of
 * four. Bucketing and keeping each bucket's lowest and highest keeps the shape
 * of the envelope, which on a temperature plot is the part that matters.
 */
export function downsample(points: readonly TimedValue[], maximum: number): TimedValue[] {
  if (maximum < 4 || points.length <= maximum) return [...points]

  const bucketCount = Math.floor(maximum / 2)
  const bucketSize = points.length / bucketCount
  const thinned: TimedValue[] = []

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const from = Math.floor(bucket * bucketSize)
    const to = Math.min(points.length, Math.floor((bucket + 1) * bucketSize))
    if (to <= from) continue

    let lowest = points[from] as TimedValue
    let highest = points[from] as TimedValue
    for (let index = from + 1; index < to; index += 1) {
      const point = points[index] as TimedValue
      if (point.value < lowest.value) lowest = point
      if (point.value > highest.value) highest = point
    }

    // In the order they were measured, so the line never doubles back.
    const [first, second] =
      lowest.eventtime <= highest.eventtime ? [lowest, highest] : [highest, lowest]
    thinned.push(first)
    if (second !== first) thinned.push(second)
  }

  // The newest sample is the one the user is watching; bucketing must never
  // round it away and leave the trace ending short of the axis.
  const newest = points[points.length - 1] as TimedValue
  if (thinned[thinned.length - 1]?.eventtime !== newest.eventtime) thinned.push(newest)

  // The oldest is kept for the mirror-image reason. A bucket contributes its
  // extremes by value, which can be most of a bucket later than where the data
  // actually starts — and the caller deliberately holds samples from before the
  // window so the trace runs out past the plot's clipped left edge. Letting
  // bucketing eat that margin puts the end of the line back inside the plot.
  const oldest = points[0] as TimedValue
  if (thinned[0]?.eventtime !== oldest.eventtime) thinned.unshift(oldest)
  return thinned
}

/**
 * An SVG path through the points, or `''` when there is nothing to draw.
 *
 * `isDrawable` lifts the pen at a point that fails it rather than connecting
 * straight through: a straight segment to the next good point would draw a
 * reading that was never taken, the same reason `stepPath` lifts its own pen
 * for a heater that is off.
 */
export function linePath(
  points: readonly TimedValue[],
  projectX: (eventtime: number) => number,
  projectY: (value: number) => number,
  isDrawable: (value: number) => boolean = () => true,
): string {
  const commands: string[] = []
  let drawing = false

  for (const point of points) {
    if (!isDrawable(point.value)) {
      drawing = false
      continue
    }
    const x = projectX(point.eventtime).toFixed(1)
    const y = projectY(point.value).toFixed(1)
    commands.push(`${drawing ? 'L' : 'M'}${x} ${y}`)
    drawing = true
  }

  // A lone `M` draws nothing and only makes the path attribute longer.
  return commands.some((command) => command.startsWith('L')) ? commands.join(' ') : ''
}

/**
 * A target is a series of held values that step when the user asks for
 * something else, so it is drawn as a staircase rather than a slope: the
 * printer never ramped its setpoint from 0 to 215, it was told 215 at an
 * instant, and a diagonal there would show a climb that never happened.
 */
export function stepPath(
  points: readonly TimedValue[],
  projectX: (eventtime: number) => number,
  projectY: (value: number) => number,
  isDrawable: (value: number) => boolean = () => true,
): string {
  const commands: string[] = []
  let previous: TimedValue | null = null

  for (const point of points) {
    const drawable = isDrawable(point.value)
    const x = projectX(point.eventtime).toFixed(1)

    if (!drawable) {
      // Carry the old value up to the moment it stopped, then lift the pen.
      // A heater switched off has no setpoint to draw, and bridging the gap
      // would claim it held the last one throughout.
      if (previous) commands.push(`L${x} ${projectY(previous.value).toFixed(1)}`)
      previous = null
      continue
    }

    if (!previous) {
      commands.push(`M${x} ${projectY(point.value).toFixed(1)}`)
      previous = point
      continue
    }

    commands.push(`L${x} ${projectY(previous.value).toFixed(1)}`)
    commands.push(`L${x} ${projectY(point.value).toFixed(1)}`)
    previous = point
  }

  // A lone `M` draws nothing and only makes the path attribute longer.
  return commands.some((command) => command.startsWith('L')) ? commands.join(' ') : ''
}
