/**
 * The two scales a height map is read against, kept apart on purpose.
 *
 * The **color** scale decides what the gradient covers. The **height** scale
 * decides how tall the surface stands. Sharing them — which this module did
 * once — means recoloring the map reshapes the bed, and invites the user to
 * read a change in their printer out of a change to a legend.
 */

/** A range of deviations, in millimetres. */
export interface MeshScale {
  low: number
  high: number
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * Where a deviation sits on a scale, from -1 at the low end through 0 in the
 * middle to 1 at the high end. Values past either end clamp rather than
 * saturate further, so a fixed scale reports "at least this far" instead of
 * quietly rescaling itself to an outlier.
 */
export function meshScalePosition(deviation: number, scale: MeshScale): number {
  const middle = (scale.high + scale.low) / 2
  const reach = (scale.high - scale.low) / 2
  if (reach <= 0) return 0
  return clamp((deviation - middle) / reach, -1, 1)
}

/**
 * The color range when the gradient is scaled to the mesh.
 *
 * Centered on the mean deviation rather than the plane, with its reach set from
 * the mean absolute deviation rather than the literal lowest/highest point.
 * A single bad probe point sits far from every other value, so a min/max range
 * stretched to cover it compresses the rest of the mesh into a sliver near the
 * middle of the ramp — the one point that least deserves attention is the only
 * thing still visible. Mean absolute deviation moves by at most that point's
 * share of the average, so it barely shifts the scale; the point itself simply
 * clamps at the saturated end instead (`meshScalePosition`), same as any other
 * value past the ends of a fixed scale.
 */
export function meshColorRange(values: readonly number[]): MeshScale {
  if (values.length === 0) return { low: 0, high: 0 }
  const mean = values.reduce((total, value) => total + value, 0) / values.length
  const meanAbsoluteDeviation =
    values.reduce((total, value) => total + Math.abs(value - mean), 0) / values.length
  const reach = meanAbsoluteDeviation * 2
  return { low: mean - reach, high: mean + reach }
}

/**
 * What the height axis may be set to, in millimetres either side of the plane.
 *
 * The floor is the mesh's own reach rounded up a tenth, because an axis shorter
 * than the bed would clip a peak flat — a lie about its shape. Above that the
 * choice is the user's: a taller axis flattens the picture and makes small
 * meshes comparable, a shorter one exaggerates the relief of a good bed.
 */
export function meshHeightLimits(
  lowest: number | null,
  highest: number | null,
): { min: number; max: number } {
  const reach = Math.max(Math.abs(lowest ?? 0), Math.abs(highest ?? 0))
  const min = Math.max(0.1, Math.ceil(reach * 10) / 10)
  return { min, max: Math.max(min, 1) }
}

/**
 * Thins a mesh to at most `limit` points a side by taking every nth row and
 * column, always keeping both edges.
 *
 * `mesh_pps` is the user's to set, and a high value turns a modest probed grid
 * into thousands of quads that have to be re-projected on every frame of a
 * 500 ms animation. Dropping points costs nothing visible — the interpolation
 * that produced them is smooth by construction — while re-projecting all of
 * them on a phone does not stay at 60 frames a second.
 */
export function thinMeshMatrix(
  matrix: readonly (readonly number[])[],
  limit: number,
): readonly (readonly number[])[] {
  const rows = matrix.length
  const columns = matrix[0]?.length ?? 0
  if (rows <= limit && columns <= limit) return matrix
  const pick = (count: number): number[] => {
    if (count <= limit) return Array.from({ length: count }, (_, index) => index)
    const step = (count - 1) / (limit - 1)
    return Array.from({ length: limit }, (_, index) => Math.round(index * step))
  }
  const rowIndices = pick(rows)
  const columnIndices = pick(columns)
  return rowIndices.map((row) => columnIndices.map((column) => matrix[row]?.[column] ?? 0))
}
