import { describe, expect, it, vi } from 'vitest'

import {
  fetchMoonrakerTextFile,
  normalizeMoonrakerRelativePath,
  uploadMoonrakerFile,
  validMoonrakerFilename,
} from '@/services/moonraker'

describe('Moonraker machine files', () => {
  it('normalizes safe relative paths and rejects traversal', () => {
    expect(normalizeMoonrakerRelativePath('/hardware\\bed.cfg/')).toBe('hardware/bed.cfg')
    expect(normalizeMoonrakerRelativePath('')).toBe('')
    expect(() => normalizeMoonrakerRelativePath('hardware/../printer.cfg')).toThrow()
    expect(validMoonrakerFilename('printer.cfg')).toBe(true)
    expect(validMoonrakerFilename('../printer.cfg')).toBe(false)
  })

  it('fetches encoded configuration paths without caching stale content', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('[printer]\n', { status: 200, headers: { 'content-type': 'text/plain' } }),
      )
    await expect(
      fetchMoonrakerTextFile(
        'config',
        'hardware/bed mesh.cfg',
        'ws://printer.local/websocket',
        fetcher,
      ),
    ).resolves.toBe('[printer]\n')
    const [url, options] = fetcher.mock.calls[0] ?? []
    expect(String(url)).toContain('/server/files/config/hardware/bed%20mesh.cfg?t=')
    expect(options).toMatchObject({ cache: 'no-store' })
  })

  it('uploads files with Moonraker multipart fields', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ item: { root: 'config', path: 'hardware/bed.cfg' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await uploadMoonrakerFile(
      'config',
      'hardware',
      new Blob(['[bed_mesh]\n']),
      'bed.cfg',
      'ws://printer.local/websocket',
      fetcher,
    )
    const [url, options] = fetcher.mock.calls[0] ?? []
    expect(String(url)).toBe('http://printer.local/server/files/upload')
    expect(options?.method).toBe('POST')
    const form = options?.body as FormData
    expect(form.get('root')).toBe('config')
    expect(form.get('path')).toBe('hardware')
    expect((form.get('file') as File).name).toBe('bed.cfg')
  })
})
