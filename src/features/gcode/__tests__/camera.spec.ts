import { describe, expect, it } from 'vitest'

import {
  cameraForward,
  cameraPosition,
  cameraViewRay,
  dollyCameraAt,
  fittedCamera,
  orbitCamera,
  orbitCameraAround,
  panCamera,
  projectGcodePoint,
  projectionFor,
  unprojectGcodeNdc,
} from '@/features/gcode/camera'
import type { GcodeBounds } from '@/features/gcode/types'

const bounds: GcodeBounds = { minX: 0, maxX: 200, minY: 0, maxY: 200, minZ: 0, maxZ: 200 }

describe('G-code perspective camera', () => {
  it('fits every model corner inside the initial perspective view', () => {
    const camera = fittedCamera(bounds, 800, 600)
    const projection = projectionFor(bounds, camera, 800, 600)
    for (const x of [bounds.minX, bounds.maxX]) {
      for (const y of [bounds.minY, bounds.maxY]) {
        for (const z of [bounds.minZ, bounds.maxZ]) {
          const [screenX, screenY] = projectGcodePoint([x, y, z], projection)
          expect(screenX).toBeGreaterThan(0)
          expect(screenX).toBeLessThan(800)
          expect(screenY).toBeGreaterThan(0)
          expect(screenY).toBeLessThan(600)
        }
      }
    }

    const center = projectGcodePoint([100, 100, 100], projection)
    expect(center[0]).toBeCloseTo(400, 3)
    expect(center[1]).toBeCloseTo(300, 3)
  })

  it('pans in screen space while preserving the orbit distance', () => {
    const camera = fittedCamera(bounds)
    const distance = camera.distance
    const centeredProjection = projectionFor(bounds, camera, 800, 600)
    const centeredPoint = projectGcodePoint([100, 100, 100], centeredProjection)

    panCamera(camera, 40, 20, 600)
    const pannedProjection = projectionFor(bounds, camera, 800, 600)
    const pannedPoint = projectGcodePoint([100, 100, 100], pannedProjection)

    expect(pannedPoint[0] - centeredPoint[0]).toBeCloseTo(40, 3)
    expect(pannedPoint[1] - centeredPoint[1]).toBeCloseTo(20, 3)
    expect(camera.distance).toBe(distance)
  })

  it('orbits around the same target and clamps away from the camera poles', () => {
    const camera = fittedCamera(bounds)
    const initialPosition = cameraPosition(camera)
    const target = [camera.targetX, camera.targetY, camera.targetZ]

    const initialPitch = camera.pitch
    orbitCamera(camera, 60, -10_000)

    expect(cameraPosition(camera)).not.toEqual(initialPosition)
    expect([camera.targetX, camera.targetY, camera.targetZ]).toEqual(target)
    expect(camera.pitch).toBeLessThan(initialPitch)
    expect(camera.pitch).toBeGreaterThan(-Math.PI / 2)
  })

  it('keeps a point under the mouse stationary while zooming', () => {
    const camera = fittedCamera(bounds)
    const point: [number, number, number] = [
      camera.targetX - Math.sin(camera.yaw) * 45,
      camera.targetY + Math.cos(camera.yaw) * 45,
      camera.targetZ,
    ]
    const beforeProjection = projectionFor(bounds, camera, 800, 600)
    const before = projectGcodePoint(point, beforeProjection)

    dollyCameraAt(camera, 1.8, before[0], before[1], 800, 600)

    const afterProjection = projectionFor(bounds, camera, 800, 600)
    const after = projectGcodePoint(point, afterProjection)
    expect(after[0]).toBeCloseTo(before[0], 3)
    expect(after[1]).toBeCloseTo(before[1], 3)
  })

  /**
   * The render loop calls projectionFor every frame, so it writes into shared
   * module scratch rather than allocating. That makes two retained projections
   * alias, which is safe for the immediate-use pattern every caller follows —
   * and is exactly why the renderer passes its own storage for the scene
   * matrix, which the overlay keeps reading between scene renders.
   */
  it('reuses one matrix by default and honors caller-owned storage', () => {
    const camera = fittedCamera(bounds)

    const first = projectionFor(bounds, camera, 800, 600)
    const second = projectionFor(bounds, camera, 800, 600)
    expect(second.viewProjection).toBe(first.viewProjection)

    const owned = new Float32Array(16)
    const isolated = projectionFor(bounds, camera, 800, 600, owned)
    expect(isolated.viewProjection).toBe(owned)
    expect([...owned]).toEqual([...first.viewProjection])

    // Writing the shared scratch again must not disturb caller-owned storage.
    panCamera(camera, 120, 0, 600)
    const moved = projectionFor(bounds, camera, 800, 600)
    expect([...owned]).not.toEqual([...moved.viewProjection])
  })

  it('shoots view rays that project back onto the pixel they came from', () => {
    const camera = fittedCamera(bounds, 800, 600)
    const projection = projectionFor(bounds, camera, 800, 600)
    for (const [screenX, screenY] of [
      [400, 300],
      [120, 90],
      [700, 500],
    ]) {
      const ray = cameraViewRay(camera, screenX ?? 0, screenY ?? 0, 800, 600)
      const travel = 60
      const point: [number, number, number] = [
        ray.origin[0] + ray.direction[0] * travel,
        ray.origin[1] + ray.direction[1] * travel,
        ray.origin[2] + ray.direction[2] * travel,
      ]
      const projected = projectGcodePoint(point, projection)
      expect(projected[0]).toBeCloseTo(screenX ?? 0, 3)
      expect(projected[1]).toBeCloseTo(screenY ?? 0, 3)
    }
  })

  it('aims the center ray straight at the orbit target', () => {
    const camera = fittedCamera(bounds, 800, 600)
    const ray = cameraViewRay(camera, 400, 300, 800, 600)
    const forward = cameraForward(camera)
    expect(ray.direction[0]).toBeCloseTo(forward[0], 6)
    expect(ray.direction[1]).toBeCloseTo(forward[1], 6)
    expect(ray.direction[2]).toBeCloseTo(forward[2], 6)
    const target: [number, number, number] = [
      ray.origin[0] + ray.direction[0] * camera.distance,
      ray.origin[1] + ray.direction[1] * camera.distance,
      ray.origin[2] + ray.direction[2] * camera.distance,
    ]
    expect(target[0]).toBeCloseTo(camera.targetX, 6)
    expect(target[1]).toBeCloseTo(camera.targetY, 6)
    expect(target[2]).toBeCloseTo(camera.targetZ, 6)
  })

  it('matches a plain orbit when the pivot is the orbit target', () => {
    const camera = fittedCamera(bounds, 800, 600)
    const reference = fittedCamera(bounds, 800, 600)
    orbitCameraAround(camera, 45, -20, [reference.targetX, reference.targetY, reference.targetZ])
    orbitCamera(reference, 45, -20)
    expect(camera.yaw).toBeCloseTo(reference.yaw, 6)
    expect(camera.pitch).toBeCloseTo(reference.pitch, 6)
    expect(camera.distance).toBeCloseTo(reference.distance, 6)
    expect(camera.targetX).toBeCloseTo(reference.targetX, 3)
    expect(camera.targetY).toBeCloseTo(reference.targetY, 3)
    expect(camera.targetZ).toBeCloseTo(reference.targetZ, 3)
  })

  it('keeps an off-center pivot pinned to its pixel while orbiting around it', () => {
    const camera = fittedCamera(bounds, 800, 600)
    const pivot: [number, number, number] = [40, 160, 30]
    const eye = cameraPosition(camera)
    const before = projectGcodePoint(pivot, projectionFor(bounds, camera, 800, 600))

    orbitCameraAround(camera, 55, -25, pivot)

    const after = projectGcodePoint(pivot, projectionFor(bounds, camera, 800, 600))
    expect(after[0]).toBeCloseTo(before[0], 2)
    expect(after[1]).toBeCloseTo(before[1], 2)
    // The camera really moved, and the pivot kept its distance from the eye.
    const movedEye = cameraPosition(camera)
    expect(
      Math.hypot(movedEye[0] - eye[0], movedEye[1] - eye[1], movedEye[2] - eye[2]),
    ).toBeGreaterThan(1)
    const distanceTo = (position: readonly [number, number, number]): number =>
      Math.hypot(position[0] - pivot[0], position[1] - pivot[1], position[2] - pivot[2])
    expect(distanceTo(movedEye)).toBeCloseTo(distanceTo(eye), 3)
    expect(camera.distance).toBeCloseTo(fittedCamera(bounds, 800, 600).distance, 6)
  })

  it('holds the pivot in place even when the pitch clamp engages', () => {
    const camera = fittedCamera(bounds, 800, 600)
    const pivot: [number, number, number] = [40, 160, 30]
    const before = projectGcodePoint(pivot, projectionFor(bounds, camera, 800, 600))

    orbitCameraAround(camera, 0, 100_000, pivot)

    expect(camera.pitch).toBeLessThan(Math.PI / 2)
    const after = projectGcodePoint(pivot, projectionFor(bounds, camera, 800, 600))
    expect(after[0]).toBeCloseTo(before[0], 2)
    expect(after[1]).toBeCloseTo(before[1], 2)
  })

  it('unprojects clip-space depth samples back to the projected pixel', () => {
    const camera = fittedCamera(bounds, 800, 600)
    const projection = projectionFor(bounds, camera, 800, 600)
    for (const [normalizedX, normalizedY, normalizedZ] of [
      [0, 0, 0],
      [0.3, -0.4, 0.2],
      [-0.8, 0.6, 0.9],
    ]) {
      const world = unprojectGcodeNdc(
        normalizedX ?? 0,
        normalizedY ?? 0,
        normalizedZ ?? 0,
        projection,
      )
      expect(world).not.toBeNull()
      if (!world) continue
      const projected = projectGcodePoint(world, projection)
      expect(projected[0]).toBeCloseTo((((normalizedX ?? 0) + 1) / 2) * 800, 2)
      expect(projected[1]).toBeCloseTo(((1 - (normalizedY ?? 0)) / 2) * 600, 2)
    }
  })
})
