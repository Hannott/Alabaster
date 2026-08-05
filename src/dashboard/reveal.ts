/**
 * Finds a dashboard card's own DOM node by the `data-instance-id` attribute
 * every `DashboardModuleCard` carries. One query, shared rather than
 * duplicated, because both callers mean the same thing by it — "the element
 * this instance id renders as" — not two things that merely look alike.
 */
export function findDashboardCardElement(instanceId: string): HTMLElement | null {
  const card = document.querySelector(`[data-instance-id="${CSS.escape(instanceId)}"]`)
  return card instanceof HTMLElement ? card : null
}

// Optional-called, so an environment without matchMedia still animates
// rather than silently losing the motion — as `cardMove.ts` already does.
function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/**
 * Scrolls a card into view by instance id, for a control outside the card's
 * own boundaries that needs to point the user at a specific one — Print's
 * header warning revealing the Maintenance card that raised it, so far the
 * only instance. The caller is responsible for expanding the card first if it
 * is collapsed; a collapsed card unmounts its module, so scrolling to one
 * would land on a card with nothing to show yet.
 */
export function revealDashboardCard(instanceId: string): void {
  findDashboardCardElement(instanceId)?.scrollIntoView({
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    block: 'center',
  })
}
