import { simulationTimeForCursor, type GcodeSimulationTimeline } from '@/features/gcode/simulation'
import {
  gcodeSegment,
  gcodeSegmentStride,
  gcodeSourceByte,
  gcodeSourceByteStride,
} from '@/features/gcode/types'

export type PlannedPlaybackFallbackReason =
  | 'backward-file-position'
  | 'impossible-file-position'
  | 'live-position-ambiguous'
  | 'live-position-outside-tolerance'
  | 'live-position-outside-frontier'

export type PlannedPlaybackPhase = 'idle' | 'buffering' | 'running' | 'holding' | 'fallback'

export interface PlannedPlaybackConfiguration {
  delaySeconds: number
  liveDelaySeconds: number
  deadBandSeconds: number
  minimumRateMultiplier: number
  maximumRateMultiplier: number
  correctionGain: number
  phaseCorrectionGain: number
  maximumPhaseCorrectionSeconds: number
  rateSmoothingGain: number
  minimumObservedRateMultiplier: number
  maximumObservedRateMultiplier: number
  maximumFrameSeconds: number
  stoppedVelocity: number
}

export interface PlannedPlaybackAnchor {
  filePosition: number
  timestampMilliseconds: number
  active: boolean
  paused: boolean
}

export interface PlannedPlaybackStep {
  timestampMilliseconds: number
  speedFactor: number
  liveVelocity: number
}

export interface PlannedPlaybackState {
  phase: PlannedPlaybackPhase
  playbackSeconds: number
  targetSeconds: number
  frontierSeconds: number
  playbackRate: number
  referenceRate: number
  cursorErrorSeconds: number
  anchorAgeMilliseconds: number
  reanchorCount: number
  liveAnchorCount: number
  fallbackReason: PlannedPlaybackFallbackReason | null
}

export interface PlannedPositionMatchConfiguration {
  windowSeconds: number
  toleranceMillimeters: number
  ambiguitySeparationSeconds: number
  ambiguityMarginMillimeters: number
}

export interface PlannedFollowEligibility {
  loadedSource: 'moonraker' | 'local' | null
  loadedFilename: string
  currentFilename: string
  hasActivePrint: boolean
  virtualSdActive: boolean
  klipperReady: boolean
  reducedMotion: boolean
  followEnabled: boolean
  simulationEnabled: boolean
}

export type PlannedPositionMatch =
  | { matched: true; timelineSeconds: number; distanceMillimeters: number }
  | { matched: false; reason: 'outside-tolerance' | 'ambiguous' }

/**
 * Measured on the workshop printer on 2026-08-14 over 41 active-print samples:
 * Moonraker median/max push intervals 0.501/1.253 s, dispatch lead 1.442–4.175
 * nominal path seconds, and maximum normalized live-path error 0.065 mm.
 */
export const defaultPlannedPlaybackConfiguration: PlannedPlaybackConfiguration = {
  delaySeconds: 4.5,
  liveDelaySeconds: 0.25,
  deadBandSeconds: 0.05,
  minimumRateMultiplier: 0.75,
  maximumRateMultiplier: 1.25,
  correctionGain: 0.5,
  phaseCorrectionGain: 0.5,
  maximumPhaseCorrectionSeconds: 0.15,
  rateSmoothingGain: 0.65,
  minimumObservedRateMultiplier: 0.1,
  maximumObservedRateMultiplier: 2,
  maximumFrameSeconds: 0.1,
  stoppedVelocity: 0.01,
}

export const defaultPlannedPositionMatchConfiguration: PlannedPositionMatchConfiguration = {
  windowSeconds: 4,
  toleranceMillimeters: 0.25,
  ambiguitySeparationSeconds: 0.5,
  ambiguityMarginMillimeters: 0.05,
}

function normalizedGcodePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+|^gcodes\//i, '')
}

export function plannedFollowCanStart(eligibility: PlannedFollowEligibility): boolean {
  return (
    eligibility.loadedSource === 'moonraker' &&
    Boolean(eligibility.currentFilename) &&
    normalizedGcodePath(eligibility.loadedFilename) ===
      normalizedGcodePath(eligibility.currentFilename) &&
    eligibility.hasActivePrint &&
    eligibility.virtualSdActive &&
    eligibility.klipperReady &&
    !eligibility.reducedMotion &&
    eligibility.followEnabled &&
    !eligibility.simulationEnabled
  )
}

function finiteNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(`${name} must be finite and non-negative`)
  return value
}

function validateConfiguration(configuration: PlannedPlaybackConfiguration): void {
  finiteNonNegative(configuration.delaySeconds, 'delaySeconds')
  finiteNonNegative(configuration.liveDelaySeconds, 'liveDelaySeconds')
  finiteNonNegative(configuration.deadBandSeconds, 'deadBandSeconds')
  finiteNonNegative(configuration.minimumRateMultiplier, 'minimumRateMultiplier')
  finiteNonNegative(configuration.maximumRateMultiplier, 'maximumRateMultiplier')
  finiteNonNegative(configuration.correctionGain, 'correctionGain')
  finiteNonNegative(configuration.phaseCorrectionGain, 'phaseCorrectionGain')
  finiteNonNegative(configuration.maximumPhaseCorrectionSeconds, 'maximumPhaseCorrectionSeconds')
  finiteNonNegative(configuration.rateSmoothingGain, 'rateSmoothingGain')
  finiteNonNegative(configuration.minimumObservedRateMultiplier, 'minimumObservedRateMultiplier')
  finiteNonNegative(configuration.maximumObservedRateMultiplier, 'maximumObservedRateMultiplier')
  finiteNonNegative(configuration.maximumFrameSeconds, 'maximumFrameSeconds')
  finiteNonNegative(configuration.stoppedVelocity, 'stoppedVelocity')
  if (configuration.maximumRateMultiplier < configuration.minimumRateMultiplier) {
    throw new RangeError('maximumRateMultiplier must not be smaller than minimumRateMultiplier')
  }
  if (configuration.rateSmoothingGain > 1) {
    throw new RangeError('rateSmoothingGain must not exceed one')
  }
  if (configuration.maximumObservedRateMultiplier < configuration.minimumObservedRateMultiplier) {
    throw new RangeError(
      'maximumObservedRateMultiplier must not be smaller than minimumObservedRateMultiplier',
    )
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

/**
 * Returns the cursor after the last complete command Klipper has dispatched.
 * Arc subdivisions intentionally share an end byte, so the upper-bound search
 * admits every subdivision together and never exposes a fraction of a command
 * Klipper has not handed to its G-code dispatcher yet.
 */
export function cursorForSourceByte(sourceBytes: Float64Array, requestedByte: number): number {
  const count = Math.floor(sourceBytes.length / gcodeSourceByteStride)
  const sourceByte = Math.max(0, requestedByte)
  let low = 0
  let high = count
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const commandEnd =
      sourceBytes[middle * gcodeSourceByteStride + gcodeSourceByte.commandEnd] ?? Infinity
    if (commandEnd <= sourceByte) low = middle + 1
    else high = middle
  }
  return low
}

function lowerTimelineIndex(timeline: GcodeSimulationTimeline, requestedSeconds: number): number {
  const count = Math.max(0, timeline.cumulativeSeconds.length - 1)
  let low = 0
  let high = count
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if ((timeline.cumulativeSeconds[middle + 1] ?? 0) < requestedSeconds) low = middle + 1
    else high = middle
  }
  return low
}

/**
 * Reconciles a physical sample only inside a bounded timeline window. Repeated
 * geometry at meaningfully different times is rejected as ambiguous instead
 * of selecting a plausible-looking global nearest point.
 */
export function matchPlannedPosition(
  segments: Float32Array,
  timeline: GcodeSimulationTimeline,
  centerSeconds: number,
  position: readonly [number, number, number],
  configuration: PlannedPositionMatchConfiguration,
): PlannedPositionMatch {
  finiteNonNegative(configuration.windowSeconds, 'windowSeconds')
  finiteNonNegative(configuration.toleranceMillimeters, 'toleranceMillimeters')
  finiteNonNegative(configuration.ambiguitySeparationSeconds, 'ambiguitySeparationSeconds')
  finiteNonNegative(configuration.ambiguityMarginMillimeters, 'ambiguityMarginMillimeters')
  const count = Math.floor(segments.length / gcodeSegmentStride)
  if (count === 0 || timeline.cumulativeSeconds.length !== count + 1) {
    return { matched: false, reason: 'outside-tolerance' }
  }
  const windowStart = Math.max(0, centerSeconds - configuration.windowSeconds)
  const windowEnd = Math.min(timeline.totalSeconds, centerSeconds + configuration.windowSeconds)
  const candidates: Array<{ timelineSeconds: number; distanceMillimeters: number }> = []
  for (let index = lowerTimelineIndex(timeline, windowStart); index < count; index += 1) {
    const startSeconds = timeline.cumulativeSeconds[index] ?? 0
    const endSeconds = timeline.cumulativeSeconds[index + 1] ?? startSeconds
    if (startSeconds > windowEnd) break
    const offset = index * gcodeSegmentStride
    const startX = segments[offset + gcodeSegment.startX] ?? 0
    const startY = segments[offset + gcodeSegment.startY] ?? 0
    const startZ = segments[offset + gcodeSegment.startZ] ?? 0
    const deltaX = (segments[offset + gcodeSegment.endX] ?? startX) - startX
    const deltaY = (segments[offset + gcodeSegment.endY] ?? startY) - startY
    const deltaZ = (segments[offset + gcodeSegment.endZ] ?? startZ) - startZ
    const lengthSquared = deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ
    const minimumFraction =
      endSeconds > startSeconds
        ? clamp((windowStart - startSeconds) / (endSeconds - startSeconds), 0, 1)
        : 0
    const maximumFraction =
      endSeconds > startSeconds
        ? clamp((windowEnd - startSeconds) / (endSeconds - startSeconds), 0, 1)
        : 1
    const projectedFraction =
      lengthSquared > 0
        ? ((position[0] - startX) * deltaX +
            (position[1] - startY) * deltaY +
            (position[2] - startZ) * deltaZ) /
          lengthSquared
        : 1
    const fraction = clamp(projectedFraction, minimumFraction, maximumFraction)
    const distanceMillimeters = Math.hypot(
      position[0] - (startX + deltaX * fraction),
      position[1] - (startY + deltaY * fraction),
      position[2] - (startZ + deltaZ * fraction),
    )
    candidates.push({
      timelineSeconds: startSeconds + (endSeconds - startSeconds) * fraction,
      distanceMillimeters,
    })
  }
  candidates.sort((left, right) => left.distanceMillimeters - right.distanceMillimeters)
  const best = candidates[0]
  if (!best || best.distanceMillimeters > configuration.toleranceMillimeters) {
    return { matched: false, reason: 'outside-tolerance' }
  }
  const ambiguous = candidates.some(
    (candidate) =>
      Math.abs(candidate.timelineSeconds - best.timelineSeconds) >
        configuration.ambiguitySeparationSeconds &&
      candidate.distanceMillimeters <=
        best.distanceMillimeters + configuration.ambiguityMarginMillimeters,
  )
  return ambiguous ? { matched: false, reason: 'ambiguous' } : { matched: true, ...best }
}

/**
 * Timeline-only synchronization controller. It never chooses geometry: callers
 * sample the existing parsed path at `playbackSeconds`. Calibration values are
 * constructor inputs on purpose; ADR 0007 forbids inventing printer defaults.
 */
export class PlannedToolheadPlayback {
  private phase: PlannedPlaybackPhase = 'idle'
  private playbackSeconds = 0
  private targetSeconds = 0
  private frontierSeconds = 0
  private playbackRate = 0
  private referenceRate = 1
  private cursorErrorSeconds = 0
  private anchorTimestamp = 0
  private stepTimestamp = 0
  private lastFilePosition: number | null = null
  private paused = false
  private reanchorCount = 0
  private liveAnchorCount = 0
  private lastLiveEventtime: number | null = null
  private lastLiveTimelineSeconds: number | null = null
  private lastSpeedFactor = 1
  private fallbackReason: PlannedPlaybackFallbackReason | null = null

  constructor(
    private readonly sourceBytes: Float64Array,
    private readonly sourceByteCount: number,
    private readonly timeline: GcodeSimulationTimeline,
    private readonly configuration: PlannedPlaybackConfiguration,
  ) {
    validateConfiguration(configuration)
    if (sourceBytes.length % gcodeSourceByteStride !== 0) {
      throw new RangeError('sourceBytes must contain complete byte-range rows')
    }
    finiteNonNegative(sourceByteCount, 'sourceByteCount')
    if (sourceBytes.length / gcodeSourceByteStride !== timeline.cumulativeSeconds.length - 1) {
      throw new RangeError('source byte ranges and timeline segments must have equal lengths')
    }
    let previousStart = 0
    let previousEnd = 0
    for (let offset = 0; offset < sourceBytes.length; offset += gcodeSourceByteStride) {
      const start = sourceBytes[offset + gcodeSourceByte.commandStart]
      const end = sourceBytes[offset + gcodeSourceByte.commandEnd]
      if (
        start === undefined ||
        end === undefined ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < previousStart ||
        end < previousEnd ||
        end < start ||
        end > sourceByteCount
      ) {
        throw new RangeError('source byte ranges must be finite, ordered, and inside the file')
      }
      previousStart = start
      previousEnd = end
    }
  }

  reset(): PlannedPlaybackState {
    this.phase = 'idle'
    this.playbackSeconds = 0
    this.targetSeconds = 0
    this.frontierSeconds = 0
    this.playbackRate = 0
    this.referenceRate = 1
    this.cursorErrorSeconds = 0
    this.anchorTimestamp = 0
    this.stepTimestamp = 0
    this.lastFilePosition = null
    this.paused = false
    this.reanchorCount = 0
    this.liveAnchorCount = 0
    this.lastLiveEventtime = null
    this.lastLiveTimelineSeconds = null
    this.lastSpeedFactor = 1
    this.fallbackReason = null
    return this.state(0)
  }

  anchor(anchor: PlannedPlaybackAnchor): PlannedPlaybackState {
    if (!anchor.active) return this.reset()
    if (this.phase === 'fallback') return this.state(anchor.timestampMilliseconds)
    if (!Number.isFinite(anchor.timestampMilliseconds) || anchor.timestampMilliseconds < 0) {
      return this.state(0)
    }
    if (this.anchorTimestamp > 0 && anchor.timestampMilliseconds <= this.anchorTimestamp) {
      return this.state(anchor.timestampMilliseconds)
    }
    if (
      !Number.isFinite(anchor.filePosition) ||
      anchor.filePosition < 0 ||
      anchor.filePosition > this.sourceByteCount
    ) {
      return this.fallback('impossible-file-position', anchor.timestampMilliseconds)
    }
    if (this.lastFilePosition !== null && anchor.filePosition < this.lastFilePosition) {
      return this.fallback('backward-file-position', anchor.timestampMilliseconds)
    }

    this.paused = anchor.paused
    this.anchorTimestamp = anchor.timestampMilliseconds
    this.stepTimestamp ||= anchor.timestampMilliseconds
    if (!anchor.paused || this.lastFilePosition === null) {
      this.lastFilePosition = anchor.filePosition
      const cursor = cursorForSourceByte(this.sourceBytes, anchor.filePosition)
      this.frontierSeconds = simulationTimeForCursor(this.timeline, cursor)
      if (this.liveAnchorCount === 0) {
        this.targetSeconds = Math.max(0, this.frontierSeconds - this.configuration.delaySeconds)
      }
      if (this.phase === 'idle') {
        // Loading a print already in progress needs one explicit re-anchor. All
        // movement after this point remains monotonic and on the parsed path.
        this.playbackSeconds = this.targetSeconds
        this.reanchorCount += 1
      }
    }
    this.cursorErrorSeconds = this.targetSeconds - this.playbackSeconds
    this.phase = this.frontierSeconds <= this.configuration.delaySeconds ? 'buffering' : 'running'
    return this.state(anchor.timestampMilliseconds)
  }

  step(step: PlannedPlaybackStep): PlannedPlaybackState {
    if (this.phase === 'idle' || this.phase === 'fallback') {
      return this.state(step.timestampMilliseconds)
    }
    if (
      !Number.isFinite(step.timestampMilliseconds) ||
      step.timestampMilliseconds <= this.stepTimestamp
    ) {
      return this.state(step.timestampMilliseconds)
    }
    const elapsedSeconds = Math.min(
      this.configuration.maximumFrameSeconds,
      Math.max(0, (step.timestampMilliseconds - this.stepTimestamp) / 1_000),
    )
    this.stepTimestamp = step.timestampMilliseconds
    const speedFactor = Number.isFinite(step.speedFactor) ? Math.max(0, step.speedFactor) : 1
    if (speedFactor !== this.lastSpeedFactor) {
      this.referenceRate =
        this.lastSpeedFactor > 0
          ? this.referenceRate * (speedFactor / this.lastSpeedFactor)
          : speedFactor
      this.lastSpeedFactor = speedFactor
    }
    const advanceLiveTarget =
      this.liveAnchorCount > 0 &&
      (!this.paused || step.liveVelocity > this.configuration.stoppedVelocity)
    this.cursorErrorSeconds = this.targetSeconds - this.playbackSeconds

    if (
      this.phase === 'buffering' ||
      (this.paused && step.liveVelocity <= this.configuration.stoppedVelocity)
    ) {
      this.playbackRate = 0
      this.phase = this.phase === 'buffering' ? 'buffering' : 'holding'
      return this.state(step.timestampMilliseconds)
    }

    const correction =
      Math.abs(this.cursorErrorSeconds) <= this.configuration.deadBandSeconds
        ? 0
        : this.cursorErrorSeconds * this.configuration.correctionGain
    this.playbackRate = clamp(
      this.referenceRate + correction,
      this.referenceRate * this.configuration.minimumRateMultiplier,
      this.referenceRate * this.configuration.maximumRateMultiplier,
    )
    this.playbackSeconds = Math.min(
      this.frontierSeconds,
      this.playbackSeconds + elapsedSeconds * this.playbackRate,
    )
    // A live sample is a phase anchor, not a stationary destination. Keep its
    // delayed timeline position moving at the filtered physical clock rate between
    // Moonraker pushes; otherwise every push creates a short catch-up followed
    // by a slowdown, which looks exactly like the old telemetry spring.
    if (advanceLiveTarget) {
      this.targetSeconds = Math.min(
        this.frontierSeconds,
        this.targetSeconds + elapsedSeconds * this.referenceRate,
      )
    }
    this.cursorErrorSeconds = this.targetSeconds - this.playbackSeconds
    this.phase = this.paused && this.playbackSeconds >= this.frontierSeconds ? 'holding' : 'running'
    return this.state(step.timestampMilliseconds)
  }

  reconcileLivePosition(timelineSeconds: number, eventtime: number): PlannedPlaybackState {
    if (this.phase === 'idle' || this.phase === 'fallback') return this.state(this.stepTimestamp)
    if (!Number.isFinite(eventtime) || eventtime < 0) return this.state(this.stepTimestamp)
    if (this.lastLiveEventtime !== null && eventtime <= this.lastLiveEventtime) {
      return this.state(this.stepTimestamp)
    }
    if (
      !Number.isFinite(timelineSeconds) ||
      timelineSeconds < 0 ||
      timelineSeconds > this.frontierSeconds
    ) {
      return this.fallback('live-position-outside-frontier', this.stepTimestamp)
    }
    const firstLiveAnchor = this.liveAnchorCount === 0
    const previousLiveEventtime = this.lastLiveEventtime
    const previousLiveTimelineSeconds = this.lastLiveTimelineSeconds
    const observedTargetSeconds = Math.max(
      0,
      Math.min(this.frontierSeconds, timelineSeconds - this.configuration.liveDelaySeconds),
    )
    this.lastLiveEventtime = eventtime
    this.lastLiveTimelineSeconds = timelineSeconds
    this.liveAnchorCount += 1
    if (firstLiveAnchor) {
      // Nothing has been rendered from this controller yet, so begin close to
      // the uniquely matched physical position instead of visibly catching up
      // from the conservative dispatch-only bootstrap estimate.
      this.targetSeconds = observedTargetSeconds
      this.playbackSeconds = observedTargetSeconds
      this.referenceRate = this.lastSpeedFactor
    } else {
      const eventtimeDelta = eventtime - (previousLiveEventtime ?? eventtime)
      const timelineDelta = timelineSeconds - (previousLiveTimelineSeconds ?? timelineSeconds)
      if (!this.paused && eventtimeDelta > 0 && timelineDelta >= 0 && this.lastSpeedFactor > 0) {
        const observedRate = clamp(
          timelineDelta / eventtimeDelta,
          this.lastSpeedFactor * this.configuration.minimumObservedRateMultiplier,
          this.lastSpeedFactor * this.configuration.maximumObservedRateMultiplier,
        )
        this.referenceRate +=
          (observedRate - this.referenceRate) * this.configuration.rateSmoothingGain
      }
      const phaseCorrection = clamp(
        (observedTargetSeconds - this.targetSeconds) * this.configuration.phaseCorrectionGain,
        -this.configuration.maximumPhaseCorrectionSeconds,
        this.configuration.maximumPhaseCorrectionSeconds,
      )
      this.targetSeconds = clamp(this.targetSeconds + phaseCorrection, 0, this.frontierSeconds)
    }
    this.cursorErrorSeconds = this.targetSeconds - this.playbackSeconds
    if (
      this.phase === 'buffering' &&
      (firstLiveAnchor || this.frontierSeconds > this.configuration.delaySeconds)
    ) {
      this.phase = 'running'
    }
    return this.state(this.stepTimestamp)
  }

  rejectLivePosition(
    reason: Extract<
      PlannedPlaybackFallbackReason,
      'live-position-ambiguous' | 'live-position-outside-tolerance'
    >,
  ): PlannedPlaybackState {
    return this.fallback(reason, this.stepTimestamp)
  }

  snapshot(timestampMilliseconds: number): PlannedPlaybackState {
    return this.state(timestampMilliseconds)
  }

  private fallback(
    reason: PlannedPlaybackFallbackReason,
    timestampMilliseconds: number,
  ): PlannedPlaybackState {
    this.phase = 'fallback'
    this.playbackRate = 0
    this.fallbackReason = reason
    return this.state(timestampMilliseconds)
  }

  private state(timestampMilliseconds: number): PlannedPlaybackState {
    return {
      phase: this.phase,
      playbackSeconds: this.playbackSeconds,
      targetSeconds: this.targetSeconds,
      frontierSeconds: this.frontierSeconds,
      playbackRate: this.playbackRate,
      referenceRate: this.referenceRate,
      cursorErrorSeconds: this.cursorErrorSeconds,
      anchorAgeMilliseconds:
        this.anchorTimestamp > 0
          ? Math.max(0, timestampMilliseconds - this.anchorTimestamp)
          : Number.POSITIVE_INFINITY,
      reanchorCount: this.reanchorCount,
      liveAnchorCount: this.liveAnchorCount,
      fallbackReason: this.fallbackReason,
    }
  }
}
