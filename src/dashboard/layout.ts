export const dashboardModuleIds = [
  'print',
  'camera',
  'temperatures',
  'movement',
  'controls',
  'machine',
  'macros',
  'extruder',
  'bedMesh',
  'jobQueue',
  'console',
  'activity',
  'spool',
  'sensors',
  'maintenance',
] as const

export type DashboardModuleId = (typeof dashboardModuleIds)[number]
export type DashboardViewport = 'desktop' | 'tablet' | 'mobile'

/**
 * A module instance owns the content configuration of one card and is shared by
 * every viewport profile. Placement — column, order, visibility, and collapsed
 * state — belongs to a single viewport profile instead.
 */
export interface DashboardModuleInstance {
  instanceId: string
  moduleId: DashboardModuleId
  title: string | null
  config: Record<string, unknown>
}

export interface DashboardPlacement {
  instanceId: string
  column: number
  visible: boolean
  collapsed: boolean
}

export type DashboardPlacements = Record<DashboardViewport, DashboardPlacement[]>

/**
 * Column width is a profile-wide choice, not a per-module one: every module
 * fills the full width of whichever column it sits in. `target` names the
 * column that is wider or narrower than its siblings and is ignored when
 * `shape` is 'equal'.
 */
export type DashboardColumnShape = 'equal' | 'wide' | 'narrow'

export interface DashboardColumnWidths {
  shape: DashboardColumnShape
  target: number
}

export type DashboardColumnWidthsByViewport = Record<DashboardViewport, DashboardColumnWidths>

export interface DashboardProfile {
  instances: DashboardModuleInstance[]
  placements: DashboardPlacements
  columnWidths: DashboardColumnWidthsByViewport
}

export const dashboardViewports: readonly DashboardViewport[] = ['desktop', 'tablet', 'mobile']

const columnCounts: Record<DashboardViewport, number> = {
  desktop: 3,
  tablet: 2,
  mobile: 1,
}

export const wideColumnRatio = 1.6
export const narrowColumnRatio = 0.55

export function columnCountFor(viewport: DashboardViewport): number {
  return columnCounts[viewport]
}

/**
 * Modules keep the column order they were added in, spread evenly across the
 * viewport's columns, so a fresh profile never piles everything into column 0.
 */
export function defaultColumnForIndex(index: number, viewport: DashboardViewport): number {
  return index % columnCountFor(viewport)
}

export function defaultColumnWidths(): DashboardColumnWidths {
  return { shape: 'equal', target: 0 }
}

export function isDashboardModuleId(value: unknown): value is DashboardModuleId {
  return typeof value === 'string' && dashboardModuleIds.includes(value as DashboardModuleId)
}

export function isDashboardViewport(value: unknown): value is DashboardViewport {
  return value === 'desktop' || value === 'tablet' || value === 'mobile'
}

export function clampColumn(value: unknown, viewport: DashboardViewport): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const count = columnCountFor(viewport)
  return Math.min(count - 1, Math.max(0, Math.round(value)))
}

export function clampColumnTarget(value: unknown, viewport: DashboardViewport): number {
  const count = columnCountFor(viewport)
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(count - 1, Math.max(0, Math.round(value)))
}

/**
 * The fr value for each column track, in column order. A shape only changes
 * geometry when the viewport has more than one column to redistribute.
 */
export function columnWidthFractions(
  widths: DashboardColumnWidths,
  viewport: DashboardViewport,
): number[] {
  const count = columnCountFor(viewport)
  const fractions = Array<number>(count).fill(1)
  if (widths.shape === 'equal' || count < 2) return fractions

  const target = Math.min(count - 1, Math.max(0, widths.target))
  fractions[target] = widths.shape === 'wide' ? wideColumnRatio : narrowColumnRatio
  return fractions
}

/**
 * The index a card would land at among a column's visible cards, given where
 * the pointer is. Counted with the dragged card still in the list, which is
 * what keeps a drag stable — see `useDashboardCardDrag`.
 */
export interface DashboardDropTarget {
  column: number
  index: number
}

/**
 * Moves one placement to `index` among the visible cards of `column`.
 *
 * This is the single primitive every reorder goes through — the drag preview,
 * the drop that commits it, and the card's own move buttons. They have to agree
 * about where a card lands, and the only way to guarantee that is for the
 * preview to compute the result rather than approximate it.
 *
 * The list is flat and interleaved: a hidden card keeps its slot between two
 * visible ones, so a visible index is not a list index. Translating between
 * them is the whole job, and it is what keeps a hidden card beside the
 * neighbours it was stored next to instead of drifting to the end of the list
 * every time something visible moves past it.
 */
export function movePlacement(
  placements: readonly DashboardPlacement[],
  viewport: DashboardViewport,
  instanceId: string,
  target: DashboardDropTarget,
): DashboardPlacement[] {
  const rest = [...placements]
  const sourceIndex = rest.findIndex((placement) => placement.instanceId === instanceId)
  const source = rest[sourceIndex]
  if (!source) return rest
  rest.splice(sourceIndex, 1)

  const column = clampColumn(target.column, viewport) ?? source.column
  // List indices, not visible indices: these are what we splice against.
  const siblings = rest.reduce<number[]>((found, placement, index) => {
    if (placement.column === column && placement.visible) found.push(index)
    return found
  }, [])
  const index = Math.min(siblings.length, Math.max(0, Math.round(target.index)))

  let insertAt: number
  if (index < siblings.length) {
    insertAt = siblings[index] as number
  } else if (siblings.length > 0) {
    // Past the last visible sibling — after it, so any hidden cards that follow
    // it stay where they were rather than being jumped over.
    insertAt = (siblings[siblings.length - 1] as number) + 1
  } else {
    /*
     * No visible card to anchor to. A column can still hold hidden ones, and
     * landing after them keeps the column's own cards together in the list;
     * only a column with nothing at all sends the card to the end.
     */
    const lastInColumn = rest.reduce(
      (found, placement, position) => (placement.column === column ? position : found),
      -1,
    )
    insertAt = lastInColumn < 0 ? rest.length : lastInColumn + 1
  }

  rest.splice(insertAt, 0, { ...source, column })
  return rest
}

/**
 * Where a card currently sits among the visible cards of its own column, which
 * is the index a move into another column tries to keep.
 */
export function visibleIndexOf(
  placements: readonly DashboardPlacement[],
  instanceId: string,
): number {
  const placement = placements.find((candidate) => candidate.instanceId === instanceId)
  if (!placement) return 0
  const siblings = placements.filter(
    (candidate) => candidate.column === placement.column && candidate.visible,
  )
  return Math.max(0, siblings.indexOf(placement))
}

/**
 * Instance identifiers stay derived from the module id so they are stable and
 * reproducible: the first instance is the module id and later ones are suffixed.
 */
export function nextInstanceId(moduleId: DashboardModuleId, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(moduleId)) return moduleId
  let suffix = 2
  while (used.has(`${moduleId}-${suffix}`)) suffix += 1
  return `${moduleId}-${suffix}`
}

export function moduleIdOfInstance(instanceId: string): DashboardModuleId | null {
  const base = instanceId.replace(/-\d+$/, '')
  return isDashboardModuleId(base) ? base : null
}

/**
 * Module ids a stored profile may still carry under an old name.
 *
 * A module id is a storage key: it names the `moduleId` of every saved
 * instance, it is the stem `moduleIdOfInstance` parses an `instanceId` back
 * from, and an id that stops being recognized takes the card's placement and
 * its per-instance configuration with it — silently, because
 * `normalizeInstances` drops what it cannot resolve and the tray then re-adds a
 * pristine one. So renaming an id is allowed, and renaming it without an entry
 * here is not.
 *
 * `filament` became `extruder` when the card was renamed for what it actually
 * commands. The old name was deliberately freed rather than kept as an alias:
 * a Spoolman-backed filament module is planned and will want it, and two
 * meanings for one storage key is the failure this map exists to prevent — so
 * an entry is a one-way rename, never a synonym.
 */
const renamedModuleIds: Readonly<Record<string, DashboardModuleId>> = {
  filament: 'extruder',
}

/**
 * The current id for a stored one, or null when it is not an id at all.
 * Suffixes are preserved, so `filament-2` renames to `extruder-2` and keeps its
 * position among its siblings.
 */
export function renameStoredInstanceId(instanceId: string): string {
  const [, base, suffix] = /^(.*?)(-\d+)?$/.exec(instanceId) ?? []
  const renamed = base === undefined ? undefined : renamedModuleIds[base]
  return renamed === undefined ? instanceId : `${renamed}${suffix ?? ''}`
}

/** The current id for a stored `moduleId`, or the value unchanged. */
export function renameStoredModuleId(moduleId: unknown): unknown {
  return typeof moduleId === 'string' ? (renamedModuleIds[moduleId] ?? moduleId) : moduleId
}
