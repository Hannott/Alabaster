/**
 * The bridge between "which move" and "which byte".
 *
 * Everything that moves through a file upstream of the renderer counts in
 * moves: ADR 0007's playback controller produces a segment cursor, the
 * simulation clock produces one, and the transport scrubber sets one. The
 * renderer draws up to a byte offset. This is the one place the two meet, so
 * there is a single definition of where a fractional cursor lands in the file
 * rather than one per caller.
 *
 * Byte ranges come from the parser's own table, which is exact: a command's
 * range survives chunk boundaries, multi-byte characters and CRLF, and every
 * segment an arc was subdivided into shares the range of the command that
 * produced it. That exactness is the whole basis of ADR 0007's claim to
 * synchronise on encoded bytes rather than on normalized progress, so nothing
 * here may round it away — a cursor between two moves interpolates inside the
 * current command's own range and never past its end.
 */

import { gcodeSourceByte, gcodeSourceByteStride } from '@/features/gcode/types'

/**
 * The byte offset a fractional segment cursor points at.
 *
 * A cursor of exactly `n` means move `n` has not been drawn yet, so the offset
 * is the start of its command; a cursor of `n + 1` means it has, so the offset
 * is the end. Between them the offset advances through the command, which is
 * what keeps a slow simulation of one long move from sitting still.
 */
export function gcodeByteForCursor(
  sourceBytes: Uint32Array | Float64Array,
  segmentCount: number,
  cursor: number,
): number {
  if (segmentCount <= 0 || sourceBytes.length === 0) return 0
  const clamped = Math.min(segmentCount, Math.max(0, cursor))
  const index = Math.min(segmentCount - 1, Math.floor(clamped))
  const offset = index * gcodeSourceByteStride
  const start = sourceBytes[offset + gcodeSourceByte.commandStart] ?? 0
  const end = sourceBytes[offset + gcodeSourceByte.commandEnd] ?? start
  const fraction = Math.min(1, Math.max(0, clamped - index))
  return Math.round(start + (end - start) * fraction)
}
