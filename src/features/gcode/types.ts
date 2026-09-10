export const gcodeSegmentStride = 13
export const gcodeSourceByteStride = 2
// The exact byte table stores Uint32 offsets, so a source file must fit in
// 32 bits. Anything larger is refused with a message instead of overflowing.
export const maximumGcodeSourceBytes = 4_294_967_295
export const defaultGcodeNozzleDiameter = 0.4
export const defaultGcodeFilamentDiameter = 1.75

export const gcodeSegment = {
  startX: 0,
  startY: 1,
  startZ: 2,
  endX: 3,
  endY: 4,
  endZ: 5,
  layer: 6,
  kind: 7,
  feedrate: 8,
  progress: 9,
  extrusionHeight: 10,
  extrusionWidth: 11,
  feature: 12,
} as const

export const gcodeSourceByte = {
  commandStart: 0,
  commandEnd: 1,
} as const

export const enum GcodeMoveKind {
  Travel = 0,
  Extrusion = 1,
}

/**
 * What a move is *for*, read from the slicer's own `;TYPE:` comments. The
 * categories are deliberately few: they are the distinctions a person makes
 * when looking at a print ("is the outside wall clean", "where are the
 * bridges"), not the full vocabulary any one slicer happens to emit. Every
 * unrecognized type lands on `Other` rather than being invented into a
 * neighboring category, so an unknown slicer degrades to honest grey instead
 * of a confident lie.
 */
export const enum GcodeFeature {
  Other = 0,
  PerimeterOuter = 1,
  PerimeterInner = 2,
  Infill = 3,
  InfillSolid = 4,
  Bridge = 5,
  Support = 6,
  Skirt = 7,
}

export const gcodeFeatureCount = 8

export type GcodeColorMode = 'single' | 'feature' | 'feedrate'

export interface GcodeBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

/**
 * The timeline a parse produces: what happens, where, in which order, and at
 * which byte of the file it was written.
 *
 * Scene geometry is not in here and deliberately so — the renderer builds its
 * own from the file text. What only a parse can produce is this: the complete
 * segment stream the simulation and the live-position matcher step through,
 * the exact byte table planned playback maps a file position onto, and the
 * layer, feature and feed-rate facts the readouts state.
 *
 * `progressScale` reconciles the two normalization bases a download can have:
 * segment progress is normalized by the actual byte total, while a progress
 * readout during the download could only divide by the expected one.
 * Multiplying a progress value by this scale converts between them; it is
 * exactly 1 whenever the download reported its size truthfully.
 */
export interface ParsedGcodeSummary {
  segments: Float32Array
  sourceBytes: Uint32Array
  sourceByteCount: number
  layerHeights: Float32Array
  segmentCount: number
  extrusionCount: number
  travelCount: number
  bounds: GcodeBounds
  extrusionBounds: GcodeBounds
  minimumFeedrate: number
  maximumFeedrate: number
  progressScale: number
}

export interface GcodeCamera {
  yaw: number
  pitch: number
  distance: number
  targetX: number
  targetY: number
  targetZ: number
}

export type GcodeParserWorkerRequest =
  | { type: 'start'; expectedTotalBytes: number | null; filamentDiameter: number }
  | { type: 'chunk'; buffer: ArrayBuffer }
  | { type: 'finish' }

export type GcodeParserWorkerResponse =
  { type: 'parsed'; summary: ParsedGcodeSummary } | { type: 'error'; message: string }
