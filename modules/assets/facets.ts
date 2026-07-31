// modules/assets/facets.ts
// The low-poly look, as tooling.
//
// A flat-shaded prop kit gets its character from baked vertex colours, not from
// textures: every triangle is tinted a little differently, and everything gets
// darker toward the ground. Do that in the geometry and a whole kit — terrain,
// buildings, barrels, wrecks — shares ONE material, which is what lets a few
// hundred props render in a handful of draw calls.
//
// These are the two functions the whole kit is built from, plus the material
// they all share.

import * as THREE from 'three'

import type { SeededRng } from '../../lib/index.js'


/** Options for {@link bakeFacetColors}. */
export interface FacetColorOptions {

  /** Deterministic variation. Omit for an unvaried, flat tint. */
  rng?: SeededRng

  /** Per-facet brightness spread, ±fraction. @defaultValue 0.06 */
  jitter?: number
}

/**
 * Tint every triangle of a geometry, one jittered shade per facet.
 *
 * @param geometry - Must be **non-indexed** — the whole point is that facets do
 * not share vertices, so each gets its own colour. {@link part} handles the
 * conversion; call `toNonIndexed()` yourself otherwise.
 * @returns The same geometry, with a `color` attribute.
 * @example
 * bakeFacetColors(new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), '#8d8579', { rng })
 */
export function bakeFacetColors (
  geometry: THREE.BufferGeometry,
  color: THREE.ColorRepresentation,
  { rng, jitter = 0.06 }: FacetColorOptions = {},
): THREE.BufferGeometry {
  const position = geometry.attributes.position as THREE.BufferAttribute
  const base     = new THREE.Color(color)
  const colors   = new Float32Array(position.count * 3)

  for (let i = 0; i < position.count; i += 3) {
    // one shade per triangle — the three corners of a facet must agree, or
    // flat shading interpolates the jitter back into a gradient
    const shade = 1 + (rng ? rng.next() - 0.5 : 0) * 2 * jitter
    const r     = clamp01(base.r * shade)
    const g     = clamp01(base.g * shade)
    const b     = clamp01(base.b * shade)

    for (let corner = 0; corner < 3 && i + corner < position.count; corner++) {
      colors[(i + corner) * 3]     = r
      colors[(i + corner) * 3 + 1] = g
      colors[(i + corner) * 3 + 2] = b
    }
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

/** Options for {@link applyGrime}. */
export interface GrimeOptions {

  /** Height at which the prop is fully clean, in local units. */
  height: number

  /** Brightness at the very bottom, 0..1. @defaultValue 0.6 */
  floor?: number
}

/**
 * Darken a geometry's vertex colours toward its base — dirt, soot, and ambient
 * occlusion in one pass.
 *
 * This is the cheapest AO there is: it costs nothing at render time and it does
 * most of the work of grounding a prop, because the eye reads "dark where it
 * meets the floor" as contact.
 *
 * @returns The same geometry. Requires a `color` attribute — run
 * {@link bakeFacetColors} (or {@link part}) first.
 */
export function applyGrime (geometry: THREE.BufferGeometry, { height, floor = 0.6 }: GrimeOptions): THREE.BufferGeometry {
  const position = geometry.attributes.position as THREE.BufferAttribute
  const color    = geometry.attributes.color as THREE.BufferAttribute | undefined
  if (!color || height <= 0)
    return geometry

  const span = 1 - floor
  for (let i = 0; i < position.count; i++) {
    const shade = floor + span * clamp01(position.getY(i) / height)
    color.setXYZ(i, color.getX(i) * shade, color.getY(i) * shade, color.getZ(i) * shade)
  }
  color.needsUpdate = true
  return geometry
}

/**
 * The one material a whole flat-shaded kit shares.
 *
 * @returns A {@link THREE.MeshStandardMaterial} reading baked vertex colours.
 * @remarks Share a single instance across every prop, the terrain, and every
 * `InstancedMesh` — distinct materials cost a shader compile each and a state
 * change per draw. Because it is shared, it is **not** owned by any prop: tag it
 * with `markShared` before putting it inside one.
 * @example
 * const material = kitMaterial()
 * scene.add(new THREE.Mesh(buildKitGeometry('barrel-cluster'), material))
 */
export function kitMaterial (overrides: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading:  true,
    roughness:    0.92,
    metalness:    0.04,
    ...overrides,
  })
}

function clamp01 (value: number): number {
  return Math.min(1, Math.max(0, value))
}

// perf: build-time only. Vertex colours are free at render time and they are
// what lets one material serve an entire kit.
