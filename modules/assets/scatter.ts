// modules/assets/scatter.ts
// Where props go, and how they get drawn.
//
// Two jobs, deliberately separate.
//
// `createPlacementField` is a solver: you describe the RULES — keep 2m clear of
// anything already placed, stay off the road, stay above the waterline, inside
// this ring — and it finds coordinates that satisfy them. That split is the one
// lesson the LLM-scene literature agrees on (Holodeck, SceneCraft): a model that
// cannot estimate metric distance can still state a relation, so let it declare
// constraints and let a solver do the arithmetic. It is equally the right split
// for a human author, who also does not want to hand-place four hundred rocks.
//
// `scatterInstances` is the draw-call half: one geometry, N transforms, one
// `InstancedMesh`, optional per-instance tint so identical geometry does not
// read as identical objects.

import * as THREE from 'three'

import type { SeededRng, Vec3 } from '../../lib/index.js'


/** A claimed circle on the ground plane. */
export interface Claim {
  x: number
  z: number

  /** Keep-out radius, in metres. */
  radius: number
}

/** Rules for one placement attempt. */
export interface PlacementQuery {

  /** Keep-out radius for the thing being placed, in metres. */
  radius: number

  /** Nearest the field origin it may land. @defaultValue 0 */
  minDistance?: number

  /** Furthest from the field origin it may land. @defaultValue the field's `extent` */
  maxDistance?: number

  /** Reject anything whose |x| is under this — a road, a runway, a corridor. */
  avoidCorridor?: number

  /** Tries before giving up. @defaultValue 60 */
  attempts?: number
}

/** Options for {@link createPlacementField}. */
export interface PlacementFieldOptions {

  /** Deterministic placement. Same seed → same layout, every load. */
  rng: SeededRng

  /** Radius of the field, in metres. */
  extent: number

  /**
   * Ground height at a point. Used to reject placements below `minHeight` —
   * that is how props stay out of lakes without anyone listing the lakes.
   */
  heightAt?: (x: number, z: number) => number

  /** Reject ground below this height. @defaultValue -Infinity */
  minHeight?: number

  /** Circles that are occupied before anything is placed. */
  claims?: readonly Claim[]
}

/** A solver that turns placement rules into coordinates. */
export interface PlacementField {

  /**
   * Find a free spot, or `null` when the field is too crowded to satisfy the
   * query. A returned spot is claimed — the next call will avoid it.
   */
  place (query: PlacementQuery): { x: number, z: number } | null

  /** Claim a circle manually, for things placed by other means. */
  reserve (x: number, z: number, radius: number): void

  /** Everything claimed so far, in claim order. */
  readonly claims: readonly Claim[]
}

/**
 * Build a placement solver over a circular field.
 *
 * @returns A {@link PlacementField}. Ask it for spots; it enforces spacing,
 * range, corridors and ground height.
 * @remarks Sampling is `sqrt(random) * maxDistance`, which distributes points
 * evenly over the disc — sampling the radius linearly instead crowds everything
 * into the middle, the classic scatter bug.
 * @example
 * const field = createPlacementField({ rng, extent: 64, heightAt, minHeight: -0.3 })
 * const spot  = field.place({ radius: 2.7, minDistance: 10, avoidCorridor: 4.8 })
 */
export function createPlacementField ({
  rng,
  extent,
  heightAt,
  minHeight = -Infinity,
  claims = [],
}: PlacementFieldOptions): PlacementField {
  const taken: Claim[] = [ ...claims ]

  return {
    claims: taken,

    reserve (x, z, radius) {
      taken.push({ x, z, radius })
    },

    place ({ radius, minDistance = 0, maxDistance = extent, avoidCorridor = 0, attempts = 60 }) {
      for (let attempt = 0; attempt < attempts; attempt++) {
        const angle    = rng.next() * Math.PI * 2
        const distance = Math.sqrt(rng.next()) * maxDistance
        const x        = Math.cos(angle) * distance
        const z        = Math.sin(angle) * distance

        if (distance < minDistance)
          continue
        if (avoidCorridor > 0 && Math.abs(x) < avoidCorridor)
          continue
        if (heightAt && heightAt(x, z) < minHeight)
          continue
        if (!taken.every(claim => Math.hypot(claim.x - x, claim.z - z) > claim.radius + radius))
          continue

        taken.push({ x, z, radius })
        return { x, z }
      }
      return null
    },
  }
}

/** What {@link scatterInstances} asks for each instance. */
export interface InstancePlacement {

  /** World position. */
  at: Vec3

  /** Euler rotation in radians. @defaultValue `[0, 0, 0]` */
  rotate?: Vec3

  /** Uniform scale. @defaultValue 1 */
  scale?: number

  /** Per-instance tint, multiplied into the baked vertex colours. */
  tint?: THREE.ColorRepresentation
}

/** Options for {@link scatterInstances}. */
export interface ScatterOptions {

  /** The geometry to stamp. Not owned — dispose it yourself. */
  geometry: THREE.BufferGeometry

  /** The material to draw with. Not owned. */
  material: THREE.Material

  /** How many instances to allocate. */
  count: number

  /**
   * Where instance `index` goes. Return `null` to leave that slot empty — it is
   * scaled to zero rather than dropped, so the count stays fixed and no
   * reallocation happens.
   */
  place: (index: number) => InstancePlacement | null
}

/** An {@link THREE.InstancedMesh} plus how many slots were actually filled. */
export interface ScatterResult {
  mesh: THREE.InstancedMesh

  /** Instances that got a real placement. */
  placed: number
}

/**
 * Stamp one geometry many times into a single draw call.
 *
 * @returns The mesh (already shadow-enabled) and the number of filled slots.
 * @remarks Per-instance colour is a *multiplier* on the baked vertex colours, so
 * a tint near white varies the shade and a saturated tint repaints the prop —
 * which is how one container geometry becomes a rusted yard of different
 * containers.
 * @example
 * const { mesh } = scatterInstances({
 *   geometry, material, count: 40,
 *   place: () => {
 *     const spot = field.place({ radius: 1.2 })
 *     return spot && { at: [ spot.x, heightAt(spot.x, spot.z), spot.z ], rotate: [ 0, rng.next() * 6.28, 0 ] }
 *   },
 * })
 */
export function scatterInstances ({ geometry, material, count, place }: ScatterOptions): ScatterResult {
  const mesh  = new THREE.InstancedMesh(geometry, material, count)
  const dummy = new THREE.Object3D()
  const tint  = new THREE.Color()
  let placed = 0

  mesh.castShadow    = true
  mesh.receiveShadow = true

  for (let index = 0; index < count; index++) {
    const placement = place(index)

    if (placement) {
      const [ x, y, z ] = placement.at
      const rotate      = placement.rotate ?? [ 0, 0, 0 ]
      dummy.position.set(x, y, z)
      dummy.rotation.set(rotate[0], rotate[1], rotate[2])
      dummy.scale.setScalar(placement.scale ?? 1)
      tint.set(placement.tint ?? '#ffffff')
      placed++
    }
    else {
      // an empty slot is scaled to nothing: keeps the buffer a fixed size, and
      // a zero-scale instance is culled by the GPU for free
      dummy.position.set(0, 0, 0)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.setScalar(0)
      tint.setRGB(1, 1, 1)
    }

    dummy.updateMatrix()
    mesh.setMatrixAt(index, dummy.matrix)
    mesh.setColorAt(index, tint)
  }

  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor)
    mesh.instanceColor.needsUpdate = true

  return { mesh, placed }
}

// perf: one draw call per scattered TYPE, regardless of count. The solver is
// O(attempts × claims) per placement — fine for the low thousands; past that,
// swap the linear claim scan for a grid hash.
