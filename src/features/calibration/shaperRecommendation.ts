/**
 * The input shaper Shake&Tune recommends at the end of an
 * `AXES_SHAPER_CALIBRATION` run, lifted out of the console text it is
 * otherwise only printed as.
 *
 * The formats below are read from klippain-shaketune's own source, not
 * inferred from a transcript. Since v5.0 (`shaper_computation.py`, earlier
 * `shaper_graph_creator.py`) every axis ends with:
 *
 *   Recommended filters:
 *       -> For performance: MZV @ 48.2 Hz (with a damping ratio of 0.052)
 *       -> For low vibrations: EI @ 52.0 Hz (with a damping ratio of 0.052)
 *
 * or a single `-> Best shaper: MZV @ 48.2 Hz` line when both would name the
 * same shaper. v4 printed one `-> Recommended shaper is MZV @ 48.2 Hz (when
 * using …)` line instead. None of them names the axis; the axis comes from the
 * `X axis frequency profile generation...` line printed just before the
 * computation starts, which is reliable because the command waits for each
 * axis's computation to finish before measuring the next. Every line arrives
 * through `gcode.respond_info`, so it carries Klipper's `// ` prefix — which is
 * why no pattern here is anchored to the start of the line.
 *
 * v5 and later pass `logger=None` to Klipper's own `find_best_shaper`, so
 * Klipper's "Fitted shaper" lines never appear beside these and cannot be
 * double-counted.
 */

export type ShaperAxis = 'x' | 'y'

export type ShaperRecommendationKind = 'performance' | 'lowVibrations' | 'best'

export interface ShaperRecommendation {
  axis: ShaperAxis
  kind: ShaperRecommendationKind
  /** Lower-case, as `SET_INPUT_SHAPER` and `[input_shaper]` spell it. */
  shaperType: string
  frequency: number
}

const commandPattern = /^\s*(?:>\s*)?_?AXES_SHAPER_CALIBRATION\b(.*)$/i
const commandAxisPattern = /\bAXIS\s*=\s*([xy])\b/i
const axisPattern = /\b([XY]) axis frequency profile generation/
const recommendationPattern =
  /->\s*(For performance|For low vibrations|Best shaper|Recommended shaper is):?\s*([A-Za-z0-9_]+)\s*@\s*([\d.]+)\s*Hz/i

const kinds: Record<string, ShaperRecommendationKind> = {
  'for performance': 'performance',
  'for low vibrations': 'lowVibrations',
  'best shaper': 'best',
  'recommended shaper is': 'best',
}

/**
 * The recommendations from the most recent run in the transcript, in the
 * order they were printed, one per axis and kind.
 *
 * The run boundary is found fresh from the lines every time rather than kept
 * as an index, for the reason `stores/axesNoise.ts` gives: a transcript that
 * trims its oldest lines would otherwise leave a stored index pointing at the
 * wrong command. An older run's recommendations are never mixed into a newer
 * one's: a run that has not reached its first recommendation yet reports none.
 */
export function latestShaperRecommendations(lines: readonly string[]): ShaperRecommendation[] {
  let start = -1
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (commandPattern.test(lines[index]!)) {
      start = index
      break
    }
  }
  if (start < 0) return []

  const requestedAxis = commandAxisPattern.exec(commandPattern.exec(lines[start]!)?.[1] ?? '')
  let axis: ShaperAxis | null = requestedAxis
    ? (requestedAxis[1]!.toLowerCase() as ShaperAxis)
    : null

  const byKey = new Map<string, ShaperRecommendation>()
  for (const text of lines.slice(start + 1)) {
    for (const line of text.split('\n')) {
      const axisMatch = axisPattern.exec(line)
      if (axisMatch) {
        axis = axisMatch[1]!.toLowerCase() as ShaperAxis
        continue
      }
      const match = recommendationPattern.exec(line)
      if (!match || axis === null) continue
      const kind = kinds[match[1]!.toLowerCase()]
      const frequency = Number(match[3])
      if (kind === undefined || !Number.isFinite(frequency) || frequency <= 0) continue
      const key = `${axis}:${kind}`
      byKey.delete(key)
      byKey.set(key, { axis, kind, shaperType: match[2]!.toLowerCase(), frequency })
    }
  }
  return [...byKey.values()]
}

/**
 * The live, until-restart command for one recommendation. Values are
 * re-validated rather than trusted, because they came from console text: a
 * shaper name is a bare identifier and a frequency a positive number, or
 * nothing is sent at all.
 */
export function setInputShaperCommand(recommendation: ShaperRecommendation): string | null {
  const { axis, shaperType, frequency } = recommendation
  if (!/^[a-z0-9_]+$/.test(shaperType) || !Number.isFinite(frequency) || frequency <= 0) {
    return null
  }
  const suffix = axis.toUpperCase()
  return `SET_INPUT_SHAPER SHAPER_TYPE_${suffix}=${shaperType} SHAPER_FREQ_${suffix}=${frequency}`
}
