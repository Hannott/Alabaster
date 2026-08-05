/**
 * The bed mesh height map, drawn on the GPU.
 *
 * This replaced a Canvas 2D painter, for two reasons that are really one.
 *
 * **Correctness.** Canvas 2D has no depth buffer, so the only way to decide
 * what covers what is to sort whole polygons by their average depth and paint
 * back to front. Two surfaces that genuinely cross each other — the level
 * reference plane through the bed, most often — have no correct polygon order
 * at any resolution: a single quad is either in front or behind, when the
 * truth is that it is both, on either side of the line where they meet. A
 * depth buffer resolves that per pixel, which is the only place the answer
 * actually exists.
 *
 * **Cost.** Sorting and stroking a few thousand quads on the CPU cost about
 * twelve milliseconds a frame for a scene that is, in the end, a grid of
 * points with lines between them. The same geometry uploaded once and
 * transformed in a vertex shader costs a fraction of a millisecond, and stops
 * depending on how dense `mesh_pps` happens to be — so the detail cap this
 * module used to need is gone.
 *
 * The camera is deliberately not reimplemented here: `projectWithCamera` in
 * `scene.ts` is the definition, and `cameraUniforms` below feeds the identical
 * arithmetic to the shader. The axes, the probe markers and pointer
 * hit-testing all run the CPU copy, so the two must agree to the pixel.
 */

import { buildMeshGeometry, type MeshGeometry, type MeshRenderStyle } from './geometry'
import type { MeshCamera } from './scene'

export type MeshRgb = readonly [number, number, number]

/**
 * How solid the box's own grid is, at full fade-in.
 *
 * The box is the frame of reference the surface is read against — which corner
 * is near, how high a peak stands against the axis — so it has to be legible,
 * not merely present. It was carried over at the opacity a flat 2D painter had
 * used, where it was drawn over nothing; against a lit surface on a dark card
 * that read as almost invisible.
 */
const guideOpacity = 0.7
/** The surface's own wireframe, over the fill it belongs to. */
const wireframeOpacity = 0.45
/**
 * Always black, never `palette.line` — a wireframe reads as the surface's
 * own structure, the way a real print bed's mesh lines would, only if its
 * ink stays the same regardless of theme. Drawn from the palette instead, it
 * read as a UI overlay tinted to match the chrome around it rather than a
 * feature of the surface itself.
 */
const wireframeInk: MeshRgb = [0, 0, 0]
/**
 * How far `u_depthBias` pulls the wireframe toward the camera, in the same
 * clip-space units as `toward` itself — which this camera keeps well inside
 * a unit box, so this is a small fraction of the whole scene's depth range,
 * comfortably larger than the rounding gap between two rasterizations of the
 * identical vertices, and comfortably smaller than the depth between any two
 * surfaces that actually differ.
 */
const wireframeDepthBias = 0.002

/**
 * Matches the `u_lens` branch in the vertex shader.
 *
 * Keyed on the lens rather than on the projection, so adding a member of the
 * taxonomy never touches this file: a new projection resolves to one of these
 * three formulas plus the angle, skew, and upright flags the camera already
 * carries.
 */
const lensCode: Record<MeshCamera['lens'], number> = {
  parallel: 0,
  perspective: 1,
  fisheye: 2,
}

export interface MeshGlPalette {
  lowDeep: MeshRgb
  low: MeshRgb
  middle: MeshRgb
  high: MeshRgb
  highDeep: MeshRgb
  plane: MeshRgb
  guide: MeshRgb
}

/**
 * What to draw for one uploaded key, and how. Separate from the grid that built
 * it, because not everything drawn here came from a grid — the easter egg
 * uploads its geometry directly.
 */
export interface MeshGlDraw {
  key: string
  opacity: number
  /** Drawn in the flat-plane colour rather than from the deviation ramp. */
  neutral?: boolean
  /** Reads the ramp from its opposite end, to separate near-coincident layers. */
  invertRamp?: boolean
  /** Draws this layer's own grid lines over it. */
  wireframe?: boolean
}

export interface MeshGlLayer extends MeshGlDraw {
  /** Row-major grid of deviations, in millimetres. */
  matrix: readonly (readonly number[])[]
  area: { minX: number; maxX: number; minY: number; maxY: number }
  /** What the grid is turned into: a skin, columns, iso-lines, or terraces. */
  style?: MeshRenderStyle
  /** The height interval terraces snap to and contour lines are drawn at. */
  bandStep?: number
}

export interface MeshGlFrame {
  camera: MeshCamera
  palette: MeshGlPalette
  /** The colour scale, which is not the height scale. */
  scale: { low: number; high: number }
  /** Box grid lines, in bed coordinates. */
  guides: readonly (readonly [number, number, number])[]
  guideAlpha: number
  /** CSS pixels. */
  width: number
  height: number
  pixelRatio: number
}

const vertexSource = `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_bed;
// The reading this vertex is coloured for, which is not always its own height:
// a bar's foot sits on the zero plane and still belongs to the value at its
// top. Sharing one attribute drew every column with a gradient up it.
layout(location = 1) in float a_deviation;

uniform vec2 u_centre;
uniform float u_longest;
uniform float u_zMax;
uniform float u_boxHeight;
// Named one per angle rather than packed into a vec2. Packing them as
// (cos, sin) and then reading .x/.y in the wrong order is exactly how this
// shader first went wrong: the surface came out nearly face-on while the
// CPU-projected probe markers over it were correct, because alpha's sine and
// cosine had swapped roles.
uniform float u_cosAlpha;
uniform float u_sinAlpha;
uniform float u_cosBeta;
uniform float u_sinBeta;
uniform int u_lens;
uniform float u_amount;
uniform float u_perspective;
uniform float u_fisheye;
uniform float u_obliqueX;
uniform float u_obliqueY;
uniform float u_obliqueNorm;
uniform float u_uprightsParallel;
uniform float u_fitZoom;
uniform vec2 u_offset;        // CSS pixels
uniform vec2 u_resolution;    // CSS pixels
// Only ever set while drawing a surface's own wireframe over itself: the two
// share every vertex, so their depth is not merely close but identical, and
// identical depth computed twice — once rasterizing triangles, once lines —
// still rounds to two different values often enough to flicker one away.
// This is that fix, done in the vertex shader rather than with WebGL's
// polygon offset, which only ever applies to filled triangles, never to a
// line primitive, so it silently did nothing for a wireframe. It stays zero
// for every other draw, and is far too small to reorder two surfaces that
// actually differ in depth.
uniform float u_depthBias;

out float v_deviation;

void main() {
  // The identical arithmetic to projectWithCamera in scene.ts. Any change here
  // is a change there.
  float ux = (a_bed.x - u_centre.x) / u_longest;
  float uy = -((a_bed.y - u_centre.y) / u_longest);
  float uz = (clamp(a_bed.z, -u_zMax, u_zMax) / u_zMax) * (u_boxHeight * 0.5);

  float rotatedX = ux * u_cosBeta - uy * u_sinBeta;
  float rotatedY = ux * u_sinBeta + uy * u_cosBeta;
  float screenY = rotatedY * u_sinAlpha - uz * u_cosAlpha;
  float toward = rotatedY * u_cosAlpha + uz * u_sinAlpha;

  vec2 flat2d = vec2(rotatedX, screenY);

  if (u_obliqueNorm > 0.0) {
    // Oblique replaces the turned camera instead of sitting on top of it, and
    // is blended in by the same amount, so the flat map still morphs into it.
    float depth = -uy;
    vec2 skewed = vec2(ux + depth * u_obliqueX, -uz - depth * u_obliqueY);
    float skewedToward = (ux * u_obliqueX - depth + uz * u_obliqueY) / u_obliqueNorm;
    flat2d = mix(flat2d, skewed, u_amount);
    toward = mix(toward, skewedToward, u_amount);
  } else {
    // Along the ground rather than along the full view ray when uprights must
    // stay parallel: that is the whole of two-point versus three-point.
    float lensDepth = u_uprightsParallel > 0.5 ? rotatedY * u_cosAlpha : toward;
    float lens = 1.0;
    if (u_lens == 1) {
      float shrink = u_perspective / max(0.2, u_perspective - lensDepth);
      lens = 1.0 + (shrink - 1.0) * u_amount;
    } else if (u_lens == 2) {
      float radius = length(flat2d);
      float warp = 1.0 + u_fisheye * radius * radius;
      lens = 1.0 + (warp - 1.0) * u_amount;
    }
    flat2d *= lens;
  }

  vec2 css = flat2d * u_fitZoom + u_offset;
  vec2 ndc = vec2(css.x / u_resolution.x * 2.0 - 1.0, 1.0 - css.y / u_resolution.y * 2.0);

  // Nearer is a smaller depth, so the default LESS test keeps the near surface.
  // The toward value stays well inside a unit box, so it needs no further
  // normalisation to land in clip space. Subtracting the bias makes this
  // vertex read as nearer, which is the whole of what it is for.
  gl_Position = vec4(ndc, -toward - u_depthBias, 1.0);
  v_deviation = a_deviation;
}`

const fragmentSource = `#version 300 es
precision highp float;

in float v_deviation;

uniform vec3 u_lowDeep;
uniform vec3 u_low;
uniform vec3 u_middle;
uniform vec3 u_high;
uniform vec3 u_highDeep;
uniform vec3 u_flat;
uniform vec2 u_scale;      // low, high
uniform float u_opacity;
uniform float u_neutral;
uniform float u_invert;
uniform float u_solid;     // 1 when drawing a line in u_flat, ignoring the ramp

out vec4 out_color;

void main() {
  if (u_neutral > 0.5 || u_solid > 0.5) {
    out_color = vec4(u_flat, u_opacity);
    return;
  }

  // The same five-stop ramp as meshRampColor: full saturation at the midpoint
  // of each half, the deeper shade only at the true extreme.
  float middle = (u_scale.y + u_scale.x) * 0.5;
  float reach = (u_scale.y - u_scale.x) * 0.5;
  float position = reach <= 0.0 ? 0.0 : clamp((v_deviation - middle) / reach, -1.0, 1.0);
  if (u_invert > 0.5) position = -position;

  vec3 colour;
  if (position < -0.5) colour = mix(u_low, u_lowDeep, (-position - 0.5) / 0.5);
  else if (position < 0.0) colour = mix(u_middle, u_low, -position / 0.5);
  else if (position < 0.5) colour = mix(u_middle, u_high, position / 0.5);
  else colour = mix(u_high, u_highDeep, (position - 0.5) / 0.5);

  out_color = vec4(colour, u_opacity);
}`

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Unable to create a WebGL shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'Unknown shader compilation error'
    gl.deleteShader(shader)
    throw new Error(log)
  }
  return shader
}

interface LayerBuffers {
  /** Interleaved x, y, z, deviation per vertex. */
  vertices: WebGLBuffer
  triangles: WebGLBuffer
  triangleCount: number
  lines: WebGLBuffer
  lineCount: number
  linesAreTheDrawing: boolean
}

/** Floats per vertex: three of position, one of colour. */
const vertexStride = 4

export class MeshGlRenderer {
  private readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly vertexArray: WebGLVertexArrayObject
  private readonly guideBuffer: WebGLBuffer
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>()
  private readonly layers = new Map<string, LayerBuffers>()
  private guideCount = 0

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      depth: true,
      premultipliedAlpha: false,
    })
    if (!gl) throw new Error('WebGL 2 is not available')
    this.gl = gl

    const program = gl.createProgram()
    if (!program) throw new Error('Unable to create a WebGL program')
    const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource)
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource)
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? 'Unknown WebGL link error'
      gl.deleteProgram(program)
      throw new Error(log)
    }
    this.program = program

    const vertexArray = gl.createVertexArray()
    const guideBuffer = gl.createBuffer()
    if (!vertexArray || !guideBuffer) throw new Error('Unable to allocate WebGL geometry')
    this.vertexArray = vertexArray
    this.guideBuffer = guideBuffer

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
  }

  private location(name: string): WebGLUniformLocation | null {
    if (!this.uniforms.has(name)) {
      this.uniforms.set(name, this.gl.getUniformLocation(this.program, name))
    }
    return this.uniforms.get(name) ?? null
  }

  /**
   * Uploads a layer's geometry. Called when the mesh changes, not per frame —
   * the camera moves entirely in the vertex shader, so an orbit re-transforms
   * the same buffers rather than rebuilding them.
   */
  setLayer(layer: MeshGlLayer): void {
    this.setGeometry(
      layer.key,
      buildMeshGeometry({
        matrix: layer.matrix,
        area: layer.area,
        style: layer.style ?? 'surface',
        bandStep: layer.bandStep ?? 0,
      }),
    )
  }

  /**
   * Uploads geometry that did not come from a grid. The same buffers and the
   * same shader — only the thing that decided the triangles is different.
   */
  setGeometry(key: string, geometry: MeshGeometry): void {
    const gl = this.gl
    const count = geometry.positions.length / 3
    if (count === 0) {
      this.removeLayer(key)
      return
    }

    const vertices = new Float32Array(count * vertexStride)
    for (let index = 0; index < count; index += 1) {
      vertices[index * vertexStride] = geometry.positions[index * 3] ?? 0
      vertices[index * vertexStride + 1] = geometry.positions[index * 3 + 1] ?? 0
      vertices[index * vertexStride + 2] = geometry.positions[index * 3 + 2] ?? 0
      vertices[index * vertexStride + 3] = geometry.deviations[index] ?? 0
    }

    const existing = this.layers.get(key)
    const buffers: LayerBuffers = existing ?? {
      vertices: gl.createBuffer() as WebGLBuffer,
      triangles: gl.createBuffer() as WebGLBuffer,
      triangleCount: 0,
      lines: gl.createBuffer() as WebGLBuffer,
      lineCount: 0,
      linesAreTheDrawing: false,
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vertices)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.triangles)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(geometry.triangles), gl.STATIC_DRAW)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.lines)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(geometry.lines), gl.STATIC_DRAW)
    buffers.triangleCount = geometry.triangles.length
    buffers.lineCount = geometry.lines.length
    buffers.linesAreTheDrawing = geometry.linesAreTheDrawing
    this.layers.set(key, buffers)
  }

  removeLayer(key: string): void {
    const buffers = this.layers.get(key)
    if (!buffers) return
    this.gl.deleteBuffer(buffers.vertices)
    this.gl.deleteBuffer(buffers.triangles)
    this.gl.deleteBuffer(buffers.lines)
    this.layers.delete(key)
  }

  setGuides(points: readonly (readonly [number, number, number])[]): void {
    const gl = this.gl
    const data = new Float32Array(points.length * 3)
    points.forEach((point, index) => {
      data[index * 3] = point[0]
      data[index * 3 + 1] = point[1]
      data[index * 3 + 2] = point[2]
    })
    gl.bindBuffer(gl.ARRAY_BUFFER, this.guideBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
    this.guideCount = points.length
  }

  private cameraUniforms(frame: MeshGlFrame): void {
    const gl = this.gl
    const { camera } = frame
    gl.uniform2f(this.location('u_centre'), camera.centreX, camera.centreY)
    gl.uniform1f(this.location('u_longest'), camera.longest)
    gl.uniform1f(this.location('u_zMax'), camera.zMax)
    gl.uniform1f(this.location('u_boxHeight'), camera.boxHeight)
    gl.uniform1f(this.location('u_cosAlpha'), camera.cosAlpha)
    gl.uniform1f(this.location('u_sinAlpha'), camera.sinAlpha)
    gl.uniform1f(this.location('u_cosBeta'), camera.cosBeta)
    gl.uniform1f(this.location('u_sinBeta'), camera.sinBeta)
    gl.uniform1i(this.location('u_lens'), lensCode[camera.lens] ?? 0)
    gl.uniform1f(this.location('u_obliqueX'), camera.obliqueX)
    gl.uniform1f(this.location('u_obliqueY'), camera.obliqueY)
    gl.uniform1f(this.location('u_obliqueNorm'), camera.obliqueNorm)
    gl.uniform1f(this.location('u_uprightsParallel'), camera.uprightsParallel)
    gl.uniform1f(this.location('u_amount'), camera.projectionAmount)
    gl.uniform1f(this.location('u_perspective'), camera.perspectiveDistance)
    gl.uniform1f(this.location('u_fisheye'), camera.fisheyeStrength)
    gl.uniform1f(this.location('u_fitZoom'), camera.fit * camera.zoom)
    gl.uniform2f(this.location('u_offset'), camera.offsetX, camera.offsetY)
    gl.uniform2f(this.location('u_resolution'), frame.width, frame.height)

    const { palette } = frame
    const rgb = (name: string, colour: MeshRgb): void => {
      gl.uniform3f(this.location(name), colour[0] / 255, colour[1] / 255, colour[2] / 255)
    }
    rgb('u_lowDeep', palette.lowDeep)
    rgb('u_low', palette.low)
    rgb('u_middle', palette.middle)
    rgb('u_high', palette.high)
    rgb('u_highDeep', palette.highDeep)
    gl.uniform2f(this.location('u_scale'), frame.scale.low, frame.scale.high)
  }

  render(frame: MeshGlFrame, layers: readonly MeshGlDraw[]): void {
    const gl = this.gl
    const ratio = Math.min(2, Math.max(1, frame.pixelRatio))
    const deviceWidth = Math.max(1, Math.round(frame.width * ratio))
    const deviceHeight = Math.max(1, Math.round(frame.height * ratio))
    if (this.canvas.width !== deviceWidth) this.canvas.width = deviceWidth
    if (this.canvas.height !== deviceHeight) this.canvas.height = deviceHeight
    gl.viewport(0, 0, deviceWidth, deviceHeight)

    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    gl.useProgram(this.program)
    gl.bindVertexArray(this.vertexArray)
    this.cameraUniforms(frame)

    const bytes = Float32Array.BYTES_PER_ELEMENT
    const bindLayerVertices = (buffer: WebGLBuffer): void => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, vertexStride * bytes, 0)
      gl.enableVertexAttribArray(1)
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, vertexStride * bytes, 3 * bytes)
    }

    // The box grid is positions only. Its colour is a uniform, so the deviation
    // attribute is switched off and given a constant rather than being padded
    // into the buffer — a leftover pointer here would read the guide's own y as
    // a deviation the moment the shader stopped ignoring it.
    const bindGuideVertices = (buffer: WebGLBuffer): void => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0)
      gl.disableVertexAttribArray(1)
      gl.vertexAttrib1f(1, 0)
    }

    // The box grid first, and behind everything: it is depth-tested like the
    // rest, so the surface hides the part of the box that is genuinely behind
    // it rather than the grid showing through as it did when painted flat.
    if (this.guideCount > 0 && frame.guideAlpha > 0.01) {
      bindGuideVertices(this.guideBuffer)
      gl.uniform1f(this.location('u_solid'), 1)
      gl.uniform1f(this.location('u_neutral'), 0)
      gl.uniform1f(this.location('u_invert'), 0)
      gl.uniform1f(this.location('u_depthBias'), 0)
      gl.uniform1f(this.location('u_opacity'), frame.guideAlpha * guideOpacity)
      const guide = frame.palette.guide
      gl.uniform3f(this.location('u_flat'), guide[0] / 255, guide[1] / 255, guide[2] / 255)
      gl.drawArrays(gl.LINES, 0, this.guideCount)
    }

    // Opaque layers first, then translucent ones with depth writes off — the
    // standard order. Writing depth from a see-through surface would let it
    // hide whatever is behind it, which is the one thing it must not do.
    const ordered = [...layers].sort((first, second) => second.opacity - first.opacity)
    for (const layer of ordered) {
      const buffers = this.layers.get(layer.key)
      const hasNothingToDraw = buffers && buffers.triangleCount === 0 && buffers.lineCount === 0
      if (!buffers || hasNothingToDraw) continue
      const translucent = layer.opacity < 1
      gl.depthMask(!translucent)

      bindLayerVertices(buffers.vertices)
      gl.uniform1f(this.location('u_opacity'), layer.opacity)
      gl.uniform1f(this.location('u_neutral'), layer.neutral ? 1 : 0)
      gl.uniform1f(this.location('u_invert'), layer.invertRamp ? 1 : 0)
      gl.uniform1f(this.location('u_solid'), 0)
      gl.uniform1f(this.location('u_depthBias'), 0)
      const plane = frame.palette.plane
      gl.uniform3f(this.location('u_flat'), plane[0] / 255, plane[1] / 255, plane[2] / 255)

      if (buffers.triangleCount > 0) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.triangles)
        gl.drawElements(gl.TRIANGLES, buffers.triangleCount, gl.UNSIGNED_INT, 0)
      }

      // A contour map has no surface to outline: the lines are the drawing, so
      // they ignore the wireframe setting, keep the layer's own opacity, and
      // stay on the deviation ramp rather than dropping to the flat line ink.
      if (buffers.linesAreTheDrawing) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.lines)
        gl.drawElements(gl.LINES, buffers.lineCount, gl.UNSIGNED_INT, 0)
      } else if (layer.wireframe && buffers.lineCount > 0) {
        // Depth-tested with the rest, so a line behind the surface is hidden
        // by it — but the two share every vertex, so without a bias their
        // depth is not merely close but identical, and computed twice (once
        // rasterizing the triangles, once the lines) it still rounds
        // differently often enough to flicker a segment away. `gl.polygonOffset`
        // cannot fix this: WebGL only ever applies it to filled triangles,
        // never to `gl.LINES`. `u_depthBias` is the same idea, done where it
        // actually reaches the lines.
        gl.uniform1f(this.location('u_solid'), 1)
        gl.uniform1f(this.location('u_opacity'), wireframeOpacity)
        gl.uniform1f(this.location('u_depthBias'), wireframeDepthBias)
        gl.uniform3f(this.location('u_flat'), wireframeInk[0], wireframeInk[1], wireframeInk[2])
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.lines)
        gl.drawElements(gl.LINES, buffers.lineCount, gl.UNSIGNED_INT, 0)
      }
    }

    gl.depthMask(true)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    for (const key of [...this.layers.keys()]) this.removeLayer(key)
    this.gl.deleteBuffer(this.guideBuffer)
    this.gl.deleteVertexArray(this.vertexArray)
    this.gl.deleteProgram(this.program)
  }
}
