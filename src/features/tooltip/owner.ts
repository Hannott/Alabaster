const TITLE_STASH = 'data-tooltip-from-title'

/**
 * The element a tooltip belongs to. The application writes plain `title`
 * attributes everywhere; those are the tooltip text, so no call site has to
 * change. `data-tooltip` is the same thing for an element that has no title of
 * its own, and what a title becomes while its element is claimed.
 *
 * An `iframe`'s title names the frame for assistive technology and is never
 * hover text.
 */
export function tooltipOwner(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  let node: Element | null = target
  while (node) {
    if (node instanceof HTMLElement && node.tagName !== 'IFRAME') {
      if (node.hasAttribute('data-tooltip') && node.getAttribute('data-tooltip')) return node
      if (node.getAttribute('title')) return node
    }
    node = node.parentElement
  }
  return null
}

/**
 * Takes a title out of the element so the browser's own tooltip does not show
 * beside ours, and returns the text. `release` puts it back, so the attribute
 * still names the element to anything reading it while it is not hovered.
 */
export function claimTooltipText(owner: HTMLElement): string {
  const title = owner.getAttribute('title')
  if (title) {
    owner.setAttribute('data-tooltip', title)
    owner.setAttribute(TITLE_STASH, '')
    owner.removeAttribute('title')
  }
  return owner.getAttribute('data-tooltip') ?? ''
}

export function releaseTooltipText(owner: HTMLElement): void {
  if (!owner.hasAttribute(TITLE_STASH)) return
  const text = owner.getAttribute('data-tooltip')
  owner.removeAttribute(TITLE_STASH)
  owner.removeAttribute('data-tooltip')
  if (text && !owner.hasAttribute('title')) owner.setAttribute('title', text)
}
