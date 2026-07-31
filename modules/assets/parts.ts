// modules/assets/parts.ts
// Build a prop out of primitives, then collapse it into ONE geometry.
//
// A ruined building is twelve boxes and some rubble. Kept as twelve meshes it is
// twelve draw calls and cannot be instanced; baked into one geometry it is one
// draw call and can be stamped forty times through a single `InstancedMesh`.
// That is the entire trade this file exists to make.
//
// The merge itself is `BufferGeometryUtils.mergeGeometries` from three's own
// addons rather than a hand-rolled attribute copier — it handles morph targets,
// groups and index states we would otherwise get wrong.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

import { applyGrime, bakeFacetColors } from './facets.js'

import type { Vec3 } from '../../lib/index.js'
import type { SeededRng } from '../../lib/index.js'


/** Placement and finish for one primitive in a prop. */
export interface PartOptions {

  /** Local position, in metres. @defaultValue `[0, 0, 0]` */
  at?: Vec3

  /** Local rotation in RADIANS, applied x then y then z. @defaultValue `[0, 0, 0]` */
  rotate?: Vec3

  /** Scale, uniform or per axis, applied before rotation. @defaultValue 1 */
  scale?: Vec3 | number

  /** Baked tint. @defaultValue `'#8d8579'` */
  color?: THREE.ColorRepresentation

  /** Per-facet brightness spread. @defaultValue 0.06 */
  jitter?: number

  /** Deterministic variation for the facet jitter. */
  rng?: SeededRng
}

/**
 * Transform a primitive into place and bake its colour into the vertices.
 *
 * The geometry is **consumed**: it is converted to non-indexed (so facets can be
 * tinted independently) and baked in local space, ready to be merged. Do not
 * reuse the geometry you passed in.
 *
 * @returns A new, non-indexed, transformed, vertex-coloured geometry.
 * @example
 * part(new THREE.BoxGeometry(3.4, 2.6, 0.22), { at: [ 0, 1.3, 1.19 ], color: '#8d8579', rng })
 */
export function part (geometry: THREE.BufferGeometry, options: PartOptions = {}): THREE.BufferGeometry {
  const {
    at = [ 0, 0, 0 ],
    rotate = [ 0, 0, 0 ],
    scale = 1,
    color = '#8d8579',
    jitter = 0.06,
    rng,
  } = options

  // non-indexed is a hard requirement, not a preference: shared corners cannot
  // carry two different facet colours, and flat shading needs split normals
  const baked = geometry.index ? geometry.toNonIndexed() : geometry
  if (baked !== geometry)
    geometry.dispose()

  transform(baked, at, rotate, scale)
  return bakeFacetColors(baked, color, { rng, jitter })
}

/** Scale, then rotate, then move — the order that makes a stretched post lie down. */
function transform (geometry: THREE.BufferGeometry, at: Vec3, rotate: Vec3, scale: Vec3 | number): void {
  const [ sx, sy, sz ] = typeof scale === 'number' ? [ scale, scale, scale ] : scale
  if (sx !== 1 || sy !== 1 || sz !== 1)
    geometry.scale(sx, sy, sz)

  if (rotate[0])
    geometry.rotateX(rotate[0])
  if (rotate[1])
    geometry.rotateY(rotate[1])
  if (rotate[2])
    geometry.rotateZ(rotate[2])

  geometry.translate(at[0], at[1], at[2])
}

/** Options for {@link mergeParts}. */
export interface MergePartsOptions {

  /** Darken toward the base over this height, in metres. Skipped when absent. */
  grime?: number

  /** Brightness at the very bottom when `grime` is set, 0..1. @defaultValue 0.6 */
  grimeFloor?: number
}

/**
 * Collapse baked parts into one geometry, and dispose the parts.
 *
 * @param parts - Geometries from {@link part}. They are disposed here — the
 * merged result is the only thing left to own.
 * @returns One geometry with position, normal, uv and color.
 * @throws Error when `parts` is empty, or when the parts disagree on attributes
 * (which means one of them did not come through {@link part}).
 * @example
 * const geometry = mergeParts([ wall, roof, rubble ], { grime: 2.6 })
 */
export function mergeParts (parts: THREE.BufferGeometry[], { grime, grimeFloor }: MergePartsOptions = {}): THREE.BufferGeometry {
  if (parts.length === 0)
    throw new Error('mergeParts: nothing to merge')

  const merged = mergeGeometries(parts, false)
  if (!merged)
    throw new Error('mergeParts: the parts disagree on attributes — build every one with part()')

  for (const geometry of parts)
    geometry.dispose()

  if (grime !== undefined)
    applyGrime(merged, { height: grime, floor: grimeFloor })

  return merged
}

// perf: one merged geometry per prop TYPE, built once. The saving is at draw
// time — 12 boxes become 1 draw call, and only a single geometry can instance.
