import type { MeshArea } from '@/features/bedMesh/scene'

/**
 * Reads a saved (not necessarily loaded) `bed_mesh` profile's own probed
 * points straight out of `configfile.settings`, so comparing two meshes never
 * has to load either one onto the printer first.
 *
 * The shape comes from `klippy/extras/bed_mesh.py`'s `ProfileManager`, which
 * keeps a `[bed_mesh <name>]` config section holding `points` (the probed
 * matrix, one row per probed line) alongside `min_x`/`max_x`/`min_y`/`max_y`.
 * See `parsePointsMatrix` for the shape `points` actually arrives in. Those
 * bounds describe the same probed
 * area `bedMesh.ts`'s `meshMin`/`meshMax` report for the *active* profile, so
 * a saved profile's own matrix and area are exactly the pair
 * `MeshGlLayer` already expects — no second notion of "what a mesh is"
 * needed to draw one that was never loaded.
 *
 * Nothing here is dispatched to the printer. `configfile.settings` is data
 * `usePrinterConfigStore` already holds for every reason a config value gets
 * read, so a comparison costs no command and changes nothing about which
 * profile is actually active.
 */
export interface SavedMeshProfile {
  matrix: number[][]
  area: MeshArea
}

/**
 * `bed_mesh.py`'s `ProfileManager` loads the `points` config value through
 * `config.getlists(..., parser=float)`, and Klipper's config access tracking
 * — what `configfile.settings` actually echoes back — records that parsed
 * result, not the raw config text. So a real printer reports `points` as a
 * nested array of numbers already, one row per probed line, never the
 * comma-and-newline string the on-disk config file holds. The string branch
 * below is kept only as a defensive fallback for a Klipper build that
 * reports the raw text instead; it was, until this parser, the only shape
 * this code understood, which is why comparing against a saved profile drew
 * nothing on any real printer.
 */
function parsePointsMatrix(raw: unknown): number[][] {
  if (Array.isArray(raw)) {
    return raw
      .filter((row): row is unknown[] => Array.isArray(row))
      .map((row) => row.filter((value): value is number => Number.isFinite(value)))
      .filter((row) => row.length > 0)
  }
  if (typeof raw !== 'string') return []
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) =>
      line
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value)),
    )
    .filter((row) => row.length > 0)
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * `section` is whatever `printerConfig.section('bed_mesh ' + name)` returns —
 * `null` for a profile name that does not exist, which reads the same as a
 * profile whose section failed to parse rather than as a distinct error.
 */
export function readSavedMeshProfile(
  section: Record<string, unknown> | null,
): SavedMeshProfile | null {
  if (!section) return null
  const matrix = parsePointsMatrix(section.points)
  if (matrix.length === 0) return null
  const minX = finiteNumber(section.min_x)
  const maxX = finiteNumber(section.max_x)
  const minY = finiteNumber(section.min_y)
  const maxY = finiteNumber(section.max_y)
  if (minX === null || maxX === null || minY === null || maxY === null) return null
  if (maxX <= minX || maxY <= minY) return null
  return { matrix, area: { minX, minY, maxX, maxY } }
}
