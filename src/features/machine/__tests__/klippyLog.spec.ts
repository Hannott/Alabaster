import { describe, expect, it } from 'vitest'

import {
  findRuns,
  foldLines,
  isKlippyLogName,
  runExcerpt,
  runRows,
} from '@/features/machine/klippyLog'

/** One start, shaped like a real klippy.log: header, config copy, Stats, a print, a shutdown. */
function shutdownRun(startWall: number, startMono: number): string[] {
  return [
    `Start printer at Sun Nov  1 10:38:22 2026 (${startWall} ${startMono})`,
    '===== Config file =====',
    '[printer]',
    'kinematics = corexy',
    '=======================',
    "mcu 'mcu': Starting serial connect",
    `Stats ${startMono + 1}: gcodein=0`,
    'Testing frequency: 5.0 Hz',
    '',
    'Testing frequency: 6.0 Hz',
    '',
    `Stats ${startMono + 2}: gcodein=0`,
    'Testing frequency: 7.0 Hz',
    'Testing frequency: 8.0 Hz',
    'Starting SD card print (position 0)',
    `Stats ${startMono + 60}: gcodein=0`,
    "MCU 'mcu' shutdown: Phase stepper move too late",
    'Dumping send queue 3 messages',
    'Sent 0 1.0 1.0 6: seq: 1',
    'Sent 1 1.0 1.0 6: seq: 2',
    'Sent 2 1.0 1.0 6: seq: 3',
    "Transition to shutdown state: MCU 'mcu' shutdown: Phase stepper move too late",
    'Traceback (most recent call last):',
    '  File "/klippy/extras/virtual_sdcard.py", line 430, in work_handler',
    '    self.gcode.run_script(line)',
    'klippy.printer.WaitInterruption: Command interrupted',
    'Printer is shutdown',
    'webhooks client 1: Disconnected',
    'Restarting printer',
  ]
}

function cleanRun(startWall: number, startMono: number): string[] {
  return [
    `Start printer at Sun Nov  1 10:47:52 2026 (${startWall} ${startMono})`,
    '===== Config file =====',
    '[printer]',
    '=======================',
    `Stats ${startMono + 1}: gcodein=0`,
    'Heater extruder within range of 220.000',
  ]
}

describe('isKlippyLogName', () => {
  it('takes the live log and its rotated copies, nothing else', () => {
    expect(isKlippyLogName('klippy.log')).toBe(true)
    expect(isKlippyLogName('klippy.log.2026-10-31')).toBe(true)
    expect(isKlippyLogName('moonraker.log')).toBe(false)
    expect(isKlippyLogName('klippy.log.bak/other')).toBe(true)
    expect(isKlippyLogName('my-klippy.log')).toBe(false)
  })
})

describe('findRuns', () => {
  it('splits at every start and says how each ended', () => {
    const lines = [...shutdownRun(1000, 50), ...cleanRun(2000, 60)]
    const runs = findRuns(lines, true)

    expect(runs).toHaveLength(2)
    expect(runs[0]).toMatchObject({
      start: 0,
      continued: false,
      outcome: {
        type: 'shutdown',
        reason: "MCU 'mcu' shutdown: Phase stepper move too late",
      },
    })
    expect(runs[0]!.startedAt?.getTime()).toBe(1_000_000)
    expect(runs[1]!.outcome).toEqual({ type: 'running' })
  })

  it('calls a clean run that Klipper restarted out of "restarted"', () => {
    const restarted = [
      ...cleanRun(1000, 50),
      'webhooks client 1: Disconnected',
      'Restarting printer',
    ]
    const runs = findRuns([...restarted, ...cleanRun(2000, 60)], true)

    expect(runs[0]!.outcome).toEqual({ type: 'restarted' })
  })

  it('calls a run that stops without a restart line "ended"', () => {
    const runs = findRuns([...cleanRun(1000, 50), ...cleanRun(2000, 60)], true)

    expect(runs[0]!.outcome).toEqual({ type: 'ended' })
  })

  /*
   * A config error never reaches a shutdown: the start fails, and the reason
   * is the message the traceback ends in, which is what the printer shows.
   */
  it('reports a start that failed with the message its traceback ended in', () => {
    const lines = [
      'Start printer at Sun Nov  1 09:00:00 2026 (1000 50)',
      'Config error',
      'Traceback (most recent call last):',
      '  File "/klippy/klippy.py", line 180, in _connect',
      "configparser.Error: Option 'rotation_distanc' is not valid in section 'extruder'",
    ]

    expect(findRuns(lines, true)[0]!.outcome).toMatchObject({
      type: 'error',
      reason: "Option 'rotation_distanc' is not valid in section 'extruder'",
    })
  })

  it('leaves out lines whose start has not been read yet', () => {
    const lines = ['Stats 10.0: gcodein=0', 'Heater bed within range', ...cleanRun(2000, 60)]

    expect(findRuns(lines, false)).toHaveLength(1)
  })

  /*
   * A rollover starts the new file with a repeat of the startup info and the
   * config, then the rollover line: the run itself began in the previous file.
   */
  it('reports the head of a rotated file as a run carried in from the previous log', () => {
    const lines = [
      "Loaded MCU 'mcu' 154 commands",
      '===== Config file =====',
      '[printer]',
      '=======================',
      '=============== Log rollover at Sun Nov  1 00:00:00 2026 ===============',
      'Stats 500.0: gcodein=0',
      ...cleanRun(2000, 60),
    ]
    const runs = findRuns(lines, true)

    expect(runs).toHaveLength(2)
    expect(runs[0]).toMatchObject({ start: 0, end: 6, continued: true })
    expect(runs[0]!.startedAt).toEqual(new Date(2026, 10, 1, 0, 0, 0))
    expect(runs[0]!.outcome).toEqual({ type: 'ended' })
  })
})

describe('runRows', () => {
  const lines = shutdownRun(1000, 50)
  const run = findRuns(lines, true)[0]!
  const { rows, hiddenStats } = runRows(lines, run)

  it('hides Stats lines and counts them', () => {
    expect(hiddenStats).toBe(3)
    expect(rows.some((row) => row.kind === 'line' && row.text.startsWith('Stats'))).toBe(false)
  })

  it('folds the config, the dump, the traceback, and a run of similar lines', () => {
    const folds = rows.filter((row) => row.kind === 'fold')

    expect(folds.map((row) => [row.fold, row.count])).toEqual([
      ['config', 4],
      ['similar', 4],
      ['dump', 4],
      ['traceback', 4],
    ])
    expect(folds[3]).toMatchObject({
      label: 'klippy.printer.WaitInterruption: Command interrupted',
      error: true,
    })
  })

  it('keeps every other line as written, and marks the shutdown and its MCU line', () => {
    const shown = rows.filter((row) => row.kind === 'line')

    expect(shown.map((row) => [row.text, row.mark])).toEqual([
      ['Start printer at Sun Nov  1 10:38:22 2026 (1000 50)', null],
      ["mcu 'mcu': Starting serial connect", null],
      ['Starting SD card print (position 0)', null],
      ["MCU 'mcu' shutdown: Phase stepper move too late", 'error'],
      ["Transition to shutdown state: MCU 'mcu' shutdown: Phase stepper move too late", 'shutdown'],
      ['Printer is shutdown', null],
      ['webhooks client 1: Disconnected', null],
      ['Restarting printer', null],
    ])
  })

  /** Only Stats lines carry Klipper's clock; the start line ties it to the wall clock. */
  it('times each row from the last Stats line before it', () => {
    const at = (text: string) =>
      rows.find((row) => row.kind === 'line' && row.text === text)?.time?.getTime()

    expect(at("mcu 'mcu': Starting serial connect")).toBe(1_000_000)
    expect(at("MCU 'mcu' shutdown: Phase stepper move too late")).toBe(1_060_000)
  })

  it('opens a fold to its own lines, still without Stats', () => {
    const similar = rows.find((row) => row.kind === 'fold' && row.fold === 'similar')!
    if (similar.kind !== 'fold') throw new Error('not a fold')

    expect(foldLines(lines, similar).map((entry) => entry.text)).toEqual([
      'Testing frequency: 5.0 Hz',
      '',
      'Testing frequency: 6.0 Hz',
      '',
      'Testing frequency: 7.0 Hz',
      'Testing frequency: 8.0 Hz',
    ])
  })

  /** The bed mesh table pads its columns to each number's width; that is not a different shape. */
  it('folds a padded table as one run of similar lines', () => {
    const table = [
      'Start printer at Sun Nov  1 10:38:22 2026 (1000 50)',
      'Index |  Tool Adjusted  |   Probe',
      '  0   | (15.0, -10.0)   | (15.0, 15.0)',
      '  9   | (235.9, -10.0)  | (235.9, 15.0)',
      '  10  | (260.4, -10.0)  | (260.4, 15.0)',
      '  12  | (284.9, 16.9)   | (284.9, 41.9)',
      '  107 | (15.0, 230.0)   | (15.0, 255.0)',
    ]
    const result = runRows(table, findRuns(table, true)[0]!)

    expect(result.rows.at(-1)).toMatchObject({ kind: 'fold', fold: 'similar', count: 5 })
  })

  it('folds what a rollover repeated at the top of a carried-in run', () => {
    const rotated = [
      "Loaded MCU 'mcu' 154 commands",
      '===== Config file =====',
      '[printer]',
      '=======================',
      '=============== Log rollover at Sun Nov  1 00:00:00 2026 ===============',
      'Stats 500.0: gcodein=0',
      'Heater bed within range',
    ]
    const carried = findRuns(rotated, true)[0]!
    const result = runRows(rotated, carried)

    expect(result.rows[0]).toMatchObject({ kind: 'fold', fold: 'rollover', count: 4 })
    expect(result.rows.at(-1)).toMatchObject({
      kind: 'line',
      text: 'Heater bed within range',
      time: new Date(2026, 10, 1, 0, 0, 0),
    })
  })
})

describe('runExcerpt', () => {
  it('writes out the dump and traceback, keeps the last Stats line, and notes what it left out', () => {
    const lines = shutdownRun(1000, 50)
    const excerpt = runExcerpt(lines, findRuns(lines, true)[0]!)

    expect(excerpt).toEqual([
      { kind: 'line', text: 'Start printer at Sun Nov  1 10:38:22 2026 (1000 50)' },
      { kind: 'omitted', what: 'config', count: 4 },
      { kind: 'line', text: "mcu 'mcu': Starting serial connect" },
      { kind: 'line', text: 'Testing frequency: 5.0 Hz' },
      { kind: 'omitted', what: 'similar', count: 3 },
      { kind: 'line', text: 'Starting SD card print (position 0)' },
      { kind: 'line', text: 'Stats 110: gcodein=0' },
      { kind: 'line', text: "MCU 'mcu' shutdown: Phase stepper move too late" },
      { kind: 'line', text: 'Dumping send queue 3 messages' },
      { kind: 'line', text: 'Sent 0 1.0 1.0 6: seq: 1' },
      { kind: 'line', text: 'Sent 1 1.0 1.0 6: seq: 2' },
      { kind: 'line', text: 'Sent 2 1.0 1.0 6: seq: 3' },
      {
        kind: 'line',
        text: "Transition to shutdown state: MCU 'mcu' shutdown: Phase stepper move too late",
      },
      { kind: 'line', text: 'Traceback (most recent call last):' },
      {
        kind: 'line',
        text: '  File "/klippy/extras/virtual_sdcard.py", line 430, in work_handler',
      },
      { kind: 'line', text: '    self.gcode.run_script(line)' },
      { kind: 'line', text: 'klippy.printer.WaitInterruption: Command interrupted' },
      { kind: 'line', text: 'Printer is shutdown' },
      { kind: 'line', text: 'webhooks client 1: Disconnected' },
      { kind: 'line', text: 'Restarting printer' },
    ])
  })

  it('keeps the top and the end of a run too long to post', () => {
    const lines = [
      'Start printer at Sun Nov  1 10:38:22 2026 (1000 50)',
      ...Array.from(
        { length: 1000 },
        (_, index) => `line ${index % 2 ? 'odd' : 'even'} ${'x'.repeat(index % 7)}`,
      ),
      'Transition to shutdown state: Timer too close',
    ]
    const excerpt = runExcerpt(lines, findRuns(lines, true)[0]!)

    expect(excerpt).toHaveLength(401)
    expect(excerpt[0]).toEqual({ kind: 'line', text: lines[0] })
    expect(excerpt[80]).toEqual({ kind: 'omitted', what: 'lines', count: 602 })
    expect(excerpt.at(-1)).toEqual({ kind: 'line', text: lines.at(-1) })
  })
})

describe('runExcerpt, client requests', () => {
  it('leaves out the requests Klipper dumps for each API client', () => {
    const lines = [
      'Start printer at Sun Nov  1 10:38:22 2026 (1000 50)',
      "Transition to shutdown state: Lost communication with MCU 'mcu'",
      'Dumping 2 requests for client 5477',
      `Received 15829.3: b'{"id":1,"method":"objects/list"}'`,
      `Received 15829.4: b'{"id":2,"method":"info"}'`,
      'Restarting printer',
    ]
    const excerpt = runExcerpt(lines, findRuns(lines, true)[0]!)

    expect(excerpt.slice(2)).toEqual([
      { kind: 'line', text: 'Dumping 2 requests for client 5477' },
      { kind: 'omitted', what: 'requests', count: 2 },
      { kind: 'line', text: 'Restarting printer' },
    ])
  })
})

describe('runExcerpt, long shutdowns', () => {
  it('keeps the last messages of each MCU queue dump', () => {
    const lines = [
      'Start printer at Sun Nov  1 10:38:22 2026 (1000 50)',
      "Transition to shutdown state: MCU 'mcu' shutdown: Timer too close",
      'Dumping send queue 12 messages',
      ...Array.from({ length: 12 }, (_, index) => `Sent ${index} 1.0 1.0 6: seq: ${index}`),
    ]
    const excerpt = runExcerpt(lines, findRuns(lines, true)[0]!)

    expect(excerpt.slice(2, 5)).toEqual([
      { kind: 'line', text: 'Dumping send queue 12 messages' },
      { kind: 'omitted', what: 'messages', count: 2 },
      { kind: 'line', text: 'Sent 2 1.0 1.0 6: seq: 2' },
    ])
    expect(excerpt.at(-1)).toEqual({ kind: 'line', text: 'Sent 11 1.0 1.0 6: seq: 11' })
  })

  /** A long tail after the first traceback is still the part a reader needs. */
  it('cuts before the first traceback rather than through it', () => {
    const filler = (from: number, count: number) =>
      Array.from({ length: count }, (_, index) => `step ${from + index} ${'x'.repeat(index % 5)}`)
    const lines = [
      'Start printer at Sun Nov  1 10:38:22 2026 (1000 50)',
      ...filler(0, 200),
      'Traceback (most recent call last):',
      ...Array.from(
        { length: 60 },
        (_, index) => `  File "/klippy/mcu.py", line ${index}, in send`,
      ),
      'klippy.serialhdl.error: non-critical MCU is disconnected',
      ...filler(1000, 300),
      'Transition to shutdown state: Unhandled exception during run',
    ]
    const excerpt = runExcerpt(lines, findRuns(lines, true)[0]!)
    const traceback = excerpt.findIndex(
      (entry) => entry.kind === 'line' && entry.text.startsWith('Traceback'),
    )

    expect(excerpt[80]).toEqual({ kind: 'omitted', what: 'lines', count: 81 })
    expect(traceback).toBe(81 + 40)
    expect(excerpt.slice(traceback, traceback + 62).every((entry) => entry.kind === 'line')).toBe(
      true,
    )
    expect(excerpt.at(-1)).toEqual({ kind: 'line', text: lines.at(-1) })
  })
})
