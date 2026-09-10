import { afterEach, describe, expect, it, vi } from 'vitest'

import { gcodeStreamTotalBytes, parseGcodeStream } from '@/features/gcode/loader'
import { GcodeParser, parseGcode } from '@/features/gcode/parser'
import {
  gcodeSourceByte,
  gcodeSourceByteStride,
  type GcodeParserWorkerRequest,
  type GcodeParserWorkerResponse,
} from '@/features/gcode/types'

/**
 * Streaming has one hard requirement: a file parsed in chunks must produce
 * exactly the timeline the whole-file parse produces, and must hand back
 * exactly the text that was downloaded. Both are byte-level claims — a
 * multi-byte character or a CRLF straddling a chunk boundary is the whole
 * risk — so these tests compare bytes rather than shapes.
 */

/** Drives the parser directly, cutting the byte stream every `chunkBytes`. */
function streamParse(source: string, chunkBytes = 0) {
  const bytes = new TextEncoder().encode(source)
  const parser = new GcodeParser(bytes.length)
  const step = chunkBytes > 0 ? chunkBytes : bytes.length
  for (let offset = 0; offset < bytes.length; offset += step) {
    parser.pushBytes(bytes.subarray(offset, Math.min(bytes.length, offset + step)))
  }
  return parser.finish()
}

const perimeterLoop = `G90
M83
;LAYER:0
G1 X0 Y0 Z0.2 F1200
G1 X20 Y0 E1
G1 X20 Y20 E1
G1 X0 Y20 E1
G1 X0 Y0 E1
G1 X5 Y5
G1 X15 Y5 E1
G1 X15 Y15 E1
;LAYER:1
G1 X15 Y15 Z0.4
G1 X5 Y15 E1
G1 X5 Y5 E1
`

describe('streamed parsing', () => {
  it('produces a byte-identical timeline to a whole-file parse', () => {
    const whole = parseGcode(perimeterLoop)
    const streamed = streamParse(perimeterLoop, 7)

    expect(streamed.segmentCount).toBe(whole.segmentCount)
    expect(streamed.extrusionCount).toBe(whole.extrusionCount)
    expect(streamed.travelCount).toBe(whole.travelCount)
    expect([...streamed.segments]).toEqual([...whole.segments])
    expect([...streamed.sourceBytes]).toEqual([...whole.sourceBytes])
    expect([...streamed.layerHeights]).toEqual([...whole.layerHeights])
    expect(streamed.bounds).toEqual(whole.bounds)
    expect(streamed.extrusionBounds).toEqual(whole.extrusionBounds)
    expect(streamed.minimumFeedrate).toBe(whole.minimumFeedrate)
    expect(streamed.maximumFeedrate).toBe(whole.maximumFeedrate)
  })

  it('is unaffected by where the download splits its chunks', () => {
    const reference = streamParse(perimeterLoop)
    for (const chunkBytes of [1, 3, 7, 16, 64]) {
      const streamed = streamParse(perimeterLoop, chunkBytes)
      expect([...streamed.segments], `chunk size ${chunkBytes}`).toEqual([...reference.segments])
      expect([...streamed.sourceBytes], `chunk size ${chunkBytes}`).toEqual([
        ...reference.sourceBytes,
      ])
      expect([...streamed.layerHeights], `chunk size ${chunkBytes}`).toEqual([
        ...reference.layerHeights,
      ])
    }
  })

  it('keeps exact byte ranges across chunks, including UTF-8 and CRLF', () => {
    const source = '; café — test\r\nG90\r\nM83\r\nG1 X10 Z0.2 E1\r\nG1 X20 E1\r\n'
    const whole = parseGcode(source)
    const summary = streamParse(source, 5)

    expect([...summary.sourceBytes]).toEqual([...whole.sourceBytes])
    expect(summary.sourceByteCount).toBe(new TextEncoder().encode(source).length)
    const lastEnd =
      summary.sourceBytes[
        (summary.segmentCount - 1) * gcodeSourceByteStride + gcodeSourceByte.commandEnd
      ] ?? 0
    expect(lastEnd).toBe(summary.sourceByteCount)
  })

  it('reports progress against the expected total and scales when it was wrong', () => {
    const bytes = new TextEncoder().encode(perimeterLoop).length
    const parser = new GcodeParser(bytes * 2)
    parser.pushText(perimeterLoop)

    // The download claimed twice the real size, so a progress readout that
    // divided by the claim reached only half of 1, and the scale maps those
    // values onto the timeline's own normalization.
    expect(parser.finish().progressScale).toBeCloseTo(0.5)

    const honest = new GcodeParser(bytes)
    honest.pushText(perimeterLoop)
    expect(honest.finish().progressScale).toBeCloseTo(1)
  })
})

/**
 * The loader's other output is the file text, which is what the scene is built
 * from. It is decoded once, on this side, as the chunks arrive — so the test
 * that matters is that a character split across a chunk boundary survives
 * rather than becoming a replacement character.
 */
class StubParserWorker {
  onmessage: ((event: MessageEvent<GcodeParserWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  private parser: GcodeParser | null = null

  postMessage(message: GcodeParserWorkerRequest): void {
    if (message.type === 'start') {
      this.parser = new GcodeParser(message.expectedTotalBytes, message.filamentDiameter)
      return
    }
    if (!this.parser) return
    if (message.type === 'chunk') {
      this.parser.pushBytes(new Uint8Array(message.buffer))
      return
    }
    const summary = this.parser.finish()
    this.parser = null
    this.onmessage?.({
      data: { type: 'parsed', summary },
    } as MessageEvent<GcodeParserWorkerResponse>)
  }

  terminate(): void {}
}

function streamOf(bytes: Uint8Array, chunkBytes: number): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
        controller.enqueue(bytes.slice(offset, Math.min(bytes.length, offset + chunkBytes)))
      }
      controller.close()
    },
  })
}

async function load(source: string, chunkBytes: number) {
  const bytes = new TextEncoder().encode(source)
  return parseGcodeStream(streamOf(bytes, chunkBytes), bytes.length, {
    signal: new AbortController().signal,
    onProgress: () => {},
  })
}

describe('parseGcodeStream', () => {
  const multiByteSource = '; blå café — test\r\nG90\r\nM83\r\nG1 X10 Z0.2 E1\r\nG1 X20 E1\r\n'

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the decoded text intact when a character is split across chunks', async () => {
    vi.stubGlobal('Worker', StubParserWorker)
    const encoder = new TextEncoder()
    const bytes = encoder.encode(multiByteSource)
    // Deliberately mid-character: one byte into the two-byte 'å'.
    const splitAt =
      encoder.encode(multiByteSource.slice(0, multiByteSource.indexOf('å'))).length + 1
    const chunks = [bytes.slice(0, splitAt), bytes.slice(splitAt)]

    const result = await parseGcodeStream(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk)
          controller.close()
        },
      }),
      bytes.length,
      { signal: new AbortController().signal, onProgress: () => {} },
    )

    expect(result.text).toBe(multiByteSource)
    expect(new TextEncoder().encode(result.text)).toEqual(bytes)
    expect(result.text).not.toContain('�')
    expect(result.summary.sourceByteCount).toBe(bytes.length)
    expect([...result.summary.sourceBytes]).toEqual([...parseGcode(multiByteSource).sourceBytes])
  })

  it('reassembles the same text whatever the chunk size', async () => {
    vi.stubGlobal('Worker', StubParserWorker)
    for (const chunkBytes of [1, 2, 3, 5, 13]) {
      const result = await load(multiByteSource, chunkBytes)
      expect(result.text, `chunk size ${chunkBytes}`).toBe(multiByteSource)
      expect(result.summary.segmentCount, `chunk size ${chunkBytes}`).toBe(
        parseGcode(multiByteSource).segmentCount,
      )
    }
  })
})

/**
 * Whether a download can report a percentage comes down entirely to whether a
 * total is known. The bug this guards shipped and went unnoticed because a
 * local file knows its size and a dev server sends `Content-Length`, so both
 * tested paths had a total, while Moonraker sends no `Content-Length` and the
 * path most people use — pick a file off the printer — had none.
 */
describe('gcodeStreamTotalBytes', () => {
  it('takes the size from the response when it declares one', () => {
    expect(gcodeStreamTotalBytes('118231040', 999)).toBe(118231040)
  })

  it('falls back to the size the caller already knows', () => {
    // Moonraker's own file listing is where this comes from, and it is the same
    // number the follow frontier divides file positions by.
    expect(gcodeStreamTotalBytes(null, 118231040)).toBe(118231040)
  })

  it('reports unknown rather than guessing when neither source has a size', () => {
    expect(gcodeStreamTotalBytes(null, undefined)).toBeNull()
    expect(gcodeStreamTotalBytes('not-a-number', null)).toBeNull()
  })

  it('treats a zero declared size as unknown, not as an empty file', () => {
    // A file listing that has not arrived yet reports 0, and trusting it would
    // divide every progress readout by zero.
    expect(gcodeStreamTotalBytes(null, 0)).toBeNull()
    expect(gcodeStreamTotalBytes(null, -1)).toBeNull()
  })
})
