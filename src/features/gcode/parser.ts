import {
  GcodeFeature,
  GcodeMoveKind,
  defaultGcodeFilamentDiameter,
  gcodeSegment,
  gcodeSegmentStride,
  gcodeSourceByteStride,
  maximumGcodeSourceBytes,
  type GcodeBounds,
  type ParsedGcodeSummary,
} from '@/features/gcode/types'
import { gcodeFeatureFromComment } from '@/features/gcode/features'

const segmentsPerBufferChunk = 65_536
const valuesPerChunk = gcodeSegmentStride * segmentsPerBufferChunk
const sourceBytesPerChunk = gcodeSourceByteStride * segmentsPerBufferChunk
const coordinateEpsilon = 0.000_1
const maximumArcSegments = 2_048
const maximumArcStepRadians = Math.PI / 36
const maximumArcChordError = 0.025
const minimumDerivedExtrusionWidth = 0.05
const maximumDerivedExtrusionWidth = 2

// Slicers vary extrusion width per feature and usually widen the first layer, so
// the deposited cross-section is recovered from the filament consumed over the
// move. Zero means "not derivable"; a consumer falls back to nozzle width.
//
// The filament's cross-section is squared into this, so the diameter is taken
// from the machine rather than assumed: 1.75 mm arithmetic on a 2.85 mm printer
// understates every bead by about two and a half times.
function derivedExtrusionWidth(
  volume: number,
  length: number,
  height: number,
  filamentCrossSection: number,
): number {
  if (volume <= 0 || length <= coordinateEpsilon || height <= coordinateEpsilon) return 0
  const width = (volume * filamentCrossSection) / (length * height)
  if (!Number.isFinite(width) || width < minimumDerivedExtrusionWidth) return 0
  return Math.min(maximumDerivedExtrusionWidth, width)
}

function arcStepRadians(radius: number): number {
  if (radius <= maximumArcChordError) return maximumArcStepRadians
  const chordLimited = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - maximumArcChordError / radius)))
  return Math.max(0.000_1, Math.min(maximumArcStepRadians, chordLimited))
}

class SegmentBuffer {
  private readonly chunks: Float32Array[] = []
  private readonly sourceByteChunks: Uint32Array[] = []
  private current = new Float32Array(valuesPerChunk)
  private currentSourceBytes = new Uint32Array(sourceBytesPerChunk)
  private offset = 0
  private sourceByteOffset = 0
  count = 0

  push(values: readonly number[], commandStartByte: number, commandEndByte: number): void {
    if (this.offset + gcodeSegmentStride > this.current.length) {
      this.chunks.push(this.current)
      this.sourceByteChunks.push(this.currentSourceBytes)
      this.current = new Float32Array(valuesPerChunk)
      this.currentSourceBytes = new Uint32Array(sourceBytesPerChunk)
      this.offset = 0
      this.sourceByteOffset = 0
    }
    this.current.set(values, this.offset)
    this.currentSourceBytes.set([commandStartByte, commandEndByte], this.sourceByteOffset)
    this.offset += gcodeSegmentStride
    this.sourceByteOffset += gcodeSourceByteStride
    this.count += 1
  }

  /**
   * Concatenates the retained chunks and normalizes the raw progress bytes by
   * the actual byte total. Progress is stored as a byte offset while parsing
   * because the total is only known once the last chunk has arrived.
   */
  finish(totalBytes: number): { segments: Float32Array; sourceBytes: Uint32Array } {
    const segments = new Float32Array(this.count * gcodeSegmentStride)
    const sourceBytes = new Uint32Array(this.count * gcodeSourceByteStride)
    let targetOffset = 0
    let sourceByteTargetOffset = 0
    for (let index = 0; index < this.chunks.length; index += 1) {
      const chunk = this.chunks[index]
      const sourceByteChunk = this.sourceByteChunks[index]
      if (!chunk || !sourceByteChunk) continue
      segments.set(chunk, targetOffset)
      sourceBytes.set(sourceByteChunk, sourceByteTargetOffset)
      targetOffset += chunk.length
      sourceByteTargetOffset += sourceByteChunk.length
    }
    segments.set(this.current.subarray(0, this.offset), targetOffset)
    sourceBytes.set(
      this.currentSourceBytes.subarray(0, this.sourceByteOffset),
      sourceByteTargetOffset,
    )

    const denominator = Math.max(1, totalBytes)
    for (let index = gcodeSegment.progress; index < segments.length; index += gcodeSegmentStride) {
      segments[index] = Math.min(1, Math.max(0, (segments[index] ?? 0) / denominator))
    }
    return { segments, sourceBytes }
  }
}

interface MachineState {
  x: number
  y: number
  z: number
  e: number
  feedrate: number
  units: number
  coordinatesAbsolute: boolean
  extrusionAbsolute: boolean
}

interface CommandParameters {
  X?: number
  Y?: number
  Z?: number
  E?: number
  F?: number
  I?: number
  J?: number
}

function finiteParameter(value: string): number | undefined {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parametersFrom(command: string): CommandParameters {
  const parameters: CommandParameters = {}
  const parameterPattern = /([XYZEFIJK])\s*([-+]?(?:\d+\.?\d*|\.\d+))/gi
  for (const match of command.matchAll(parameterPattern)) {
    const key = match[1]?.toUpperCase() as keyof CommandParameters | undefined
    const value = match[2] ? finiteParameter(match[2]) : undefined
    if (key && value !== undefined) parameters[key] = value
  }
  return parameters
}

function commandFrom(line: string): string | null {
  const withoutLineNumber = line.replace(/^\s*N\d+\s+/i, '').trim()
  return /^(?:G|M)\d+(?:\.\d+)?|^T\d+/i.exec(withoutLineNumber)?.[0]?.toUpperCase() ?? null
}

function emptyBounds(): GcodeBounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  }
}

export class GcodeParser {
  private readonly segments = new SegmentBuffer()
  private readonly bounds = emptyBounds()
  private readonly extrusionBounds = emptyBounds()
  private readonly layerHeights: number[] = []
  private readonly decoder = new TextDecoder()
  private readonly encoder = new TextEncoder()
  private state: MachineState = {
    x: 0,
    y: 0,
    z: 0,
    e: 0,
    feedrate: 0,
    units: 1,
    coordinatesAbsolute: true,
    extrusionAbsolute: true,
  }
  private byteCarry = new Uint8Array()
  private bytesProcessed = 0
  private currentCommandStartByte = 0
  private currentLayer = 0
  // Slicers state a feature once and then emit many moves under it, so this
  // stays in force until the next type comment rather than resetting per line.
  private currentFeature: GcodeFeature = GcodeFeature.Other
  private explicitLayers = false
  private lastExtrusionZ: number | null = null
  private extrusionCount = 0
  private travelCount = 0
  private minimumFeedrate = Number.POSITIVE_INFINITY
  private maximumFeedrate = 0

  private readonly filamentCrossSection: number

  /**
   * `expectedTotalBytes` is the size the download claimed up front, kept only
   * so the summary can report how far it differed from the real total. The
   * segment stream itself is always normalized by the actual byte count, so a
   * lying `Content-Length` cannot distort the timeline — see
   * `ParsedGcodeSummary.progressScale`.
   */
  constructor(
    private readonly expectedTotalBytes: number | null = null,
    filamentDiameter: number = defaultGcodeFilamentDiameter,
  ) {
    const diameter =
      Number.isFinite(filamentDiameter) && filamentDiameter > 0
        ? filamentDiameter
        : defaultGcodeFilamentDiameter
    this.filamentCrossSection = Math.PI * (diameter / 2) ** 2
  }

  pushBytes(bytes: Uint8Array): void {
    if (bytes.length === 0) return
    const source = new Uint8Array(this.byteCarry.length + bytes.length)
    source.set(this.byteCarry)
    source.set(bytes, this.byteCarry.length)
    let lineStart = 0
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] !== 10) continue
      const contentEnd = index > lineStart && source[index - 1] === 13 ? index - 1 : index
      const line = this.decoder.decode(source.subarray(lineStart, contentEnd))
      this.processLine(line, index - lineStart + 1)
      lineStart = index + 1
    }
    this.byteCarry = source.slice(lineStart)
  }

  pushText(text: string): void {
    this.pushBytes(this.encoder.encode(text))
  }

  /** Flushes the trailing partial line and produces the parse timeline. */
  finish(): ParsedGcodeSummary {
    this.flushByteCarry()

    const { segments, sourceBytes } = this.segments.finish(this.bytesProcessed)
    const hasGeometry = this.segments.count > 0
    const bounds = hasGeometry
      ? this.bounds
      : { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 }
    const extrusionBounds = this.extrusionCount > 0 ? this.extrusionBounds : bounds
    const progressScale =
      this.expectedTotalBytes && this.expectedTotalBytes > 0 && this.bytesProcessed > 0
        ? this.bytesProcessed / this.expectedTotalBytes
        : 1

    return {
      segments,
      sourceBytes,
      sourceByteCount: this.bytesProcessed,
      layerHeights: this.filledLayerHeights(),
      segmentCount: this.segments.count,
      extrusionCount: this.extrusionCount,
      travelCount: this.travelCount,
      bounds,
      extrusionBounds,
      minimumFeedrate: Number.isFinite(this.minimumFeedrate) ? this.minimumFeedrate : 0,
      maximumFeedrate: this.maximumFeedrate,
      progressScale,
    }
  }

  private flushByteCarry(): void {
    if (this.byteCarry.length === 0) return
    const contentEnd =
      this.byteCarry.at(-1) === 13 ? this.byteCarry.length - 1 : this.byteCarry.length
    this.processLine(
      this.decoder.decode(this.byteCarry.subarray(0, contentEnd)),
      this.byteCarry.length,
    )
    this.byteCarry = new Uint8Array()
  }

  private filledLayerHeights(): Float32Array {
    const layerCount = Math.max(1, this.currentLayer + 1)
    const heights = new Float32Array(layerCount)
    let lastHeight = 0
    for (let layer = 0; layer < layerCount; layer += 1) {
      const height = this.layerHeights[layer]
      if (height !== undefined) lastHeight = height
      heights[layer] = lastHeight
    }
    return heights
  }

  private processLine(rawLine: string, byteLength: number): void {
    this.currentCommandStartByte = this.bytesProcessed
    this.bytesProcessed += byteLength
    if (this.bytesProcessed > maximumGcodeSourceBytes) {
      throw new RangeError('G-code file exceeds the 4 GiB byte-table limit')
    }
    this.readLayerComment(rawLine)
    const feature = gcodeFeatureFromComment(rawLine)
    if (feature !== null) this.currentFeature = feature
    const code =
      rawLine
        .replace(/\([^)]*\)/g, '')
        .split(';', 1)[0]
        ?.trim() ?? ''
    if (!code) return
    const command = commandFrom(code)
    if (!command) return
    const parameters = parametersFrom(code)

    switch (command) {
      case 'G20':
        this.state.units = 25.4
        return
      case 'G21':
        this.state.units = 1
        return
      case 'G90':
        this.state.coordinatesAbsolute = true
        return
      case 'G91':
        this.state.coordinatesAbsolute = false
        return
      case 'M82':
        this.state.extrusionAbsolute = true
        return
      case 'M83':
        this.state.extrusionAbsolute = false
        return
      case 'G92':
        this.applyPositionReset(parameters)
        return
      case 'G0':
      case 'G00':
      case 'G1':
      case 'G01':
        this.addLinearMove(parameters)
        return
      case 'G2':
      case 'G02':
      case 'G3':
      case 'G03':
        this.addArcMove(parameters, command === 'G2' || command === 'G02')
    }
  }

  private readLayerComment(line: string): void {
    const match =
      /;\s*LAYER\s*:?\s*(\d+)\s*$/i.exec(line) ??
      /;\s*LAYER_CHANGE(?:\s*:?\s*(\d+))?\s*$/i.exec(line)
    if (!match) return
    this.explicitLayers = true
    const parsedLayer =
      match[1] === undefined
        ? this.lastExtrusionZ === null
          ? 0
          : this.currentLayer + 1
        : Number.parseInt(match[1], 10)
    if (Number.isFinite(parsedLayer)) this.currentLayer = Math.max(0, parsedLayer)
  }

  private applyPositionReset(parameters: CommandParameters): void {
    if (parameters.X !== undefined) this.state.x = parameters.X * this.state.units
    if (parameters.Y !== undefined) this.state.y = parameters.Y * this.state.units
    if (parameters.Z !== undefined) this.state.z = parameters.Z * this.state.units
    if (parameters.E !== undefined) this.state.e = parameters.E * this.state.units
  }

  private targetFor(parameters: CommandParameters): MachineState {
    const coordinate = (axis: 'X' | 'Y' | 'Z', current: number): number => {
      const value = parameters[axis]
      if (value === undefined) return current
      const scaled = value * this.state.units
      return this.state.coordinatesAbsolute ? scaled : current + scaled
    }
    const extrusionValue = parameters.E
    const targetExtrusion =
      extrusionValue === undefined
        ? this.state.e
        : this.state.extrusionAbsolute
          ? extrusionValue * this.state.units
          : this.state.e + extrusionValue * this.state.units

    return {
      ...this.state,
      x: coordinate('X', this.state.x),
      y: coordinate('Y', this.state.y),
      z: coordinate('Z', this.state.z),
      e: targetExtrusion,
      feedrate: parameters.F === undefined ? this.state.feedrate : parameters.F * this.state.units,
    }
  }

  private addLinearMove(parameters: CommandParameters): void {
    const target = this.targetFor(parameters)
    this.addSegment(this.state, target, target.e - this.state.e > coordinateEpsilon)
    this.state = target
  }

  private addArcMove(parameters: CommandParameters, clockwise: boolean): void {
    const target = this.targetFor(parameters)
    if (parameters.I === undefined && parameters.J === undefined) {
      this.addSegment(this.state, target, target.e - this.state.e > coordinateEpsilon)
      this.state = target
      return
    }

    const centerX = this.state.x + (parameters.I ?? 0) * this.state.units
    const centerY = this.state.y + (parameters.J ?? 0) * this.state.units
    const radius = Math.hypot(this.state.x - centerX, this.state.y - centerY)
    if (radius <= coordinateEpsilon) {
      this.addSegment(this.state, target, target.e - this.state.e > coordinateEpsilon)
      this.state = target
      return
    }

    const startAngle = Math.atan2(this.state.y - centerY, this.state.x - centerX)
    const endAngle = Math.atan2(target.y - centerY, target.x - centerX)
    let sweep = endAngle - startAngle
    if (clockwise && sweep >= 0) sweep -= Math.PI * 2
    if (!clockwise && sweep <= 0) sweep += Math.PI * 2
    const steps = Math.min(
      maximumArcSegments,
      Math.max(2, Math.ceil(Math.abs(sweep) / arcStepRadians(radius))),
    )
    const extrusion = target.e - this.state.e > coordinateEpsilon
    let previous = this.state

    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps
      const angle = startAngle + sweep * ratio
      const point: MachineState = {
        ...target,
        x: step === steps ? target.x : centerX + Math.cos(angle) * radius,
        y: step === steps ? target.y : centerY + Math.sin(angle) * radius,
        z: this.state.z + (target.z - this.state.z) * ratio,
        e: this.state.e + (target.e - this.state.e) * ratio,
      }
      const segmentProgress =
        this.currentCommandStartByte + (this.bytesProcessed - this.currentCommandStartByte) * ratio
      this.addSegment(previous, point, extrusion, segmentProgress)
      previous = point
    }
    this.state = target
  }

  private addSegment(
    start: MachineState,
    end: MachineState,
    extrusion: boolean,
    progressBytes = this.bytesProcessed,
  ): void {
    if (
      Math.abs(end.x - start.x) <= coordinateEpsilon &&
      Math.abs(end.y - start.y) <= coordinateEpsilon &&
      Math.abs(end.z - start.z) <= coordinateEpsilon
    ) {
      return
    }

    if (extrusion) this.updateLayer(end.z)
    const kind = extrusion ? GcodeMoveKind.Extrusion : GcodeMoveKind.Travel
    const previousLayerZ =
      this.currentLayer > 0 ? (this.layerHeights[this.currentLayer - 1] ?? 0) : 0
    const extrusionHeight = extrusion ? Math.max(0, end.z - previousLayerZ) : 0
    const extrusionWidth = extrusion
      ? derivedExtrusionWidth(
          end.e - start.e,
          Math.hypot(end.x - start.x, end.y - start.y),
          extrusionHeight,
          this.filamentCrossSection,
        )
      : 0
    this.segments.push(
      [
        start.x,
        start.y,
        start.z,
        end.x,
        end.y,
        end.z,
        this.currentLayer,
        kind,
        end.feedrate,
        progressBytes,
        extrusionHeight,
        extrusionWidth,
        extrusion ? this.currentFeature : GcodeFeature.Other,
      ],
      this.currentCommandStartByte,
      this.bytesProcessed,
    )
    this.updateBounds(start.x, start.y, start.z)
    this.updateBounds(end.x, end.y, end.z)

    if (extrusion) {
      this.updateBounds(start.x, start.y, start.z - extrusionHeight, this.extrusionBounds)
      this.updateBounds(end.x, end.y, end.z, this.extrusionBounds)
      this.extrusionCount += 1
    } else this.travelCount += 1
    // Extrusion feedrates only. Travels run far faster than any bead is laid
    // down, so including them stretches the reported range until every
    // extrusion colors to the same end of a feed-rate ramp.
    if (extrusion && end.feedrate > 0) {
      this.minimumFeedrate = Math.min(this.minimumFeedrate, end.feedrate)
      this.maximumFeedrate = Math.max(this.maximumFeedrate, end.feedrate)
    }
  }

  private updateLayer(z: number): void {
    if (
      !this.explicitLayers &&
      this.lastExtrusionZ !== null &&
      z > this.lastExtrusionZ + coordinateEpsilon
    ) {
      this.currentLayer += 1
    }
    this.lastExtrusionZ = z
    this.layerHeights[this.currentLayer] = z
  }

  private updateBounds(x: number, y: number, z: number, bounds = this.bounds): void {
    bounds.minX = Math.min(bounds.minX, x)
    bounds.maxX = Math.max(bounds.maxX, x)
    bounds.minY = Math.min(bounds.minY, y)
    bounds.maxY = Math.max(bounds.maxY, y)
    bounds.minZ = Math.min(bounds.minZ, z)
    bounds.maxZ = Math.max(bounds.maxZ, z)
  }
}

export function parseGcode(source: string, filamentDiameter?: number): ParsedGcodeSummary {
  const parser = new GcodeParser(null, filamentDiameter)
  parser.pushText(source)
  return parser.finish()
}
