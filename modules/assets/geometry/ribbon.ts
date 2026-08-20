// modules/assets/geometry/ribbon.ts
// An open strip laid along a polyline and draped onto a surface — a cart rut, a
// stream bed, a footpath, a road, a shoreline of foam.
//
// Distinct from createPathTube, which sweeps a *closed* profile through
// parallel-transport frames in free space. A ribbon stays in the ground plane,
// takes its height from a callback per vertex, and has two edges rather than
// none. That difference is the whole reason it exists: a feature narrower than
// the terrain's own vertex spacing cannot be painted into the terrain at all,
// because there are no vertices there to paint. A strip carries its own, so it
// is as fine as it needs to be and costs the same on every quality tier.
//
// The seam is a colouring problem, not a blending one: give the outer edge the
// colour of whatever it lies on and there is nothing to sort and nothing to
// fade, because the edge already matches its surroundings.

import * as THREE from 'three'


/** A point on the centreline, in the ground plane. */
export interface RibbonPoint {
  x: number
  z: number
}

/** One cross-section: where it sits, which way is sideways, and how far along it is. */
export interface RibbonSection {
  x: number
  z: number

  /** Unit normal in the ground plane. Which of the two sides this is, is arbitrary but consistent. */
  normalX: number
  normalZ: number

  /** Arc length from the start of the path, in world units. */
  along: number
}

/**
 * Resample a polyline at a fixed arc length, with a sideways normal per cut.
 *
 * Fixed *arc length* rather than fixed segment count is what keeps the strip's
 * vertex density even where the polyline's own points bunch up, which they
 * always do after smoothing. The final point of the path is always emitted, so
 * the ribbon reaches its end rather than stopping up to `step` short of it.
 */
export function traceSections (path: readonly RibbonPoint[], step: number): RibbonSection[] {
  const sections: RibbonSection[] = []
  let along                       = 0

  if (step <= 0)
    return sections

  for (let index = 0; index < path.length - 1; index += 1) {
    const a = path[index]
    const b = path[index + 1]

    if (!a || !b)
      continue

    const dx     = b.x - a.x
    const dz     = b.z - a.z
    const length = Math.hypot(dx, dz)

    if (length === 0)
      continue

    const normalX = -dz / length
    const normalZ = dx / length

    for (let cut = 0; cut < length; cut += step) {
      const travel = cut / length

      sections.push({
        x:     a.x + dx * travel,
        z:     a.z + dz * travel,
        normalX,
        normalZ,
        along: along + cut,
      })
    }

    along += length
  }

  const last = path[path.length - 1]
  const tail = sections[sections.length - 1]

  if (tail && last)
    sections.push({ ...tail, x: last.x, z: last.z, along })

  return sections
}

/**
 * The quads of one strip, wound so the ribbon faces up.
 *
 * A section's tangent crossed into its ground-plane normal points down, so the
 * corners have to go across before they go along. Getting that backwards gives
 * a ribbon that is invisible from above and perfect from below, which is a
 * confusing thing to debug from a screenshot.
 */
export function ribbonIndices (first: number, sections: number, across: number): number[] {
  const indices: number[] = []

  for (let section = 0; section < sections - 1; section += 1)
    for (let step = 0; step < across - 1; step += 1) {
      const corner = first + section * across + step

      indices.push(
        corner, corner + 1, corner + across,
        corner + 1, corner + across + 1, corner + across,
      )
    }

  return indices
}

/** One vertex being written, with everything a caller needs to colour it. */
export interface RibbonVertex {
  x: number
  z: number

  /** Signed sideways offset from the centreline, including any `centreAt` shift. */
  offset: number

  /** Index into `across`, for indexing a caller's own per-edge weights. */
  step: number

  /** Normalised position across the ribbon, 0 at the first edge, 1 at the last. */
  u: number

  /** Normalised position along the ribbon, 0 at the start, 1 at the end. */
  v: number

  section: RibbonSection
}

export interface SurfaceRibbonOptions {

  /** The centreline, in the ground plane. */
  path: readonly RibbonPoint[]

  /**
   * Sideways offsets of each lengthwise edge, in world units, in order.
   *
   * Five entries at `[-1, -0.5, 0, 0.5, 1] * width` is the usual shape: the two
   * outer ones carry the untouched surrounding colour and hide the seam, the
   * middle carries the full effect.
   */
  across: readonly number[]

  /** World units between cross-sections along the path. @defaultValue 0.5 */
  step?: number

  /**
   * Height of the ribbon at a point — the surface, plus whatever lift is wanted.
   *
   * Sample the surface *as drawn*, not the underlying continuous field. Wherever
   * the ground curves, the rendered triangles stand off the field by far more
   * than a ribbon's own clearance, so a ribbon laid on the field disappears
   * under the very triangles it is meant to be lying on and comes out dashed.
   */
  heightAt (x: number, z: number): number

  /**
   * Sideways shift of a whole cross-section — a wander, a lane offset, a drift.
   *
   * For two parallel strips off one centreline (wheel ruts, rails, a double
   * track) build the ribbon twice with opposite shifts and merge the results
   * with `mergeGeometryList`.
   */
  centreAt? (section: RibbonSection): number

  /** Colour for one vertex, written into `target`. Omit it and no colour attribute is built. */
  colorAt? (vertex: RibbonVertex, target: THREE.Color): void
}

/**
 * One ribbon as an indexed geometry, or `null` when there is nothing to build.
 *
 * Attributes are `position`, `uv`, computed `normal`, and `color` when
 * `colorAt` is given — which is exactly what a terrain patch carries, so the
 * result merges into a terrain draw and costs no extra draw call.
 */
/** The attribute arrays one ribbon is written into. `colors` is null when nothing colours it. */
interface RibbonBuffers {
  positions: Float32Array
  uvs:       Float32Array
  colors:    Float32Array | null
}

/** Project every cross-section onto the surface, one vertex per edge. */
function writeRibbon (
  sections: readonly RibbonSection[],
  options:  SurfaceRibbonOptions,
  buffers:  RibbonBuffers,
): void {
  const { across, heightAt, centreAt, colorAt } = options
  const { positions, uvs, colors }              = buffers

  const span     = sections[sections.length - 1]?.along || 1
  const lastEdge = across.length - 1
  const sample   = new THREE.Color()

  let vertex = 0

  for (const section of sections) {
    const centre = centreAt ? centreAt(section) : 0
    const v      = section.along / span

    for (let edge = 0; edge < across.length; edge += 1) {
      const offset = centre + (across[edge] ?? 0)
      const x      = section.x + section.normalX * offset
      const z      = section.z + section.normalZ * offset
      const u      = edge / lastEdge

      positions[vertex * 3]     = x
      positions[vertex * 3 + 1] = heightAt(x, z)
      positions[vertex * 3 + 2] = z

      uvs[vertex * 2]     = u
      uvs[vertex * 2 + 1] = v

      if (colors && colorAt) {
        colorAt({ x, z, offset, step: edge, u, v, section }, sample)
        sample.toArray(colors, vertex * 3)
      }

      vertex += 1
    }
  }
}

export function createSurfaceRibbon (options: SurfaceRibbonOptions): THREE.BufferGeometry | null {
  const { path, across, step = 0.5, colorAt } = options

  if (path.length < 2 || across.length < 2)
    return null

  const sections = traceSections(path, step)

  if (sections.length < 2)
    return null

  const count   = sections.length * across.length
  const buffers = {
    positions: new Float32Array(count * 3),
    uvs:       new Float32Array(count * 2),
    colors:    colorAt ? new Float32Array(count * 3) : null,
  }

  writeRibbon(sections, options, buffers)

  const { positions, uvs, colors } = buffers
  const geometry                   = new THREE.BufferGeometry()

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))

  if (colors)
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  geometry.setIndex(ribbonIndices(0, sections.length, across.length))
  geometry.computeVertexNormals()

  return geometry
}
