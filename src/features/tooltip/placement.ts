export const tooltipGapAbove = 14
export const tooltipGapBelow = 22
export const tooltipViewportMargin = 8

export interface TooltipPlacement {
  side: 'above' | 'below'
  /** Where the reveal starts: the pointer's x, and the edge of the box nearest the pointer. */
  anchorX: number
  anchorY: number
  /** How far the finished box slides sideways to stay inside the viewport. */
  shift: number
}

/**
 * Above the pointer unless the box would leave the top of the viewport, then
 * below it, where it grows downward. The sideways shift is applied only by the
 * last stage of the reveal, so the dot and line still start at the pointer.
 */
export function placeTooltip(
  pointer: { x: number; y: number },
  box: { width: number; height: number },
  viewportWidth: number,
): TooltipPlacement {
  const side = pointer.y - tooltipGapAbove - box.height < tooltipViewportMargin ? 'below' : 'above'
  const left = pointer.x - box.width / 2
  const right = pointer.x + box.width / 2
  const shift =
    Math.max(0, tooltipViewportMargin - left) -
    Math.max(0, right - (viewportWidth - tooltipViewportMargin))
  return {
    side,
    anchorX: pointer.x,
    anchorY: side === 'below' ? pointer.y + tooltipGapBelow : pointer.y - tooltipGapAbove,
    shift,
  }
}
