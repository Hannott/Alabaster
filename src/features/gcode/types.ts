export const gcodeSegmentStride = 13
export const gcodePathDetailStride = 8
export const gcodeCapStride = 9
export const gcodeSourceByteStride = 2
// The exact byte table stores Uint32 offsets, so a source file must fit in
// 32 bits. Anything larger is refused with a message instead of overflowing.
export const maximumGcodeSourceBytes = 4_294_967_295
export const defaultGcodeNozzleDiameter = 0.4
export const defaultGcodeExtrusionWidth = defaultGcodeNozzleDiameter
export const defaultGcodeFilamentDiameter = 1.75
/*
 * Beads are drawn slightly wider than the width they were extruded at.
 *
 * A slicer spaces adjacent lines by their extrusion width, so in the file they
 * exactly abut. Drawing them at exactly that width leaves a hairline of
 * background between every pair once rasterization and antialiasing have had
 * their say, and a surface of hairlines reads as stripes or speckle rather than
 * as a solid wall. A real print does not have those gaps either: the beads are
 * pressed together and fuse. Overlapping slightly is both the more honest
 * picture and the more solid one.
 */
export const defaultGcodeBeadOverlap = 1.12

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

export const gcodePathDetail = {
  startOffsetX: 0,
  startOffsetY: 1,
  endOffsetX: 2,
  endOffsetY: 3,
  startProgress: 4,
  flags: 5,
  startWidth: 6,
  endWidth: 7,
} as const

export const gcodeCap = {
  x: 0,
  y: 1,
  z: 2,
  directionX: 3,
  directionY: 4,
  layer: 5,
  progress: 6,
  extrusionHeight: 7,
  extrusionWidth: 8,
} as const

export const gcodeSourceByte = {
  commandStart: 0,
  commandEnd: 1,
} as const

export const enum GcodePathFlags {
  StartCap = 1,
  EndCap = 2,
}

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
 * neighbouring category, so an unknown slicer degrades to honest grey instead
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

export interface GcodeRenderChunk {
  first: number
  count: number
  minimumLayer: number
  maximumLayer: number
  bounds: GcodeBounds
}

/**
 * The two reduced streams of the toolpath LOD ladder. Both are ordinary
 * segment streams — same stride, same shaders — holding fewer, longer beads.
 */
export type GcodeDecimationTier = 'decimated' | 'coarse'

/** One uploaded tier: reduced segments plus the path data they need. */
export interface GcodeGeometryTier {
  segments: Float32Array
  pathDetails: Float32Array
  segmentCount: number
  renderChunks: GcodeRenderChunk[]
}

export interface ParsedGcodeGeometry {
  segments: Float32Array
  sourceBytes: Uint32Array
  sourceByteCount: number
  pathDetails: Float32Array
  caps: Float32Array
  layerHeights: Float32Array
  renderChunks: GcodeRenderChunk[]
  capRenderChunks: GcodeRenderChunk[]
  tiers: Record<GcodeDecimationTier, GcodeGeometryTier>
  segmentCount: number
  capCount: number
  extrusionCount: number
  travelCount: number
  bounds: GcodeBounds
  extrusionBounds: GcodeBounds
  minimumFeedrate: number
  maximumFeedrate: number
}

/**
 * One streamed slice of parsed geometry, cut only at path breaks so miter
 * joins and end caps never straddle a batch boundary. `renderChunks` carry
 * global instance indices, so the renderer can append batches without
 * re-indexing anything.
 */
export interface GcodeGeometryBatch {
  segments: Float32Array
  pathDetails: Float32Array
  caps: Float32Array
  segmentCount: number
  capCount: number
  renderChunks: GcodeRenderChunk[]
  capRenderChunks: GcodeRenderChunk[]
  /** Scene and extrusion bounds of everything parsed so far, not just this batch. */
  bounds: GcodeBounds
  extrusionBounds: GcodeBounds
  /** Layers seen so far, so a streaming view can keep new geometry visible. */
  layerCount: number
}

/**
 * The end-of-parse message. Full-resolution GPU arrays already left in
 * batches; this carries what only the end of the parse can produce: the
 * complete segment stream for simulation and the live-position matcher, the
 * exact byte table for planned playback, and the reduced LOD tiers, which
 * cannot be built incrementally because a merged run may span batches.
 *
 * `progressScale` reconciles the two normalization bases: batch progress was
 * normalized by the expected byte total (all that is known mid-stream), the
 * CPU stream by the actual total. Multiplying a CPU-side progress value by
 * this scale yields the value the GPU buffers store; it is exactly 1 whenever
 * the download reported its size truthfully.
 */
export interface ParsedGcodeSummary {
  segments: Float32Array
  sourceBytes: Uint32Array
  sourceByteCount: number
  layerHeights: Float32Array
  tiers: Record<GcodeDecimationTier, GcodeGeometryTier>
  segmentCount: number
  capCount: number
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

/**
 * The cross-section every bead is extruded along.
 *
 * `round` is a pill: the shape a bead actually takes on a print, and what makes
 * a close-up read as extruded plastic rather than as a wireframe of boxes.
 * `square` is a rectangular ribbon with four flat faces — a third of the
 * vertices, no curvature to alias, and the calmer of the two at any distance.
 * The choice is the user's rendering-quality setting, never a zoom threshold:
 * bead shape is the most visible thing in the viewer, so it may not change
 * under the camera while a preference says it should not.
 */
export type GcodeBeadProfile = 'round' | 'square'

/** See `gcodeSubPixelStrategyFor` for why this is a choice, not a fix. */
export type GcodeSubPixelStrategy = 'preserve' | 'widen'

export interface GcodeRenderOptions {
  selectedLayer: number
  showPreviousLayers: boolean
  /**
   * Lowest visible layer. `showPreviousLayers` false still means "this layer
   * only"; with it true, this is the floor of a range whose ceiling is
   * `selectedLayer`, which is what lets a cross-section be cut from below.
   */
  layerMinimum: number
  showTravels: boolean
  printProgress: number
  progressStyle: 'standard' | 'live-layer'
  /** Fallback bead width for moves that declared no extrusion volume. */
  extrusionWidth: number
  /** Multiplies every bead's rendered width so neighbours overlap. */
  widthScale: number
  beadProfile: GcodeBeadProfile
  /**
   * What to do where a bead no longer fills a pixel. See
   * `gcodeSubPixelStrategyFor` for why this is a choice rather than a fix.
   */
  subPixelStrategy: GcodeSubPixelStrategy
  highlightSeams: boolean
  colorMode: GcodeColorMode
  /** Feed-rate colour range, in mm/min, matching the parser's stored units. */
  feedrateRange: readonly [number, number]
  /**
   * True while follow or simulation is showing a moving frontier. The selected
   * layer then always renders from the full-resolution stream, whatever tier
   * the rest of the model uses, so zooming out can never coarsen the geometry
   * whose reveal the user is actually watching.
   */
  exactActiveLayer: boolean
  /** Governor bias on the tier thresholds; 1 leaves distance selection alone. */
  tierBias: number
  contactShadow: boolean
}

// How far the seam colour reaches from the start and end of an extrusion path,
// in millimetres.
export const gcodeSeamLength = 1

export type GcodeParserWorkerRequest =
  | { type: 'start'; expectedTotalBytes: number | null; filamentDiameter: number }
  | { type: 'chunk'; buffer: ArrayBuffer }
  | { type: 'finish' }

export type GcodeParserWorkerResponse =
  | { type: 'batch'; batch: GcodeGeometryBatch }
  | { type: 'parsed'; summary: ParsedGcodeSummary }
  | { type: 'error'; message: string }
