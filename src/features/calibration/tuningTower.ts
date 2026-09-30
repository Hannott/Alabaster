/**
 * Klipper's `TUNING_TOWER`: a value that changes with the height of a print,
 * so one tower shows a whole range of settings and the reader reads the best
 * one off it with calipers. Klipper's pressure advance guide is the canonical
 * use; firmware retraction's length is tuned the same way.
 *
 * The arithmetic is `tuning_tower.py`'s own `calc_value`, so the value worked
 * out from a height is the value the printer was running at that height.
 * Nothing here sends a command or writes a file.
 */

export type TowerTarget = 'pressureAdvance' | 'retractLength'

export interface TowerSweep {
  start: number
  factor: number
  /** Holds the value for each band of this many millimetres; 0 changes it every layer. */
  band: number
}

export interface TowerTargetInfo {
  /** The command and the word `TUNING_TOWER` rewrites at every layer. */
  command: string
  parameter: string
  /** Where the value is kept once read off the tower. */
  section: string
  option: string
  decimals: number
  /** Klipper's guide's sweeps for its two common setups, as starting points. */
  presets: Readonly<Record<'direct' | 'bowden', TowerSweep>>
}

export const towerTargets: Readonly<Record<TowerTarget, TowerTargetInfo>> = {
  pressureAdvance: {
    command: 'SET_PRESSURE_ADVANCE',
    parameter: 'ADVANCE',
    section: 'extruder',
    option: 'pressure_advance',
    decimals: 4,
    presets: {
      direct: { start: 0, factor: 0.005, band: 0 },
      bowden: { start: 0, factor: 0.02, band: 0 },
    },
  },
  /*
   * Klipper's guide has no retraction tower; these sweep 0-2 mm and 0-6 mm
   * over a 100 mm tower in 5 mm bands, so each band is tall enough to judge
   * stringing across.
   */
  retractLength: {
    command: 'SET_RETRACTION',
    parameter: 'RETRACT_LENGTH',
    section: 'firmware_retraction',
    option: 'retract_length',
    decimals: 2,
    presets: {
      direct: { start: 0, factor: 0.02, band: 5 },
      bowden: { start: 0, factor: 0.06, band: 5 },
    },
  },
}

/** `tuning_tower.py`'s `calc_value` for a height in millimetres, without `SKIP`. */
export function towerValue(sweep: TowerSweep, height: number): number {
  const z = sweep.band > 0 ? (Math.floor(height / sweep.band) + 0.5) * sweep.band : height
  return sweep.start + z * sweep.factor
}

function number(value: number): string {
  return String(Number(value.toFixed(6)))
}

export function isValidSweep(sweep: TowerSweep): boolean {
  return (
    Number.isFinite(sweep.start) &&
    sweep.start >= 0 &&
    Number.isFinite(sweep.factor) &&
    sweep.factor > 0 &&
    Number.isFinite(sweep.band) &&
    sweep.band >= 0
  )
}

/**
 * What goes to the printer before the tower is printed. For pressure advance,
 * Klipper's guide first slows cornering (`SQUARE_CORNER_VELOCITY=1
 * ACCEL=500`) so the corners show pressure rather than speed; the restart that
 * loads the kept value puts both limits back.
 */
export function towerScript(target: TowerTarget, sweep: TowerSweep): string | null {
  if (!isValidSweep(sweep)) return null
  const info = towerTargets[target]
  const words = [
    'TUNING_TOWER',
    `COMMAND=${info.command}`,
    `PARAMETER=${info.parameter}`,
    `START=${number(sweep.start)}`,
    `FACTOR=${number(sweep.factor)}`,
    ...(sweep.band > 0 ? [`BAND=${number(sweep.band)}`] : []),
  ].join(' ')
  return target === 'pressureAdvance'
    ? ['SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=1 ACCEL=500', words].join('\n')
    : words
}

/** The command that runs a value read off the tower until the next restart. */
export function applyScript(target: TowerTarget, value: number): string {
  const info = towerTargets[target]
  return `${info.command} ${info.parameter}=${number(value)}`
}
