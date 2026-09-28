/**
 * Where each Quick config card sits: explicit columns of section keys, each in
 * the order the user put it.
 *
 * Explicit because the alternative was tried and read as random. With cards in
 * one flowed list — CSS columns balancing a single order across the width —
 * moving one card re-flowed every card after it into a different column, so a
 * card dropped under another landed somewhere else and half the page moved
 * with it. Here a move changes the column it leaves and the column it enters,
 * and nothing else.
 *
 * Kept free of Vue: the view measures how many columns fit and passes the
 * count in.
 */

export type QuickConfigColumns = string[][]

export interface QuickConfigSlot {
  column: number
  index: number
}

/** A stored arrangement, or null for "never arranged". Keys are lower-cased and appear once. */
export function normalizeQuickConfigColumns(value: unknown): QuickConfigColumns | null {
  if (!Array.isArray(value)) return null
  const seen = new Set<string>()
  return value.map((column) => {
    if (!Array.isArray(column)) return []
    const keys: string[] = []
    for (const entry of column) {
      if (typeof entry !== 'string') continue
      const key = entry.trim().toLowerCase()
      if (key === '' || seen.has(key)) continue
      seen.add(key)
      keys.push(key)
    }
    return keys
  })
}

/**
 * The stored arrangement laid out in `count` columns.
 *
 * A stored column past the last one that fits stacks onto the last, in order,
 * so a narrow window reads the arrangement column by column rather than
 * interleaving it. A card the arrangement does not name yet — newly pinned, or
 * everything before the first move — goes to the end of the column holding the
 * fewest cards, which for a fresh page is the round-robin spread across the
 * width.
 */
export function arrangeQuickConfigColumns(
  keys: readonly string[],
  stored: QuickConfigColumns | null,
  count: number,
): QuickConfigColumns {
  const width = Math.max(1, Math.floor(count))
  const present = new Set(keys)
  const placed = new Set<string>()
  const columns: QuickConfigColumns = Array.from({ length: width }, () => [])

  for (const [index, column] of (stored ?? []).entries()) {
    const target = columns[Math.min(index, width - 1)] as string[]
    for (const key of column) {
      if (!present.has(key) || placed.has(key)) continue
      target.push(key)
      placed.add(key)
    }
  }

  for (const key of keys) {
    if (placed.has(key)) continue
    let shortest = 0
    for (const [index, column] of columns.entries()) {
      if (column.length < (columns[shortest] as string[]).length) shortest = index
    }
    ;(columns[shortest] as string[]).push(key)
    placed.add(key)
  }

  return columns
}

export function slotOf(columns: QuickConfigColumns, key: string): QuickConfigSlot | null {
  for (const [column, keys] of columns.entries()) {
    const index = keys.indexOf(key)
    if (index >= 0) return { column, index }
  }
  return null
}

/**
 * Takes one card out of wherever it is and puts it at `target`, the index
 * counted in the target column once the card has left it — the same count
 * `resolveDropTarget` reports, so the drag preview, the drop, and the move
 * buttons all land a card in the same place.
 */
export function moveQuickConfigCard(
  columns: QuickConfigColumns,
  key: string,
  target: QuickConfigSlot,
): QuickConfigColumns {
  const next = columns.map((column) => column.filter((candidate) => candidate !== key))
  if (next.length === 0) return next
  const column = next[Math.min(next.length - 1, Math.max(0, Math.round(target.column)))]
  if (!column) return next
  column.splice(Math.min(column.length, Math.max(0, Math.round(target.index))), 0, key)
  return next
}
