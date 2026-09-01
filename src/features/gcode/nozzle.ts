// A V6-style brass nozzle modeled as a solid of revolution with a hexagonal
// nut, drawn as the live toolhead marker. The mesh is generated once at module
// load and consumed by the viewer overlay, which projects and shades it per
// frame; keeping it off the WebGL scene preserves the throttled-toolpath /
// smooth-marker split the viewer relies on for large files.

// The marker is drawn at true scale in millimetres, so it keeps a constant size
// relative to the print and grows and shrinks with it as the view zooms. Every
// dimension below is a V6-style profile trimmed by modelScale; adjust that one
// factor to resize the whole marker.
const modelScale = 0.85
const profileHeight = 12.5
const profileTipRadius = 0.45
const profileNutBottomZ = 3
const profileNutTopZ = 6.2

export const nozzleHeight = profileHeight * modelScale
export const nozzleTipRadius = profileTipRadius * modelScale
export const nozzleNutBottomZ = profileNutBottomZ * modelScale
export const nozzleNutTopZ = profileNutTopZ * modelScale

const radialSegments = 24
const hexApothem = 3.5
const threadMajorRadius = 2.9
const threadMinorRadius = 2.5
const threadPitch = 0.88
const threadStarts = 6
const hexSectorRadians = Math.PI / 3

export type NozzleVertex = readonly [number, number, number]

export interface NozzleFace {
  vertices: readonly NozzleVertex[]
  normal: NozzleVertex
}

interface NozzleRing {
  radius: number
  z: number
  hex: boolean
}

function ringsFromProfile(): NozzleRing[] {
  const shoulderZ = 6.9
  const rings: NozzleRing[] = [
    { radius: 0, z: 0, hex: false },
    { radius: profileTipRadius, z: 0, hex: false },
    { radius: 2.55, z: profileNutBottomZ, hex: false },
    { radius: hexApothem, z: profileNutBottomZ, hex: true },
    { radius: hexApothem, z: profileNutTopZ, hex: true },
    { radius: threadMajorRadius, z: profileNutTopZ, hex: false },
    { radius: threadMajorRadius, z: shoulderZ, hex: false },
  ]

  for (let start = 0; start < threadStarts; start += 1) {
    rings.push({
      radius: start % 2 === 0 ? threadMinorRadius : threadMajorRadius,
      z: shoulderZ + (start + 1) * threadPitch,
      hex: false,
    })
  }

  rings.push({ radius: threadMajorRadius, z: profileHeight, hex: false })
  rings.push({ radius: 0, z: profileHeight, hex: false })

  return rings.map((ring) => ({
    radius: ring.radius * modelScale,
    z: ring.z * modelScale,
    hex: ring.hex,
  }))
}

// Sampling a hexagon by its apothem keeps every sample exactly on the outline,
// and radialSegments being a multiple of six lands the corners on quad seams.
function radiusAt(ring: NozzleRing, angle: number): number {
  if (!ring.hex) return ring.radius
  const offset =
    (((angle % hexSectorRadians) + hexSectorRadians) % hexSectorRadians) - hexSectorRadians / 2
  return ring.radius / Math.cos(offset)
}

function pointAt(ring: NozzleRing, angle: number): NozzleVertex {
  const radius = radiusAt(ring, angle)
  return [Math.cos(angle) * radius, Math.sin(angle) * radius, ring.z]
}

// Traversing the silhouette tip-to-top keeps the solid on the left, so the
// in-plane normal (dz, -dr) always faces outward.
function revolutionNormal(lower: NozzleRing, upper: NozzleRing, angle: number): NozzleVertex {
  const deltaRadius = upper.radius - lower.radius
  const deltaZ = upper.z - lower.z
  const length = Math.hypot(deltaRadius, deltaZ) || 1
  const radial = deltaZ / length
  return [Math.cos(angle) * radial, Math.sin(angle) * radial, -deltaRadius / length]
}

function hexFaceNormal(angle: number): NozzleVertex {
  const faceCenter = Math.floor(angle / hexSectorRadians) * hexSectorRadians + hexSectorRadians / 2
  return [Math.cos(faceCenter), Math.sin(faceCenter), 0]
}

function buildNozzleFaces(): NozzleFace[] {
  const rings = ringsFromProfile()
  const step = (Math.PI * 2) / radialSegments
  const faces: NozzleFace[] = []

  for (let band = 0; band + 1 < rings.length; band += 1) {
    const lower = rings[band]
    const upper = rings[band + 1]
    if (!lower || !upper) continue
    if (lower.radius === 0 && upper.radius === 0) continue

    const isPrismWall = lower.hex && upper.hex && lower.z !== upper.z

    for (let segment = 0; segment < radialSegments; segment += 1) {
      const startAngle = segment * step
      const endAngle = startAngle + step
      const midAngle = startAngle + step / 2
      const lowerStart = pointAt(lower, startAngle)
      const lowerEnd = pointAt(lower, endAngle)
      const upperStart = pointAt(upper, startAngle)
      const upperEnd = pointAt(upper, endAngle)
      const normal = isPrismWall
        ? hexFaceNormal(midAngle)
        : revolutionNormal(lower, upper, midAngle)

      // Poles collapse one edge, so emit a triangle instead of a sliver quad.
      const vertices =
        lower.radius === 0
          ? [lowerStart, upperEnd, upperStart]
          : upper.radius === 0
            ? [lowerStart, lowerEnd, upperStart]
            : [lowerStart, lowerEnd, upperEnd, upperStart]

      faces.push({ vertices, normal })
    }
  }

  return faces
}

export const nozzleFaces: readonly NozzleFace[] = buildNozzleFaces()

export interface ProjectedNozzleFace {
  points: readonly (readonly [number, number])[]
  shade: number
}

const ambientShade = 0.42
const directionalShade = 0.58
// Matches the toolpath shader so the marker is lit from the same direction.
const lightDirection: NozzleVertex = [-0.3299, -0.4399, 0.8347]

/**
 * Places the nozzle with its orifice at `origin`, drops faces turned away from
 * `eye`, and orders what remains far-to-near. Threads and the nut-to-cone step
 * make the solid non-convex, so culling alone cannot order the faces.
 */
export function visibleNozzleFaces(
  origin: NozzleVertex,
  eye: NozzleVertex,
  project: (point: NozzleVertex) => readonly [number, number],
): ProjectedNozzleFace[] {
  const visible: { face: ProjectedNozzleFace; depth: number }[] = []

  for (const face of nozzleFaces) {
    const placed = face.vertices.map<NozzleVertex>((vertex) => [
      origin[0] + vertex[0],
      origin[1] + vertex[1],
      origin[2] + vertex[2],
    ])

    let centerX = 0
    let centerY = 0
    let centerZ = 0
    for (const vertex of placed) {
      centerX += vertex[0]
      centerY += vertex[1]
      centerZ += vertex[2]
    }
    centerX /= placed.length
    centerY /= placed.length
    centerZ /= placed.length

    const toEyeX = eye[0] - centerX
    const toEyeY = eye[1] - centerY
    const toEyeZ = eye[2] - centerZ
    if (face.normal[0] * toEyeX + face.normal[1] * toEyeY + face.normal[2] * toEyeZ <= 0) continue

    const diffuse = Math.max(
      0,
      face.normal[0] * lightDirection[0] +
        face.normal[1] * lightDirection[1] +
        face.normal[2] * lightDirection[2],
    )
    visible.push({
      face: {
        points: placed.map(project),
        shade: ambientShade + directionalShade * diffuse,
      },
      depth: Math.hypot(toEyeX, toEyeY, toEyeZ),
    })
  }

  visible.sort((left, right) => right.depth - left.depth)
  return visible.map((entry) => entry.face)
}
