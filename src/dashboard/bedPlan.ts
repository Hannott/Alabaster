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

/**
 * Whether the machine's usable X/Y area is the rectangle Klipper reports, or
 * the circle inscribed in it. Delta, rotary delta and polar kinematics all
 * move within a circle, but `toolhead.axis_minimum`/`axis_maximum` only ever
 * carries the square bounding box around it — Klipper has no notification
 * that reports the shape directly, so the caller supplies it from
 * `usePrinterConfigStore`'s `bedShape`, which reads `kinematics` for exactly
 * this reason.
 */
export type BedShape = 'rectangular' | 'circular'

export interface BedExtents {
  minimumX: number
  maximumX: number
  minimumY: number
  maximumY: number
  /** Travel in each axis, which is also the plot's aspect ratio. */
  width: number
  depth: number
  shape: BedShape
  /**
   * The circle's own center and radius, derived from the reported bounding
   * box rather than read from config. Always computed, even for a rectangular
   * bed, so a caller never has to guard a read on `shape` first — only
   * `shape` decides whether clamping and drawing treat them as meaningful.
   * `radius` is the *shorter* half-span rather than assuming a perfectly
   * square report, so a printer whose reported box is off by a rounding error
   * still gets a circle that fits inside it rather than one that pokes past
   * one side.
   */
  centerX: number
  centerY: number
  radius: number
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
 *
 * `shape` defaults to rectangular so every existing caller — the ones that
 * have not been given a printer's kinematics, such as the exclude-object
 * scatter — keeps its current behavior unchanged rather than needing to pass
 * one it does not have.
 */
export function bedExtents(
  minimum: Extent,
  maximum: Extent,
  shape: BedShape = 'rectangular',
): BedExtents | null {
  const minimumX = finite(minimum[0])
  const minimumY = finite(minimum[1])
  const maximumX = finite(maximum[0])
  const maximumY = finite(maximum[1])
  if (minimumX === null || minimumY === null || maximumX === null || maximumY === null) return null

  const width = maximumX - minimumX
  const depth = maximumY - minimumY
  if (width <= 0 || depth <= 0) return null

  return {
    minimumX,
    maximumX,
    minimumY,
    maximumY,
    width,
    depth,
    shape,
    centerX: (minimumX + maximumX) / 2,
    centerY: (minimumY + maximumY) / 2,
    radius: Math.min(width, depth) / 2,
  }
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
 * A coordinate pulled back to the nearest point Klipper's kinematics can
 * actually reach, for a circular bed — the shared last step of both
 * `planCoordinate` and `nudgeCoordinate`, which otherwise clamp to the
 * reported bounding box's straight edges. It moves a coordinate outside the
 * circle in along the ray from the bed's center, so a tap in a corner lands
 * on the circle's edge nearest that corner rather than on the unreachable
 * corner itself. That is the one case a rectangular clamp gets wrong for
 * delta and polar kinematics: Klipper does not refuse the move with a command
 * error the way it does past a linear axis's travel limit, it simply cannot
 * complete it, so letting a tap through to a corner would ask for a move the
 * machine can never finish.
 */
function clampToCircle(coordinate: BedCoordinate, extents: BedExtents): BedCoordinate {
  const dx = coordinate.x - extents.centerX
  const dy = coordinate.y - extents.centerY
  const distance = Math.hypot(dx, dy)
  if (distance <= extents.radius) return coordinate
  const scale = extents.radius / distance
  return { x: extents.centerX + dx * scale, y: extents.centerY + dy * scale }
}

/**
 * The machine coordinate a point on the plot stands for — the inverse of
 * `planPoint`, and clamped where that one is not.
 *
 * Clamping is right in this direction and wrong in the other. This value
 * becomes a move the printer is asked to make, and a tap a pixel outside the
 * plot, or on the border itself, would otherwise ask for a coordinate outside
 * the travel limits, which Klipper refuses with a command error. The user
 * aiming at the far edge of the bed means the far edge of the bed — the
 * nearest point the kinematics can reach, along the ray from where they
 * pointed, whichever shape that edge is.
 */
export function planCoordinate(point: PlanPoint, extents: BedExtents): BedCoordinate {
  const fractionX = Math.min(1, Math.max(0, point.x))
  const fractionY = Math.min(1, Math.max(0, point.y))
  const coordinate = {
    x: extents.minimumX + fractionX * extents.width,
    y: extents.minimumY + (1 - fractionY) * extents.depth,
  }
  return extents.shape === 'circular' ? clampToCircle(coordinate, extents) : coordinate
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
  const moved = { x: coordinate.x + deltaX, y: coordinate.y + deltaY }
  if (extents.shape === 'circular') return clampToCircle(moved, extents)
  return {
    x: Math.min(extents.maximumX, Math.max(extents.minimumX, moved.x)),
    y: Math.min(extents.maximumY, Math.max(extents.minimumY, moved.y)),
  }
}
