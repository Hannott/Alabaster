/**
 * Reading `klippy.log` one run at a time.
 *
 * Klipper copies the whole config into its log on every start and writes a
 * Stats line every second, so the hundred lines that say why a run ended sit
 * among thousands that never change. This splits a log into runs, says how
 * each one ended, and turns a run into rows: Stats lines hidden, the blocks
 * nobody reads line by line folded to one row each, and every other line kept
 * exactly as written.
 *
 * Pure: the lines come in as strings and the rows go out as data, so every
 * rule here is testable without a printer or a component.
 */

/** `klippy.log` and the copies a rollover leaves behind (`klippy.log.2026-10-31`). */
export function isKlippyLogName(name: string): boolean {
  return /^klippy\.log(\..+)?$/.test(name)
}

export type KlippyRunOutcome =
  | { type: 'running' }
  | { type: 'shutdown'; reason: string; line: number }
  | { type: 'error'; reason: string; line: number }
  | { type: 'restarted' }
  | { type: 'ended' }

export interface KlippyRun {
  /** First line of the run, inclusive. */
  start: number
  /** One past the last line of the run. */
  end: number
  /**
   * A run that began in an earlier file and was carried into this one by a
   * rollover, rather than one Klipper started here.
   */
  continued: boolean
  /** Wall-clock time the run started, when the log says. */
  startedAt: Date | null
  outcome: KlippyRunOutcome
}

const START_LINE = /^Start printer at .*\(([\d.]+) ([\d.]+)\)\s*$/
const ROLLOVER_LINE = /^=+ Log rollover at (.+?) =+$/
const STATS_LINE = /^Stats ([\d.]+):/
const CONFIG_OPEN = '===== Config file ====='
const CONFIG_CLOSE = '======================='
const TRACEBACK_LINE = 'Traceback (most recent call last):'
const DUMP_LINE = /^Dumping /
const DUMP_BODY = /^(Config \d+:|Sent \d+|Receive: \d+|Received \d+|queue_step \d+)/
const SHUTDOWN_LINE = /^Transition to shutdown state: (.*)$/
const ERROR_LINE = /^MCU '[^']+' shutdown:/
/*
 * What Klipper logs, through `logging.exception`, when a start fails before
 * the printer is ready. The traceback that follows ends in the message the
 * printer shows, which is the reason worth stating.
 */
const START_FAILURE = /^(Config error|MCU error during connect|Unhandled exception during connect)$/
const RESTART_LINE = 'Restarting printer'
/** Fewer than this many lines in a row with the same shape are left as they are. */
const SIMILAR_MIN = 4

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `Sun Nov  1 00:00:00 2026`, Python's `time.asctime()`, in the printer's local time. */
function parseAsctime(text: string): Date | null {
  const match = /^\w{3} (\w{3}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(text.trim())
  if (!match) return null
  const month = MONTHS.indexOf(match[1]!)
  if (month < 0) return null
  return new Date(
    Number(match[6]),
    month,
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  )
}

function isTracebackBody(line: string): boolean {
  return line.startsWith(' ') || line.startsWith('\t')
}

/** The line a traceback starting at `index` ends on: its exception. */
function tracebackEnd(lines: readonly string[], index: number, end: number): number {
  let cursor = index + 1
  while (cursor < end && isTracebackBody(lines[cursor]!)) cursor += 1
  return Math.min(cursor, end - 1)
}

/** `klippy.gcode.CommandError: MCU 'mcu' shutdown: …` → `MCU 'mcu' shutdown: …`. */
function exceptionMessage(line: string): string {
  return line.replace(/^[\w.]+: /, '')
}

function outcomeOf(
  lines: readonly string[],
  start: number,
  end: number,
  isLast: boolean,
): KlippyRunOutcome {
  let failure: KlippyRunOutcome | null = null
  for (let index = start; index < end; index += 1) {
    const line = lines[index]!
    const shutdown = SHUTDOWN_LINE.exec(line)
    if (shutdown) return { type: 'shutdown', reason: shutdown[1]!, line: index }
    if (!failure && START_FAILURE.test(line) && lines[index + 1] === TRACEBACK_LINE) {
      const last = tracebackEnd(lines, index + 1, end)
      failure = { type: 'error', reason: exceptionMessage(lines[last]!), line: index }
    }
  }
  if (failure) return failure
  if (isLast) return { type: 'running' }
  // Moonraker's client disconnecting is logged after the restart line, so it is stepped over.
  for (let index = end - 1; index >= start; index -= 1) {
    const line = lines[index]!
    if (!line.trim() || STATS_LINE.test(line) || line.startsWith('webhooks client')) continue
    if (line === RESTART_LINE) return { type: 'restarted' }
    break
  }
  return { type: 'ended' }
}

/**
 * Every run in `lines`, oldest first.
 *
 * `fromFileStart` says whether `lines` begins at the start of the file. When
 * it does not, the lines before the first start belong to a run whose start
 * has not been read yet, and are left out rather than reported as a run of
 * their own. When it does, those lines are the run a rollover carried in.
 */
export function findRuns(lines: readonly string[], fromFileStart: boolean): KlippyRun[] {
  const starts: number[] = []
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]!.startsWith('Start printer at ')) starts.push(index)
  }
  const runs: KlippyRun[] = []
  const firstStart = starts[0] ?? lines.length
  if (fromFileStart && firstStart > 0 && lines.slice(0, firstStart).some((line) => line.trim())) {
    const rolloverIndex = lines.findIndex(
      (line, index) => index < firstStart && ROLLOVER_LINE.test(line),
    )
    const rollover = rolloverIndex >= 0 ? ROLLOVER_LINE.exec(lines[rolloverIndex]!) : null
    runs.push({
      start: 0,
      end: firstStart,
      continued: true,
      startedAt: rollover ? parseAsctime(rollover[1]!) : null,
      outcome: outcomeOf(lines, 0, firstStart, starts.length === 0),
    })
  }
  starts.forEach((start, position) => {
    const end = starts[position + 1] ?? lines.length
    const match = START_LINE.exec(lines[start]!)
    runs.push({
      start,
      end,
      continued: false,
      startedAt: match ? new Date(Number(match[1]) * 1000) : null,
      outcome: outcomeOf(lines, start, end, position === starts.length - 1),
    })
  })
  return runs
}

/**
 * A run's identity that survives earlier lines being read in front of it,
 * which shifts every line index: its start line carries the wall and
 * monotonic clocks, so no two starts share it.
 */
export function runKey(lines: readonly string[], run: KlippyRun): string {
  return run.continued ? 'continued' : (lines[run.start] ?? '')
}

/** Whether a print was running at line `at` of the run: started and not yet finished. */
export function wasPrinting(lines: readonly string[], run: KlippyRun, at: number): boolean {
  let printing = false
  for (let index = run.start; index < Math.min(at, run.end); index += 1) {
    const line = lines[index]!
    if (line.startsWith('Starting SD card print')) printing = true
    else if (line.startsWith('Finished SD card print') || line.startsWith('Exiting SD card print'))
      printing = false
  }
  return printing
}

export type KlippyFoldKind = 'config' | 'rollover' | 'traceback' | 'dump' | 'similar'

export type KlippyLogRow =
  | {
      kind: 'line'
      /** Index into the log's lines; also the row's stable key. */
      line: number
      time: Date | null
      text: string
      mark: 'shutdown' | 'error' | null
    }
  | {
      kind: 'fold'
      fold: KlippyFoldKind
      line: number
      /** One past the last line the fold holds. */
      end: number
      time: Date | null
      /** The fold's own first line, or the exception a traceback ended in. */
      label: string
      /** Lines the fold holds, Stats lines inside it not counted. */
      count: number
      error: boolean
    }

export interface KlippyRunRows {
  rows: KlippyLogRow[]
  /** Stats lines left out of the rows. */
  hiddenStats: number
}

/**
 * Maps Klipper's monotonic clock, which every Stats line carries, onto the
 * wall clock. The start line pairs the two; a run carried in by a rollover
 * pairs the rollover's own time with the first Stats line after it.
 */
class RunClock {
  private offset: number | null = null
  private current: Date | null = null
  private pendingWall: number | null = null

  constructor(startLine: string | undefined, startedAt: Date | null) {
    const match = startLine ? START_LINE.exec(startLine) : null
    if (match) {
      this.offset = Number(match[1]) - Number(match[2])
      this.current = new Date(Number(match[1]) * 1000)
    } else if (startedAt) {
      this.pendingWall = startedAt.getTime() / 1000
      this.current = startedAt
    }
  }

  stats(monotonic: number): void {
    if (this.offset === null && this.pendingWall !== null) {
      this.offset = this.pendingWall - monotonic
      this.pendingWall = null
    }
    if (this.offset !== null) this.current = new Date((monotonic + this.offset) * 1000)
  }

  get now(): Date | null {
    return this.current
  }
}

/*
 * Numbers and the spacing between columns are what vary down a run of similar
 * lines — a frequency sweep, the bed mesh's point table, whose columns are
 * padded to the width of each number — so neither counts toward the shape.
 */
function shapeOf(line: string): string {
  return line
    .replace(/-?\d+(\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The rows one run is shown as. */
export function runRows(lines: readonly string[], run: KlippyRun): KlippyRunRows {
  const rows: KlippyLogRow[] = []
  const clock = new RunClock(run.continued ? undefined : lines[run.start], run.startedAt)
  let hiddenStats = 0

  /** Advances the clock over Stats lines in [from, to) and returns how many there were. */
  function passStats(from: number, to: number): number {
    let count = 0
    for (let index = from; index < to; index += 1) {
      const stats = STATS_LINE.exec(lines[index]!)
      if (!stats) continue
      clock.stats(Number(stats[1]))
      count += 1
    }
    return count
  }

  function fold(
    kind: KlippyFoldKind,
    line: number,
    end: number,
    label: string,
    error = false,
  ): void {
    const stats = passStats(line, end)
    hiddenStats += stats
    rows.push({
      kind: 'fold',
      fold: kind,
      line,
      end,
      time: clock.now,
      label,
      count: end - line - stats,
      error,
    })
  }

  const rolloverIndex = run.continued
    ? lines.findIndex((line, index) => index < run.end && ROLLOVER_LINE.test(line))
    : -1
  let index = run.start
  if (rolloverIndex > run.start) {
    fold('rollover', run.start, rolloverIndex, lines[run.start]!)
    index = rolloverIndex
  }

  while (index < run.end) {
    const text = lines[index]!
    const stats = STATS_LINE.exec(text)
    if (stats) {
      clock.stats(Number(stats[1]))
      hiddenStats += 1
      index += 1
      continue
    }
    if (!text.trim()) {
      index += 1
      continue
    }
    if (text === CONFIG_OPEN) {
      let close = index + 1
      while (close < run.end && lines[close] !== CONFIG_CLOSE) close += 1
      const end = Math.min(close + 1, run.end)
      fold('config', index, end, text)
      index = end
      continue
    }
    if (text === TRACEBACK_LINE) {
      const last = tracebackEnd(lines, index, run.end)
      fold('traceback', index, last + 1, lines[last]!, true)
      index = last + 1
      continue
    }
    if (DUMP_LINE.test(text)) {
      let end = index + 1
      while (end < run.end && DUMP_BODY.test(lines[end]!)) end += 1
      if (end - index > 1) {
        fold('dump', index, end, text)
        index = end
        continue
      }
    }
    const shape = shapeOf(text)
    let cursor = index + 1
    let same = 1
    let lastSame = index
    while (cursor < run.end) {
      const next = lines[cursor]!
      if (!next.trim() || STATS_LINE.test(next)) {
        cursor += 1
        continue
      }
      if (shapeOf(next) !== shape) break
      same += 1
      lastSame = cursor
      cursor += 1
    }
    if (same >= SIMILAR_MIN) {
      const end = lastSame + 1
      const stats = passStats(index, end)
      hiddenStats += stats
      rows.push({
        kind: 'fold',
        fold: 'similar',
        line: index,
        end,
        time: clock.now,
        label: text,
        count: same,
        error: false,
      })
      index = end
      continue
    }
    const mark = SHUTDOWN_LINE.test(text)
      ? 'shutdown'
      : ERROR_LINE.test(text) || START_FAILURE.test(text)
        ? 'error'
        : null
    rows.push({ kind: 'line', line: index, time: clock.now, text, mark })
    index += 1
  }
  return { rows, hiddenStats }
}

export type KlippyExcerptEntry =
  | { kind: 'line'; text: string }
  | {
      kind: 'omitted'
      what: 'config' | 'similar' | 'requests' | 'messages' | 'lines'
      count: number
    }

/*
 * After a shutdown Klipper also dumps the last requests each API client sent,
 * which for a front end is its own subscribe calls: tens of kilobytes of JSON
 * that say nothing about why the printer stopped, and would take an excerpt
 * past a forum post's length on their own.
 */
const CLIENT_REQUESTS_DUMP = /^Dumping \d+ requests for client /

/*
 * The MCU's send and receive queues are dumped a hundred messages each, and a
 * send-queue line can run to five hundred characters of step timing. The last
 * few before the shutdown are the ones read; the rest only push the excerpt
 * past what a forum post holds.
 */
const QUEUE_DUMP = /^Dumping (send|receive) queue /
const QUEUE_DUMP_KEPT = 10

/** Entries an excerpt keeps; a forum post has to fit, and a reader skims past a few hundred. */
const EXCERPT_LIMIT = 400
/** Of those, how many come from the top of the run, where its versions and MCUs are stated. */
const EXCERPT_HEAD = 80
/** Entries kept from just before the first sign of trouble, which say what the printer was doing. */
const EXCERPT_LEAD_IN = 40
/** The most entries kept from the trouble on, which can run past the limit rather than be cut. */
const EXCERPT_TAIL_MAX = 600

/**
 * The part of a run worth pasting into a forum post or an AI chat: every line
 * the run view shows, with tracebacks and MCU dumps written out, because
 * those are what the people answering read first. The config copy
 * and runs of similar lines are left out with a note saying so, and only the
 * last Stats line before a shutdown is kept, since it holds the MCU and timing
 * figures a shutdown is diagnosed from. A run too long to post keeps its top
 * and everything from shortly before the first sign of trouble.
 */
export function runExcerpt(lines: readonly string[], run: KlippyRun): KlippyExcerptEntry[] {
  const placed: Array<{ at: number; entry: KlippyExcerptEntry }> = []
  const line = (at: number) => placed.push({ at, entry: { kind: 'line', text: lines[at]! } })

  function rawLines(from: number, to: number): void {
    let index = from
    while (index < to) {
      const text = lines[index]!
      if (text === CONFIG_OPEN) {
        let close = index + 1
        while (close < to && lines[close] !== CONFIG_CLOSE) close += 1
        const end = Math.min(close + 1, to)
        placed.push({
          at: index,
          entry: { kind: 'omitted', what: 'config', count: end - index },
        })
        index = end
        continue
      }
      if (text.trim() && !STATS_LINE.test(text)) line(index)
      index += 1
    }
  }

  for (const row of runRows(lines, run).rows) {
    if (row.kind === 'line') line(row.line)
    else if (row.fold === 'config')
      placed.push({ at: row.line, entry: { kind: 'omitted', what: 'config', count: row.count } })
    else if (row.fold === 'similar') {
      line(row.line)
      placed.push({
        at: row.line + 0.5,
        entry: { kind: 'omitted', what: 'similar', count: row.count - 1 },
      })
    } else if (row.fold === 'dump' && CLIENT_REQUESTS_DUMP.test(row.label)) {
      line(row.line)
      placed.push({
        at: row.line + 0.5,
        entry: { kind: 'omitted', what: 'requests', count: row.count - 1 },
      })
    } else if (row.fold === 'dump' && QUEUE_DUMP.test(row.label)) {
      const messages = foldLines(lines, row).slice(1)
      const kept = messages.slice(-QUEUE_DUMP_KEPT)
      line(row.line)
      if (messages.length > kept.length)
        placed.push({
          at: row.line + 0.5,
          entry: { kind: 'omitted', what: 'messages', count: messages.length - kept.length },
        })
      for (const message of kept) line(message.line)
    } else rawLines(row.line, row.end)
  }

  if (run.outcome.type === 'shutdown') {
    let failedAt = run.outcome.line
    for (let index = run.start; index < failedAt; index += 1) {
      if (ERROR_LINE.test(lines[index]!)) {
        failedAt = index
        break
      }
    }
    for (let index = failedAt - 1; index >= run.start; index -= 1) {
      if (STATS_LINE.test(lines[index]!)) {
        line(index)
        break
      }
    }
  }

  placed.sort((a, b) => a.at - b.at)
  const entries = placed.map((item) => item.entry)
  if (entries.length <= EXCERPT_LIMIT) return entries
  /*
   * The cut goes before the trouble, never through it: a traceback cut in half
   * or a shutdown left out is the excerpt failing at the one thing it is for.
   */
  const trouble = firstTrouble(lines, run)
  const troubleAt = placed.findIndex((item) => item.at >= trouble)
  const fromEnd = entries.length - (EXCERPT_LIMIT - EXCERPT_HEAD)
  const fromTrouble = troubleAt - EXCERPT_LEAD_IN
  // A harmless traceback hours before the shutdown would otherwise keep everything after it.
  const keepFrom =
    troubleAt >= 0 && entries.length - fromTrouble <= EXCERPT_TAIL_MAX
      ? Math.min(fromTrouble, fromEnd)
      : fromEnd
  if (keepFrom <= EXCERPT_HEAD) return entries
  return [
    ...entries.slice(0, EXCERPT_HEAD),
    { kind: 'omitted', what: 'lines', count: weight(entries.slice(EXCERPT_HEAD, keepFrom)) },
    ...entries.slice(keepFrom),
  ]
}

/** Lines that entries stand for, counting what each note says it left out. */
function weight(entries: readonly KlippyExcerptEntry[]): number {
  return entries.reduce((sum, entry) => sum + (entry.kind === 'line' ? 1 : entry.count), 0)
}

/** The first line of a run that reports something wrong, or its end when nothing does. */
function firstTrouble(lines: readonly string[], run: KlippyRun): number {
  for (let index = run.start; index < run.end; index += 1) {
    const text = lines[index]!
    if (
      text === TRACEBACK_LINE ||
      SHUTDOWN_LINE.test(text) ||
      ERROR_LINE.test(text) ||
      START_FAILURE.test(text)
    )
      return index
  }
  return run.end
}

/** The lines a fold holds, as they are shown once it is opened: Stats lines still left out. */
export function foldLines(
  lines: readonly string[],
  row: Extract<KlippyLogRow, { kind: 'fold' }>,
): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = []
  for (let index = row.line; index < row.end; index += 1) {
    const text = lines[index]!
    if (STATS_LINE.test(text)) continue
    out.push({ line: index, text })
  }
  return out
}
