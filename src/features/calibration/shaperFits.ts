/**
 * Every shaper `SHAPER_CALIBRATE` fitted, not only the one it recommended.
 *
 * `shaper_calibrate.py` fits each shaper type in turn and prints one line per
 * fit and one suggested acceleration per fit, then `resonance_tester.py`
 * names the recommendation for the axis. The recommendation alone is what the
 * result keeps; the fits are the comparison a reader weighs it against — a
 * shaper with a little more vibration and a much higher acceleration is often
 * the better trade for their printer. Read from the lines Klipper printed, and
 * kept free of Vue so they can be tested against those lines.
 */

export interface ShaperFit {
  name: string
  frequency: number
  /** Remaining vibration, in percent. */
  vibrations: number
  smoothing: number
  maxAccel: number | null
}

export interface AxisFits {
  axis: 'x' | 'y'
  fits: ShaperFit[]
  recommended: string
}

const fittedPattern =
  /Fitted shaper '(\w+)' frequency = ([\d.]+) Hz \(vibrations = ([\d.]+)%, smoothing ~= ([\d.]+)\)/
const maxAccelPattern = /smoothing with '(\w+)', suggested max_accel <= ([\d.]+)/
const recommendedPattern = /Recommended shaper_type_([xy]) = (\w+), shaper_freq_[xy] = ([\d.]+) Hz/

/**
 * The fits the lines report, one group per axis, the newest group for an
 * axis winning. A group is closed by its axis's recommendation, so fits with
 * no recommendation after them — a run still going, or one that failed — are
 * left out rather than attributed to the wrong axis.
 */
export function shaperFits(lines: readonly string[]): AxisFits[] {
  const byAxis = new Map<'x' | 'y', AxisFits>()
  let pending: ShaperFit[] = []
  for (const line of lines.flatMap((entry) => entry.split('\n'))) {
    const fitted = fittedPattern.exec(line)
    if (fitted) {
      pending = pending.filter((fit) => fit.name !== fitted[1]!.toLowerCase())
      pending.push({
        name: fitted[1]!.toLowerCase(),
        frequency: Number(fitted[2]),
        vibrations: Number(fitted[3]),
        smoothing: Number(fitted[4]),
        maxAccel: null,
      })
      continue
    }
    const accel = maxAccelPattern.exec(line)
    if (accel) {
      const fit = pending.find((candidate) => candidate.name === accel[1]!.toLowerCase())
      if (fit) fit.maxAccel = Number(accel[2])
      continue
    }
    const recommended = recommendedPattern.exec(line)
    if (recommended) {
      const axis = recommended[1]!.toLowerCase() as 'x' | 'y'
      if (pending.length > 0) {
        byAxis.set(axis, { axis, fits: pending, recommended: recommended[2]!.toLowerCase() })
      }
      pending = []
    }
  }
  return (['x', 'y'] as const).flatMap((axis) => {
    const fits = byAxis.get(axis)
    return fits ? [fits] : []
  })
}
