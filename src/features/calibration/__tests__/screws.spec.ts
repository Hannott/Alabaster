import { describe, expect, it } from 'vitest'

import {
  configuredScrews,
  placeScrews,
  probeReferencePoint,
  screwReadings,
  turnMinutes,
  type ScrewsTiltStatus,
} from '@/features/calibration/screws'

const settings = {
  screw1: [30, 30],
  screw1_name: 'front left',
  screw2: '200, 30',
  screw2_name: 'front right',
  screw3: [200, 200],
  screw3_name: 'rear right',
  screw4: [30, 200],
  screw4_name: 'rear left',
  screw_thread: 'CW-M4',
}

const status: ScrewsTiltStatus = {
  error: false,
  maxDeviation: null,
  results: {
    screw1: { z: 2.329, sign: 'CW', adjust: '00:00', isBase: true },
    screw2: { z: 2.391, sign: 'CW', adjust: '00:15', isBase: false },
    screw3: { z: 2.351, sign: 'CCW', adjust: '00:05', isBase: false },
    screw4: { z: 2.412, sign: 'CW', adjust: '01:20', isBase: false },
  },
}

describe('bed screws from the config', () => {
  it('reads screws in order until the first gap, as pairs or "x, y" text, with Klipper’s default name', () => {
    expect(
      configuredScrews(settings).map((screw) => [screw.key, screw.name, screw.x, screw.y]),
    ).toEqual([
      ['screw1', 'front left', 30, 30],
      ['screw2', 'front right', 200, 30],
      ['screw3', 'rear right', 200, 200],
      ['screw4', 'rear left', 30, 200],
    ])
    expect(configuredScrews({ screw1: [1, 2], screw3: [3, 4] })).toEqual([
      { key: 'screw1', name: 'screw at 1.000,2.000', x: 1, y: 2 },
    ])
    expect(configuredScrews(null)).toEqual([])
  })

  it('joins the status onto the config, leaving out a screw the config no longer lists', () => {
    const readings = screwReadings(status, settings)
    expect(readings.map((screw) => [screw.name, screw.sign, screw.adjust, screw.minutes])).toEqual([
      ['front left', null, '00:00', 0],
      ['front right', 'CW', '00:15', 15],
      ['rear right', 'CCW', '00:05', 5],
      ['rear left', 'CW', '01:20', 80],
    ])
    expect(screwReadings(status, { screw1: [30, 30] })).toHaveLength(1)
    expect(turnMinutes('garbage')).toBe(0)
  })
})

describe('laying screws out as the bed', () => {
  it('puts four corner screws in a two-by-two grid, rear row first', () => {
    const layout = placeScrews(configuredScrews(settings))
    expect([layout.columns, layout.rows]).toEqual([2, 2])
    expect(layout.cells.map((cell) => [cell.screw.name, cell.column, cell.row])).toEqual([
      ['front left', 1, 2],
      ['front right', 2, 2],
      ['rear right', 2, 1],
      ['rear left', 1, 1],
    ])
  })

  it('gives a rear-centre screw its own column rather than forcing a square', () => {
    const layout = placeScrews([
      { x: 30, y: 30 },
      { x: 200, y: 30 },
      { x: 115, y: 200 },
    ])
    expect([layout.columns, layout.rows]).toEqual([3, 2])
    expect(layout.cells[2]).toMatchObject({ column: 2, row: 1 })
  })

  it('treats screws within a few millimetres as one column, whatever order they are listed in', () => {
    const layout = placeScrews([
      { x: 202, y: 200 },
      { x: 30, y: 31 },
      { x: 198, y: 28 },
      { x: 33, y: 199 },
    ])
    expect([layout.columns, layout.rows]).toEqual([2, 2])
    expect(layout.cells.map((cell) => [cell.column, cell.row])).toEqual([
      [2, 1],
      [1, 2],
      [2, 2],
      [1, 1],
    ])
  })
})

describe('where a probe procedure should stand', () => {
  const bed = { minimum: [0, 0, 0], maximum: [250, 210, 250] }

  it('prefers the mesh’s zero reference, then the safe-Z home, then the bed’s centre', () => {
    const both = (section: string) =>
      section === 'bed_mesh'
        ? { zero_reference_position: [125, 105] }
        : section === 'safe_z_home'
          ? { home_xy_position: '117.5, 117.5' }
          : null
    expect(probeReferencePoint(both, bed)).toEqual({ x: 125, y: 105 })
    const homeOnly = (section: string) =>
      section === 'safe_z_home' ? { home_xy_position: '117.5, 117.5' } : null
    expect(probeReferencePoint(homeOnly, bed)).toEqual({ x: 117.5, y: 117.5 })
    expect(probeReferencePoint(() => null, bed)).toEqual({ x: 125, y: 105 })
  })

  it('has nowhere to send the toolhead before the bed’s size is known', () => {
    expect(
      probeReferencePoint(() => null, { minimum: [null, null, null], maximum: [null, null, null] }),
    ).toBeNull()
  })
})
