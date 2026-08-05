/**
 * What the extruder is doing right now, derived from `motion_report`.
 *
 * Klipper reports `live_extruder_velocity` in millimetres of *filament* per
 * second. The number people specify hotends in is millimetres *cubed* per
 * second, and converting between them needs the filament's cross-section —
 * which is a property of the material on the spool, not of the printer, and
 * therefore something Alabaster either knows or does not.
 */

/**
 * Below this the extruder is not meaningfully turning. `motion_report` reports
 * small nonzero values as a move settles, and a reading that flickers between
 * "moving" and "idle" on the tail of every move is worse than no reading — the
 * eye is drawn to the change rather than to the value.
 */
const movingThresholdMmPerSecond = 0.05

/** Whether the extruder is turning, in either direction. */
export function isExtruderMoving(velocityMmPerSecond: number): boolean {
  return (
    Number.isFinite(velocityMmPerSecond) &&
    Math.abs(velocityMmPerSecond) >= movingThresholdMmPerSecond
  )
}

/**
 * Volumetric flow in mm³/s, or null when it cannot be derived.
 *
 * Null rather than a guess: 1.75 mm is a default, not a fact. Flow scales with
 * the square of the diameter, so assuming 1.75 on a 2.85 mm machine
 * under-reports by a factor of 2.65 — the real flow is 165% higher than the
 * number shown. That is a wrong number in the units people compare against a
 * hotend's rated limit, which is exactly the reading someone would act on. The diameter comes from the active spool's filament, so a
 * printer with no Spoolman, no active spool, or a spool whose filament has no
 * diameter recorded gets no flow reading at all. Bed mesh takes the same
 * posture with a profile that has no probe temperature on record.
 *
 * The sign is kept. A retract reports negative velocity and therefore negative
 * flow, which is how the reading tells a retract apart from an extrude rather
 * than showing both as the same positive number.
 */
export function volumetricFlow(
  velocityMmPerSecond: number,
  filamentDiameterMm: number | null | undefined,
): number | null {
  if (!Number.isFinite(velocityMmPerSecond)) return null
  if (typeof filamentDiameterMm !== 'number') return null
  if (!Number.isFinite(filamentDiameterMm) || filamentDiameterMm <= 0) return null

  const radius = filamentDiameterMm / 2
  return velocityMmPerSecond * Math.PI * radius * radius
}

/**
 * How far a manual extrude actually travels once it leaves the nozzle, in mm.
 *
 * Volume is conserved between the filament fed in and the bead pushed out, so
 * the length ratio is the inverse square of the diameter ratio — a thin nozzle
 * turns a short push of thick filament into a much longer, thinner bead. Null
 * without both diameters on record, for the same reason `volumetricFlow`
 * refuses to guess one: assuming 1.75 mm filament through an unknown nozzle
 * would be a fabricated number dressed as a measurement.
 */
export function extrudedBeadLength(
  filamentLengthMm: number,
  filamentDiameterMm: number | null | undefined,
  nozzleDiameterMm: number | null | undefined,
): number | null {
  if (!Number.isFinite(filamentLengthMm) || filamentLengthMm <= 0) return null
  if (typeof filamentDiameterMm !== 'number') return null
  if (!Number.isFinite(filamentDiameterMm) || filamentDiameterMm <= 0) return null
  if (typeof nozzleDiameterMm !== 'number') return null
  if (!Number.isFinite(nozzleDiameterMm) || nozzleDiameterMm <= 0) return null

  return filamentLengthMm * (filamentDiameterMm / nozzleDiameterMm) ** 2
}
