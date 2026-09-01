/**
 * How a mesh is turned into triangles and lines.
 *
 * The projection decides where the camera stands; this decides what is standing
 * there. They are independent on purpose — every style is drawn by the same
 * vertex shader, so a style costs nothing at the camera and a projection costs
 * nothing here.
 *
 * Two things every builder shares.
 *
 * A vertex carries **a position and a deviation, separately**. For the surface
 * they are the same number, but a bar's foot sits on the zero plane while still
 * being colored for the reading at its top — so height and color cannot be
 * the same attribute. Getting this wrong draws every column with a gradient
 * running up it, which reads as a value the printer never reported.
 *
 * And the **band interval is shared** with the height axis: the contour lines
 * and the terrace treads land on the same ladder the axis is already numbered
 * with, so a step read off one can be found on the other.
 *
 * Nothing here touches the DOM or WebGL.
 */

/**
 * Surface is the plain interpolated skin. The other four each answer a
 * question it is bad at: bars show the probed points as the discrete
 * measurements they actually are, contour says exactly where a given deviation
 * falls, terraces group the bed into bands so its overall shape reads without
 * tracing a gradient, and mosaic is bars pushed edge to edge — one flat tile
 * per probed point, colored for its own exact reading rather than an average
 * or a band, so the number the overlay writes over a tile always names the
 * reading that tile is colored for.
 */
export type MeshRenderStyle = 'surface' | 'bars' | 'contour' | 'terraced' | 'mosaic'

export interface MeshGeometry {
  /** x, y, z triples in bed coordinates. */
  positions: number[]
  /** One deviation per vertex, for the color ramp. */
  deviations: number[]
  triangles: number[]
  lines: number[]
  /**
   * True when the lines are the drawing rather than an overlay on it. Contour
   * has no surface to outline, so its lines ignore the wireframe setting, take
   * the layer's own opacity, and are colored from the ramp rather than drawn
   * in the flat line color.
   */
  linesAreTheDrawing: boolean
}

export interface MeshGeometryInput {
  matrix: readonly (readonly number[])[]
  area: { minX: number; maxX: number; minY: number; maxY: number }
  style: MeshRenderStyle
  /** The height interval terraces snap to and contour lines are drawn at. */
  bandStep: number
}

/**
 * How much of its cell a column fills.
 *
 * Bars are thin enough to read as separate columns with the bed visible
 * between them. Terraces are nearly full width so they read as one stepped
 * solid — but not *exactly* full width, because neighboring blocks would then
 * share their side faces exactly, and two coincident faces at the same depth
 * flicker against each other as the camera turns.
 */
const barFootprint = 0.6
const terraceFootprint = 0.9
/**
 * Mosaic exists to read as a seamless grid — the flat heat map with a number
 * in every cell — so its footprint goes further than a terrace's, right to
 * the edge its neighbor also stops short of. Not exactly 1: two neighboring
 * tiles would then share a side face exactly, and two coincident faces at the
 * same depth flicker against each other as the camera turns, the same problem
 * terraces stop short of at 0.9.
 */
const mosaicFootprint = 0.97

export function emptyGeometry(): MeshGeometry {
  return { positions: [], deviations: [], triangles: [], lines: [], linesAreTheDrawing: false }
}

/** The interpolated skin: one vertex per grid point, shared by everything on it. */
function buildSurface(input: MeshGeometryInput): MeshGeometry {
  const { matrix, area } = input
  const rows = matrix.length
  const columns = matrix[0]?.length ?? 0
  const geometry = emptyGeometry()
  const stepX = (area.maxX - area.minX) / (columns - 1)
  const stepY = (area.maxY - area.minY) / (rows - 1)

  for (let row = 0; row < rows; row += 1) {
    const y = area.minY + row * stepY
    for (let column = 0; column < columns; column += 1) {
      const value = matrix[row]?.[column] ?? 0
      geometry.positions.push(area.minX + column * stepX, y, value)
      geometry.deviations.push(value)
    }
  }

  const at = (row: number, column: number): number => row * columns + column
  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const a = at(row, column)
      const b = at(row, column + 1)
      const c = at(row + 1, column + 1)
      const d = at(row + 1, column)
      geometry.triangles.push(a, b, c, a, c, d)
    }
  }
  // The grid's own interior edges, each exactly once. Outlining every cell
  // separately draws each shared edge twice — wasted work, and at partial
  // opacity a visibly darker line.
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      geometry.lines.push(at(row, column), at(row, column + 1))
    }
  }
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows - 1; row += 1) {
      geometry.lines.push(at(row, column), at(row + 1, column))
    }
  }
  return geometry
}

/**
 * One box standing on the zero plane, all eight corners carrying the reading it
 * was built for so the whole column takes a single color.
 */
export function pushBox(
  geometry: MeshGeometry,
  area: MeshGeometryInput['area'],
  x: number,
  y: number,
  halfWidth: number,
  halfDepth: number,
  floor: number,
  height: number,
  deviation: number,
  /**
   * Clipped to the probed area by default. A column stands on a point, and
   * the points on the outer ring sit exactly on the boundary — so half of
   * every edge column would be drawn over bed that was never measured,
   * claiming a reading for it. Mosaic turns this off: it draws a complete
   * grid rather than columns, and a grid's outer cells are whole cells, not
   * bed that was never measured — the point at the boundary is still the
   * middle of its own tile, not the tile's edge.
   */
  clipToArea = true,
): void {
  const base = geometry.positions.length / 3
  const left = clipToArea ? Math.max(area.minX, x - halfWidth) : x - halfWidth
  const right = clipToArea ? Math.min(area.maxX, x + halfWidth) : x + halfWidth
  const near = clipToArea ? Math.max(area.minY, y - halfDepth) : y - halfDepth
  const far = clipToArea ? Math.min(area.maxY, y + halfDepth) : y + halfDepth
  const corners: Array<[number, number]> = [
    [left, near],
    [right, near],
    [right, far],
    [left, far],
  ]
  for (const z of [floor, height]) {
    for (const [cornerX, cornerY] of corners) {
      geometry.positions.push(cornerX, cornerY, z)
      geometry.deviations.push(deviation)
    }
  }

  const quad = (a: number, b: number, c: number, d: number): void => {
    geometry.triangles.push(base + a, base + b, base + c, base + a, base + c, base + d)
  }
  // Both caps and all four walls. The bottom cap is not wasted: a bed that
  // dips gives a top below the floor, and the box then hangs under the plane
  // with its underside facing the camera.
  quad(0, 1, 2, 3)
  quad(4, 5, 6, 7)
  quad(0, 1, 5, 4)
  quad(1, 2, 6, 5)
  quad(2, 3, 7, 6)
  quad(3, 0, 4, 7)

  for (let corner = 0; corner < 4; corner += 1) {
    const next = (corner + 1) % 4
    geometry.lines.push(base + corner, base + next)
    geometry.lines.push(base + 4 + corner, base + 4 + next)
    geometry.lines.push(base + corner, base + 4 + corner)
  }
}

/**
 * One flat-topped column per probed point, at a given fraction of its cell.
 * Bars and mosaic are the same shape at two different footprints — a thin
 * column that stands apart from its neighbors, or one pushed edge to edge
 * with them — so they share this rather than each carrying their own copy of
 * an identical loop.
 */
function buildColumns(
  input: MeshGeometryInput,
  footprint: number,
  clipToArea: boolean,
): MeshGeometry {
  const { matrix, area } = input
  const rows = matrix.length
  const columns = matrix[0]?.length ?? 0
  const geometry = emptyGeometry()
  const stepX = (area.maxX - area.minX) / (columns - 1)
  const stepY = (area.maxY - area.minY) / (rows - 1)

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const value = matrix[row]?.[column] ?? 0
      pushBox(
        geometry,
        area,
        area.minX + column * stepX,
        area.minY + row * stepY,
        (stepX * footprint) / 2,
        (stepY * footprint) / 2,
        0,
        value,
        value,
        clipToArea,
      )
    }
  }
  return geometry
}

/** A column per probed point: the measurements as the discrete things they are. */
function buildBars(input: MeshGeometryInput): MeshGeometry {
  return buildColumns(input, barFootprint, true)
}

/**
 * A tile per probed point, pushed edge to edge into a seamless grid. Its
 * outer row and column are not clipped to the probed area the way bars are:
 * a grid's edge cells are whole cells, so mosaic draws them whole, half
 * outside the strict area, rather than as the half-tiles clipping would leave
 * — which is what turned the outer ring into a frame of slivers around a full
 * grid instead of a rectangle of them.
 */
function buildMosaic(input: MeshGeometryInput): MeshGeometry {
  return buildColumns(input, mosaicFootprint, false)
}

/**
 * The bed grouped into height bands, one block per cell.
 *
 * Per cell rather than per point, because a terrace is a flat tread and a cell
 * is the only thing here with an area. The block's height and its color both
 * come from the snapped value, so the treads and the gradient step together
 * rather than a smooth color running over a stepped shape.
 */
function buildTerraced(input: MeshGeometryInput): MeshGeometry {
  const { matrix, area, bandStep } = input
  const rows = matrix.length
  const columns = matrix[0]?.length ?? 0
  const geometry = emptyGeometry()
  if (!(bandStep > 0)) return geometry
  const stepX = (area.maxX - area.minX) / (columns - 1)
  const stepY = (area.maxY - area.minY) / (rows - 1)

  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const average =
        ((matrix[row]?.[column] ?? 0) +
          (matrix[row]?.[column + 1] ?? 0) +
          (matrix[row + 1]?.[column + 1] ?? 0) +
          (matrix[row + 1]?.[column] ?? 0)) /
        4
      const banded = Math.round(average / bandStep) * bandStep
      pushBox(
        geometry,
        area,
        area.minX + (column + 0.5) * stepX,
        area.minY + (row + 0.5) * stepY,
        (stepX * terraceFootprint) / 2,
        (stepY * terraceFootprint) / 2,
        0,
        banded,
        banded,
      )
    }
  }
  return geometry
}

/**
 * Iso-height lines, by marching triangles rather than marching squares.
 *
 * A square has two ways to resolve a saddle and no local information to choose
 * between them, which is how a contour map grows a crossing that is not in the
 * data. A triangle has no such case: a plane crosses it on exactly zero or two
 * edges, so every segment follows from the three corners alone.
 */
function buildContour(input: MeshGeometryInput): MeshGeometry {
  const { matrix, area, bandStep } = input
  const rows = matrix.length
  const columns = matrix[0]?.length ?? 0
  const geometry = emptyGeometry()
  if (!(bandStep > 0)) return geometry
  geometry.linesAreTheDrawing = true
  const stepX = (area.maxX - area.minX) / (columns - 1)
  const stepY = (area.maxY - area.minY) / (rows - 1)

  const corner = (row: number, column: number): [number, number, number] => [
    area.minX + column * stepX,
    area.minY + row * stepY,
    matrix[row]?.[column] ?? 0,
  ]

  const crossTriangle = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
  ): void => {
    const low = Math.min(a[2], b[2], c[2])
    const high = Math.max(a[2], b[2], c[2])
    const first = Math.ceil(low / bandStep) * bandStep
    for (let level = first; level <= high; level += bandStep) {
      const hits: Array<[number, number]> = []
      for (const [from, to] of [
        [a, b],
        [b, c],
        [c, a],
      ] as Array<[[number, number, number], [number, number, number]]>) {
        // A level exactly on a corner is counted once, by the edge that leaves
        // it — testing both ends inclusively would emit the same point twice
        // and turn one segment into a zero-length one.
        if (from[2] === to[2]) continue
        const t = (level - from[2]) / (to[2] - from[2])
        if (t < 0 || t >= 1) continue
        hits.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t])
      }
      if (hits.length !== 2) continue
      for (const [x, y] of hits) {
        geometry.positions.push(x, y, level)
        geometry.deviations.push(level)
      }
      const index = geometry.positions.length / 3
      geometry.lines.push(index - 2, index - 1)
    }
  }

  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const a = corner(row, column)
      const b = corner(row, column + 1)
      const c = corner(row + 1, column + 1)
      const d = corner(row + 1, column)
      crossTriangle(a, b, c)
      crossTriangle(a, c, d)
    }
  }
  return geometry
}

export function buildMeshGeometry(input: MeshGeometryInput): MeshGeometry {
  const rows = input.matrix.length
  const columns = input.matrix[0]?.length ?? 0
  if (rows < 2 || columns < 2) return emptyGeometry()
  if (input.style === 'bars') return buildBars(input)
  if (input.style === 'mosaic') return buildMosaic(input)
  if (input.style === 'terraced') return buildTerraced(input)
  if (input.style === 'contour') return buildContour(input)
  return buildSurface(input)
}
