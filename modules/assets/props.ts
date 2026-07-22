// modules/assets/props.ts
// A small catalogue of ready-made props, built from the material factories.
// Every factory is deterministic: pass the same rng (or none) and you get the
// same geometry, so scenes replay identically. Each returns a Prop that owns
// what it built — call dispose() when you remove it.

import * as THREE from 'three'

import { Prop } from './prop'
import { createStandardMaterial } from './materials'

import type { SeededRng } from '../../lib/index'


/** Shared options for the prop factories. */
export interface PropOptions {

  /** Deterministic randomness. Omit for the canonical (unvaried) form. */
  rng?: SeededRng

  /** Uniform scale applied to the built prop. @defaultValue 1 */
  scale?: number
}

function jitter (rng: SeededRng | undefined, amount: number): number {
  return rng ? rng.range(-amount, amount) : 0
}

function finish (prop: Prop, scale: number): Prop {
  if (scale !== 1)
    prop.scale.setScalar(scale)
  return prop
}

/** Options for {@link crystalProp}. */
export interface CrystalOptions extends PropOptions {
  color?: THREE.ColorRepresentation

  /** Emissive gain; raise above 1 to make it bloom. @defaultValue 2.5 */
  glow?: number
}

/**
 * A faceted crystal shard with an emissive core — the canonical "glowing pickup".
 *
 * @returns A {@link Prop} with parts `shell` and `core`.
 * @remarks The core is emissive above 1 so a bloom pass picks it up.
 */
export function crystalProp ({ rng, scale = 1, color = '#79f7ff', glow = 2.5 }: CrystalOptions = {}): Prop {
  const prop = new Prop('crystal')

  const shell = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.5 + jitter(rng, 0.08), 0),
    createStandardMaterial('glass', { color, thickness: 0.35, roughness: 0.08 }),
  )
  shell.scale.y = 1.8 + jitter(rng, 0.3)

  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.22, 0),
    createStandardMaterial('emissive', { emissive: color, emissiveIntensity: glow }),
  )
  core.scale.y = 1.8

  return finish(prop.addPart('shell', shell).addPart('core', core), scale)
}

/** Options for {@link rockProp}. */
export interface RockOptions extends PropOptions {
  color?: THREE.ColorRepresentation
}

/**
 * A low-poly boulder — flat-shaded, vertex-displaced, no two alike when seeded.
 *
 * @returns A {@link Prop} with a single part `body`.
 */
export function rockProp ({ rng, scale = 1, color = '#7c776e' }: RockOptions = {}): Prop {
  const geometry = new THREE.IcosahedronGeometry(0.5, 1)
  const position = geometry.attributes.position as THREE.BufferAttribute
  const vertex   = new THREE.Vector3()

  // A per-rock phase so seeded rocks each differ, fed through a hash of the
  // vertex POSITION rather than the rng sequence. Icosahedron geometry is
  // non-indexed — every corner is duplicated across the faces that meet there —
  // so displacing by the rng sequence moves those duplicates apart and tears
  // the shell into gaps (the reason the old rocks read as shattered blobs, not
  // stones). Hashing the position instead moves coincident corners together,
  // keeping the boulder watertight.
  const phase = rng ? rng.range(0, 100) : 0

  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i)

    const h    = Math.sin((vertex.x * 12.9898 + vertex.y * 78.233 + vertex.z * 37.719 + phase) * 43758.5453)
    const bump = h - Math.floor(h) // 0..1, identical for coincident corners
    vertex.multiplyScalar(0.82 + bump * 0.46) // lumpy, but a closed surface
    vertex.y *= 0.68 // squat: a boulder sits wider than it stands tall
    position.setXYZ(i, vertex.x, vertex.y, vertex.z)
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()

  const body         = new THREE.Mesh(geometry, createStandardMaterial('matte', { color, roughness: 0.94, flatShading: true }))
  body.castShadow    = true
  body.receiveShadow = true

  return finish(new Prop('rock').addPart('body', body), scale)
}

/** Options for {@link treeProp}. */
export interface TreeOptions extends PropOptions {
  trunkColor?:  THREE.ColorRepresentation
  canopyColor?: THREE.ColorRepresentation
}

/**
 * A stylised conifer: tapered trunk plus two stacked canopy cones.
 *
 * @returns A {@link Prop} with parts `trunk`, `canopyLower`, and `canopyUpper`.
 */
export function treeProp ({
  rng,
  scale = 1,
  trunkColor = '#4a3728',
  canopyColor = '#3f7d52',
}: TreeOptions = {}): Prop {
  const height = 1.6 + jitter(rng, 0.35)
  const prop   = new Prop('tree')

  const trunkMaterial  = createStandardMaterial('matte', { color: trunkColor, flatShading: true })
  const canopyMaterial = createStandardMaterial('matte', { color: canopyColor, flatShading: true })

  const trunk      = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, height * 0.5, 6), trunkMaterial)
  trunk.position.y = height * 0.25

  const lower      = new THREE.Mesh(new THREE.ConeGeometry(0.42, height * 0.55, 7), canopyMaterial)
  lower.position.y = height * 0.6

  const upper      = new THREE.Mesh(new THREE.ConeGeometry(0.3, height * 0.45, 7), canopyMaterial)
  upper.position.y = height * 0.95

  for (const mesh of [ trunk, lower, upper ]) {
    mesh.castShadow    = true
    mesh.receiveShadow = true
  }

  return finish(
    prop.addPart('trunk', trunk).addPart('canopyLower', lower)
      .addPart('canopyUpper', upper),
    scale,
  )
}

/** Options for {@link boatProp}. */
export interface BoatOptions extends PropOptions {
  hullColor?: THREE.ColorRepresentation
  sailColor?: THREE.ColorRepresentation
}

/**
 * A little low-poly sailing dinghy: a pinched hull, a mast, and one triangular
 * sail. Long axis runs along +z, so point it downwind with `rotation.y`.
 *
 * @returns A {@link Prop} with parts `hull`, `mast`, and `sail`.
 */
export function boatProp ({ rng, scale = 1, hullColor = '#8a4436', sailColor = '#ece7d9' }: BoatOptions = {}): Prop {
  const prop = new Prop('boat')

  // Hull: a low box pinched toward a bow at +z and lifted at the prow, so it
  // reads as a dinghy rather than a floating crate. BoxGeometry is indexed, so
  // moving a shared corner moves it for every face — the shell stays closed.
  const hullGeo = new THREE.BoxGeometry(0.42, 0.22, 0.96)
  const hullPos = hullGeo.attributes.position as THREE.BufferAttribute
  const vertex  = new THREE.Vector3()
  for (let i = 0; i < hullPos.count; i++) {
    vertex.fromBufferAttribute(hullPos, i)

    const bow = Math.max(0, vertex.z / 0.48) // 0 amidships .. 1 at the bow
    vertex.x *= 1 - 0.62 * bow // pinch the bow
    if (vertex.y > 0)
      vertex.y += 0.05 * bow // lift the prow
    hullPos.setXYZ(i, vertex.x, vertex.y, vertex.z)
  }
  hullPos.needsUpdate = true
  hullGeo.computeVertexNormals()

  const hull      = new THREE.Mesh(hullGeo, createStandardMaterial('matte', { color: hullColor, flatShading: true }))
  hull.position.y = 0.05
  hull.castShadow = true

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.025, 0.6, 5),
    createStandardMaterial('matte', { color: '#4a3728' }),
  )
  mast.position.set(0, 0.4, 0.03)
  mast.castShadow = true

  // A single triangular sail in the x = 0 plane, luffing up the mast and back.
  const sailGeo = new THREE.BufferGeometry()
  sailGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0.09, 0.05, 0, 0.67, 0.05, 0, 0.15, 0.42,
  ], 3))
  sailGeo.computeVertexNormals()

  const sail      = new THREE.Mesh(sailGeo, createStandardMaterial('matte', { color: sailColor, flatShading: true, side: THREE.DoubleSide }))
  sail.castShadow = true

  prop.addPart('hull', hull).addPart('mast', mast)
    .addPart('sail', sail)
  return finish(prop, scale * (1 + jitter(rng, 0.12)))
}

/** Options for {@link cloudProp}. */
export interface CloudOptions extends PropOptions {
  color?: THREE.ColorRepresentation
}

/**
 * A low-poly cloud: a clump of squashed, flat-shaded icosahedron puffs. Cheap
 * and deliberately faceted — a handful drifting overhead reads as weather
 * without a particle system.
 *
 * @returns A {@link Prop} whose parts are `puff0`, `puff1`, … in order.
 */
export function cloudProp ({ rng, scale = 1, color = '#eef1f6' }: CloudOptions = {}): Prop {
  const prop     = new Prop('cloud')
  // one material shared across the puffs — Prop.dispose dedupes it and frees it once
  const material = createStandardMaterial('matte', { color, roughness: 1, flatShading: true })
  const puffs    = 4 + Math.round(rng ? rng.range(0, 3) : 1)

  for (let i = 0; i < puffs; i++) {
    const radius = 0.6 + jitter(rng, 0.28)
    const puff   = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 0), material)
    puff.position.set((i - (puffs - 1) / 2) * 0.7 + jitter(rng, 0.18), jitter(rng, 0.16), jitter(rng, 0.5))
    puff.scale.set(1, 0.62, 1) // squashed: clouds spread wider than they are tall
    prop.addPart(`puff${i}`, puff)
  }
  return finish(prop, scale)
}

/** Options for {@link lampPostProp}. */
export interface LampPostOptions extends PropOptions {
  lightColor?: THREE.ColorRepresentation

  /** Attach a real {@link THREE.PointLight} to the bulb. @defaultValue false */
  withLight?: boolean
}

/**
 * A lamp post with an emissive bulb, optionally carrying a real point light.
 *
 * @returns A {@link Prop} with parts `post` and `bulb` (plus `light` when requested).
 * @remarks Lights are not free — prefer the emissive bulb alone for set
 * dressing and enable `withLight` only for the few that must actually cast.
 */
export function lampPostProp ({
  scale = 1,
  lightColor = '#ffd9a0',
  withLight = false,
}: LampPostOptions = {}): Prop {
  const prop = new Prop('lamp-post')

  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.06, 2, 8),
    createStandardMaterial('metal', { color: '#2f333b', roughness: 0.6 }),
  )
  post.position.y = 1
  post.castShadow = true

  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 16, 12),
    createStandardMaterial('emissive', { emissive: lightColor, emissiveIntensity: 3 }),
  )
  bulb.position.y = 2.05

  prop.addPart('post', post).addPart('bulb', bulb)

  if (withLight) {
    const light      = new THREE.PointLight(lightColor, 4, 8, 2)
    light.position.y = 2.05
    prop.addPart('light', light)
  }

  return finish(prop, scale)
}

// perf: one draw call per part. For fields of these, build one and instance it
// rather than calling the factory per placement.
