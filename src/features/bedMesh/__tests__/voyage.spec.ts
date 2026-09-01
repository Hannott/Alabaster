import { describe, expect, it } from 'vitest'

import {
  boatSize,
  boatVoxels,
  buildVoyageFrame,
  voyageDuration,
  voyageVoxel,
  voyageWaveAt,
  type VoyageInput,
} from '@/features/bedMesh/voyage'

const area = { minX: 0, minY: 0, maxX: 276, maxY: 230 }
const zMax = 0.5
/** What the camera gives this bed's height axis; see `meshHeightAgainstBed`. */
const boxHeight = (230 / 276) * 0.85

function frameAt(elapsed: number, overrides: Partial<VoyageInput> = {}) {
  return buildVoyageFrame({ area, zMax, boxHeight, elapsed, ...overrides })
}

function heightsOf(geometry: { positions: number[] }) {
  const heights: number[] = []
  for (let index = 2; index < geometry.positions.length; index += 3) {
    heights.push(geometry.positions[index] ?? 0)
  }
  return heights
}

describe('the voyage', () => {
  it('cuts a voxel that projects square, not one that measures square', () => {
    // x and y are divided by the bed's longest side while z is squeezed into
    // boxHeight, so a cube in millimetres would draw as a tall slab. What has
    // to match is the size on screen.
    const voxel = voyageVoxel(area, zMax, boxHeight)
    const onScreenX = voxel.x / 276
    const onScreenZ = (voxel.z / zMax) * (boxHeight / 2)
    expect(onScreenZ).toBeCloseTo(onScreenX, 9)
  })

  it('keeps the sea the same depth in voxels whatever the height axis is set to', () => {
    // Otherwise every change to the height setting would need the wave heights
    // and the boat retuned against it.
    const shallow = voyageVoxel(area, 0.2, boxHeight)
    const deep = voyageVoxel(area, 2, boxHeight)
    expect(0.2 / shallow.z).toBeCloseTo(2 / deep.z, 6)
  })

  it('floods from the floor up to the resting surface before any wave moves', () => {
    const floor = heightsOf(frameAt(0).sea)
    expect(Math.max(...floor)).toBeCloseTo(-zMax, 6)

    const rising = heightsOf(frameAt(600).sea)
    expect(Math.max(...rising)).toBeGreaterThan(-zMax)
    expect(Math.max(...rising)).toBeLessThan(0)
    // Still level: the sea is filling, not yet running.
    const tops = rising.filter((height) => height > -zMax)
    expect(new Set(tops.map((height) => height.toFixed(9))).size).toBe(1)
  })

  it('starts the water at the floor of the box, never below it', () => {
    // Anything past the height axis is clamped by the shader, so a sea floor
    // outside the box would be silently flattened onto it — and the box's own
    // grid would then show through the water.
    for (const elapsed of [0, 2000, 5000, 9000]) {
      expect(Math.min(...heightsOf(frameAt(elapsed).sea))).toBeCloseTo(-zMax, 6)
    }
  })

  it('rolls the waves in from one side rather than heaving the whole sea', () => {
    const later = frameAt(4000).sea
    const heights = heightsOf(later)
    expect(new Set(heights.map((height) => height.toFixed(6))).size).toBeGreaterThan(2)
  })

  it('snaps the surface to the voxel, which is what makes it a voxel sea', () => {
    const voxel = voyageVoxel(area, zMax, boxHeight)
    for (const height of heightsOf(frameAt(4000).sea)) {
      if (Math.abs(height + zMax) < 1e-9) continue
      const steps = height / voxel.z
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6)
    }
  })

  it('moves the crests across the bed as time passes', () => {
    const early = voyageWaveAt(0.5, 0.5, 3)
    const later = voyageWaveAt(0.5, 0.5, 3.4)
    expect(early).not.toBeCloseTo(later, 6)
  })

  it('breaks the crests up along their length rather than corrugating the bed', () => {
    // One wave gives a rolling shutter. What makes it read as water is that a
    // crest is not the same height all the way along it.
    const nearEdge = voyageWaveAt(0.5, 0.1, 3)
    const farEdge = voyageWaveAt(0.5, 0.9, 3)
    expect(nearEdge).not.toBeCloseTo(farEdge, 3)
  })

  it('colors the sea along one hue rather than across the diverging ramp', () => {
    // The bed's ramp runs deep blue through white to orange, because a bed can
    // be wrong in two directions. A sea cannot, and a swell that went orange at
    // the crests would read as a fault rather than as water.
    const built = buildVoyageFrame({
      area,
      zMax,
      boxHeight,
      elapsed: 4000,
      color: { trough: -0.1, crest: 0 },
    })
    expect(built.sea.deviations.length).toBeGreaterThan(0)
    for (const ink of built.sea.deviations) {
      expect(ink).toBeLessThanOrEqual(0)
      expect(ink).toBeGreaterThanOrEqual(-0.1)
    }
    // And it actually uses the range, rather than sitting at one end of it.
    expect(Math.min(...built.sea.deviations)).toBeLessThan(-0.05)
    expect(Math.max(...built.sea.deviations)).toBeGreaterThan(-0.05)
  })

  it('gives a trough the deep end of that hue and a crest the pale end', () => {
    const built = buildVoyageFrame({
      area,
      zMax,
      boxHeight,
      elapsed: 4000,
      color: { trough: -0.1, crest: 0 },
    })
    // Every box carries one height and one color, eight corners each.
    let lowest = { top: Infinity, ink: 0 }
    let highest = { top: -Infinity, ink: 0 }
    for (let index = 0; index < built.sea.deviations.length; index += 8) {
      const top = built.sea.positions[index * 3 + 3 * 4 + 2] ?? 0
      const ink = built.sea.deviations[index] ?? 0
      if (top < lowest.top) lowest = { top, ink }
      if (top > highest.top) highest = { top, ink }
    }
    expect(lowest.ink).toBeLessThan(highest.ink)
  })

  it('rides the boat on the water rather than through it', () => {
    // The hull sits at the surface at every moment of the crossing, which is
    // the whole illusion — a boat at a fixed height would have the sea pass
    // through it twice a wavelength.
    const seen: number[] = []
    for (const elapsed of [2000, 3000, 4000, 5000, 6000, 7000]) {
      const built = frameAt(elapsed)
      seen.push(Math.min(...heightsOf(built.boat)))
    }
    expect(new Set(seen.map((height) => height.toFixed(6))).size).toBeGreaterThan(2)
  })

  it('rocks the boat rather than sliding it up and down flat', () => {
    // A hull that answers only the height under its middle reads as a card on
    // a lift. What makes it a boat is that the bow and the stern are at
    // different heights, and that which of them is higher keeps changing.
    const tiltAt = (elapsed: number) => {
      const built = frameAt(elapsed)
      let bow = { x: -Infinity, z: 0 }
      let stern = { x: Infinity, z: 0 }
      for (let index = 0; index < built.boat.positions.length; index += 3) {
        const x = built.boat.positions[index] ?? 0
        const z = built.boat.positions[index + 2] ?? 0
        if (x > bow.x) bow = { x, z }
        if (x < stern.x) stern = { x, z }
      }
      return bow.z - stern.z
    }
    const tilts = [2500, 3500, 4500, 5500, 6500, 7500].map(tiltAt)
    // Measured against its own average rather than against zero: the boat is
    // not symmetric, so a level hull does not read as a tilt of nothing. What
    // has to be true is that the lean keeps changing and changes direction.
    const mean = tilts.reduce((total, tilt) => total + tilt, 0) / tilts.length
    const swing = tilts.map((tilt) => tilt - mean)
    expect(Math.max(...swing)).toBeGreaterThan(0)
    expect(Math.min(...swing)).toBeLessThan(0)
    // And by enough to see: more than a whole voxel of difference bow to stern.
    const voxel = voyageVoxel(area, zMax, boxHeight)
    expect(Math.max(...swing) - Math.min(...swing)).toBeGreaterThan(voxel.z)
  })

  it('gives a crest time to pass under the hull, rather than strobing past it', () => {
    // Measured rather than restated from the tuning constants: what matters is
    // how long the water under one spot takes to go from one crest to the next,
    // and that comes out of all three waves together. Under about a second the
    // boat jitters instead of rolling.
    const crests: number[] = []
    let previous = voyageWaveAt(0.5, 0.5, 0)
    let rising = false
    for (let seconds = 0.02; seconds < 20; seconds += 0.02) {
      const height = voyageWaveAt(0.5, 0.5, seconds)
      if (rising && height < previous) crests.push(seconds)
      rising = height > previous
      previous = height
    }
    expect(crests.length).toBeGreaterThan(1)
    const gaps = crests.slice(1).map((at, index) => at - (crests[index] ?? 0))
    expect(Math.min(...gaps)).toBeGreaterThan(1)
  })

  it('materialises the boat and dissolves it again, rather than cutting it in', () => {
    expect(frameAt(0).boatOpacity).toBe(0)
    expect(frameAt(1400).boatOpacity).toBeCloseTo(1, 6)
    expect(frameAt(voyageDuration - 450).boatOpacity).toBeGreaterThan(0)
    expect(frameAt(voyageDuration - 450).boatOpacity).toBeLessThan(1)
    expect(frameAt(voyageDuration).boatOpacity).toBe(0)
  })

  it('builds no boat at all while it is invisible', () => {
    expect(frameAt(0).boat.positions).toEqual([])
    expect(frameAt(voyageDuration).boat.positions).toEqual([])
  })

  it('reports itself finished exactly once the ten seconds are up', () => {
    expect(frameAt(voyageDuration - 1).finished).toBe(false)
    expect(frameAt(voyageDuration).finished).toBe(true)
    // And survives a caller that hands it an elapsed time past the end.
    expect(frameAt(voyageDuration * 5).finished).toBe(true)
  })

  it('holds the sea still under reduced motion, without cutting the scene short', () => {
    // A frozen seascape, not a flat plate: what reduced motion asks for is that
    // nothing moves, and ADR 0004 rules out the flash as firmly as it rules out
    // the movement — so the scene still runs its full length.
    const early = frameAt(3000, { stillness: true })
    const late = frameAt(8000, { stillness: true })
    expect(heightsOf(late.sea)).toEqual(heightsOf(early.sea))
    expect(heightsOf(late.boat)).toEqual(heightsOf(early.boat))
    // Still a sea with shape in it, not a level surface.
    expect(new Set(heightsOf(early.sea).map((height) => height.toFixed(6))).size).toBeGreaterThan(2)
    expect(early.boatOpacity).toBeCloseTo(1, 6)
    expect(late.finished).toBe(false)
  })

  it('kept the features that survive being voxelised at this size', () => {
    // The model is sampled from the real thing, so these are checks that the
    // sampling did not smooth away what makes it recognisable — not a
    // description of a shape anyone chose. A center-only test drops every wall
    // thinner than a voxel and produces a hull with no cabin on it, which is
    // exactly the failure that would still pass a "does it have some voxels"
    // assertion.
    expect(boatSize).toEqual({ x: 21, y: 11, z: 17 })
    const solid = new Set(boatVoxels.map((voxel) => `${voxel.x},${voxel.y},${voxel.z}`))
    const at = (x: number, y: number, z: number) => solid.has(`${x},${y},${z}`)

    // The doorway through the aft face of the cabin, arched over above it.
    expect(at(7, 5, 9)).toBe(false)
    expect(at(7, 3, 9)).toBe(true)
    expect(at(7, 7, 9)).toBe(true)
    expect(at(7, 5, 11)).toBe(true)

    // The cabin is hollow, rather than a solid block with a doorway drawn on.
    expect(at(10, 5, 10)).toBe(false)
    expect(at(10, 5, 13)).toBe(true)

    // The chimney, standing alone above the cabin roof.
    const stationsAt = (z: number) =>
      new Set(boatVoxels.filter((voxel) => voxel.z === z).map((voxel) => voxel.x))
    expect(stationsAt(13).size).toBeGreaterThan(6)
    expect(stationsAt(16).size).toBeLessThan(4)
    expect([...stationsAt(16)].every((x) => stationsAt(13).has(x))).toBe(true)
  })

  it('shapes a hull rather than a box, and points it at one end', () => {
    const beamAt = (x: number, z: number) =>
      boatVoxels.filter((voxel) => voxel.x === x && voxel.z === z).length
    // Narrower at the keel than at the waterline: a hull, not a slab.
    expect(beamAt(8, 0)).toBeLessThan(beamAt(8, 2))
    // And narrowing towards the bow, which is the end the waves reach first.
    expect(beamAt(17, 2)).toBeLessThan(beamAt(8, 2))
    expect(beamAt(19, 2)).toBeLessThan(beamAt(17, 2))
  })

  it('keeps the whole boat inside the box the camera draws', () => {
    // Anything past the height axis is clamped flat by the shader, so a funnel
    // with no headroom is silently squashed into the roof. The boat has to fit
    // between the waterline and the top even when it is on a crest.
    const voxel = voyageVoxel(area, zMax, boxHeight)
    for (const elapsed of [2000, 3500, 5000, 6500, 8000]) {
      const heights = heightsOf(frameAt(elapsed).boat)
      expect(Math.max(...heights), `${elapsed} ms`).toBeLessThan(zMax)
      expect(Math.min(...heights), `${elapsed} ms`).toBeGreaterThan(-zMax)
    }
    expect(voxel.z).toBeGreaterThan(0)
  })

  it('keeps every boat voxel its full size, rather than shaving it at the edges', () => {
    // The sea is clipped to the probed area, because a column of water outside
    // it would claim a reading for bed that was never measured. The boat is not
    // a reading, so it must not inherit that clipping — a hull trimmed square
    // against an invisible boundary is the failure this catches.
    const voxel = voyageVoxel(area, zMax, boxHeight)
    const built = frameAt(4000)
    // Eight corners a box, three floats a corner; the first and second corners
    // are the near edge, left then right.
    for (let index = 0; index < built.boat.positions.length; index += 24) {
      const left = built.boat.positions[index] ?? 0
      const right = built.boat.positions[index + 3] ?? 0
      expect(right - left).toBeCloseTo(voxel.x, 9)
    }
  })
})
