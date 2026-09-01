/**
 * The geometry behind Movement's bed plan: a top-down picture of the build
 * volume that the toolhead's position is drawn onto and a tap is read back
 * out of.
 *
 * Kept pure and free of Vue so it can be tested without mounting anything,
 * and because every one of these conversions is the kind that looks right on
 * screen while being subtly wrong — a flipped axis puts the nozzle at the
 * front when it is at the back, and a missing clamp turns a fat-fingered tap
 * near the edge into a move the printer refuses.
 */

export interface BedExtents {
  minimumX: number
  maximumX: number
  minimumY: number
  maximumY: number
  /** Travel in each axis, which is also the plot's aspect ratio. */
  width: number
  depth: number
}

/** A position on the plot, as a fraction of its box from the top-left. */
export interface PlanPoint {
  x: number
  y: number
}

export interface BedCoordinate {
  x: number
  y: number
}

type Extent = readonly (number | null)[]

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * The volume the printer has actually reported, or null.
 *
 * Null rather than a default, for the same reason parking derives its
 * coordinates from the reported volume instead of a constant: a plan drawn to
 * a guessed bed size would put the nozzle marker somewhere plausible and
 * wrong, and a tap on it would command a move to a coordinate that was never
 * on this machine. The card draws nothing until Klipper has said how big the
 * bed is.
 *
 * A zero or negative span is treated the same way. It is not a bed, and it
 * would divide by zero in every conversion below.
 */
export function bedExtents(minimum: Extent, maximum: Extent): BedExtents | null {
  const minimumX = finite(minimum[0])
  const minimumY = finite(minimum[1])
  const maximumX = finite(maximum[0])
  const maximumY = finite(maximum[1])
  if (minimumX === null || minimumY === null || maximumX === null || maximumY === null) return null

  const width = maximumX - minimumX
  const depth = maximumY - minimumY
  if (width <= 0 || depth <= 0) return null

  return { minimumX, maximumX, minimumY, maximumY, width, depth }
}

/**
 * Where a machine coordinate falls on the plot, as fractions from the
 * top-left corner.
 *
 * Y is inverted because the two axes disagree about direction: the bed's Y
 * grows toward the back of the printer, and every screen coordinate system
 * grows downward. Without the flip the marker mirrors front-to-back, which is
 * the one error a picture of the bed must not make — it reads as correct right
 * up until someone uses it to reach into the machine.
 *
 * Deliberately not clamped. A toolhead really can sit outside the reported
 * volume — a negative-origin machine, a bed mesh that probes past the travel
 * limits — and pinning the marker to the edge would report it as being
 * somewhere it is not. The caller draws the plot with its overflow hidden, so
 * a position off the bed reads as off the bed.
 */
export function planPoint(coordinate: BedCoordinate, extents: BedExtents): PlanPoint {
  return {
    x: (coordinate.x - extents.minimumX) / extents.width,
    y: 1 - (coordinate.y - extents.minimumY) / extents.depth,
  }
}

/**
 * The machine coordinate a point on the plot stands for — the inverse of
 * `planPoint`, and clamped where that one is not.
 *
 * Clamping is right in this direction and wrong in the other. This value
 * becomes a move the printer is asked to make, and a tap a pixel outside the
 * plot, or on the border itself, would otherwise ask for a coordinate outside
 * the travel limits, which Klipper refuses with a command error. The user
 * aiming at the far edge of the bed means the far edge of the bed.
 */
export function planCoordinate(point: PlanPoint, extents: BedExtents): BedCoordinate {
  const fractionX = Math.min(1, Math.max(0, point.x))
  const fractionY = Math.min(1, Math.max(0, point.y))
  return {
    x: extents.minimumX + fractionX * extents.width,
    y: extents.minimumY + (1 - fractionY) * extents.depth,
  }
}

/**
 * A coordinate nudged by a step in machine units, kept inside the volume.
 *
 * The keyboard path onto the plot. It steps in millimetres rather than in
 * fractions of the box so that one press means the same distance whatever
 * size the card is — the same reason the jog buttons are labeled with
 * distances rather than with proportions of an axis.
 */
export function nudgeCoordinate(
  coordinate: BedCoordinate,
  deltaX: number,
  deltaY: number,
  extents: BedExtents,
): BedCoordinate {
  return {
    x: Math.min(extents.maximumX, Math.max(extents.minimumX, coordinate.x + deltaX)),
    y: Math.min(extents.maximumY, Math.max(extents.minimumY, coordinate.y + deltaY)),
  }
}
