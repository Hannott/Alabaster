import { describe, expect, it } from 'vitest'

import {
  buildGcodeSimulationTimeline,
  sampleGcodeSimulation,
  sampleGcodeSimulationAtTime,
  simulationTimeForCursor,
} from '@/features/gcode/simulation'

// One row per segment: startXYZ, endXYZ, layer, kind, feedrate, progress,
// extrusionHeight, extrusionWidth.
const segments = new Float32Array([
  ...[0, 0, 0, 10, 0, 0, 0, 1, 1_200, 0.25, 0.2, 0.4, 0],
  ...[10, 0, 0, 10, 10, 2, 1, 1, 1_200, 0.75, 0.2, 0.4, 0],
])

describe('G-code simulation sampling', () => {
  it('interpolates within a move without stepping the toolhead', () => {
    expect(sampleGcodeSimulation(segments, 0.5)).toMatchObject({
      move: 0,
      layer: 0,
      progress: 0.125,
      position: [5, 0, 0],
    })
    expect(sampleGcodeSimulation(segments, 1.5)).toMatchObject({
      move: 1,
      layer: 1,
      progress: 0.5,
      position: [10, 5, 1],
    })
  })

  it('clamps the cursor and reaches the final endpoint', () => {
    expect(sampleGcodeSimulation(segments, 99)).toMatchObject({
      cursor: 2,
      move: 2,
      progress: 0.75,
      position: [10, 10, 2],
    })
    expect(sampleGcodeSimulation(new Float32Array(), 0)).toBeNull()
  })

  it('uses commanded feedrates for real-time playback and interpolates continuously', () => {
    const timeline = buildGcodeSimulationTimeline(segments)
    const secondMoveMidpoint = 0.5 + Math.hypot(10, 2) / 40

    expect(timeline.totalSeconds).toBeCloseTo(0.5 + Math.hypot(10, 2) / 20)
    expect(sampleGcodeSimulationAtTime(segments, timeline, 0.25)).toMatchObject({
      cursor: 0.5,
      position: [5, 0, 0],
    })
    expect(sampleGcodeSimulationAtTime(segments, timeline, secondMoveMidpoint)).toMatchObject({
      cursor: 1.5,
      position: [10, 5, 1],
    })
    expect(simulationTimeForCursor(timeline, 1.5)).toBeCloseTo(secondMoveMidpoint)
  })
})
