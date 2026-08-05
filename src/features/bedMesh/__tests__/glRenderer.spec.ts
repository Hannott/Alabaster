import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  meshCameraFor,
  meshOrientationPresets,
  meshProjections,
  projectWithCamera,
  type MeshArea,
  type MeshProjection,
} from '@/features/bedMesh/scene'

const bed: MeshArea = { minX: 0, minY: 0, maxX: 250, maxY: 210 }
const source = readFileSync(resolve(__dirname, '../glRenderer.ts'), 'utf8')

/**
 * The vertex shader's arithmetic, transcribed into TypeScript.
 *
 * The shader cannot be executed here, and it is a second implementation of a
 * projection that `scene.ts` already defines — the exact shape of drift this
 * module has already suffered once, when the shader read alpha's sine and
 * cosine in the opposite order and drew the surface nearly face-on while the
 * CPU-projected markers over it stayed correct. Transcribing it and checking
 * the two agree is the only guard available short of a GPU in the test run,
 * and it fails the moment either side is edited alone.
 */
function shaderProject(
  camera: ReturnType<typeof meshCameraFor> & object,
  x: number,
  y: number,
  z: number,
): [number, number] {
  const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
  const ux = (x - camera.centreX) / camera.longest
  const uy = -((y - camera.centreY) / camera.longest)
  const uz = (clamp(z, -camera.zMax, camera.zMax) / camera.zMax) * (camera.boxHeight * 0.5)

  const rotatedX = ux * camera.cosBeta - uy * camera.sinBeta
  const rotatedY = ux * camera.sinBeta + uy * camera.cosBeta
  const screenY = rotatedY * camera.sinAlpha - uz * camera.cosAlpha
  const toward = rotatedY * camera.cosAlpha + uz * camera.sinAlpha

  const mix = (from: number, to: number, amount: number) => from + (to - from) * amount
  const fitZoom = camera.fit * camera.zoom
  let flat: [number, number] = [rotatedX, screenY]

  if (camera.obliqueNorm > 0) {
    const depth = -uy
    const skewed: [number, number] = [ux + depth * camera.obliqueX, -uz - depth * camera.obliqueY]
    flat = [
      mix(flat[0], skewed[0], camera.projectionAmount),
      mix(flat[1], skewed[1], camera.projectionAmount),
    ]
  } else {
    const lensDepth = camera.uprightsParallel > 0.5 ? rotatedY * camera.cosAlpha : toward
    let lens = 1
    if (camera.lens === 'perspective') {
      const shrink =
        camera.perspectiveDistance / Math.max(0.2, camera.perspectiveDistance - lensDepth)
      lens = 1 + (shrink - 1) * camera.projectionAmount
    } else if (camera.lens === 'fisheye') {
      const radius = Math.sqrt(flat[0] * flat[0] + flat[1] * flat[1])
      const warp = 1 + camera.fisheyeStrength * radius * radius
      lens = 1 + (warp - 1) * camera.projectionAmount
    }
    flat = [flat[0] * lens, flat[1] * lens]
  }

  return [flat[0] * fitZoom + camera.offsetX, flat[1] * fitZoom + camera.offsetY]
}

describe('the vertex shader and the CPU camera', () => {
  it('place every point identically, for every projection and angle', () => {
    // Every one of them, not a representative few: the projections differ in
    // which branch of the shader they take, and a family added to
    // `meshProjections` without a matching branch is exactly the drift this
    // guards.
    for (const projection of Object.keys(meshProjections) as MeshProjection[]) {
      for (const orientation of Object.values(meshOrientationPresets)) {
        for (const amount of [0, 0.5, 1]) {
          const camera = meshCameraFor({
            bed,
            layers: [],
            zMax: 0.5,
            orientation,
            viewport: { width: 360, height: 240 },
            projection,
            projectionAmount: amount,
            zoom: 1.4,
          })
          expect(camera).not.toBeNull()
          if (!camera) continue

          for (const [x, y, z] of [
            [0, 0, 0],
            [250, 210, 0.4],
            [125, 105, -0.3],
            [40, 190, 0.12],
          ]) {
            const cpu = projectWithCamera(camera, x ?? 0, y ?? 0, z ?? 0)
            const gpu = shaderProject(camera, x ?? 0, y ?? 0, z ?? 0)
            const placed = [
              cpu[0] * camera.fit * camera.zoom + camera.offsetX,
              cpu[1] * camera.fit * camera.zoom + camera.offsetY,
            ]
            expect(gpu[0]).toBeCloseTo(placed[0] ?? 0, 9)
            expect(gpu[1]).toBeCloseTo(placed[1] ?? 0, 9)
          }
        }
      }
    }
  })

  it('reads each angle by name in the shader, never from a packed pair', () => {
    // The swap that caused the original defect is only possible when cos and
    // sin travel together in one vec2 and are read positionally.
    expect(source).toContain('uniform float u_cosAlpha;')
    expect(source).toContain('uniform float u_sinAlpha;')
    expect(source).toContain('float screenY = rotatedY * u_sinAlpha - uz * u_cosAlpha;')
    expect(source).toContain('float toward = rotatedY * u_cosAlpha + uz * u_sinAlpha;')
  })

  it('branches on the lens and the camera, never on a projection name', () => {
    // A shader that knew the taxonomy would need a branch per member, and the
    // one forgotten would silently draw as orthographic. It gets a lens code
    // and the resolved skew and upright flags instead, so a projection added to
    // `meshProjections` reaches the GPU without this file being touched.
    expect(source).toContain('uniform int u_lens;')
    expect(source).toContain('uniform float u_obliqueNorm;')
    expect(source).toContain('uniform float u_uprightsParallel;')

    const [shader] = /const vertexSource = `[\s\S]*?`/.exec(source) ?? []
    expect(shader).toBeDefined()
    for (const name of Object.keys(meshProjections)) {
      // `u_perspective` is the camera distance, not a branch on the name.
      const named = new RegExp(`(?<!u_)\\b${name}\\b`, 'i')
      expect(named.test(shader ?? ''), `the vertex shader names ${name}`).toBe(false)
    }
  })

  it('keeps the shader ramp in step with the five stops the legend draws', () => {
    // The gradient exists twice — once in meshRampColor for the legend and the
    // probed number ink, once in the fragment shader for the surface itself.
    expect(source).toContain('if (position < -0.5) colour = mix(u_low, u_lowDeep,')
    expect(source).toContain('else if (position < 0.0) colour = mix(u_middle, u_low,')
    expect(source).toContain('else if (position < 0.5) colour = mix(u_middle, u_high,')
    expect(source).toContain('else colour = mix(u_high, u_highDeep,')
  })

  it("draws the wireframe in a fixed black, never the theme's line colour", () => {
    // A wireframe that changed colour with the theme read as UI chrome tinted
    // to match the card around it, rather than a feature of the surface
    // itself — the one thing a wireframe most needs to look like.
    const wireframeBlock =
      /else if \(layer\.wireframe[\s\S]*?gl\.drawElements\(gl\.LINES[\s\S]*?\)/.exec(source)?.[0]
    expect(wireframeBlock).toBeDefined()
    expect(wireframeBlock).toContain('wireframeInk')
    expect(wireframeBlock).not.toContain('palette.line')
  })

  it('biases the wireframe in the vertex shader, never with gl.polygonOffset', () => {
    // WebGL only ever applies polygon offset to filled triangles, never to
    // `gl.LINES` — so a wireframe drawn against its own coincident surface
    // needs the bias to reach the vertex shader instead, or it does nothing
    // and the two rasterizations of identical vertices flicker against each
    // other at random.
    expect(source).toContain('uniform float u_depthBias;')
    expect(source).toContain('gl_Position = vec4(ndc, -toward - u_depthBias, 1.0);')
    expect(source).not.toContain('POLYGON_OFFSET')
    const wireframeBlock =
      /else if \(layer\.wireframe[\s\S]*?gl\.drawElements\(gl\.LINES[\s\S]*?\)/.exec(source)?.[0]
    expect(wireframeBlock).toContain('wireframeDepthBias')
  })
})
