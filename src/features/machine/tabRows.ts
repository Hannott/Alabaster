/**
 * Splits tabs of the given widths into rows no wider than `available`, in
 * order, the way a wrapping row would. Each row holds at least one tab, so a
 * tab wider than the well still gets a row of its own rather than vanishing.
 */
export function packTabRows(widths: readonly number[], available: number, gap: number): number[][] {
  const rows: number[][] = []
  let row: number[] = []
  let used = 0
  widths.forEach((width, index) => {
    const needed = row.length === 0 ? width : used + gap + width
    if (row.length > 0 && needed > available) {
      rows.push(row)
      row = [index]
      used = width
      return
    }
    row.push(index)
    used = needed
  })
  if (row.length > 0) rows.push(row)
  return rows
}

/**
 * The tabs the collapsed well shows in its one row, and how many it folds
 * away. Room is kept for the count of folded tabs, and the tab being shown is
 * never folded: if it would be, it takes the row's last slot and the tab it
 * displaces is folded instead.
 */
export function collapsedTabRow(
  rows: readonly (readonly number[])[],
  widths: readonly number[],
  activeIndex: number,
  available: number,
  gap: number,
  countWidth: number,
): { visible: number[]; folded: number } {
  const total = widths.length
  if (rows.length <= 1) return { visible: [...(rows[0] ?? [])], folded: 0 }
  const visible = [...rows[0]!]
  const wantsActive = activeIndex >= 0 && !visible.includes(activeIndex)
  const width = (indices: readonly number[]) =>
    indices.reduce((sum, index) => sum + widths[index]!, 0) + gap * indices.length + countWidth
  const withActive = () => (wantsActive ? [...visible, activeIndex] : visible)
  while (visible.length > 0 && width(withActive()) > available) visible.pop()
  const shown = withActive()
  return { visible: shown, folded: total - shown.length }
}
