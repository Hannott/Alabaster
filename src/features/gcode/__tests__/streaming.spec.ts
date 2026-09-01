import { describe, expect, it } from 'vitest'

import { gcodeStreamTotalBytes } from '@/features/gcode/loader'
import { GcodeParser, assembleGcodeGeometry, parseGcode } from '@/features/gcode/parser'
import { gcodeMovesConnected } from '@/features/gcode/pathGeometry'
import {
  GcodePathFlags,
  gcodePathDetail,
  gcodePathDetailStride,
  gcodeSegment,
  gcodeSegmentStride,
  gcodeSourceByte,
  gcodeSourceByteStride,
  type GcodeGeometryBatch,
} from '@/features/gcode/types'

/**
 * Streaming has one hard requirement: a file parsed in batches must produce
 * exactly the geometry the whole-file parse produces. Batch boundaries are
 * chosen at path breaks precisely so miter joins and end caps cannot differ,
 * and these tests are what keep that true as the parser changes.
 */

/** Drives the streaming parser, cutting a batch at every opportunity. */
function streamParse(source: string, batchSegments = 1, chunkBytes = 0) {
  const bytes = new TextEncoder().encode(source)
  const parser = new GcodeParser(bytes.length)
  const batches: GcodeGeometryBatch[] = []
  const step = chunkBytes > 0 ? chunkBytes : bytes.length
  for (let offset = 0; offset < bytes.length; offset += step) {
    parser.pushBytes(bytes.subarray(offset, Math.min(bytes.length, offset + step)))
    let batch = parser.drainBatch(batchSegments)
    while (batch) {
      batches.push(batch)
      batch = parser.drainBatch(batchSegments)
    }
  }
  const { batch, summary } = parser.finishStream()
  if (batch) batches.push(batch)
  return { batches, summary, geometry: assembleGcodeGeometry(batches, summary) }
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
  it('produces byte-identical geometry to a whole-file parse', () => {
    const whole = parseGcode(perimeterLoop)
    const streamed = streamParse(perimeterLoop).geometry

    expect(streamed.segmentCount).toBe(whole.segmentCount)
    expect(streamed.capCount).toBe(whole.capCount)
    expect(streamed.extrusionCount).toBe(whole.extrusionCount)
    expect(streamed.travelCount).toBe(whole.travelCount)
    expect([...streamed.segments]).toEqual([...whole.segments])
    expect([...streamed.pathDetails]).toEqual([...whole.pathDetails])
    expect([...streamed.caps]).toEqual([...whole.caps])
    expect([...streamed.sourceBytes]).toEqual([...whole.sourceBytes])
    expect([...streamed.layerHeights]).toEqual([...whole.layerHeights])
    expect(streamed.bounds).toEqual(whole.bounds)
    expect(streamed.extrusionBounds).toEqual(whole.extrusionBounds)
  })

  it('is unaffected by where the download splits its chunks', () => {
    const reference = streamParse(perimeterLoop).geometry
    for (const chunkBytes of [1, 3, 7, 16, 64]) {
      const streamed = streamParse(perimeterLoop, 1, chunkBytes).geometry
      expect([...streamed.segments], `chunk size ${chunkBytes}`).toEqual([...reference.segments])
      expect([...streamed.pathDetails], `chunk size ${chunkBytes}`).toEqual([
        ...reference.pathDetails,
      ])
      expect([...streamed.sourceBytes], `chunk size ${chunkBytes}`).toEqual([
        ...reference.sourceBytes,
      ])
    }
  })

  it('emits more than one batch and keeps chunk indices global', () => {
    const { batches, geometry } = streamParse(perimeterLoop)

    expect(batches.length).toBeGreaterThan(1)
    let expectedFirst = 0
    for (const batch of batches) {
      for (const chunk of batch.renderChunks) {
        expect(chunk.first).toBe(expectedFirst)
        expectedFirst += chunk.count
      }
    }
    expect(expectedFirst).toBe(geometry.segmentCount)
    expect(batches.reduce((sum, batch) => sum + batch.segmentCount, 0)).toBe(geometry.segmentCount)
  })

  /**
   * The holdback rule. A batch may only end where the next move does not
   * continue the current path; otherwise the join would be built from a
   * truncated neighbor and the wall would gain a cap in its middle.
   */
  it('never cuts a batch in the middle of a connected path', () => {
    const { batches } = streamParse(perimeterLoop)
    let index = 0
    for (const batch of batches.slice(0, -1)) {
      index += batch.segmentCount
      const previous = index - 1
      const whole = parseGcode(perimeterLoop)
      const at = (segment: number, field: number): number =>
        whole.segments[segment * gcodeSegmentStride + field] ?? 0
      expect(
        gcodeMovesConnected(
          at(previous, gcodeSegment.endX),
          at(previous, gcodeSegment.endY),
          at(previous, gcodeSegment.endZ),
          at(previous, gcodeSegment.kind),
          at(previous, gcodeSegment.layer),
          at(index, gcodeSegment.startX),
          at(index, gcodeSegment.startY),
          at(index, gcodeSegment.startZ),
          at(index, gcodeSegment.kind),
          at(index, gcodeSegment.layer),
        ),
        `batch boundary at segment ${index} splits a connected path`,
      ).toBe(false)
    }
  })

  it('caps a closed perimeter exactly once across batches, as the whole parse does', () => {
    const whole = parseGcode(perimeterLoop)
    const streamed = streamParse(perimeterLoop).geometry
    const capFlags = (geometry: typeof whole): number[] => {
      const flags: number[] = []
      for (let index = 0; index < geometry.segmentCount; index += 1) {
        flags.push(geometry.pathDetails[index * gcodePathDetailStride + gcodePathDetail.flags] ?? 0)
      }
      return flags
    }

    expect(capFlags(streamed)).toEqual(capFlags(whole))
    const startCaps = capFlags(streamed).filter((flag) => flag & GcodePathFlags.StartCap).length
    expect(startCaps).toBeGreaterThan(0)
  })

  it('keeps exact byte ranges across batches, including UTF-8 and CRLF', () => {
    const source = '; café — test\r\nG90\r\nM83\r\nG1 X10 Z0.2 E1\r\nG1 X20 E1\r\n'
    const whole = parseGcode(source)
    const { summary } = streamParse(source, 1, 5)

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
    const { summary } = parser.finishStream()

    // The download claimed twice the real size, so GPU-side progress values
    // reach only half of 1 and the scale maps CPU progress onto them.
    expect(summary.progressScale).toBeCloseTo(0.5)

    const honest = new GcodeParser(bytes)
    honest.pushText(perimeterLoop)
    expect(honest.finishStream().summary.progressScale).toBeCloseTo(1)
  })

  it('holds an unfinished path back rather than cutting it early', () => {
    const parser = new GcodeParser(1_000)
    parser.pushText(`G90
M83
G1 X0 Y0 Z0.2 F1200
G1 X10 Y0 E1
G1 X20 Y0 E1
G1 X30 Y0 E1
`)
    // The lead-in travel is a complete path of its own, so it may leave; the
    // three connected wall moves may not, because a fourth could still join.
    expect(parser.drainBatch(1)?.segmentCount).toBe(1)
    expect(parser.drainBatch(1)).toBeNull()

    // A travel ends the wall, releasing its three moves — and the travel with
    // them, since the safe cut is before the extrusion that follows it.
    parser.pushText('G1 X40 Y10\nG1 X50 Y10 E1\n')
    expect(parser.drainBatch(1)?.segmentCount).toBe(4)
  })

  it('refuses finish() after batches have already been drained', () => {
    const parser = new GcodeParser(1_000)
    parser.pushText(perimeterLoop)
    expect(parser.drainBatch(1)).not.toBeNull()

    expect(() => parser.finish()).toThrow('finishStream')
  })

  it('stays a single-emission parser when no expected total is declared', () => {
    const parser = new GcodeParser()
    parser.pushText(perimeterLoop)

    expect(parser.drainBatch(1)).toBeNull()
    expect(parser.finish().segmentCount).toBe(parseGcode(perimeterLoop).segmentCount)
  })
})

/**
 * Whether a download streams into the scene comes down entirely to whether a
 * total is known, because the parser above emits nothing without one. The bug
 * this guards shipped and went unnoticed for exactly that reason: a local file
 * knows its size and a dev server sends `Content-Length`, so both tested paths
 * streamed, while Moonraker sends no `Content-Length` and the path most people
 * use — pick a file off the printer — stayed blank for the whole download and
 * then appeared at once.
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
    // divide every batch's progress by zero.
    expect(gcodeStreamTotalBytes(null, 0)).toBeNull()
    expect(gcodeStreamTotalBytes(null, -1)).toBeNull()
  })
})
