/**
 * What `SAVE_CONFIG` is about to write, read as sections rather than as a
 * boolean.
 *
 * Klipper reports two halves of the answer and Alabaster needs both:
 * `configfile.save_config_pending_items` is what the write would put in the
 * file — `{section: {option: value}}`, every value a **string**, because these
 * are the lines that get written — and `configfile.settings` is what is loaded
 * right now, with values already typed. Comparing them is what turns "the
 * printer is holding changes" into "the probe's Z offset goes from 0.3 to
 * 0.285", which is the difference between authorizing a rewrite blind and
 * authorizing one you can read.
 *
 * Kept free of Vue, Pinia, and i18n on purpose. It returns facts — a kind, the
 * options, and how many numbers a value holds — and the dialog decides the
 * words. That keeps every rule here testable against raw Klipper shapes, and it
 * keeps a translated string from becoming part of the comparison.
 */

/**
 * Which renderer a section gets. The kinds exist because these sections are
 * read differently, not because they are formatted differently: a probe offset
 * is one number someone dialed in on purpose, a heater model is a block of
 * coefficients a calibration produced, and a bed mesh is a measurement grid
 * nobody reads value by value.
 */
export type PendingConfigKind = 'probe' | 'heaterModel' | 'bedMesh' | 'generic'

export interface PendingConfigRow {
  option: string
  /** The staged value, as it would be written. `null` when `count` stands in. */
  next: string | null
  /** What is loaded now, or `null` for an option the running config lacks. */
  previous: string | null
  /**
   * How many numbers the staged value holds, when it holds too many to read.
   * A bed mesh stages 168 of them; printing those is how the one line that
   * matters gets buried.
   */
  count?: number
}

export interface PendingConfigSection {
  /** The section as Klipper names it, `probe` or `bed_mesh default`. */
  section: string
  kind: PendingConfigKind
  rows: PendingConfigRow[]
}

/** `bed_mesh default` → `bed_mesh`; `probe` → `probe`. */
function sectionType(section: string): string {
  return section.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
}

/**
 * Probing sections are matched by type rather than by the single name `probe`,
 * because the setting is the same one under several of them — a BLTouch and a
 * dockable probe both write `z_offset`, and a machine that used one of those
 * would otherwise fall through to the generic renderer and stop saying which
 * number moved.
 */
const probeTypes = new Set(['probe', 'bltouch', 'smart_effector', 'dockable_probe'])

function kindFor(section: string): PendingConfigKind {
  const type = sectionType(section)
  if (probeTypes.has(type)) return 'probe'
  if (type === 'bed_mesh') return 'bedMesh'
  // `extruder`, `extruder1`, … and `heater_bed` all stage the same shape of
  // block: whichever of PID or MPC the calibration produced.
  if (type === 'heater_bed' || /^extruder\d*$/.test(type)) return 'heaterModel'
  return 'generic'
}

/**
 * The numbers in a staged value, when it is a list of them.
 *
 * Klipper writes a mesh as newline-separated rows of comma-separated numbers
 * and a fan-transfer curve as one comma-separated row, so both are found by
 * splitting on either separator. A single number is not a list — `0.3` is a
 * value to show, not a count of one.
 */
function numberCount(value: string): number | null {
  const parts = value
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
  if (parts.length < 2) return null
  return parts.every((part) => Number.isFinite(Number(part))) ? parts.length : null
}

/**
 * The loaded value for one option, as text.
 *
 * `settings` is keyed in lower case by Klipper and holds typed values, while
 * the staged side is all strings — so both ends are stringified rather than
 * coerced toward each other. Comparing a parsed `0.3` against a written
 * `"0.300"` would have to decide how many zeros are the same number, and
 * getting that wrong on a Z offset is a decision nobody asked for.
 */
function loadedValue(
  settings: Record<string, unknown>,
  section: string,
  option: string,
): string | null {
  const loaded = settings[section.toLowerCase()]
  if (loaded === null || typeof loaded !== 'object') return null
  const value = (loaded as Record<string, unknown>)[option.toLowerCase()]
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return null
  return String(value)
}

/**
 * Sections in the order they are worth reading, not the order Klipper happened
 * to report them: the probe offset someone just dialed in first, then the
 * heater models a calibration produced, then meshes, then anything Alabaster
 * has no special reading for. Ties break by name so the list never reorders
 * itself between two status pushes.
 */
const kindOrder: Record<PendingConfigKind, number> = {
  probe: 0,
  heaterModel: 1,
  bedMesh: 2,
  generic: 3,
}

/**
 * Every staged section, each with the options it would write.
 *
 * Sections are never collapsed into a count — `dialog-system.md` requires an
 * authorized set to be listed rather than totalled, and the section is the unit
 * being authorized. What a section's *options* do is the renderer's business:
 * a value too long to read reports its size instead, which is the same rule
 * applied one level down rather than an exception to it.
 */
export function readPendingConfig(
  items: Readonly<Record<string, Record<string, string | undefined> | undefined>>,
  settings: Readonly<Record<string, unknown>> = {},
): PendingConfigSection[] {
  const sections: PendingConfigSection[] = []

  for (const [section, options] of Object.entries(items)) {
    if (!options || typeof options !== 'object') continue
    const rows: PendingConfigRow[] = []

    for (const [option, raw] of Object.entries(options)) {
      if (raw === undefined || raw === null) continue
      const next = String(raw).trim()
      const count = numberCount(next)
      rows.push({
        option,
        next: count === null ? next : null,
        /*
         * A counted value carries no previous value, because there is no
         * readable "before" for a matrix. Leaving it in printed the loaded
         * mesh's own 168 numbers into the row and then arrowed to "168 values",
         * which is the exact burial the count exists to prevent — the rule had
         * been applied to one side of the comparison and not the other. The
         * count already says the shape changed.
         */
        previous: count === null ? loadedValue(settings, section, option) : null,
        ...(count === null ? {} : { count }),
      })
    }

    if (rows.length === 0) continue
    sections.push({ section, kind: kindFor(section), rows })
  }

  return sections.sort((left, right) => {
    const byKind = kindOrder[left.kind] - kindOrder[right.kind]
    return byKind === 0 ? left.section.localeCompare(right.section) : byKind
  })
}

/**
 * Whether a row actually changes anything. A calibration restages every option
 * in its block, including the ones it recomputed to the same value, so a
 * section is worth reading for what moved rather than for its whole contents.
 * Used to mark rows, never to hide them: an unchanged line still gets written,
 * and a list that quietly dropped it would misdescribe the write.
 */
export function isChangedRow(row: PendingConfigRow): boolean {
  if (row.previous === null) return true
  if (row.next === null) return true
  return row.previous.trim() !== row.next.trim()
}
