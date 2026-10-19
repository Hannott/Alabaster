import { describe, expect, it } from 'vitest'

import { claimTooltipText, releaseTooltipText, tooltipOwner } from '@/features/tooltip/owner'

function html(markup: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = markup
  return host
}

describe('tooltip owner', () => {
  it('finds the nearest ancestor with a title', () => {
    const host = html(
      '<div title="Outer"><button title="Inner"><span id="t">x</span></button></div>',
    )
    expect(tooltipOwner(host.querySelector('#t'))?.getAttribute('title')).toBe('Inner')
  })

  it('walks up to a parent when the target has none', () => {
    const host = html('<button title="Home"><svg id="t"></svg></button>')
    expect(tooltipOwner(host.querySelector('#t'))?.tagName).toBe('BUTTON')
  })

  it('ignores empty titles and iframes', () => {
    const host = html('<div title=""><iframe id="t" title="Camera"></iframe></div>')
    expect(tooltipOwner(host.querySelector('#t'))).toBeNull()
  })

  it('accepts data-tooltip on an element with no title', () => {
    const host = html('<button data-tooltip="Pause" id="t"></button>')
    expect(tooltipOwner(host.querySelector('#t'))).not.toBeNull()
  })

  it('takes the title off while claimed and puts it back on release', () => {
    const button = html('<button title="Home all axes"></button>').querySelector('button')!
    expect(claimTooltipText(button)).toBe('Home all axes')
    expect(button.hasAttribute('title')).toBe(false)
    releaseTooltipText(button)
    expect(button.getAttribute('title')).toBe('Home all axes')
    expect(button.hasAttribute('data-tooltip')).toBe(false)
  })

  it('leaves an author-written data-tooltip in place on release', () => {
    const button = html('<button data-tooltip="Pause"></button>').querySelector('button')!
    expect(claimTooltipText(button)).toBe('Pause')
    releaseTooltipText(button)
    expect(button.getAttribute('data-tooltip')).toBe('Pause')
    expect(button.hasAttribute('title')).toBe(false)
  })
})
