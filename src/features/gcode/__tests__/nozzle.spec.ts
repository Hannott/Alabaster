import { describe, expect, it } from 'vitest'

import {
  nozzleFaces,
  nozzleHeight,
  nozzleNutBottomZ,
  nozzleNutTopZ,
  nozzleTipRadius,
  visibleNozzleFaces,
} from '@/features/gcode/nozzle'

function length(vector: readonly [number, number, number]): number {
  return Math.hypot(vector[0], vector[1], vector[2])
}

describe('nozzle marker mesh', () => {
  it('builds a closed solid anchored with its orifice at the origin', () => {
    expect(nozzleFaces.length).toBeGreaterThan(0)

    const zValues = nozzleFaces.flatMap((face) => face.vertices.map((vertex) => vertex[2]))
    expect(Math.min(...zValues)).toBeCloseTo(0)
    expect(Math.max(...zValues)).toBeCloseTo(nozzleHeight)

    const tipRadii = nozzleFaces
      .flatMap((face) => face.vertices)
      .filter((vertex) => Math.abs(vertex[2]) < 1e-6)
      .map((vertex) => Math.hypot(vertex[0], vertex[1]))
    expect(Math.max(...tipRadii)).toBeCloseTo(nozzleTipRadius)
  })

  it('emits unit normals and no degenerate faces', () => {
    for (const face of nozzleFaces) {
      expect(face.vertices.length).toBeGreaterThanOrEqual(3)
      expect(length(face.normal)).toBeCloseTo(1)
    }
  })

  it('never leans a normal back toward the axis of revolution', () => {
    for (const face of nozzleFaces) {
      const centroidX =
        face.vertices.reduce((total, vertex) => total + vertex[0], 0) / face.vertices.length
      const centroidY =
        face.vertices.reduce((total, vertex) => total + vertex[1], 0) / face.vertices.length
      const radial = Math.hypot(centroidX, centroidY)
      if (radial < 1e-6) continue
      // Walls lean outward and steps read as pure ±Z, so the radial component of
      // an outward normal is never negative anywhere on the solid.
      const outward = (face.normal[0] * centroidX + face.normal[1] * centroidY) / radial
      expect(outward).toBeGreaterThanOrEqual(-1e-6)
    }
  })

  it('culls the far side and keeps the crown when viewed from above', () => {
    const origin = [10, 20, 0] as const
    const eye = [10, 20, 400] as const
    const visible = visibleNozzleFaces(origin, eye, (point) => [point[0], point[1]])

    expect(visible.length).toBeGreaterThan(0)
    expect(visible.length).toBeLessThan(nozzleFaces.length)
    // Looking straight down keeps every upward face and drops the orifice disc.
    const crownFaces = nozzleFaces.filter((face) => face.normal[2] > 0.99)
    const orificeFaces = nozzleFaces.filter((face) => face.normal[2] < -0.99)
    expect(crownFaces.length).toBeGreaterThan(0)
    expect(orificeFaces.length).toBeGreaterThan(0)
    expect(visible.length).toBeGreaterThanOrEqual(crownFaces.length)
    expect(visible.length).toBeLessThanOrEqual(nozzleFaces.length - orificeFaces.length)
  })

  it('orders faces far to near by true distance from the eye', () => {
    const origin = [7, -3, 0.6] as const
    const eye = [60, 60, 40] as const
    // Encode each 3D input as its call index so the 3D centroid of an emitted
    // face can be recovered from its projected points.
    const projected: (readonly [number, number, number])[] = []
    const visible = visibleNozzleFaces(origin, eye, (point) => {
      projected.push(point)
      return [projected.length - 1, 0]
    })

    expect(visible.length).toBeGreaterThan(0)
    const depths = visible.map((face) => {
      const vertices = face.points.map((point) => projected[point[0]] ?? [0, 0, 0])
      const centerX = vertices.reduce((total, vertex) => total + vertex[0], 0) / vertices.length
      const centerY = vertices.reduce((total, vertex) => total + vertex[1], 0) / vertices.length
      const centerZ = vertices.reduce((total, vertex) => total + vertex[2], 0) / vertices.length
      return Math.hypot(eye[0] - centerX, eye[1] - centerY, eye[2] - centerZ)
    })

    for (let index = 1; index < depths.length; index += 1) {
      // Painter order: nothing nearer may be drawn before something farther.
      expect(depths[index - 1] ?? 0).toBeGreaterThanOrEqual((depths[index] ?? 0) - 1e-6)
    }
  })

  it('anchors the projected orifice at the toolhead position', () => {
    const origin = [7, -3, 0.6] as const
    const visible = visibleNozzleFaces(origin, [60, 60, 40], (point) => [point[0], point[1]])
    const nearestToOrigin = Math.min(
      ...visible
        .flatMap((face) => face.points)
        .map((point) => Math.hypot(point[0] - origin[0], point[1] - origin[1])),
    )

    expect(nearestToOrigin).toBeLessThanOrEqual(nozzleTipRadius + 1e-6)
  })

  it('places the marker in world millimetres so it tracks the print, not the view', () => {
    const project = (point: readonly [number, number, number]): readonly [number, number] => [
      point[0],
      point[1],
    ]
    const near = visibleNozzleFaces([0, 0, 0], [40, 40, 30], project)
    const far = visibleNozzleFaces([0, 0, 0], [400, 400, 300], project)

    const spread = (faces: ReturnType<typeof visibleNozzleFaces>): number =>
      Math.max(...faces.flatMap((face) => face.points).map((point) => Math.hypot(...point)))

    // Pulling the eye ten times further away must not resize the model itself;
    // apparent size is left entirely to the projection.
    expect(spread(far)).toBeCloseTo(spread(near), 6)
  })

  it('gives the hexagonal nut six flat orientations rather than a revolved wall', () => {
    const nutWalls = nozzleFaces.filter((face) => {
      const zValues = face.vertices.map((vertex) => vertex[2])
      return (
        Math.abs(face.normal[2]) < 1e-6 &&
        Math.min(...zValues) === nozzleNutBottomZ &&
        Math.max(...zValues) === nozzleNutTopZ
      )
    })

    expect(nutWalls.length).toBeGreaterThan(6)
    const orientations = nutWalls.map(
      (face) => Math.round(Math.atan2(face.normal[1], face.normal[0]) * 1e6) / 1e6,
    )
    expect(new Set(orientations).size).toBe(6)
  })
})
