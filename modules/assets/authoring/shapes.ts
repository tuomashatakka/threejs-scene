// modules/assets/authoring/shapes.ts
// The shape vocabulary, compiled.
//
// Every builder returns geometry that EXACTLY fills the requested `size` box and
// is centred on its own origin. That single rule is what makes the dialect
// learnable: the model never reasons about a torus' major/minor radius or a
// cone's base-vs-bounding-box, it says "0.6 wide, 0.2 tall, 0.6 deep" and gets
// exactly that. Builders therefore make a unit shape however three.js likes,
// and `fitToSize` does the rest.

import * as THREE from 'three'

import { FLAT_SHAPES } from './spec.js'

import type { NormalizedPart, ShapeName, SpecVec3 } from './spec.js'


const EPSILON = 1e-6

/**
 * Recentre geometry and scale it so its bounding box is exactly `size`.
 *
 * @returns The same geometry, mutated in place.
 * @remarks An axis with no extent (a plane's thickness) is left alone rather
 * than scaled by infinity, and a zero target scale is skipped — either would
 * produce a singular matrix and NaN normals.
 */
export function fitToSize (geometry: THREE.BufferGeometry, size: SpecVec3): THREE.BufferGeometry {
  geometry.computeBoundingBox()

  const box = geometry.boundingBox
  if (!box)
    return geometry

  const extent = box.getSize(new THREE.Vector3())
  const centre = box.getCenter(new THREE.Vector3())
  geometry.translate(-centre.x, -centre.y, -centre.z)

  // applyMatrix4 (under scale) transforms normals through the normal matrix, so
  // non-uniform scaling stays correctly lit — no recompute needed.
  geometry.scale(
    axisScale(extent.x, size[0]),
    axisScale(extent.y, size[1]),
    axisScale(extent.z, size[2]),
  )
  return geometry
}

function axisScale (extent: number, target: number): number {
  if (extent < EPSILON || target < EPSILON)
    return 1
  return target / extent
}

// Segment counts by detail level. detail 0 is deliberately facetted — a
// low-poly prop is the house style, and it is also the cheapest thing to draw.
const RADIAL_SEGMENTS = [ 6, 16, 32, 48 ]
const HEIGHT_SEGMENTS = [ 4, 12, 20, 32 ]

function level (detail: number, table: number[]): number {
  return table[Math.min(table.length - 1, Math.max(0, Math.round(detail)))] as number
}

/**
 * A ramp: a triangular prism rising from `-z` to `+z`, flat-shaded.
 *
 * @returns Non-indexed geometry — coincident corners stay split so the slope
 * reads as a crease rather than a smear.
 */
function wedgeGeometry (): THREE.BufferGeometry {
  const b000: SpecVec3 = [ -0.5, -0.5, -0.5 ]
  const b100: SpecVec3 = [ 0.5, -0.5, -0.5 ]
  const b101: SpecVec3 = [ 0.5, -0.5, 0.5 ]
  const b001: SpecVec3 = [ -0.5, -0.5, 0.5 ]
  const t101: SpecVec3 = [ 0.5, 0.5, 0.5 ]
  const t001: SpecVec3 = [ -0.5, 0.5, 0.5 ]

  const positions: number[] = []
  const tri                 = (...corners: SpecVec3[]): void => {
    for (const corner of corners)
      positions.push(...corner)
  }
  const quad                = (a: SpecVec3, b: SpecVec3, c: SpecVec3, d: SpecVec3): void => {
    tri(a, b, c); tri(a, c, d)
  }

  quad(b000, b100, b101, b001) // floor, facing down
  quad(b001, b101, t101, t001) // back wall, facing +z
  quad(b000, t001, t101, b100) // the slope
  tri(b100, t101, b101) // +x side
  tri(b000, b001, t001) // -x side

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

/**
 * A lumpy boulder, from the same position-hash displacement the rock prop uses.
 *
 * @param seed - Chooses which boulder; the same seed always gives the same one.
 * @remarks The displacement is a hash of the vertex POSITION, not a random
 * sequence: icosahedron geometry is non-indexed, so a per-vertex random would
 * pull coincident corners apart and tear the shell open.
 */
function rockGeometry (detail: number, seed: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(0.5, Math.min(2, Math.max(0, Math.round(detail))))
  const position = geometry.attributes.position as THREE.BufferAttribute
  const vertex   = new THREE.Vector3()

  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i)

    const h    = Math.sin((vertex.x * 12.9898 + vertex.y * 78.233 + vertex.z * 37.719 + seed) * 43758.5453)
    const bump = h - Math.floor(h)
    vertex.multiplyScalar(0.82 + bump * 0.46)
    position.setXYZ(i, vertex.x, vertex.y, vertex.z)
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

/** Builds the unit geometry for one shape, before {@link fitToSize} stretches it. */
type ShapeBuilder = (part: NormalizedPart, seed: number) => THREE.BufferGeometry

const BUILDERS: Record<ShapeName, ShapeBuilder> = {
  box: () =>
    new THREE.BoxGeometry(1, 1, 1),

  sphere: part =>
    new THREE.SphereGeometry(0.5, level(part.detail, RADIAL_SEGMENTS), level(part.detail, HEIGHT_SEGMENTS)),

  cylinder: part =>
    new THREE.CylinderGeometry(0.5 * part.taper, 0.5, 1, part.sides),

  cone: part =>
    new THREE.ConeGeometry(0.5, 1, part.sides),

  // a 4-sided cone, turned so its faces (not its corners) face the axes
  pyramid: () =>
    new THREE.ConeGeometry(0.5 * Math.SQRT2, 1, 4).rotateY(Math.PI / 4),

  prism: part =>
    new THREE.CylinderGeometry(0.5, 0.5, 1, part.sides).rotateY(Math.PI / part.sides),

  // built at twice the height of its caps so the barrel survives fitToSize
  capsule: part =>
    new THREE.CapsuleGeometry(0.5, 1, level(part.detail, HEIGHT_SEGMENTS) / 2, level(part.detail, RADIAL_SEGMENTS)),

  // laid flat: a torus in the ground plane is a wheel rim, a lid, a halo
  torus: part =>
    new THREE.TorusGeometry(0.5, 0.5 * part.thickness, level(part.detail, RADIAL_SEGMENTS) / 2, level(part.detail, RADIAL_SEGMENTS))
      .rotateX(-Math.PI / 2),

  knot: part =>
    new THREE.TorusKnotGeometry(0.35, 0.35 * part.thickness, level(part.detail, RADIAL_SEGMENTS) * 4, level(part.detail, RADIAL_SEGMENTS) / 2)
      .rotateX(-Math.PI / 2),

  crystal: part =>
    new THREE.OctahedronGeometry(0.5, Math.min(2, Math.max(0, Math.round(part.detail) - 1))),

  rock: (part, seed) =>
    rockGeometry(part.detail, seed),

  wedge: () =>
    wedgeGeometry(),

  plane: () =>
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),

  disc: part =>
    new THREE.CircleGeometry(0.5, level(part.detail, RADIAL_SEGMENTS)).rotateX(-Math.PI / 2),

  ring: part =>
    new THREE.RingGeometry(0.5 * (1 - part.thickness), 0.5, level(part.detail, RADIAL_SEGMENTS)).rotateX(-Math.PI / 2),
}

/**
 * Build the geometry for one normalized part.
 *
 * @param seed - Per-part seed for the shapes that vary (`rock`).
 * @returns Geometry centred on the origin, filling the part's `size` box.
 * @remarks Flat shapes ignore the `y` component of `size` — they have no
 * thickness to stretch.
 */
export function buildShape (part: NormalizedPart, seed = 1): THREE.BufferGeometry {
  const geometry = BUILDERS[part.shape](part, seed)
  const flat     = FLAT_SHAPES.includes(part.shape)
  return fitToSize(geometry, flat ? [ part.size[0], 0, part.size[2] ] : part.size)
}

// perf: one geometry per part (shared across every repeat copy), built once at
// author time. detail 0-1 keeps a whole prop in the low thousands of triangles.
