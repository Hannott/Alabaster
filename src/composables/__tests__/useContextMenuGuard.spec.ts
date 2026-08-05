import { describe, expect, it } from 'vitest'

import { suppressesContextMenu } from '@/composables/useContextMenuGuard'

function render(markup: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = markup
  document.body.append(host)
  return host
}

describe('context menu guard', () => {
  it('suppresses the native menu on chrome that has nothing to offer', () => {
    const host = render(`
      <button type="button" class="button"><span>Home all axes</span></button>
      <label class="check-row"><input type="checkbox" /><span>Wireframe</span></label>
      <li role="option">Perspective</li>
    `)

    for (const selector of ['span', 'input', '[role="option"]']) {
      expect(suppressesContextMenu(host.querySelector(selector)), selector).toBe(true)
    }
  })

  it('leaves the menu alone where it has real entries', () => {
    // Paste in a field, Copy inside a transcript, Open in new tab on a link —
    // the three reasons the guard is a predicate rather than a blanket prevent.
    const host = render(`
      <textarea></textarea>
      <ol class="gcode-console selectable"><li><span>ok</span></li></ol>
      <a href="#/machine"><span>Machine</span></a>
    `)

    for (const selector of ['textarea', '.gcode-console span', 'a span']) {
      expect(suppressesContextMenu(host.querySelector(selector)), selector).toBe(false)
    }
  })
})
