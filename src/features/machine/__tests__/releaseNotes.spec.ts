import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  fetchReleaseNotes,
  parseInline,
  parseNotes,
  releasesBetween,
} from '@/features/machine/releaseNotes'

describe('release notes', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the Markdown release notes are written in', () => {
    expect(
      parseNotes(
        '## Features\n\n- One `thing` with a\n  continued line\n- **Two**\n\nA paragraph\nover two lines.',
      ),
    ).toEqual([
      { kind: 'heading', inlines: [{ kind: 'text', text: 'Features' }] },
      {
        kind: 'list',
        items: [
          [
            { kind: 'text', text: 'One ' },
            { kind: 'code', text: 'thing' },
            { kind: 'text', text: ' with a continued line' },
          ],
          [{ kind: 'strong', children: [{ kind: 'text', text: 'Two' }] }],
        ],
      },
      { kind: 'paragraph', inlines: [{ kind: 'text', text: 'A paragraph over two lines.' }] },
    ])
  })

  it('keeps only web links, and leaves any other markup as text', () => {
    expect(parseInline('[site](https://example.com) and [bad](javascript:alert(1))')).toEqual([
      {
        kind: 'link',
        href: 'https://example.com',
        children: [{ kind: 'text', text: 'site' }],
      },
      { kind: 'text', text: ' and ' },
      { kind: 'text', text: 'bad' },
      { kind: 'text', text: ')' },
    ])
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([
      { kind: 'text', text: '<img src=x onerror=alert(1)>' },
    ])
  })

  it('takes the releases after the installed version up to the available one, newest first', () => {
    const releases = [
      { tag_name: 'v0.10.0' },
      { tag_name: 'v0.9.2' },
      { tag_name: 'v0.9.2-beta.1' },
      { tag_name: 'v0.9.1', draft: true },
      { tag_name: 'v0.9.10' },
      { tag_name: 'v0.9.0' },
      { tag_name: 'nightly' },
    ]
    expect(releasesBetween(releases, 'v0.9.0', 'v0.9.10').map((note) => note.tag)).toEqual([
      'v0.9.10',
      'v0.9.2',
    ])
    // A prerelease counts only when the version on offer is one.
    expect(releasesBetween(releases, 'v0.9.0', 'v0.9.2-beta.1').map((note) => note.tag)).toEqual([
      'v0.9.2-beta.1',
    ])
  })

  it('asks GitHub once per range, and again after a failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 403 }))
      .mockResolvedValue(new Response(JSON.stringify([{ tag_name: 'v2.0.1' }])))
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchReleaseNotes('o', 'r', 'v2.0.0', 'v2.0.1')).toBeNull()
    expect(
      (await fetchReleaseNotes('o', 'r', 'v2.0.0', 'v2.0.1'))?.map((note) => note.tag),
    ).toEqual(['v2.0.1'])
    await fetchReleaseNotes('o', 'r', 'v2.0.0', 'v2.0.1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
