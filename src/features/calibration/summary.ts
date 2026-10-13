import type { CalibrationProcedure, ProcedureResultRow } from '@/features/calibration/procedures'

/** How many of a run's values a one-line summary has room to say. */
export const headlineLimit = 3

/**
 * The few values a run is known by, for a line with room for a handful: the
 * procedure list's value line and an earlier run's row in the workspace.
 *
 * Both used to print every row in the order the result held them, which for a
 * run whose values came from `SAVE_CONFIG`'s pending items meant the raw
 * section prefix on each one — a mesh read `bed_mesh default · version 1 ·
 * bed_mesh default · x_count 12` and was cut off before saying anything. So:
 * the rows the procedure names first (`listRows`), else the rows the run
 * printed, in its order, else the pending items with the section said once
 * rather than per value, and a saved mesh profile as its grid.
 */
export function headlineRows(
  procedure: Pick<CalibrationProcedure, 'listRows'>,
  rows: readonly ProcedureResultRow[],
  limit: number = headlineLimit,
): ProcedureResultRow[] {
  const found = rows.filter((row) => row.after !== '')
  if (procedure.listRows) {
    const picked = procedure.listRows.flatMap((name) =>
      found.filter((row) => 'key' in row.label && row.label.key === name),
    )
    if (picked.length > 0) return picked.slice(0, limit)
  }
  const printed = found.filter((row) => pendingParts(row) === null)
  if (printed.length > 0) return printed.slice(0, limit)
  return pendingHeadline(found).slice(0, limit)
}

/** Splits a pending-item row's `section · option` label back into its parts. */
function pendingParts(row: ProcedureResultRow): { section: string; option: string } | null {
  if (!('literal' in row.label)) return null
  const separator = row.label.literal.lastIndexOf(' · ')
  if (separator < 0) return null
  return {
    section: row.label.literal.slice(0, separator),
    option: row.label.literal.slice(separator + 3),
  }
}

function pendingHeadline(rows: readonly ProcedureResultRow[]): ProcedureResultRow[] {
  const parts = rows.map((row) => ({ row, parts: pendingParts(row) }))
  if (parts.some((entry) => entry.parts === null)) return [...rows]

  /*
   * A saved mesh profile stages its whole serialisation — version, counts,
   * bounds and every point — none of which reads as a result except its grid.
   */
  const profiles = new Map<string, Record<string, string>>()
  for (const { row, parts: split } of parts) {
    if (!split!.section.startsWith('bed_mesh ')) continue
    const profile = split!.section.slice('bed_mesh '.length)
    profiles.set(profile, { ...profiles.get(profile), [split!.option]: row.after })
  }
  const meshes: ProcedureResultRow[] = [...profiles].map(([profile, options]) => ({
    label: { literal: profile },
    after: options.x_count && options.y_count ? `${options.x_count} × ${options.y_count}` : '',
  }))

  const rest = parts.filter((entry) => !entry.parts!.section.startsWith('bed_mesh '))
  const sections = new Set(rest.map((entry) => entry.parts!.section))
  const others =
    sections.size === 1
      ? rest.map(({ row, parts: split }) => ({ ...row, label: { literal: split!.option } }))
      : rest.map(({ row }) => row)

  return [...meshes.filter((mesh) => mesh.after !== ''), ...others]
}
