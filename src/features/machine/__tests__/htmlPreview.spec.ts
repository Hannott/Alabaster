import { describe, expect, it } from 'vitest'

import { withBaseHref } from '@/features/machine/htmlPreview'

describe('withBaseHref', () => {
  it('inserts a base tag right after the opening head tag', () => {
    const html = '<html><head><title>Report</title></head><body>hi</body></html>'
    expect(withBaseHref(html, 'https://printer.local/server/files/config/reports/')).toBe(
      '<html><head><base href="https://printer.local/server/files/config/reports/">' +
        '<title>Report</title></head><body>hi</body></html>',
    )
  })

  it('falls back to right after the opening html tag when there is no head', () => {
    const html = '<html><body>hi</body></html>'
    expect(withBaseHref(html, 'https://printer.local/x/')).toBe(
      '<html><base href="https://printer.local/x/"><body>hi</body></html>',
    )
  })

  it('prepends the tag when the document has neither an html nor a head tag', () => {
    expect(withBaseHref('<p>hi</p>', 'https://printer.local/x/')).toBe(
      '<base href="https://printer.local/x/"><p>hi</p>',
    )
  })

  it('escapes ampersands and quotes in the base URL', () => {
    const html = '<head></head>'
    expect(withBaseHref(html, 'https://printer.local/a"b&c/')).toBe(
      '<head><base href="https://printer.local/a&quot;b&amp;c/"></head>',
    )
  })
})
