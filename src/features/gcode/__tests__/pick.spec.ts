import { describe, expect, it } from 'vitest'

import {
  cameraForward,
  cameraPosition,
  fittedCamera,
  projectGcodePoint,
  projectionFor,
} from '@/features/gcode/camera'
import { axialDepth, bedPlaneHit, resolvePivot, reanchorCamera } from '@/features/gcode/pick'
import type { GcodeBounds, GcodeCamera } from '@/features/gcode/types'

const bounds: GcodeBounds = { minX: 0, maxX: 200, minY: 0, maxY: 200, minZ: 0, maxZ: 200 }
const bed: GcodeBounds = { minX: -10, maxX: 210, minY: -10, maxY: 210, minZ: 0, maxZ: 1 }

// Looks along +Y from ten units away, so axial depth is just the Y distance.
function axisCamera(): GcodeCamera {
  return { yaw: -Math.PI / 2, pitch: 0, distance: 10, targetX: 0, targetY: 0, targetZ: 0 }
}

describe('G-code orbit pivot', () => {
  it('lands the center ray on the bed plane beyond the model', () => {
    const camera = fittedCamera(bounds, 800, 600)
    const hit = bedPlaneHit(camera, 400, 300, 800, 600, bed)
    expect(hit).not.toBeNull()
    if (!hit) return
    expect(hit[2]).toBeCloseTo(bed.minZ, 6)
    // The bed is further away than the fitted pivot floating inside the model.
    const depth = axialDepth(camera, hit)
    expect(depth).toBeGreaterThan(camera.distance)
    // And the hit sits on the center ray rather than merely on the plane.
    const eye = cameraPosition(camera)
    const forward = cameraForward(camera)
    expect(hit[0]).toBeCloseTo(eye[0] + forward[0] * depth, 3)
    expect(hit[1]).toBeCloseTo(eye[1] + forward[1] * depth, 3)
    expect(hit[2]).toBeCloseTo(eye[2] + forward[2] * depth, 3)
  })

  it('reports no bed hit when the view points away from the bed', () => {
    const camera: GcodeCamera = {
      yaw: 0,
      pitch: -0.6,
      distance: 50,
      targetX: 0,
      targetY: 0,
      targetZ: 30,
    }
    expect(bedPlaneHit(camera, 400, 300, 800, 600, bed)).toBeNull()
  })

  it('rejects grazing bed hits that land far outside the bed', () => {
    const camera: GcodeCamera = {
      yaw: -Math.PI / 2,
      pitch: 0.002,
      distance: 100,
      targetX: 100,
      targetY: 100,
      targetZ: 50,
    }
    expect(bedPlaneHit(camera, 400, 300, 800, 600, bed)).toBeNull()
  })

  it('prefers the nearest candidate and ignores anything behind the camera', () => {
    const camera = axisCamera()
    const near: [number, number, number] = [0, -5, 0]
    const far: [number, number, number] = [0, 0, 0]
    const behind: [number, number, number] = [0, -20, 0]
    expect(resolvePivot(camera, [far, near])).toBe(near)
    expect(resolvePivot(camera, [near, far])).toBe(near)
    expect(resolvePivot(camera, [behind, null])).toBeNull()
    expect(resolvePivot(camera, [behind], far)).toBe(far)
    expect(resolvePivot(camera, [null], behind)).toBeNull()
    expect(resolvePivot(camera, [])).toBeNull()
  })

  it('moves the pivot onto the view axis without moving the camera', () => {
    const camera = axisCamera()
    const eye = cameraPosition(camera)
    expect(reanchorCamera(camera, [3, -5, 2])).toBe(true)
    expect(camera.distance).toBeCloseTo(5, 6)
    // The off-axis candidate is projected onto the axis, not adopted verbatim.
    expect([camera.targetX, camera.targetY, camera.targetZ].map(Math.round)).toEqual([0, -5, 0])
    expect(camera.yaw).toBeCloseTo(axisCamera().yaw, 6)
    expect(camera.pitch).toBeCloseTo(axisCamera().pitch, 6)
    const movedEye = cameraPosition(camera)
    expect(movedEye[0]).toBeCloseTo(eye[0], 6)
    expect(movedEye[1]).toBeCloseTo(eye[1], 6)
    expect(movedEye[2]).toBeCloseTo(eye[2], 6)
  })

  it('keeps the rendered image in place while re-anchoring', () => {
    const camera = fittedCamera(bounds, 800, 600)
    const probe: [number, number, number] = [150, 60, 40]
    const before = projectGcodePoint(probe, projectionFor(bounds, camera, 800, 600))
    const hit = bedPlaneHit(camera, 400, 300, 800, 600, bed)
    expect(hit).not.toBeNull()
    if (!hit) return
    expect(reanchorCamera(camera, hit)).toBe(true)
    const after = projectGcodePoint(probe, projectionFor(bounds, camera, 800, 600))
    expect(after[0]).toBeCloseTo(before[0], 3)
    expect(after[1]).toBeCloseTo(before[1], 3)
  })

  it('leaves the camera untouched for points at or behind the eye', () => {
    const camera = axisCamera()
    const snapshot = { ...camera }
    expect(reanchorCamera(camera, [0, -10, 0])).toBe(false)
    expect(reanchorCamera(camera, [0, -30, 0])).toBe(false)
    expect({ ...camera }).toEqual(snapshot)
  })

  it('measures axial depth from the camera to the pivot', () => {
    const camera = axisCamera()
    expect(axialDepth(camera, [camera.targetX, camera.targetY, camera.targetZ])).toBeCloseTo(
      camera.distance,
      6,
    )
  })
})
