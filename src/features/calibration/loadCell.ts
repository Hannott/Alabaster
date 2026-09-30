/**
 * Klipper's load cell calibration, as `load_cell.py`'s guided helper runs it:
 * `LOAD_CELL_CALIBRATE` opens the helper, `TARE` reads the cell with nothing
 * on it, `CALIBRATE GRAMS=` reads it again under a known weight, and `ACCEPT`
 * stages `counts_per_gram` and `reference_tare_counts` for `SAVE_CONFIG`.
 * `ABORT` leaves without either.
 *
 * The helper answers in console lines only, so what it has found is read back
 * from them here, in its own format strings.
 */

/** The sections a load cell is declared under; a load cell probe is one too. */
export function loadCells(sections: readonly string[]): string[] {
  return sections.filter(
    (section) =>
      section === 'load_cell' || section.startsWith('load_cell ') || section === 'load_cell_probe',
  )
}

/**
 * The `LOAD_CELL=` word a command needs. The unnamed `[load_cell]` and
 * `[load_cell_probe]` also answer to the bare command; a named one only by
 * its name.
 */
export function loadCellWord(section: string): string | null {
  if (section === 'load_cell' || section === 'load_cell_probe') return null
  return `LOAD_CELL=${section.slice('load_cell '.length)}`
}

/** `CALIBRATE`'s own bounds on `GRAMS`. */
export const minimumGrams = 50
export const maximumGrams = 25000

export interface LoadCellReading {
  /** Where the helper stands: nothing done, tared, calibrated, or ended. */
  phase: 'started' | 'tared' | 'calibrated' | 'accepted' | 'aborted' | null
  tarePercent: number | null
  countsPerGram: number | null
  capacityKg: number | null
  /** The helper's warnings and errors, verbatim. */
  warnings: string[]
}

/* A second start while one is open is refused, which says one is open. */
const started = /Starting load cell calibration|Already Calibrating a Load Cell/
const tare = /Load cell tare value: ([-\d.]+)%/
const calibration = /Counts\/gram: ([-\d.]+),\s*Total capacity: \+\/- ([\d.]+)Kg/
const accepted = /Load cell calibration settings:/
const aborted = /Load cell calibration aborted|Calibration process is incomplete/
const warning = /^(WARNING|ERROR):/

/** What the lines since `LOAD_CELL_CALIBRATE` say, the latest of each. */
export function readLoadCell(lines: readonly string[]): LoadCellReading {
  const reading: LoadCellReading = {
    phase: null,
    tarePercent: null,
    countsPerGram: null,
    capacityKg: null,
    warnings: [],
  }
  const flat = lines
    .flatMap((line) => line.split('\n'))
    .map((line) => line.replace(/^\s*(\/\/|!!)\s?/, '').trim())
  for (const line of flat) {
    if (started.test(line)) {
      reading.phase = 'started'
      reading.warnings = []
      continue
    }
    const tared = tare.exec(line)
    if (tared) {
      reading.phase = 'tared'
      reading.tarePercent = Number(tared[1])
      reading.countsPerGram = null
      reading.capacityKg = null
      continue
    }
    const calibrated = calibration.exec(line)
    if (calibrated) {
      reading.phase = 'calibrated'
      reading.countsPerGram = Number(calibrated[1])
      reading.capacityKg = Number(calibrated[2])
      continue
    }
    if (accepted.test(line)) reading.phase = 'accepted'
    else if (aborted.test(line)) reading.phase = 'aborted'
    else if (warning.test(line)) reading.warnings.push(line)
  }
  return reading
}
