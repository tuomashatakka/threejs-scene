// modules/assets/primitives.ts
// Terse constructors for the handful of primitives a low-poly prop is actually
// built from. `part()` consumes a geometry, so a prop builder writes dozens of
// these — and at that density `cyl(0.1, 0.12, 2.4, 5)` is readable where
// `new THREE.CylinderGeometry(0.1, 0.12, 2.4, 5)` is a wall of noise.
//
// Every one is a factory, never a cached singleton: `part()` transforms and
// bakes into the geometry it is handed, so two props sharing one instance would
// corrupt each other.

import * as THREE from 'three'


/** A box, width × height × depth. */
export const box = (width: number, height: number, depth: number): THREE.BufferGeometry =>
  new THREE.BoxGeometry(width, height, depth)

/** A cylinder or truncated cone, `top` and `bottom` radii. */
export const cyl = (top: number, bottom: number, height: number, sides = 8): THREE.BufferGeometry =>
  new THREE.CylinderGeometry(top, bottom, height, sides)

/** A cone, base radius `radius`. */
export const cone = (radius: number, height: number, sides = 7): THREE.BufferGeometry =>
  new THREE.ConeGeometry(radius, height, sides)

/** A coarse sphere. Ring count follows `segments` so it stays roughly square-facetted. */
export const ball = (radius: number, segments = 6): THREE.BufferGeometry =>
  new THREE.SphereGeometry(radius, segments, Math.max(3, segments - 2))

/**
 * A faceted polyhedron — the cheapest believable boulder, pebble or lump.
 *
 * For a rock with actual noise displaced into its surface reach for
 * `createRockGeometry` instead; this is the flat-facetted primitive, and at
 * `detail = 0` it is twenty triangles.
 */
export const hedron = (radius: number, detail = 0): THREE.BufferGeometry =>
  new THREE.IcosahedronGeometry(radius, detail)

/** A thin plank lying in the xz plane, long axis on x. */
export const plank = (length: number, thickness: number, width: number): THREE.BufferGeometry =>
  new THREE.BoxGeometry(length, thickness, width)

/**
 * An upright strip, centred on the origin and segmented up its length.
 *
 * The segments are the point: `applyTaper` and `applyBend` move vertices, so an
 * unsegmented box tapers into a wedge and refuses to bend at all.
 */
export const blade = (width: number, height: number, segments = 3): THREE.BufferGeometry =>
  new THREE.BoxGeometry(width, height, width * 0.4, 1, segments, 1)

/** Degrees to radians, for readable `rotate` options. */
export const deg = (value: number): number => value * Math.PI / 180

/** Evenly spaced offsets from `-span/2` to `+span/2`, inclusive. */
export function spread (count: number, span: number): number[] {
  if (count <= 1)
    return [ 0 ]

  const step          = span / (count - 1)
  const out: number[] = []

  for (let index = 0; index < count; index += 1)
    out.push(-span / 2 + step * index)

  return out
}
