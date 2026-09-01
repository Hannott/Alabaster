import {
  cameraBasis,
  cameraPosition,
  cameraViewRay,
  maximumCameraDistance,
  minimumCameraDistance,
} from '@/features/gcode/camera'
import type { GcodeBounds, GcodeCamera } from '@/features/gcode/types'

export type GcodePoint = readonly [number, number, number]

// How far past the bed edge a plane hit may still land, as a multiple of the bed
// extent. Looking down at a tall model puts the center ray outside the bed by a
// fair margin, which is still a sensible pivot, while grazing views hitting the
// plane hundreds of metres out are not.
const bedMargin = 2

export function boundsCenter(bounds: GcodeBounds): [number, number, number] {
  return [
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    (bounds.minZ + bounds.maxZ) / 2,
  ]
}

// Distance from the camera to the point measured along the view axis. This is
// what the orbit distance has to become for the pivot to sit on that point.
export function axialDepth(camera: GcodeCamera, point: GcodePoint): number {
  const eye = cameraPosition(camera)
  const { forward } = cameraBasis(camera)
  return (
    forward[0] * (point[0] - eye[0]) +
    forward[1] * (point[1] - eye[1]) +
    forward[2] * (point[2] - eye[2])
  )
}

export function bedPlaneHit(
  camera: GcodeCamera,
  screenX: number,
  screenY: number,
  viewportWidth: number,
  viewportHeight: number,
  bed: GcodeBounds,
): [number, number, number] | null {
  const ray = cameraViewRay(camera, screenX, screenY, viewportWidth, viewportHeight)
  if (Math.abs(ray.direction[2]) < 1e-6) return null
  const travel = (bed.minZ - ray.origin[2]) / ray.direction[2]
  if (!Number.isFinite(travel) || travel <= minimumCameraDistance) return null
  const x = ray.origin[0] + ray.direction[0] * travel
  const y = ray.origin[1] + ray.direction[1] * travel
  const centerX = (bed.minX + bed.maxX) / 2
  const centerY = (bed.minY + bed.maxY) / 2
  const halfWidth = ((bed.maxX - bed.minX) / 2) * bedMargin
  const halfDepth = ((bed.maxY - bed.minY) / 2) * bedMargin
  if (Math.abs(x - centerX) > halfWidth || Math.abs(y - centerY) > halfDepth) return null
  return [x, y, bed.minZ]
}

// The nearest candidate in front of the camera wins, so a surface hit takes
// precedence over the bed plane behind it. The fallback only applies when the
// view is pointing at nothing at all.
export function resolvePivot(
  camera: GcodeCamera,
  candidates: ReadonlyArray<GcodePoint | null>,
  fallback: GcodePoint | null = null,
): GcodePoint | null {
  let nearest: GcodePoint | null = null
  let nearestDepth = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    if (!candidate) continue
    const depth = axialDepth(camera, candidate)
    if (depth <= minimumCameraDistance || depth >= nearestDepth) continue
    nearest = candidate
    nearestDepth = depth
  }
  if (nearest) return nearest
  if (!fallback) return null
  return axialDepth(camera, fallback) > minimumCameraDistance ? fallback : null
}

// Moves the pivot onto the given point without disturbing the image: the point
// is projected onto the view axis, so the eye position, yaw and pitch all stay
// put and only the orbit distance changes.
export function reanchorCamera(camera: GcodeCamera, point: GcodePoint): boolean {
  const eye = cameraPosition(camera)
  const { forward } = cameraBasis(camera)
  const depth = axialDepth(camera, point)
  if (!Number.isFinite(depth) || depth <= minimumCameraDistance) return false
  const distance = Math.min(maximumCameraDistance, depth)
  camera.distance = distance
  camera.targetX = eye[0] + forward[0] * distance
  camera.targetY = eye[1] + forward[1] * distance
  camera.targetZ = eye[2] + forward[2] * distance
  return true
}
