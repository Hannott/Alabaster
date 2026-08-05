/**
 * The voyage: ten seconds of voxel sea with a boat on it, and nothing else.
 *
 * This is an easter egg, reached only by typing `yarrr` into the console. It
 * exists for fun, so the one thing it must be careful about is being harmless:
 * it sends nothing to the printer, writes nothing to the module's saved
 * configuration, and leaves no trace once the ten seconds are up. Everything
 * here is a function of elapsed time, which is what lets the whole thing be
 * tested without a GPU and torn down by forgetting one ref.
 *
 * A note on the voxels. A cube has to look like a cube, and the camera does not
 * treat the three axes alike: x and y are divided by the bed's longest side
 * while z is stretched to `boxHeight` so a tenth of a millimetre of deviation
 * is visible at all. `voyageVoxel` undoes that stretch, so the vertical voxel
 * is whatever height happens to project square. It falls out of the arithmetic
 * that the sea is the same number of voxels deep whatever the height axis is
 * set to, which is why nothing here has to be re-tuned when that changes.
 *
 * Nothing here touches the DOM, WebGL, or Pinia.
 */

import { benchySize, benchyVoxels, benchyWaterline } from './benchy'
import { emptyGeometry, pushBox, type MeshGeometry, type MeshGeometryInput } from './geometry'

export const voyageDuration = 10_000
/** The sea floods in over this long, and the boat fades in with it. */
const floodDuration = 1200
/** And fades back out over this long at the end. */
const fadeDuration = 900
/**
 * Voxels across the long side of the probed area.
 *
 * This is the one number the whole scene is tuned around, and it is bounded on
 * both sides. Too many and the card — which is a couple of hundred pixels wide
 * — draws voxels a few pixels across, so the sea reads as a smooth slab and the
 * boat as a smudge. Too few and the boat runs out of headroom: the height a
 * cubic voxel has to be is fixed by the camera's stretch, so a coarser sea is
 * also a shallower box, and the chimney ends up clamped flat against the top.
 * The boat is seventeen voxels tall and three of them are under water, so the
 * box needs fourteen above the surface plus room for a crest under the keel.
 */
const seaColumns = 52
/** Crest-to-trough, in voxels. Whole voxels, because the surface is snapped. */
const waveHeight = 6
/**
 * Bed lengths a crest travels each second.
 *
 * Slow on purpose. A boat rides a wave by pitching up its face and down its
 * back, and that only reads as rocking if a crest takes a second or two to
 * pass under the hull — any quicker and the boat jitters rather than rolls.
 */
const waveSpeed = 0.16
/**
 * The three waves that are summed, as wavelengths across the bed.
 *
 * Two running in from the side and one across them. A single wave gives a
 * corrugated roof; two of different lengths give a swell that never repeats
 * the same crest twice; the third breaks the crests up along their length, so
 * the surface reads as water rather than as a rolling shutter.
 */
const waveCount = 3.1
const swellCount = 1.3
const crossCount = 2.1

type MeshArea = MeshGeometryInput['area']

export interface VoyageVoxelSize {
  /** One voxel, in bed millimetres, on each axis. */
  x: number
  y: number
  z: number
}

/**
 * The voxel that projects square.
 *
 * `boxHeight` is the height the camera gives the whole z axis in the same units
 * x and y are measured in after being divided by the bed's longest side, so the
 * ratio between them is the stretch to undo.
 */
export function voyageVoxel(area: MeshArea, zMax: number, boxHeight: number): VoyageVoxelSize {
  const width = area.maxX - area.minX
  const depth = area.maxY - area.minY
  const longest = Math.max(width, depth)
  const size = longest / seaColumns
  return { x: size, y: size, z: boxHeight > 0 ? ((size / longest) * zMax * 2) / boxHeight : size }
}

/** The boat itself lives in `benchy.ts`; this file only sails it. */
export const boatVoxels = benchyVoxels
export const boatSize = benchySize
const boatWaterline = benchyWaterline

/**
 * The height of the sea at a point, in voxels above the resting surface.
 * `across` and `along` are fractions of the bed, and the crests run in from the
 * far side across the first of them.
 */
export function voyageWaveAt(across: number, along: number, seconds: number): number {
  const travel = seconds * waveSpeed
  const first = Math.sin((across - travel) * waveCount * Math.PI * 2)
  const second = Math.sin((across - travel * 0.62) * swellCount * Math.PI * 2 + 1.1)
  const cross = Math.sin((along - travel * 0.31) * crossCount * Math.PI * 2 + 0.4)
  return ((first * 0.44 + second * 0.28 + cross * 0.28) * waveHeight) / 2
}

/** The deepest the sum above can reach, for normalising a colour against. */
const waveReach = waveHeight / 2

/**
 * How many points under the hull the boat's flotation is fitted through. Odd,
 * so the middle of the boat is one of them, and enough of them to average out
 * a ripple shorter than the boat is long.
 */
const floatSamplesAlong = 9
const floatSamplesAcross = 5

export interface VoyageFrame {
  sea: MeshGeometry
  boat: MeshGeometry
  /** The boat materialises over the flood and dissolves at the end. */
  boatOpacity: number
  finished: boolean
}

export interface VoyageInput {
  area: MeshArea
  zMax: number
  boxHeight: number
  elapsed: number
  /**
   * With reduced motion the sea is flat and the boat sits still. The scene is
   * still shown for its full run — cutting it short would be a flash, which
   * ADR 0004 rules out as firmly as it rules out the movement.
   */
  stillness?: boolean
  /**
   * Where on the deviation ramp the sea is coloured from: the value a trough
   * takes and the value a crest takes.
   *
   * The ramp is diverging — deep blue through white to orange — because that is
   * what a bed that is high in one place and low in another needs. A sea is not
   * that: it wants one hue getting deeper, so it is given the negative half of
   * the ramp and nothing else, which is a smooth run from deep blue to white
   * without ever crossing into the warm end.
   */
  colour?: { trough: number; crest: number }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

export function buildVoyageFrame(input: VoyageInput): VoyageFrame {
  const { area, zMax, boxHeight } = input
  const elapsed = clamp(input.elapsed, 0, voyageDuration)
  const voxel = voyageVoxel(area, zMax, boxHeight)
  const width = area.maxX - area.minX
  const depth = area.maxY - area.minY
  const columns = Math.max(2, Math.round(width / voxel.x))
  const rows = Math.max(2, Math.round(depth / voxel.y))
  const cellX = width / columns
  const cellY = depth / rows
  const seconds = input.stillness ? 0 : elapsed / 1000

  // The flood, then the voyage, then the fade. The sea rises to its resting
  // level before any wave moves, so the first thing seen is the bed filling
  // rather than a sea that was always there.
  const flood = clamp(elapsed / floodDuration, 0, 1)
  const level = -zMax + zMax * flood
  const swell = flood * clamp((voyageDuration - elapsed) / fadeDuration, 0, 1)
  const boatOpacity =
    clamp((elapsed - floodDuration * 0.35) / (floodDuration * 0.65), 0, 1) *
    clamp((voyageDuration - elapsed) / fadeDuration, 0, 1)

  const sea = emptyGeometry()
  const surfaceAt = (x: number, y: number): number => {
    if (flood < 1) return level
    // Across the bed from the far side, so the crests roll towards the viewer,
    // and along it for the cross-swell that breaks those crests up.
    const across = (area.maxX - x) / Math.max(1e-6, width)
    const along = (y - area.minY) / Math.max(1e-6, depth)
    const raw = voyageWaveAt(across, along, seconds) * voxel.z * swell
    // Snapped to the voxel, which is what makes it a voxel sea rather than a
    // smooth surface with square columns under it.
    return Math.round(raw / voxel.z) * voxel.z
  }

  // One hue getting deeper, not the diverging ramp: a trough takes the far end
  // of the blue and a crest comes back to the neutral middle, so the swell
  // reads as water rather than as a bed that is wrong in two directions.
  const trough = input.colour?.trough ?? -1
  const crest = input.colour?.crest ?? 0
  const inkFor = (top: number): number => {
    const reach = waveReach * voxel.z
    const risen = reach > 0 ? clamp((top + reach) / (reach * 2), 0, 1) : 0.5
    return trough + (crest - trough) * risen
  }

  for (let row = 0; row < rows; row += 1) {
    const y = area.minY + (row + 0.5) * cellY
    for (let column = 0; column < columns; column += 1) {
      const x = area.minX + (column + 0.5) * cellX
      const top = surfaceAt(x, y)
      pushBox(sea, area, x, y, cellX / 2, cellY / 2, -zMax, top, inkFor(top))
    }
  }

  const boat = emptyGeometry()
  if (boatOpacity > 0) {
    const centreX = (area.minX + area.maxX) / 2
    const centreY = (area.minY + area.maxY) / 2
    const originX = centreX - (boatSize.x / 2) * voxel.x
    const originY = centreY - (boatSize.y / 2) * voxel.y
    // A hull does not balance on the water under its middle: it sits on the
    // average of everything under it, and leans with the average slope. Taking
    // the height at the bow and at the stern instead is what it looks like when
    // you get this wrong — the boat is longer than a wavelength, so those two
    // points sample the same part of two different waves and the tilt comes out
    // stuck one way. Fitting a plane through the whole footprint averages the
    // chop out and leaves the swell, which is what a boat actually answers to.
    //
    // Pitch and roll are then applied as shears rather than rotations: at this
    // size the two are indistinguishable, and a shear keeps every voxel a
    // screen-aligned box, which is the whole reason the boxes are cheap.
    const lengthwise = boatSize.x * voxel.x
    const abeam = boatSize.y * voxel.y
    let sumHeight = 0
    let sumAlong = 0
    let sumAlongSquared = 0
    let sumAcross = 0
    let sumAcrossSquared = 0
    let samples = 0
    for (let step = 0; step < floatSamplesAlong; step += 1) {
      const offsetX = (step / (floatSamplesAlong - 1) - 0.5) * lengthwise
      for (let lane = 0; lane < floatSamplesAcross; lane += 1) {
        const offsetY = (lane / (floatSamplesAcross - 1) - 0.5) * abeam
        const height = surfaceAt(centreX + offsetX, centreY + offsetY)
        sumHeight += height
        sumAlong += offsetX * height
        sumAlongSquared += offsetX * offsetX
        sumAcross += offsetY * height
        sumAcrossSquared += offsetY * offsetY
        samples += 1
      }
    }
    // The offsets are symmetric about zero, so the least-squares slope through
    // them is just the cross term over the square term.
    const float = sumHeight / samples
    const pitch = sumAlongSquared > 0 ? sumAlong / sumAlongSquared : 0
    const roll = sumAcrossSquared > 0 ? sumAcross / sumAcrossSquared : 0

    for (const cell of boatVoxels) {
      const x = originX + (cell.x + 0.5) * voxel.x
      const y = originY + (cell.y + 0.5) * voxel.y
      const lift = float + (x - centreX) * pitch + (y - centreY) * roll
      const bottom = lift + (cell.z - boatWaterline) * voxel.z
      pushBox(
        boat,
        // Its own bounds: a boat riding a crest at the edge of the bed must not
        // be sliced off by the probed area the sea is drawn in.
        { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity },
        x,
        y,
        voxel.x / 2,
        voxel.y / 2,
        bottom,
        bottom + voxel.z,
        bottom + voxel.z,
      )
    }
  }

  return { sea, boat, boatOpacity, finished: elapsed >= voyageDuration }
}
