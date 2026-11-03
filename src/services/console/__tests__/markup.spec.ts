import { describe, expect, it } from 'vitest'

import {
  consoleLinkBase,
  consoleMarkupText,
  hasConsoleMarkup,
  parseConsoleMarkup,
  resolveConsoleUrl,
} from '@/services/console/markup'

const base = new URL('http://voron.local/')

describe('hasConsoleMarkup', () => {
  it('recognises only the tags the transcript renders', () => {
    expect(hasConsoleMarkup('see <a href="/x">here</a>')).toBe(true)
    expect(hasConsoleMarkup('<img src="/x.png">')).toBe(true)
    expect(hasConsoleMarkup('<b>bold</b>')).toBe(true)
    expect(hasConsoleMarkup('line<br>break')).toBe(true)
  })

  it('leaves a stray angle bracket in ordinary output alone', () => {
    // An HTML parser would swallow the command name out of this error.
    expect(hasConsoleMarkup('Unknown command:"<G1"')).toBe(false)
    expect(hasConsoleMarkup('x<b')).toBe(false)
    expect(hasConsoleMarkup('<div>text</div>')).toBe(false)
    expect(hasConsoleMarkup('plain text')).toBe(false)
  })
})

describe('resolveConsoleUrl', () => {
  it('keeps absolute http and https URLs', () => {
    expect(resolveConsoleUrl('https://example.com/a.png', base, 'image')).toBe(
      'https://example.com/a.png',
    )
    expect(resolveConsoleUrl('http://other.local/x', null, 'link')).toBe('http://other.local/x')
  })

  it('resolves a relative path against the printer that sent it', () => {
    expect(resolveConsoleUrl('/server/files/logs/plot.png', base, 'image')).toBe(
      'http://voron.local/server/files/logs/plot.png',
    )
    expect(resolveConsoleUrl('server/files/logs/plot.png', base, 'link')).toBe(
      'http://voron.local/server/files/logs/plot.png',
    )
  })

  it('drops a relative path when there is no printer to resolve it against', () => {
    expect(resolveConsoleUrl('/server/files/logs/plot.png', null, 'link')).toBeNull()
  })

  it('rejects every scheme that could run code', () => {
    expect(resolveConsoleUrl('javascript:alert(1)', base, 'link')).toBeNull()
    expect(resolveConsoleUrl(' JavaScript:alert(1)', base, 'link')).toBeNull()
    expect(resolveConsoleUrl('vbscript:x', base, 'link')).toBeNull()
    expect(resolveConsoleUrl('data:text/html,<script>', base, 'link')).toBeNull()
    expect(resolveConsoleUrl('data:text/html,<script>', base, 'image')).toBeNull()
    expect(resolveConsoleUrl('', base, 'link')).toBeNull()
  })

  it('admits an inline image, so a plugin need not write a file', () => {
    expect(resolveConsoleUrl('data:image/svg+xml;base64,PHN2Zz4=', base, 'image')).toBe(
      'data:image/svg+xml;base64,PHN2Zz4=',
    )
    expect(resolveConsoleUrl('data:image/png;base64,AAAA', base, 'link')).toBeNull()
  })
})

describe('consoleLinkBase', () => {
  it('turns the websocket endpoint into the HTTP origin files are served from', () => {
    expect(consoleLinkBase('ws://voron.local:7125/websocket')?.href).toBe(
      'http://voron.local:7125/',
    )
    expect(consoleLinkBase('wss://printer.example/websocket')?.href).toBe(
      'https://printer.example/',
    )
  })

  it('is null without a connection or with an endpoint that is not a URL', () => {
    expect(consoleLinkBase(null)).toBeNull()
    expect(consoleLinkBase('')).toBeNull()
    expect(consoleLinkBase('not a url')).toBeNull()
  })
})

describe('parseConsoleMarkup', () => {
  it('returns a plain line as one text node without parsing it', () => {
    expect(parseConsoleMarkup('Klipper state: Ready', base)).toEqual([
      { type: 'text', text: 'Klipper state: Ready' },
    ])
  })

  it('builds a link whose relative target is resolved', () => {
    expect(parseConsoleMarkup('Result: <a href="/server/files/logs/r.png">plot</a>', base)).toEqual(
      [
        { type: 'text', text: 'Result: ' },
        {
          type: 'link',
          href: 'http://voron.local/server/files/logs/r.png',
          children: [{ type: 'text', text: 'plot' }],
        },
      ],
    )
  })

  it('builds an image, keeping the alt and ignoring size attributes', () => {
    expect(
      parseConsoleMarkup(
        '<img width="100%" height="auto" src="/server/files/logs/r.png" alt="Nozzle plot">',
        base,
      ),
    ).toEqual([
      { type: 'image', src: 'http://voron.local/server/files/logs/r.png', alt: 'Nozzle plot' },
    ])
  })

  it('nests an image inside a link the way the calibration macros emit it', () => {
    const nodes = parseConsoleMarkup(
      '<a href="/server/files/logs/r.png"><img src="/server/files/logs/r.png"></a>',
      base,
    )
    expect(nodes).toEqual([
      {
        type: 'link',
        href: 'http://voron.local/server/files/logs/r.png',
        children: [{ type: 'image', src: 'http://voron.local/server/files/logs/r.png', alt: '' }],
      },
    ])
  })

  it('unwraps a link with a rejected target to its text', () => {
    expect(parseConsoleMarkup('<a href="javascript:alert(1)">click</a>', base)).toEqual([
      { type: 'text', text: 'click' },
    ])
  })

  it('reduces an image with a rejected source to its alt, or to nothing', () => {
    expect(parseConsoleMarkup('<img src="javascript:x" alt="plot"><br>', base)).toEqual([
      { type: 'text', text: 'plot' },
      { type: 'break' },
    ])
    expect(parseConsoleMarkup('<img src="/x.png"><br>', null)).toEqual([{ type: 'break' }])
  })

  it('never carries an event handler or a style through', () => {
    const nodes = parseConsoleMarkup(
      '<a href="/x" onclick="alert(1)" style="color:red"><b onmouseover="x">t</b></a>',
      base,
    )
    expect(JSON.stringify(nodes)).not.toMatch(/onclick|onmouseover|style|alert/)
  })

  it('keeps inline emphasis and unwraps everything else', () => {
    expect(
      parseConsoleMarkup('<div><b>bold</b> <span>plain</span> <code>G28</code></div>', base),
    ).toEqual([
      { type: 'inline', tag: 'b', children: [{ type: 'text', text: 'bold' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'plain' },
      { type: 'text', text: ' ' },
      { type: 'inline', tag: 'code', children: [{ type: 'text', text: 'G28' }] },
    ])
  })

  it('drops a script and its contents rather than printing them', () => {
    expect(
      parseConsoleMarkup('<b>ok</b><script>alert(1)</script><style>x{}</style>', base),
    ).toEqual([{ type: 'inline', tag: 'b', children: [{ type: 'text', text: 'ok' }] }])
  })
})

describe('consoleMarkupText', () => {
  it('returns a plain line unchanged, prefixes and all', () => {
    expect(consoleMarkupText('// probe: at 10.000,10.000 bed will contact at z=1.000000')).toBe(
      '// probe: at 10.000,10.000 bed will contact at z=1.000000',
    )
  })

  it('leaves the words a parser needs when a macro wraps a reading in a tag', () => {
    expect(consoleMarkupText('// probe at <b>z=1.000000</b><br>done')).toBe(
      '// probe at z=1.000000\ndone',
    )
  })

  it('stands an image in by its alt and a link by its text', () => {
    expect(consoleMarkupText('<a href="/r.png">plot</a> <img src="/r.png" alt="chart">')).toBe(
      'plot chart',
    )
  })
})
