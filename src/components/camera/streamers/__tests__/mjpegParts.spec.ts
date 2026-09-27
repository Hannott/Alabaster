import { describe, expect, it } from 'vitest'

import { createMjpegPartParser } from '../mjpegParts'

const encoder = new TextEncoder()

function part(jpeg: number[], headers?: string): Uint8Array {
  const head = encoder.encode(
    headers ??
      `--boundarydonotcross\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`,
  )
  const tail = encoder.encode('\r\n')
  return Uint8Array.from([...head, ...jpeg, ...tail])
}

function collect(chunks: Uint8Array[]): number[][] {
  const frames: number[][] = []
  const parse = createMjpegPartParser((frame) => frames.push([...frame]))
  for (const chunk of chunks) parse(chunk)
  return frames
}

const plainFrame = [0xff, 0xd8, 0x01, 0x02, 0x03, 0xff, 0xd9]
// An EXIF thumbnail carries its own start-of-image marker inside the frame.
const frameWithThumbnail = [0xff, 0xd8, 0xff, 0xe1, 0xff, 0xd8, 0x10, 0xff, 0xd9, 0x20, 0xff, 0xd9]

describe('MJPEG part parser', () => {
  it('yields each frame of a stream, whole', () => {
    const stream = Uint8Array.from([...part(plainFrame), ...part(plainFrame)])
    expect(collect([stream])).toEqual([plainFrame, plainFrame])
  })

  it('keeps a frame whole when it embeds a second start-of-image marker', () => {
    const stream = Uint8Array.from([...part(frameWithThumbnail), ...part(plainFrame)])
    expect(collect([stream])).toEqual([frameWithThumbnail, plainFrame])
  })

  it('finds a start-of-image marker split across two chunks', () => {
    const stream = part(plainFrame)
    const split = stream.indexOf(0xd8)
    expect(collect([stream.slice(0, split), stream.slice(split)])).toEqual([plainFrame])
  })

  it('reassembles a frame delivered one byte at a time', () => {
    const stream = part(frameWithThumbnail)
    expect(collect([...stream].map((byte) => Uint8Array.of(byte)))).toEqual([frameWithThumbnail])
  })

  it('skips a part it cannot frame and recovers on the next', () => {
    const unframed = part(plainFrame, '--boundary\r\nContent-Length: garbage\r\n\r\n')
    const stream = Uint8Array.from([...unframed, ...part(plainFrame)])
    expect(collect([stream])).toEqual([plainFrame])
  })
})
