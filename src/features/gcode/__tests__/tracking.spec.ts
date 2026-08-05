import { describe, expect, it } from 'vitest'

import { currentGcodeLayer, gcodeLayerAtProgress } from '@/features/gcode/tracking'

const segments = new Float32Array([
  ...[0, 0, 0.2, 1, 0, 0.2, 0, 1, 1_200, 0.2, 0.2, 0.4, 0],
  ...[1, 0, 0.2, 2, 0, 0.2, 0, 1, 1_200, 0.4, 0.2, 0.4, 0],
  ...[2, 0, 0.4, 3, 0, 0.4, 1, 1, 1_200, 0.7, 0.2, 0.4, 0],
  ...[3, 0, 0.6, 4, 0, 0.6, 2, 1, 1_200, 0.9, 0.2, 0.4, 0],
])

describe('current G-code layer tracking', () => {
  it('finds the layer at the raw full-file progress frontier', () => {
    expect(gcodeLayerAtProgress(segments, 0.1, 3)).toBe(0)
    expect(gcodeLayerAtProgress(segments, 0.5, 3)).toBe(1)
    expect(gcodeLayerAtProgress(segments, 0.8, 3)).toBe(2)
  })

  it('prefers Klipper current-layer information and converts its one-based value', () => {
    expect(currentGcodeLayer(segments, 3, 1, 0.8)).toBe(0)
    expect(currentGcodeLayer(segments, 3, 2, 0.1)).toBe(1)
    expect(currentGcodeLayer(segments, 3, 99, 0.1)).toBe(2)
    expect(currentGcodeLayer(segments, 3, 0, 0.8)).toBe(0)
  })

  it('falls back to file progress when the slicer did not report a layer', () => {
    expect(currentGcodeLayer(segments, 3, null, 0.75)).toBe(2)
    expect(currentGcodeLayer(new Float32Array(), 0, null, 0.75)).toBe(0)
  })
})
