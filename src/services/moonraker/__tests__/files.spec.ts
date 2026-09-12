import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  fetchMoonrakerTextFile,
  gcodeDisplayName,
  normalizeMoonrakerRelativePath,
  uploadMoonrakerFile,
  validMoonrakerFilename,
} from '@/services/moonraker'

/**
 * The progress-reporting upload path is `XMLHttpRequest`, because `fetch` has
 * no upload-progress event to give it. This stands in for one, exposing the
 * hooks a test needs to drive a transfer: report bytes, answer, or be aborted.
 */
function installFakeXhr() {
  const instances: FakeXhr[] = []

  class FakeXhr {
    status = 200
    response: unknown = { item: { root: 'gcodes', path: 'vase.gcode' } }
    responseType = ''
    sent: FormData | null = null
    aborted = false
    private readonly listeners = new Map<string, ((event: unknown) => void)[]>()
    readonly upload = {
      listeners: new Map<string, ((event: unknown) => void)[]>(),
      addEventListener(type: string, listener: (event: unknown) => void) {
        const existing = this.listeners.get(type) ?? []
        this.listeners.set(type, [...existing, listener])
      },
    }

    constructor() {
      instances.push(this)
    }

    open(): void {}

    send(body: FormData): void {
      this.sent = body
    }

    abort(): void {
      this.aborted = true
      this.emit('abort')
    }

    addEventListener(type: string, listener: (event: unknown) => void): void {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
    }

    emit(type: string): void {
      for (const listener of this.listeners.get(type) ?? []) listener({})
    }

    reportProgress(event: { loaded: number; total: number; lengthComputable: boolean }): void {
      for (const listener of this.upload.listeners.get('progress') ?? []) listener(event)
    }
  }

  vi.stubGlobal('XMLHttpRequest', FakeXhr)
  return instances
}

describe('Moonraker machine files', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes safe relative paths and rejects traversal', () => {
    expect(normalizeMoonrakerRelativePath('/hardware\\bed.cfg/')).toBe('hardware/bed.cfg')
    expect(normalizeMoonrakerRelativePath('')).toBe('')
    expect(() => normalizeMoonrakerRelativePath('hardware/../printer.cfg')).toThrow()
    expect(validMoonrakerFilename('printer.cfg')).toBe(true)
    expect(validMoonrakerFilename('../printer.cfg')).toBe(false)
  })

  it('shows a G-code path as a bare name, keeping version dots and odd names intact', () => {
    expect(gcodeDisplayName('parts/brackets/left_v2.gcode')).toBe('left_v2')
    expect(gcodeDisplayName('vase.GCODE')).toBe('vase')
    expect(gcodeDisplayName('bed_level.nc')).toBe('bed_level')

    // Only a known G-code extension is stripped. A version is not a suffix,
    // and renaming the file in front of its owner is worse than a long name.
    expect(gcodeDisplayName('Bracket_v1.2.gcode')).toBe('Bracket_v1.2')
    expect(gcodeDisplayName('notes.txt')).toBe('notes.txt')
    expect(gcodeDisplayName('no_extension')).toBe('no_extension')

    // A name that is nothing but an extension keeps it: an empty row names
    // nothing at all.
    expect(gcodeDisplayName('.gcode')).toBe('.gcode')
    expect(gcodeDisplayName('')).toBe('')
  })

  it('reports upload progress, and says nothing rather than zero when it cannot', async () => {
    const instances = installFakeXhr()
    const seen: (number | null)[] = []
    const pending = uploadMoonrakerFile(
      'gcodes',
      '',
      new Blob(['G1 X10']),
      'vase.gcode',
      'ws://printer.local/websocket',
      { onProgress: (fraction) => seen.push(fraction) },
    )
    const request = instances[0]!

    request.reportProgress({ loaded: 25, total: 100, lengthComputable: true })
    // A body the browser will not size reports null, never 0: a bar pinned at
    // zero for a whole transfer reads as a stall rather than as no measurement.
    request.reportProgress({ loaded: 0, total: 0, lengthComputable: false })
    request.emit('load')

    await expect(pending).resolves.toEqual({ item: { root: 'gcodes', path: 'vase.gcode' } })
    expect(seen).toEqual([0.25, null])
    expect((request.sent?.get('file') as File).name).toBe('vase.gcode')
  })

  it('rejects an aborted upload as a cancellation rather than a failure', async () => {
    const instances = installFakeXhr()
    const controller = new AbortController()
    const pending = uploadMoonrakerFile(
      'gcodes',
      '',
      new Blob(['G1 X10']),
      'vase.gcode',
      'ws://printer.local/websocket',
      { onProgress: () => {}, signal: controller.signal },
    )

    controller.abort()

    // The name is the contract: `printer.ts` tells a cancelled upload apart
    // from a failed one by it, and only swallows the cancelled kind.
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(instances[0]?.aborted).toBe(true)
  })

  it('surfaces a refused upload with its status', async () => {
    const instances = installFakeXhr()
    const pending = uploadMoonrakerFile(
      'gcodes',
      '',
      new Blob(['G1 X10']),
      'vase.gcode',
      'ws://printer.local/websocket',
      { onProgress: () => {} },
    )
    instances[0]!.status = 503
    instances[0]!.emit('load')

    await expect(pending).rejects.toThrow('503')
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
      { fetcher },
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
