import { describe, expect, it } from 'vitest'

import {
  PlannedToolheadPlayback,
  cursorForSourceByte,
  defaultPlannedPlaybackConfiguration,
  defaultPlannedPositionMatchConfiguration,
  matchPlannedPosition,
  plannedFollowCanStart,
  type PlannedPlaybackConfiguration,
} from '@/features/gcode/plannedPlayback'
import { buildGcodeSimulationTimeline } from '@/features/gcode/simulation'

const configuration: PlannedPlaybackConfiguration = {
  delaySeconds: 1,
  liveDelaySeconds: 0.25,
  deadBandSeconds: 0.05,
  minimumRateMultiplier: 0.25,
  maximumRateMultiplier: 2,
  correctionGain: 0.5,
  phaseCorrectionGain: 0.2,
  maximumPhaseCorrectionSeconds: 0.05,
  rateSmoothingGain: 0.5,
  minimumObservedRateMultiplier: 0.1,
  maximumObservedRateMultiplier: 2,
  maximumFrameSeconds: 0.1,
  stoppedVelocity: 0.01,
}

const segments = new Float32Array([
  ...[0, 0, 0, 10, 0, 0, 0, 1, 600, 0.25, 0.2, 0.4, 0],
  ...[10, 0, 0, 20, 0, 0, 0, 1, 600, 0.5, 0.2, 0.4, 0],
  ...[20, 0, 0, 30, 0, 0, 0, 1, 600, 0.75, 0.2, 0.4, 0],
  ...[30, 0, 0, 40, 0, 0, 0, 1, 600, 1, 0.2, 0.4, 0],
])
const sourceBytes = new Float64Array([0, 10, 10, 20, 20, 30, 30, 40])

function controller(): PlannedToolheadPlayback {
  return new PlannedToolheadPlayback(
    sourceBytes,
    40,
    buildGcodeSimulationTimeline(segments),
    configuration,
  )
}

describe('planned-path toolhead playback', () => {
  it('keeps the measured workshop trace inside the conservative defaults', () => {
    const workshopTrace = {
      maximumDispatchLeadSeconds: 4.1753,
      medianPushIntervalSeconds: 0.5013,
      maximumPushIntervalSeconds: 1.2526,
      maximumPathErrorMillimeters: 0.0642,
    }

    expect(defaultPlannedPlaybackConfiguration.delaySeconds).toBeGreaterThan(
      workshopTrace.maximumDispatchLeadSeconds,
    )
    expect(defaultPlannedPlaybackConfiguration.liveDelaySeconds).toBeGreaterThan(0)
    expect(defaultPlannedPlaybackConfiguration.liveDelaySeconds).toBeLessThan(
      workshopTrace.medianPushIntervalSeconds,
    )
    expect(defaultPlannedPositionMatchConfiguration.windowSeconds).toBeGreaterThan(
      workshopTrace.maximumPushIntervalSeconds,
    )
    expect(defaultPlannedPositionMatchConfiguration.toleranceMillimeters).toBeGreaterThan(
      workshopTrace.maximumPathErrorMillimeters,
    )
  })

  it('starts only for the exact active Moonraker file in Follow mode', () => {
    const eligible = {
      loadedSource: 'moonraker' as const,
      loadedFilename: 'gcodes/parts/cube.gcode',
      currentFilename: 'parts/cube.gcode',
      hasActivePrint: true,
      virtualSdActive: true,
      klipperReady: true,
      reducedMotion: false,
      followEnabled: true,
      simulationEnabled: false,
    }
    expect(plannedFollowCanStart(eligible)).toBe(true)
    expect(plannedFollowCanStart({ ...eligible, loadedSource: 'local' })).toBe(false)
    expect(plannedFollowCanStart({ ...eligible, currentFilename: 'parts/other.gcode' })).toBe(false)
    expect(plannedFollowCanStart({ ...eligible, virtualSdActive: false })).toBe(false)
    expect(plannedFollowCanStart({ ...eligible, klipperReady: false })).toBe(false)
    expect(plannedFollowCanStart({ ...eligible, reducedMotion: true })).toBe(false)
    expect(plannedFollowCanStart({ ...eligible, followEnabled: false })).toBe(false)
    expect(plannedFollowCanStart({ ...eligible, simulationEnabled: true })).toBe(false)
  })

  it('maps a dispatch byte to the end of every complete command', () => {
    expect(cursorForSourceByte(sourceBytes, 0)).toBe(0)
    expect(cursorForSourceByte(sourceBytes, 9)).toBe(0)
    expect(cursorForSourceByte(sourceBytes, 10)).toBe(1)
    expect(cursorForSourceByte(new Float64Array([0, 10, 0, 10, 0, 10]), 10)).toBe(3)
    expect(cursorForSourceByte(sourceBytes, 99)).toBe(4)
  })

  it('re-anchors once, advances continuously, and never overruns the dispatch frontier', () => {
    const playback = controller()
    const anchored = playback.anchor({
      filePosition: 30,
      timestampMilliseconds: 1_000,
      active: true,
      paused: false,
    })

    expect(anchored).toMatchObject({
      phase: 'running',
      playbackSeconds: 2,
      targetSeconds: 2,
      frontierSeconds: 3,
      reanchorCount: 1,
    })
    const samples = Array.from({ length: 20 }, (_, index) =>
      playback.step({
        timestampMilliseconds: 1_050 + index * 50,
        speedFactor: 1,
        liveVelocity: 10,
      }),
    )
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]!.playbackSeconds).toBeGreaterThanOrEqual(
        samples[index - 1]!.playbackSeconds,
      )
      expect(samples[index]!.playbackSeconds).toBeLessThanOrEqual(samples[index]!.frontierSeconds)
    }
  })

  it('bounds correction rates while speeding up and slowing down', () => {
    const playback = controller()
    playback.anchor({ filePosition: 20, timestampMilliseconds: 1_000, active: true, paused: false })
    playback.anchor({ filePosition: 40, timestampMilliseconds: 1_250, active: true, paused: false })
    const catchingUp = playback.step({
      timestampMilliseconds: 1_350,
      speedFactor: 1.5,
      liveVelocity: 10,
    })

    expect(catchingUp.playbackRate).toBeGreaterThan(1.5)
    expect(catchingUp.playbackRate).toBeLessThanOrEqual(1.5 * configuration.maximumRateMultiplier)
    for (let index = 0; index < 30; index += 1) {
      playback.step({
        timestampMilliseconds: 1_450 + index * 100,
        speedFactor: 1,
        liveVelocity: 10,
      })
    }
    expect(playback.snapshot(4_500).playbackRate).toBeGreaterThanOrEqual(
      configuration.minimumRateMultiplier,
    )
  })

  it('uses ordered live matches as delayed synchronization points', () => {
    const playback = controller()
    playback.anchor({ filePosition: 40, timestampMilliseconds: 1_000, active: true, paused: false })
    const reconciled = playback.reconcileLivePosition(3.5, 100)

    expect(reconciled).toMatchObject({
      playbackSeconds: 3.25,
      targetSeconds: 3.25,
      liveAnchorCount: 1,
    })
    expect(playback.reconcileLivePosition(3, 99)).toMatchObject({
      targetSeconds: 3.25,
      liveAnchorCount: 1,
    })
    expect(playback.reconcileLivePosition(5, 101)).toMatchObject({
      phase: 'fallback',
      fallbackReason: 'live-position-outside-frontier',
    })
  })

  it('leaves dispatch buffering as soon as the first live position anchors the path', () => {
    const playback = controller()
    expect(
      playback.anchor({
        filePosition: 10,
        timestampMilliseconds: 1_000,
        active: true,
        paused: false,
      }).phase,
    ).toBe('buffering')

    expect(playback.reconcileLivePosition(0.75, 100)).toMatchObject({
      phase: 'running',
      playbackSeconds: 0.5,
      targetSeconds: 0.5,
    })
  })

  it('keeps the delayed target moving continuously between sparse live samples', () => {
    const playback = controller()
    playback.anchor({ filePosition: 40, timestampMilliseconds: 1_000, active: true, paused: false })
    playback.reconcileLivePosition(3.5, 100)

    const first = playback.step({
      timestampMilliseconds: 1_100,
      speedFactor: 1,
      liveVelocity: 10,
    })
    const second = playback.step({
      timestampMilliseconds: 1_200,
      speedFactor: 1,
      liveVelocity: 10,
    })

    expect(first.targetSeconds).toBeCloseTo(3.35)
    expect(second.targetSeconds).toBeCloseTo(3.45)
    expect(second.playbackRate).toBeCloseTo(first.playbackRate, 1)
  })

  it('applies later live samples as small phase corrections instead of cursor destinations', () => {
    const playback = controller()
    playback.anchor({ filePosition: 40, timestampMilliseconds: 1_000, active: true, paused: false })
    playback.reconcileLivePosition(3.5, 100)
    playback.step({ timestampMilliseconds: 1_100, speedFactor: 1, liveVelocity: 10 })

    const corrected = playback.reconcileLivePosition(3.9, 100.5)

    expect(corrected.playbackSeconds).toBeCloseTo(3.35)
    expect(corrected.targetSeconds).toBeCloseTo(3.4)
    expect(corrected.targetSeconds).not.toBeCloseTo(3.65)
  })

  it('learns sustained short-move slowdown from live samples and recovers afterward', () => {
    const playback = controller()
    playback.anchor({ filePosition: 40, timestampMilliseconds: 1_000, active: true, paused: false })
    playback.reconcileLivePosition(3, 100)
    for (let index = 1; index <= 5; index += 1) {
      playback.step({
        timestampMilliseconds: 1_000 + index * 100,
        speedFactor: 1,
        liveVelocity: 10,
      })
    }

    const slowed = playback.reconcileLivePosition(3.25, 100.5)
    expect(slowed.referenceRate).toBeCloseTo(0.75)
    const slowedFrame = playback.step({
      timestampMilliseconds: 1_600,
      speedFactor: 1,
      liveVelocity: 10,
    })
    expect(slowedFrame.playbackRate).toBeLessThan(0.9)

    const recovered = playback.reconcileLivePosition(3.75, 101)
    expect(recovered.referenceRate).toBeGreaterThan(slowed.referenceRate)
  })

  it('slows the default live clock substantially after one half-speed interval', () => {
    const playback = new PlannedToolheadPlayback(
      sourceBytes,
      40,
      buildGcodeSimulationTimeline(segments),
      defaultPlannedPlaybackConfiguration,
    )
    playback.anchor({ filePosition: 40, timestampMilliseconds: 1_000, active: true, paused: false })
    playback.reconcileLivePosition(3, 100)
    for (let index = 1; index <= 5; index += 1) {
      playback.step({
        timestampMilliseconds: 1_000 + index * 100,
        speedFactor: 1,
        liveVelocity: 10,
      })
    }

    const synchronized = playback.reconcileLivePosition(3.25, 100.5)
    expect(synchronized.referenceRate).toBeCloseTo(0.675)
    expect(
      playback.step({ timestampMilliseconds: 1_600, speedFactor: 1, liveVelocity: 10 })
        .playbackRate,
    ).toBeLessThan(0.65)
  })

  it('follows a sparse live trace without regressing or crossing its byte frontier', () => {
    const playback = controller()
    playback.anchor({ filePosition: 20, timestampMilliseconds: 1_000, active: true, paused: false })
    playback.reconcileLivePosition(1.75, 100)
    const samples = []

    for (let index = 1; index <= 10; index += 1) {
      if (index === 5) {
        playback.anchor({
          filePosition: 40,
          timestampMilliseconds: 1_000 + index * 100,
          active: true,
          paused: false,
        })
        playback.reconcileLivePosition(3.5, 100.5)
      }
      samples.push(
        playback.step({
          timestampMilliseconds: 1_000 + index * 100,
          speedFactor: 1,
          liveVelocity: 10,
        }),
      )
    }

    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]!.playbackSeconds).toBeGreaterThanOrEqual(
        samples[index - 1]!.playbackSeconds,
      )
      expect(samples[index]!.playbackSeconds).toBeLessThanOrEqual(samples[index]!.frontierSeconds)
      expect(samples[index]!.playbackRate).toBeGreaterThanOrEqual(
        configuration.minimumRateMultiplier,
      )
      expect(samples[index]!.playbackRate).toBeLessThanOrEqual(configuration.maximumRateMultiplier)
    }
    expect(samples.at(-1)).toMatchObject({ liveAnchorCount: 2, frontierSeconds: 4 })
  })

  it('records an ambiguous or distant live match as a permanent fallback', () => {
    const playback = controller()
    playback.anchor({ filePosition: 40, timestampMilliseconds: 1_000, active: true, paused: false })
    expect(playback.rejectLivePosition('live-position-ambiguous')).toMatchObject({
      phase: 'fallback',
      fallbackReason: 'live-position-ambiguous',
    })
    expect(
      playback.anchor({
        filePosition: 40,
        timestampMilliseconds: 1_100,
        active: true,
        paused: false,
      }).phase,
    ).toBe('fallback')
  })

  it('ignores stale anchors and falls back on a newer backward seek', () => {
    const playback = controller()
    playback.anchor({ filePosition: 30, timestampMilliseconds: 1_000, active: true, paused: false })
    expect(
      playback.anchor({
        filePosition: 10,
        timestampMilliseconds: 900,
        active: true,
        paused: false,
      }).phase,
    ).toBe('running')
    expect(
      playback.anchor({
        filePosition: 10,
        timestampMilliseconds: 1_100,
        active: true,
        paused: false,
      }),
    ).toMatchObject({ phase: 'fallback', fallbackReason: 'backward-file-position' })
  })

  it('rejects impossible offsets and holds a drained paused path', () => {
    const impossible = controller().anchor({
      filePosition: 41,
      timestampMilliseconds: 1_000,
      active: true,
      paused: false,
    })
    expect(impossible).toMatchObject({
      phase: 'fallback',
      fallbackReason: 'impossible-file-position',
    })

    const playback = controller()
    playback.anchor({ filePosition: 30, timestampMilliseconds: 1_000, active: true, paused: false })
    playback.anchor({ filePosition: 30, timestampMilliseconds: 1_250, active: true, paused: true })
    expect(
      playback.step({ timestampMilliseconds: 1_350, speedFactor: 1, liveVelocity: 0 }),
    ).toMatchObject({ phase: 'holding', playbackRate: 0 })
  })

  it('resets when the print is no longer active', () => {
    const playback = controller()
    playback.anchor({ filePosition: 30, timestampMilliseconds: 1_000, active: true, paused: false })
    expect(
      playback.anchor({
        filePosition: 30,
        timestampMilliseconds: 1_200,
        active: false,
        paused: false,
      }),
    ).toMatchObject({ phase: 'idle', playbackSeconds: 0, reanchorCount: 0 })
  })

  it('rejects byte metadata that cannot safely identify the parsed timeline', () => {
    const timeline = buildGcodeSimulationTimeline(segments)
    expect(
      () => new PlannedToolheadPlayback(new Float64Array([0, 10]), 10, timeline, configuration),
    ).toThrow(/equal lengths/)
    expect(
      () =>
        new PlannedToolheadPlayback(
          new Float64Array([0, 10, 9, 8, 20, 30, 30, 40]),
          40,
          timeline,
          configuration,
        ),
    ).toThrow(/finite, ordered/)
  })

  it('matches live geometry only inside the bounded timeline window', () => {
    const timeline = buildGcodeSimulationTimeline(segments)
    const match = matchPlannedPosition(segments, timeline, 1.5, [15, 0.1, 0], {
      windowSeconds: 0.75,
      toleranceMillimeters: 0.5,
      ambiguitySeparationSeconds: 0.25,
      ambiguityMarginMillimeters: 0.1,
    })

    expect(match).toMatchObject({ matched: true, timelineSeconds: 1.5 })
    expect(match.matched && match.distanceMillimeters).toBeCloseTo(0.1)
    expect(
      matchPlannedPosition(segments, timeline, 1.5, [15, 2, 0], {
        windowSeconds: 0.75,
        toleranceMillimeters: 0.5,
        ambiguitySeparationSeconds: 0.25,
        ambiguityMarginMillimeters: 0.1,
      }),
    ).toEqual({ matched: false, reason: 'outside-tolerance' })
  })

  it('rejects repeated geometry in the live matching window as ambiguous', () => {
    const repeatedSegments = new Float32Array([
      ...[0, 0, 0, 10, 0, 0, 0, 1, 600, 0.25, 0.2, 0.4, 0],
      ...[10, 0, 0, 0, 0, 0, 0, 1, 600, 0.5, 0.2, 0.4, 0],
      ...[0, 0, 0, 10, 0, 0, 0, 1, 600, 0.75, 0.2, 0.4, 0],
    ])
    expect(
      matchPlannedPosition(
        repeatedSegments,
        buildGcodeSimulationTimeline(repeatedSegments),
        1.5,
        [5, 0, 0],
        {
          windowSeconds: 1.25,
          toleranceMillimeters: 0.5,
          ambiguitySeparationSeconds: 0.25,
          ambiguityMarginMillimeters: 0.1,
        },
      ),
    ).toEqual({ matched: false, reason: 'ambiguous' })
  })
})
