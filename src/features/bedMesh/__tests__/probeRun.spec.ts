import { describe, expect, it } from 'vitest'

import {
  completedRows,
  isMeshCalibrateCommand,
  isScanningProbe,
  liveMeshGrid,
  parseProbedPoint,
  probeBedPosition,
  type ProbedPoint,
} from '@/features/bedMesh/probeRun'

function point(x: number, y: number, z: number): ProbedPoint {
  return { x, y, z }
}

describe('probe run parsing', () => {
  it("reads Klipper's wording", () => {
    expect(parseProbedPoint('probe: at 35.000,35.000 bed will contact at z=2.123750')).toEqual({
      x: 35,
      y: 35,
      z: 2.12375,
    })
  })

  it("reads Kalico's wording, which older Klipper also used", () => {
    expect(parseProbedPoint('probe at 117.500,117.500 is z=1.987000')).toEqual({
      x: 117.5,
      y: 117.5,
      z: 1.987,
    })
  })

  it('reads a line arriving with the console comment prefix', () => {
    expect(parseProbedPoint('// probe at 10.000,20.000 is z=0.500000')).toEqual({
      x: 10,
      y: 20,
      z: 0.5,
    })
  })

  it('keeps the sign of a negative coordinate or height', () => {
    expect(parseProbedPoint('probe: at -12.500,8.000 bed will contact at z=-0.042000')).toEqual({
      x: -12.5,
      y: 8,
      z: -0.042,
    })
  })

  /**
   * Fails closed. A line that is not a probe result must not become a point at
   * the origin — a phantom point at 0,0 would read as a real measurement, which
   * is worse than plotting nothing.
   */
  it('answers nothing for lines that are not probe results', () => {
    for (const line of [
      'probe: open',
      'probe: TRIGGERED',
      'Result is z=1.234000',
      'PROBE_ACCURACY at X:10.000 Y:10.000 Z:5.000',
      'Mesh Bed Leveling Complete',
      'bed_mesh: generated points',
      '',
      'z=1.0',
      'probe at nowhere is z=1.0',
    ]) {
      expect(parseProbedPoint(line), line).toBeNull()
    }
  })

  it('recognizes the command that starts a run, however it was sent', () => {
    expect(isMeshCalibrateCommand('BED_MESH_CALIBRATE')).toBe(true)
    expect(isMeshCalibrateCommand('bed_mesh_calibrate PROFILE="textured"')).toBe(true)
    // The console echoes a sent command with its own marker.
    expect(isMeshCalibrateCommand('> BED_MESH_CALIBRATE')).toBe(true)
    expect(isMeshCalibrateCommand('BED_MESH_PROFILE LOAD=default')).toBe(false)
    expect(isMeshCalibrateCommand('SCREWS_TILT_CALCULATE')).toBe(false)
  })
})

describe('probe capability', () => {
  it('knows a sweeping probe reports no per-point line', () => {
    for (const section of ['beacon', 'cartographer', 'scanner', 'probe_eddy_current']) {
      expect(
        isScanningProbe((name) => name === section),
        section,
      ).toBe(true)
    }
  })

  it('treats a touch probe as followable', () => {
    for (const section of ['probe', 'bltouch', 'smart_effector']) {
      expect(
        isScanningProbe((name) => name === section),
        section,
      ).toBe(false)
    }
  })
})

describe('probe position', () => {
  it('puts the probe where the offset says, not where the nozzle is', () => {
    expect(probeBedPosition([100, 100, 5], { x: -24, y: -14 })).toEqual({ x: 76, y: 86 })
  })

  it('has no position at all while an axis is unhomed', () => {
    expect(probeBedPosition([null, 100, 5], { x: 0, y: 0 })).toBeNull()
    expect(probeBedPosition([100, null, 5], { x: 0, y: 0 })).toBeNull()
  })
})

describe('completed rows', () => {
  it('is empty until a row is followed by a point from another row', () => {
    expect(completedRows([point(0, 0, 1), point(10, 0, 1)])).toEqual([])
  })

  it('finishes a row once a different Y arrives, and holds the new row still open', () => {
    const rows = completedRows([point(0, 0, 1), point(10, 0, 1), point(0, 10, 2)])
    expect(rows).toEqual([[point(0, 0, 1), point(10, 0, 1)]])
  })

  it('finishes each row in turn as the printer moves through several', () => {
    const rows = completedRows([
      point(0, 0, 1),
      point(10, 0, 1),
      point(10, 10, 2),
      point(0, 10, 2),
      point(0, 20, 3),
    ])
    expect(rows).toEqual([
      [point(0, 0, 1), point(10, 0, 1)],
      // Walked right-to-left, which is the point of a raster path — the row is
      // still one finished row, in whatever order Klipper visited it.
      [point(10, 10, 2), point(0, 10, 2)],
    ])
  })
})

describe('live mesh grid', () => {
  it('builds nothing from a single finished row', () => {
    expect(liveMeshGrid([point(0, 0, 1), point(10, 0, 1), point(0, 10, 2)])).toBeNull()
  })

  it('builds nothing from a row one point wide', () => {
    const points = [point(0, 0, 1), point(0, 10, 2), point(0, 20, 3)]
    expect(liveMeshGrid(points)).toBeNull()
  })

  /** The failure this fails closed on: a faulty region or adaptive mesh drops a
   * point mid-row, and building a grid from what lines up anyway would silently
   * misplace the rows that follow it. */
  it('builds nothing from rows of unequal length', () => {
    const points = [
      point(0, 0, 1),
      point(10, 0, 1),
      point(20, 0, 1),
      point(20, 10, 2),
      point(0, 10, 2),
      point(0, 20, 3),
    ]
    expect(liveMeshGrid(points)).toBeNull()
  })

  it('builds a grid from two finished rows, reading each left to right', () => {
    const points = [
      point(0, 0, 1),
      point(10, 0, 1.5),
      // Walked back the other way, as Klipper's raster path does.
      point(10, 10, 2.5),
      point(0, 10, 2),
      // The row in progress: excluded from the grid, whatever it contains.
      point(0, 20, 9),
    ]

    const grid = liveMeshGrid(points)

    expect(grid).toEqual({
      matrix: [
        [1, 1.5],
        [2, 2.5],
      ],
      area: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
    })
  })

  it('grows to a third row once it finishes, without disturbing the first two', () => {
    const points = [
      point(0, 0, 1),
      point(10, 0, 1.5),
      point(10, 10, 2.5),
      point(0, 10, 2),
      point(0, 20, 3),
      point(10, 20, 3.5),
      point(10, 30, 4),
    ]

    const grid = liveMeshGrid(points)

    expect(grid?.matrix).toEqual([
      [1, 1.5],
      [2, 2.5],
      [3, 3.5],
    ])
    expect(grid?.area).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 20 })
  })
})
