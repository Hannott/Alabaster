import type { GcodeBounds, GcodeCamera } from '@/features/gcode/types'

const fieldOfView = Math.PI / 4
const fitPadding = 1.08
const minimumPitch = -Math.PI / 2 + 0.04
const maximumPitch = Math.PI / 2 - 0.04

export const minimumCameraDistance = 0.1
export const maximumCameraDistance = 1_000_000

type Vector3 = readonly [number, number, number]

export interface GcodeViewRay {
  origin: [number, number, number]
  direction: [number, number, number]
}

export interface GcodeProjection {
  viewProjection: Float32Array
  width: number
  height: number
}

/*
 * Culling runs this for every supergroup and chunk of every frame — thousands
 * of calls on a large file — so the six planes are extracted into one shared
 * scratch array instead of allocating seven arrays per call. The scratch is
 * safe to share because extraction and use both complete synchronously inside
 * a single call, and it is keyed on the matrix so repeated tests against the
 * same projection re-extract nothing.
 */
const frustumScratch = new Float64Array(24)
let frustumSource: Float32Array | null = null

function extractFrustum(matrix: Float32Array): void {
  if (frustumSource === matrix) return
  const m = (index: number): number => matrix[index] ?? 0
  const planes = [
    m(3) + m(0),
    m(7) + m(4),
    m(11) + m(8),
    m(15) + m(12),
    m(3) - m(0),
    m(7) - m(4),
    m(11) - m(8),
    m(15) - m(12),
    m(3) + m(1),
    m(7) + m(5),
    m(11) + m(9),
    m(15) + m(13),
    m(3) - m(1),
    m(7) - m(5),
    m(11) - m(9),
    m(15) - m(13),
    m(3) + m(2),
    m(7) + m(6),
    m(11) + m(10),
    m(15) + m(14),
    m(3) - m(2),
    m(7) - m(6),
    m(11) - m(10),
    m(15) - m(14),
  ]
  frustumScratch.set(planes)
  frustumSource = matrix
}

/** Call when a matrix is mutated in place, so the cached planes are re-extracted. */
export function invalidateGcodeFrustumCache(): void {
  frustumSource = null
}

export function gcodeBoundsAreVisible(bounds: GcodeBounds, projection: GcodeProjection): boolean {
  extractFrustum(projection.viewProjection)
  for (let plane = 0; plane < 6; plane += 1) {
    const offset = plane * 4
    const x = frustumScratch[offset] ?? 0
    const y = frustumScratch[offset + 1] ?? 0
    const z = frustumScratch[offset + 2] ?? 0
    const distance = frustumScratch[offset + 3] ?? 0
    const furthestX = x >= 0 ? bounds.maxX : bounds.minX
    const furthestY = y >= 0 ? bounds.maxY : bounds.minY
    const furthestZ = z >= 0 ? bounds.maxZ : bounds.minZ
    if (x * furthestX + y * furthestY + z * furthestZ + distance < 0) return false
  }
  return true
}

function subtract(a: Vector3, b: Vector3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function dot(a: Vector3, b: Vector3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a: Vector3, b: Vector3): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function normalize(value: Vector3): [number, number, number] {
  const length = Math.hypot(value[0], value[1], value[2]) || 1
  return [value[0] / length, value[1] / length, value[2] / length]
}

function multiply(a: Float32Array, b: Float32Array, output: Float32Array): Float32Array {
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      output[column * 4 + row] =
        (a[row] ?? 0) * (b[column * 4] ?? 0) +
        (a[4 + row] ?? 0) * (b[column * 4 + 1] ?? 0) +
        (a[8 + row] ?? 0) * (b[column * 4 + 2] ?? 0) +
        (a[12 + row] ?? 0) * (b[column * 4 + 3] ?? 0)
    }
  }
  return output
}

function perspective(
  aspect: number,
  near: number,
  far: number,
  output: Float32Array,
): Float32Array {
  const focalLength = 1 / Math.tan(fieldOfView / 2)
  const range = 1 / (near - far)
  output.set([
    focalLength / aspect,
    0,
    0,
    0,
    0,
    focalLength,
    0,
    0,
    0,
    0,
    (far + near) * range,
    -1,
    0,
    0,
    2 * far * near * range,
    0,
  ])
  return output
}

function lookAt(eye: Vector3, target: Vector3, output: Float32Array): Float32Array {
  const backward = normalize(subtract(eye, target))
  const right = normalize(cross([0, 0, 1], backward))
  const up = cross(backward, right)
  output.set([
    right[0],
    up[0],
    backward[0],
    0,
    right[1],
    up[1],
    backward[1],
    0,
    right[2],
    up[2],
    backward[2],
    0,
    -dot(right, eye),
    -dot(up, eye),
    -dot(backward, eye),
    1,
  ])
  return output
}

function boundsRadius(bounds: GcodeBounds): number {
  return Math.max(
    1,
    Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ) / 2,
  )
}

// Mirrors the basis built by lookAt, so screen-space rays and the rendered
// image always agree on where the camera is pointing.
export function cameraBasis(camera: GcodeCamera): {
  forward: [number, number, number]
  right: [number, number, number]
  up: [number, number, number]
} {
  const backward: Vector3 = [
    Math.cos(camera.yaw) * Math.cos(camera.pitch),
    Math.sin(camera.yaw) * Math.cos(camera.pitch),
    Math.sin(camera.pitch),
  ]
  const right = normalize(cross([0, 0, 1], backward))
  const up = cross(backward, right)
  return { forward: [-backward[0], -backward[1], -backward[2]], right, up }
}

export function cameraForward(camera: GcodeCamera): [number, number, number] {
  return cameraBasis(camera).forward
}

export function cameraViewRay(
  camera: GcodeCamera,
  screenX: number,
  screenY: number,
  viewportWidth: number,
  viewportHeight: number,
): GcodeViewRay {
  const safeWidth = Math.max(1, viewportWidth)
  const safeHeight = Math.max(1, viewportHeight)
  const { forward, right, up } = cameraBasis(camera)
  const verticalTangent = Math.tan(fieldOfView / 2)
  const horizontalTangent = verticalTangent * (safeWidth / safeHeight)
  const normalizedX = ((2 * screenX) / safeWidth - 1) * horizontalTangent
  const normalizedY = (1 - (2 * screenY) / safeHeight) * verticalTangent
  return {
    origin: cameraPosition(camera),
    direction: normalize([
      forward[0] + right[0] * normalizedX + up[0] * normalizedY,
      forward[1] + right[1] * normalizedX + up[1] * normalizedY,
      forward[2] + right[2] * normalizedX + up[2] * normalizedY,
    ]),
  }
}

export function cameraPosition(camera: GcodeCamera): [number, number, number] {
  const horizontalDistance = Math.cos(camera.pitch) * camera.distance
  return [
    camera.targetX + Math.cos(camera.yaw) * horizontalDistance,
    camera.targetY + Math.sin(camera.yaw) * horizontalDistance,
    camera.targetZ + Math.sin(camera.pitch) * camera.distance,
  ]
}

export function fittedCamera(
  bounds: GcodeBounds,
  viewportWidth = 1,
  viewportHeight = 1,
): GcodeCamera {
  const yaw = -Math.PI / 2
  const pitch = Math.PI / 5
  const target: Vector3 = [
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    (bounds.minZ + bounds.maxZ) / 2,
  ]
  const backward: Vector3 = [
    Math.cos(yaw) * Math.cos(pitch),
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
  ]
  const right = normalize(cross([0, 0, 1], backward))
  const up = cross(backward, right)
  const aspect = Math.max(0.01, viewportWidth) / Math.max(0.01, viewportHeight)
  const verticalTangent = Math.tan(fieldOfView / 2)
  const horizontalTangent = verticalTangent * aspect
  let distance = 1

  for (const x of [bounds.minX, bounds.maxX]) {
    for (const y of [bounds.minY, bounds.maxY]) {
      for (const z of [bounds.minZ, bounds.maxZ]) {
        const relative = subtract([x, y, z], target)
        const depthOffset = dot(backward, relative)
        distance = Math.max(
          distance,
          depthOffset + (Math.abs(dot(right, relative)) * fitPadding) / horizontalTangent,
          depthOffset + (Math.abs(dot(up, relative)) * fitPadding) / verticalTangent,
        )
      }
    }
  }

  return {
    yaw,
    pitch,
    distance,
    targetX: target[0],
    targetY: target[1],
    targetZ: target[2],
  }
}

/*
 * The render loop calls this every frame, so the three matrices it needs live
 * in module scratch rather than being allocated per call. `into` lets a caller
 * that must keep a projection alive across calls (the pick pass, which renders
 * with one projection while the scene holds another) supply its own storage.
 */
const viewScratch = new Float32Array(16)
const perspectiveScratch = new Float32Array(16)
const viewProjectionScratch = new Float32Array(16)

export function projectionFor(
  bounds: GcodeBounds,
  camera: GcodeCamera,
  width: number,
  height: number,
  into?: Float32Array,
): GcodeProjection {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const radius = boundsRadius(bounds)
  const near = Math.max(0.01, Math.min(camera.distance / 4, camera.distance - radius * 1.5))
  const far = Math.max(near + 10, camera.distance + radius * 4)
  const target: Vector3 = [camera.targetX, camera.targetY, camera.targetZ]
  const view = lookAt(cameraPosition(camera), target, viewScratch)
  const projection = perspective(safeWidth / safeHeight, near, far, perspectiveScratch)
  const output = into ?? viewProjectionScratch
  multiply(projection, view, output)
  // The matrix was written in place, so any frustum cached from it is stale.
  invalidateGcodeFrustumCache()
  return {
    viewProjection: output,
    width: safeWidth,
    height: safeHeight,
  }
}

export function projectGcodePoint(
  point: readonly [number, number, number],
  projection: GcodeProjection,
): [number, number] {
  const matrix = projection.viewProjection
  const clipX =
    (matrix[0] ?? 0) * point[0] +
    (matrix[4] ?? 0) * point[1] +
    (matrix[8] ?? 0) * point[2] +
    (matrix[12] ?? 0)
  const clipY =
    (matrix[1] ?? 0) * point[0] +
    (matrix[5] ?? 0) * point[1] +
    (matrix[9] ?? 0) * point[2] +
    (matrix[13] ?? 0)
  const clipW =
    (matrix[3] ?? 0) * point[0] +
    (matrix[7] ?? 0) * point[1] +
    (matrix[11] ?? 0) * point[2] +
    (matrix[15] ?? 0)
  if (clipW <= 0.0001) return [-100_000, -100_000]
  const normalizedX = clipX / clipW
  const normalizedY = clipY / clipW
  return [((normalizedX + 1) / 2) * projection.width, ((1 - normalizedY) / 2) * projection.height]
}

function invert(matrix: Float32Array): Float32Array | null {
  const m = (index: number): number => matrix[index] ?? 0
  const cofactor00 = m(0) * m(5) - m(1) * m(4)
  const cofactor01 = m(0) * m(6) - m(2) * m(4)
  const cofactor02 = m(0) * m(7) - m(3) * m(4)
  const cofactor03 = m(1) * m(6) - m(2) * m(5)
  const cofactor04 = m(1) * m(7) - m(3) * m(5)
  const cofactor05 = m(2) * m(7) - m(3) * m(6)
  const cofactor06 = m(8) * m(13) - m(9) * m(12)
  const cofactor07 = m(8) * m(14) - m(10) * m(12)
  const cofactor08 = m(8) * m(15) - m(11) * m(12)
  const cofactor09 = m(9) * m(14) - m(10) * m(13)
  const cofactor10 = m(9) * m(15) - m(11) * m(13)
  const cofactor11 = m(10) * m(15) - m(11) * m(14)
  const determinant =
    cofactor00 * cofactor11 -
    cofactor01 * cofactor10 +
    cofactor02 * cofactor09 +
    cofactor03 * cofactor08 -
    cofactor04 * cofactor07 +
    cofactor05 * cofactor06
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-20) return null
  const scale = 1 / determinant
  return new Float32Array([
    (m(5) * cofactor11 - m(6) * cofactor10 + m(7) * cofactor09) * scale,
    (m(2) * cofactor10 - m(1) * cofactor11 - m(3) * cofactor09) * scale,
    (m(13) * cofactor05 - m(14) * cofactor04 + m(15) * cofactor03) * scale,
    (m(10) * cofactor04 - m(9) * cofactor05 - m(11) * cofactor03) * scale,
    (m(6) * cofactor08 - m(4) * cofactor11 - m(7) * cofactor07) * scale,
    (m(0) * cofactor11 - m(2) * cofactor08 + m(3) * cofactor07) * scale,
    (m(14) * cofactor02 - m(12) * cofactor05 - m(15) * cofactor01) * scale,
    (m(8) * cofactor05 - m(10) * cofactor02 + m(11) * cofactor01) * scale,
    (m(4) * cofactor10 - m(5) * cofactor08 + m(7) * cofactor06) * scale,
    (m(1) * cofactor08 - m(0) * cofactor10 - m(3) * cofactor06) * scale,
    (m(12) * cofactor04 - m(13) * cofactor02 + m(15) * cofactor00) * scale,
    (m(9) * cofactor02 - m(8) * cofactor04 - m(11) * cofactor00) * scale,
    (m(5) * cofactor07 - m(4) * cofactor09 - m(6) * cofactor06) * scale,
    (m(0) * cofactor09 - m(1) * cofactor07 + m(2) * cofactor06) * scale,
    (m(13) * cofactor01 - m(12) * cofactor03 - m(14) * cofactor00) * scale,
    (m(8) * cofactor03 - m(9) * cofactor01 + m(10) * cofactor00) * scale,
  ])
}

// Inverse of projectGcodePoint: turns a clip-space sample, typically a depth
// buffer read, back into the world position it came from.
export function unprojectGcodeNdc(
  normalizedX: number,
  normalizedY: number,
  normalizedZ: number,
  projection: GcodeProjection,
): [number, number, number] | null {
  const inverse = invert(projection.viewProjection)
  if (!inverse) return null
  const m = (index: number): number => inverse[index] ?? 0
  const w = m(3) * normalizedX + m(7) * normalizedY + m(11) * normalizedZ + m(15)
  if (!Number.isFinite(w) || Math.abs(w) < 1e-12) return null
  return [
    (m(0) * normalizedX + m(4) * normalizedY + m(8) * normalizedZ + m(12)) / w,
    (m(1) * normalizedX + m(5) * normalizedY + m(9) * normalizedZ + m(13)) / w,
    (m(2) * normalizedX + m(6) * normalizedY + m(10) * normalizedZ + m(14)) / w,
  ]
}

export function orbitCamera(camera: GcodeCamera, deltaX: number, deltaY: number): void {
  camera.yaw -= deltaX * 0.007
  camera.pitch = Math.min(maximumPitch, Math.max(minimumPitch, camera.pitch + deltaY * 0.007))
}

function rotateAround(value: Vector3, axis: Vector3, angle: number): [number, number, number] {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const perpendicular = cross(axis, value)
  const along = dot(axis, value) * (1 - cosine)
  return [
    value[0] * cosine + perpendicular[0] * sine + axis[0] * along,
    value[1] * cosine + perpendicular[1] * sine + axis[1] * along,
    value[2] * cosine + perpendicular[2] * sine + axis[2] * along,
  ]
}

// Orbits around an arbitrary world point instead of the screen centre: the same
// yaw and pitch delta is applied to the camera, and the eye is swung rigidly
// around the pivot by that delta, which leaves the pivot fixed on screen.
export function orbitCameraAround(
  camera: GcodeCamera,
  deltaX: number,
  deltaY: number,
  pivot: Vector3,
): void {
  const eye = cameraPosition(camera)
  const previousYaw = camera.yaw
  const previousPitch = camera.pitch
  orbitCamera(camera, deltaX, deltaY)
  const deltaYaw = camera.yaw - previousYaw
  // Pitch is clamped near the poles, so only the delta that actually landed may
  // be used here, otherwise the pivot would drift once the clamp engages.
  const deltaPitch = camera.pitch - previousPitch
  const yawed = rotateAround(subtract(eye, pivot), [0, 0, 1], deltaYaw)
  const right: Vector3 = [-Math.sin(camera.yaw), Math.cos(camera.yaw), 0]
  const pitched = rotateAround(yawed, right, -deltaPitch)
  const { forward } = cameraBasis(camera)
  camera.targetX = pivot[0] + pitched[0] + forward[0] * camera.distance
  camera.targetY = pivot[1] + pitched[1] + forward[1] * camera.distance
  camera.targetZ = pivot[2] + pitched[2] + forward[2] * camera.distance
}

export function worldUnitsPerPixel(camera: GcodeCamera, viewportHeight: number): number {
  return (2 * camera.distance * Math.tan(fieldOfView / 2)) / Math.max(1, viewportHeight)
}

export function panCamera(
  camera: GcodeCamera,
  deltaX: number,
  deltaY: number,
  viewportHeight: number,
): void {
  const worldPerPixel = worldUnitsPerPixel(camera, viewportHeight)
  const right: Vector3 = [-Math.sin(camera.yaw), Math.cos(camera.yaw), 0]
  const up: Vector3 = [
    -Math.cos(camera.yaw) * Math.sin(camera.pitch),
    -Math.sin(camera.yaw) * Math.sin(camera.pitch),
    Math.cos(camera.pitch),
  ]
  const horizontal = -deltaX * worldPerPixel
  const vertical = deltaY * worldPerPixel
  camera.targetX += right[0] * horizontal + up[0] * vertical
  camera.targetY += right[1] * horizontal + up[1] * vertical
  camera.targetZ += right[2] * horizontal + up[2] * vertical
}

export function dollyCamera(camera: GcodeCamera, factor: number): void {
  if (!Number.isFinite(factor) || factor <= 0) return
  camera.distance = Math.min(
    maximumCameraDistance,
    Math.max(minimumCameraDistance, camera.distance / factor),
  )
}

export function dollyCameraAt(
  camera: GcodeCamera,
  factor: number,
  pointerX: number,
  pointerY: number,
  viewportWidth: number,
  viewportHeight: number,
): void {
  if (!Number.isFinite(factor) || factor <= 0) return
  const previousDistance = camera.distance
  dollyCamera(camera, factor)
  const appliedFactor = previousDistance / camera.distance
  const offsetX = pointerX - Math.max(1, viewportWidth) / 2
  const offsetY = pointerY - Math.max(1, viewportHeight) / 2
  panCamera(camera, offsetX * (1 - appliedFactor), offsetY * (1 - appliedFactor), viewportHeight)
}
