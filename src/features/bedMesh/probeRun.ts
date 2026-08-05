/**
 * Reading a mesh calibration as it happens, from the printer's own console
 * output.
 *
 * The console is the only per-point signal there is, which is worth stating
 * because a structured one looks available and is not: `printer.probe` reports
 * `last_probe_position` and `last_z_result`, but Klipper assigns those only in
 * `cmd_PROBE` — the manual `PROBE` command — while `BED_MESH_CALIBRATE` goes
 * through the shared probe path that never touches them. Subscribing to them
 * during a mesh run draws one stale point and never moves. `bed_mesh`'s own
 * `probed_matrix` is rebuilt only when the mesh finalises, so it cannot be
 * watched either.
 *
 * What the console gives is better than it sounds: each line carries the probed
 * coordinates *and* the height, already in bed space with the probe's offset
 * applied, so a point can be plotted without pairing it against a toolhead
 * position that has since moved on.
 */

/** One probed point, in bed millimetres. */
export interface ProbedPoint {
  x: number
  y: number
  z: number
}

/*
 * Two wordings, because two firmwares are in the field and the older Klipper
 * wording is the one Kalico still uses:
 *
 *   Klipper   probe: at 35.000,35.000 bed will contact at z=2.123750
 *   Kalico    probe at 35.000,35.000 is z=2.123750
 *
 * Both are matched by one pattern rather than two, so a third wording that keeps
 * the same three numbers in the same order still parses. The alternative — a
 * list of exact sentences — fails closed on every firmware nobody tested.
 */
const PROBE_RESULT =
  /^\s*(?:\/\/\s*)?probe:?\s+at\s+(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\b.*?\bz=(-?\d+(?:\.\d+)?)/i

/**
 * The probed point this console line reports, or null if it reports something
 * else. Null is the common case: most lines are not probe results.
 */
export function parseProbedPoint(line: string): ProbedPoint | null {
  const match = PROBE_RESULT.exec(line)
  if (!match) return null

  const [, x, y, z] = match
  const point = { x: Number(x), y: Number(y), z: Number(z) }
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
    return null
  }
  return point
}

/** Whether this line is the command that starts a mesh calibration. */
export function isMeshCalibrateCommand(line: string): boolean {
  return /^\s*(?:>\s*)?BED_MESH_CALIBRATE\b/i.test(line)
}

/**
 * Config sections belonging to a probe that sweeps rather than touching each
 * point. These emit no per-point line, so a live view has nothing to follow and
 * says so instead of staying empty and looking broken.
 */
const SCANNING_PROBE_SECTIONS = [
  'beacon',
  'cartographer',
  'scanner',
  'probe_eddy_current',
  'eddy_ng',
  'idm',
] as const

export function isScanningProbe(hasSection: (section: string) => boolean): boolean {
  return SCANNING_PROBE_SECTIONS.some((section) => hasSection(section))
}

/**
 * Where the probe tip sits in bed coordinates, given the toolhead position and
 * the probe's configured offset. Only needed to animate the probe between
 * points — a plotted point carries its own coordinates.
 */
export function probeBedPosition(
  toolhead: readonly [number | null, number | null, number | null],
  offset: { x: number; y: number },
): { x: number; y: number } | null {
  const [x, y] = toolhead
  if (x === null || y === null) return null
  return { x: x + offset.x, y: y + offset.y }
}

/** An axis-aligned rectangle of the bed, in millimetres — `scene.ts`'s own shape. */
interface Area {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/**
 * Groups already-probed points into the rows Klipper actually walks, keeping
 * only the ones that have finished.
 *
 * Klipper's own path generator changes direction on "increasing Y" — a raster
 * pattern that alternates left-to-right and right-to-left row to row to save
 * travel time — so a row is a maximal run of consecutive points sharing one Y,
 * however Klipper chose to order the points inside it. The row still being
 * probed is deliberately excluded: it has not finished, and drawing it would
 * put a false edge where the printer has simply not arrived yet.
 *
 * Grouped by exact equality on Y, which is safe here specifically because both
 * values being compared were parsed from the same fixed three-decimal `%.3f`
 * console format — there is no accumulated arithmetic between them for
 * floating-point error to hide in.
 */
export function completedRows(points: readonly ProbedPoint[]): ProbedPoint[][] {
  const rows: ProbedPoint[][] = []
  let current: ProbedPoint[] = []
  for (const point of points) {
    if (current.length === 0 || current[0]!.y === point.y) {
      current.push(point)
    } else {
      rows.push(current)
      current = [point]
    }
  }
  return rows
}

/**
 * A rectangular grid of absolute heights, built from whatever rows have
 * finished — or null when there is not yet enough to interpolate between.
 *
 * Three things make it null: fewer than two finished rows, since a surface
 * needs two edges to span; a row one point wide, which has no width to
 * interpolate across; or rows of unequal length, which means a faulty region
 * or an adaptive mesh has broken the uniform grid this shares with the
 * finished mesh's own renderer. The last case fails closed rather than
 * building a grid from whichever points happen to line up — a surface drawn
 * from mismatched rows would silently misplace some of them.
 *
 * Each row is sorted by X before it becomes a grid row, for the same
 * direction-alternating reason `completedRows` exists: a row Klipper walked
 * right-to-left still has to read left-to-right into the matrix, or the
 * surface would fold across itself every other row.
 */
export function liveMeshGrid(
  points: readonly ProbedPoint[],
): { matrix: number[][]; area: Area } | null {
  const rows = completedRows(points)
  if (rows.length < 2) return null
  const width = rows[0]!.length
  if (width < 2 || rows.some((row) => row.length !== width)) return null

  const sortedRows = rows
    .map((row) => [...row].sort((a, b) => a.x - b.x))
    .sort((a, b) => a[0]!.y - b[0]!.y)

  const matrix = sortedRows.map((row) => row.map((point) => point.z))
  const xs = sortedRows.flatMap((row) => row.map((point) => point.x))
  const ys = sortedRows.map((row) => row[0]!.y)
  return {
    matrix,
    area: {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    },
  }
}
