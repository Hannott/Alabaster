/**
 * The configuration options Klipper can also be told at runtime, and the
 * command that tells it — what the editor's "Apply until restart" sends for
 * the line under the pointer.
 *
 * That is the tuning loop the config file alone cannot offer: try a value on
 * the running printer, and write it to the file once it works. The command
 * only lasts until the next restart, which is the point — the file stays the
 * record of what the printer boots with.
 *
 * Only the options whose command takes the value exactly as the file spells
 * it are listed. A value is refused unless it is a plain number, or for a
 * shaper type a plain word, so nothing typed into the file can smuggle a
 * second command onto the line.
 */

import type { PrinterCommandKey } from '@/stores/printer'

export interface RuntimeCommand {
  script: string
  key: PrinterCommandKey
}

type Parse = (value: string) => string | null

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/
const WORD = /^[a-z0-9_]+$/i

const number: Parse = (value) =>
  NUMBER.test(value) && Number.isFinite(Number(value)) ? value : null
const word: Parse = (value) => (WORD.test(value) ? value.toLowerCase() : null)

/*
 * `SET_GCODE_VARIABLE` reads its value as a Python literal, as the file does.
 * Only the literals that survive being one G-code argument are passed: a
 * number, a constant, or a quoted word — a value with a space in it would be
 * split into two arguments before Klipper ever parsed it.
 */
function macroLiteral(value: string): string | null {
  if (number(value)) return value
  if (/^(?:True|False|None)$/.test(value)) return value
  if (/^'[^'\s]*'$/.test(value) || /^"[^"\s]*"$/.test(value)) return value
  return null
}

interface RuntimeOption {
  parameter: string
  parse: Parse
}

const velocityLimits: Readonly<Record<string, RuntimeOption>> = {
  max_velocity: { parameter: 'VELOCITY', parse: number },
  max_accel: { parameter: 'ACCEL', parse: number },
  square_corner_velocity: { parameter: 'SQUARE_CORNER_VELOCITY', parse: number },
  minimum_cruise_ratio: { parameter: 'MINIMUM_CRUISE_RATIO', parse: number },
}

const pressureAdvance: Readonly<Record<string, RuntimeOption>> = {
  pressure_advance: { parameter: 'ADVANCE', parse: number },
  pressure_advance_smooth_time: { parameter: 'SMOOTH_TIME', parse: number },
}

const inputShaper: Readonly<Record<string, RuntimeOption>> = {
  shaper_freq_x: { parameter: 'SHAPER_FREQ_X', parse: number },
  shaper_freq_y: { parameter: 'SHAPER_FREQ_Y', parse: number },
  shaper_type_x: { parameter: 'SHAPER_TYPE_X', parse: word },
  shaper_type_y: { parameter: 'SHAPER_TYPE_Y', parse: word },
  damping_ratio_x: { parameter: 'DAMPING_RATIO_X', parse: number },
  damping_ratio_y: { parameter: 'DAMPING_RATIO_Y', parse: number },
}

const retraction: Readonly<Record<string, RuntimeOption>> = {
  retract_length: { parameter: 'RETRACT_LENGTH', parse: number },
  retract_speed: { parameter: 'RETRACT_SPEED', parse: number },
  unretract_extra_length: { parameter: 'UNRETRACT_EXTRA_LENGTH', parse: number },
  unretract_speed: { parameter: 'UNRETRACT_SPEED', parse: number },
}

/**
 * The command that applies `option: value` from `[section]` to the running
 * printer, or null when the option has none or the value is not one the
 * command takes as written.
 */
export function runtimeCommandFor(
  section: string,
  option: string,
  value: string,
): RuntimeCommand | null {
  const name = section.trim().replace(/\s+/g, ' ').toLowerCase()
  const key = option.toLowerCase()
  const raw = value.trim()

  if (name === 'printer') {
    const entry = velocityLimits[key]
    const parsed = entry?.parse(raw)
    return entry && parsed
      ? { script: `SET_VELOCITY_LIMIT ${entry.parameter}=${parsed}`, key: 'limits' }
      : null
  }
  if (/^extruder\d*$/.test(name) || /^extruder_stepper \S+$/.test(name)) {
    const entry = pressureAdvance[key]
    const parsed = entry?.parse(raw)
    const target = name.startsWith('extruder_stepper ') ? name.slice(17) : name
    return entry && parsed
      ? {
          script: `SET_PRESSURE_ADVANCE EXTRUDER=${target} ${entry.parameter}=${parsed}`,
          key: 'pressureAdvance',
        }
      : null
  }
  if (name === 'input_shaper') {
    const entry = inputShaper[key]
    const parsed = entry?.parse(raw)
    return entry && parsed
      ? { script: `SET_INPUT_SHAPER ${entry.parameter}=${parsed}`, key: 'calibration' }
      : null
  }
  /*
   * The macro keeps the case its header spells it in: Klipper registers
   * `SET_GCODE_VARIABLE`'s MACRO values exactly as written, and a lower-cased
   * name matches nothing.
   */
  if (name.startsWith('gcode_macro ') && key.startsWith('variable_') && key.length > 9) {
    const macro = section.trim().split(/\s+/)[1] ?? ''
    const parsed = macroLiteral(raw)
    return parsed && /^\S+$/.test(macro)
      ? {
          script: `SET_GCODE_VARIABLE MACRO=${macro} VARIABLE=${key.slice(9)} VALUE=${parsed}`,
          key: 'macroVariable',
        }
      : null
  }
  if (name === 'firmware_retraction') {
    const entry = retraction[key]
    const parsed = entry?.parse(raw)
    return entry && parsed
      ? { script: `SET_RETRACTION ${entry.parameter}=${parsed}`, key: 'retraction' }
      : null
  }
  return null
}
